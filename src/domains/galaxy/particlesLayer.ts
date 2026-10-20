/**
 * Star particles of the reconstructed Milky Way: bulge/bar, thin + thick disc, young arm stars, HII knots, open clusters
 * and the stellar halo (model.ts `generateGalaxyParticles`). Each particle stands for a star cloud, not one star: it adds
 * the resolved sparkle on top of the volumetric light (volumeLayer.ts) and follows the same visibility.
 *
 * Hand-off with the stars domain: its real catalogue covers ≤ 1.1 kpc around the Sun and fades out between 3 and 30 kpc
 * fields (skyExposureForScale). Particles inside that sphere are weighted by (1 − catalogue opacity), so no star cloud is
 * drawn twice and nothing pops. Placement is camera-relative (float64 on the CPU, float32 kpc in the buffer).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { KPC_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { skyExposureForScale } from '../stars/photometry';
import { buildShuffledParticlesAsync } from './particlesGen';
import { galaxyRuntime } from './runtime';
import { galaxyVolumeVisibility } from './volumeLayer';

/** Radius of the stars domain's catalogue sphere (kpc). */
const CATALOGUE_KPC = 1.1;
const MAX_PARTICLES = 320_000;

const VERT = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 color;
attribute float lum;
uniform float uPixelRatio;
uniform float uGain;
uniform float uOpacity;
uniform vec3 uSunKpc;
uniform float uHole;
uniform vec3 uCamKpc;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
  float d = length(position - uCamKpc);
  // Star clouds: brightness grows as 1/d² towards the camera but saturates (a cloud is extended), and fades out
  // within ~40 pc so the camera never flies through a blob.
  float near = min((12.0 / max(d, 1e-3)) * (12.0 / max(d, 1e-3)), 5.0) * smoothstep(0.015, 0.06, d);
  float hole = mix(1.0, smoothstep(CATALOGUE * 0.75, CATALOGUE, length(position - uSunKpc)), uHole);
  float I = lum * uGain * near * hole * uOpacity;
  float size = clamp(1.2 + 0.7 * sqrt(lum * near), 1.2, 3.4);
  vCol = color * I;
  gl_PointSize = I > 1e-4 ? size * uPixelRatio : 0.0;
}`.replace('CATALOGUE', CATALOGUE_KPC.toFixed(3)).replace('CATALOGUE', CATALOGUE_KPC.toFixed(3));

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vCol;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-3.0 * r2), 1.0);
}`;

export interface GalaxyParticlesHandle {
  /** Particles drawn this frame (0 while hidden or not generated yet). */
  readonly drawn: number;
}

export function createGalaxyParticlesLayer(): Layer & GalaxyParticlesHandle {
  const rt = galaxyRuntime();
  const f = rt.frame;
  let points: THREE.Points | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  let generated = false, generating = false, total = 0, drawn = 0, opacity = 0;
  const exposure = { refMag: 0, exposure: 0, limitMag: 0, limitSoftness: 0, opacity: 0 };
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z), new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z), new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z),
  );
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  let svcRef: EngineServices | null = null;

  function generate(budget: number): void {
    generating = true;
    // Generated in a worker (was a 100-340 ms main-thread task when the galaxy first came into view).
    const n = Math.min(MAX_PARTICLES, Math.max(40_000, Math.round(budget * 0.8)));
    void buildShuffledParticlesAsync(n).then(({ count, pos, col, lum }) => {
      if (!svcRef || !mat) { generating = false; return; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('lum', new THREE.BufferAttribute(lum, 1));
      points = new THREE.Points(geo, mat);
      points.name = 'galaxy-particles';
      points.frustumCulled = false;
      points.matrixAutoUpdate = false;
      points.visible = false;
      points.renderOrder = -40;
      svcRef.groups.transparent.add(points);
      total = count;
      generated = true;
      generating = false;
    });
  }

  const sunGal = { x: 0, y: 0, z: 0 };
  const camGal = { x: 0, y: 0, z: 0 };
  const toGal = (w: THREE.Vector3 | { x: number; y: number; z: number }, out: { x: number; y: number; z: number }): void => {
    const dx = w.x - f.origin.x, dy = w.y - f.origin.y, dz = w.z - f.origin.z;
    out.x = (dx * f.ex.x + dy * f.ex.y + dz * f.ex.z) / KPC_M;
    out.y = (dx * f.ey.x + dy * f.ey.y + dz * f.ey.z) / KPC_M;
    out.z = (dx * f.ez.x + dy * f.ez.y + dz * f.ez.z) / KPC_M;
  };

  return {
    id: 'galaxy-particles',
    get drawn() { return drawn; },

    init(svc: EngineServices): void {
      svcRef = svc;
      mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPixelRatio: { value: 1 },
          uGain: { value: 0.35 },
          uOpacity: { value: 0 },
          uSunKpc: { value: new THREE.Vector3() },
          uHole: { value: 1 },
          uCamKpc: { value: new THREE.Vector3() },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      toGal({ x: 0, y: 0, z: 0 }, sunGal);
      (mat.uniforms.uSunKpc.value as THREE.Vector3).set(sunGal.x, sunGal.y, sunGal.z);
    },

    update(ctx: FrameContext): void {
      if (!mat) return;
      const cam = ctx.cameraPosition;
      const o = f.origin;
      const dGc = Math.hypot(cam.x - o.x, cam.y - o.y, cam.z - o.z);
      const target = galaxyVolumeVisibility(cam.length(), dGc);
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 4);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      if (opacity > 0.002 && !generated && !generating) generate(ctx.quality.particleBudget);
      if (!points) { drawn = 0; return; }
      points.visible = opacity > 0.002;
      if (!points.visible) { drawn = 0; return; }
      drawn = Math.min(total, Math.max(20_000, Math.round(ctx.quality.particleBudget * 0.8)));
      points.geometry.setDrawRange(0, drawn);
      // Camera-relative placement: render = (origin − camera)/mpu, rotated into the Galactocentric basis, kpc → render units.
      const s = KPC_M / ctx.metersPerUnit;
      points.position.set((o.x - cam.x) / ctx.metersPerUnit, (o.y - cam.y) / ctx.metersPerUnit, (o.z - cam.z) / ctx.metersPerUnit);
      points.quaternion.copy(q);
      points.scale.setScalar(s);
      points.updateMatrix();
      points.updateMatrixWorld(true);
      toGal(cam, camGal);
      const u = mat.uniforms;
      (u.uCamKpc.value as THREE.Vector3).set(camGal.x, camGal.y, camGal.z);
      u.uOpacity.value = opacity;
      u.uPixelRatio.value = ctx.viewport.pixelRatio;
      // Catalogue stars present → hide the particles they replace (and keep the hole closed once they have faded).
      skyExposureForScale(ctx.scaleLog10, exposure);
      const camFromSun = cam.length();
      u.uHole.value = camFromSun < 3 * CATALOGUE_KPC * KPC_M ? exposure.opacity : 0;

    },

    dispose(): void {
      points?.removeFromParent();
      points?.geometry.dispose();
      mat?.dispose();
      points = null; mat = null; svcRef = null;
    },
  };
}
