/**
 * Asteroid belt as a GPU Kepler point cloud: 75,855 numbered asteroids (H < 15) from asteroids.bin, each propagated on the
 * GPU from its osculating elements (render-kit kepler.ts solver) at the simulation time. Colour is a subtle tint per orbital
 * class (main belt tan, Hildas/outer belt cool, Mars-crossers warm, Jupiter Trojans teal, Centaurs/TNOs reddish); the
 * near-Earth objects of neos.json (3,449 incl. all 2,550 PHAs) are drawn on top with a cyan tint (PHAs amber) and are
 * pickable. Positions are float32 relative to the Sun's centre; the cloud object is placed with ctx.toRender(sun).
 * Overlay: 'asteroids' (off by default in the store). Highlighting NEOs: setNeoHighlight().
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer, PickHit } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { KEPLER_GLSL } from '../../render/glsl/kepler';
import { PSF_GLSL } from '../../render/glsl/psf';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { jdTdbFromMs, heliocentricIcrsM } from './orbits';
import { loadNeoCatalog, neoElements, type NeoRow } from './neoApi';
import { sunSource } from './sources';
import { neoEntityId } from './neoProvider';

interface AsteroidHeader {
  count: number;
  stride: number;
  epochBaseJD: number;
  classCodes: Record<string, number>;
}

const state = { neoHighlight: true };
/** Draw the near-Earth objects in a contrasting tint on top of the belt (default on). */
export function setNeoHighlight(on: boolean): void {
  state.neoHighlight = on;
}
export const isNeoHighlightOn = (): boolean => state.neoHighlight;

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
${KEPLER_GLSL}
attribute vec4 aEl0;   // a [au], e, inc [rad], node [rad]
attribute vec4 aEl1;   // argPeri [rad], M0 [rad], epoch offset [d], H
attribute float aClass;
uniform float uDays;          // simulation JD TDB − epochBaseJD
uniform mat3 uEclToIcrs;
uniform float uUnitsPerAu;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uSize;
uniform float uInnerFade;     // NEO cloud: alpha multiplier for objects inside ~1.6 AU of the Sun
uniform vec3 uPalette[16];
varying vec3 vColor;
varying float vSizePx;

void main() {
  float a = aEl0.x;
  float n = 0.01720209895 / (a * sqrt(a));
  float M = keplerMeanAnomaly(aEl1.y, n, uDays - aEl1.z);
  vec3 p = keplerPosition(a, aEl0.y, aEl0.z, aEl0.w, aEl1.x, M);
  vec3 icrs = uEclToIcrs * p;
  vec4 mv = modelViewMatrix * vec4(icrs * uUnitsPerAu, 1.0);
  gl_Position = projectionMatrix * mv;
  float bright = clamp((15.0 - aEl1.w) * 0.1, 0.0, 1.6);
  // Size by absolute magnitude H (brighter = bigger), 1-2.5 px; alpha x0.6.
  vSizePx = clamp(uSize + bright, 1.0, 2.5);
  gl_PointSize = (vSizePx + 2.0) * uPixelRatio; // + 1 CSS px padding per side for the pixel-filtered PSF
  float inner = mix(uInnerFade, 1.0, smoothstep(1.2, 1.8, length(p)));
  vColor = uPalette[int(aClass)] * (0.42 + 0.5 * clamp(bright, 0.0, 1.0)) * uOpacity * 0.6 * inner;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform float uPixelRatio;
varying vec3 vColor;
varying float vSizePx;
${PSF_GLSL}
void main() {
  ${LOGDEPTH_FRAGMENT}
  // Pixel-filtered Gaussian in a padded sprite (render kit psfSprite) with the mean flux of the former shader
  // (≈ 0.125·size²), but independent of the sub-pixel position: 1–3 px dots no longer twinkle as they move.
  float a = psfSprite(gl_PointCoord, vSizePx, 0.35 + 0.15 * vSizePx, uPixelRatio) * (0.13 * vSizePx * vSizePx);
  if (a < 1e-4) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Class palette (index = SBDB class code in asteroids.json). Scene-linear, deliberately muted. */
function buildPalette(): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) p.push(new THREE.Vector3(0.7, 0.68, 0.64));
  const set = (i: number, r: number, g: number, b: number): void => { p[i].set(r, g, b); };
  set(0, 0.75, 0.68, 0.6);   // MBA main belt: warm grey
  set(1, 0.78, 0.68, 0.58);  // IMB inner belt: slightly warmer
  set(2, 0.7, 0.67, 0.64);   // OMB outer belt: neutral warm grey
  set(3, 1.0, 0.62, 0.4);    // MCA Mars-crossers: orange
  set(4, 0.45, 0.82, 1.0);   // APO
  set(5, 0.45, 0.82, 1.0);   // ATE
  set(6, 0.45, 0.82, 1.0);   // AMO
  set(7, 0.45, 0.82, 1.0);   // IEO
  set(8, 0.78, 0.7, 0.9);    // HUN
  set(9, 1.0, 0.55, 0.22);   // PHO (we use code 9 for PHAs in the NEO layer)
  set(10, 0.52, 0.86, 0.78); // TJN Jupiter Trojans: teal
  set(11, 1.0, 0.6, 0.42);   // CEN
  set(12, 0.96, 0.58, 0.56); // TNO: dusty rose
  set(13, 0.45, 0.82, 1.0);  // AST (other NEO)
  set(14, 0.8, 0.8, 0.8);
  set(15, 0.8, 0.8, 0.8);
  return p;
}

const ECL_TO_ICRS = new THREE.Matrix3();
{
  const eps = 23.4392911 * DEG;
  const c = Math.cos(eps), s = Math.sin(eps);
  // Column-major: rotation about x by ε (matches core/frames eclipticToIcrs).
  ECL_TO_ICRS.set(1, 0, 0, 0, c, -s, 0, s, c);
}

function makeMaterial(palette: THREE.Vector3[], size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uDays: { value: 0 },
      uEclToIcrs: { value: ECL_TO_ICRS },
      uUnitsPerAu: { value: 1 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 0 },
      uInnerFade: { value: 1 },
      uSize: { value: size },
      uPalette: { value: palette },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

function buildGeometry(rows: ArrayLike<number>, count: number, stride: number, classOf?: (i: number) => number): THREE.BufferGeometry {
  const el0 = new Float32Array(count * 4);
  const el1 = new Float32Array(count * 4);
  const cls = new Float32Array(count);
  const pos = new Float32Array(count * 3); // unused by the shader (three.js needs a position attribute)
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    el0[4 * i] = rows[o];
    el0[4 * i + 1] = Math.min(rows[o + 1], 0.96);
    el0[4 * i + 2] = rows[o + 2] * DEG;
    el0[4 * i + 3] = rows[o + 3] * DEG;
    el1[4 * i] = rows[o + 4] * DEG;
    el1[4 * i + 1] = rows[o + 5] * DEG;
    el1[4 * i + 2] = rows[o + 6];
    el1[4 * i + 3] = rows[o + 7];
    cls[i] = classOf ? classOf(i) : rows[o + 8];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEl0', new THREE.BufferAttribute(el0, 4));
  g.setAttribute('aEl1', new THREE.BufferAttribute(el1, 4));
  g.setAttribute('aClass', new THREE.BufferAttribute(cls, 1));
  // A bounding sphere large enough to never cull: the cloud spans the Solar System.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

export interface AsteroidCloud extends Layer {
  /** Number of asteroids drawn (0 until the data arrives). */
  readonly drawn: number;
}

export function createAsteroidCloudLayer(registry: Pick<EntityRegistry, 'get'>): AsteroidCloud {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const palette = buildPalette();
  let cloud: THREE.Points | null = null;
  let neoPoints: THREE.Points | null = null;
  let cloudMat: THREE.ShaderMaterial | null = null;
  let neoMat: THREE.ShaderMaterial | null = null;
  let epochBase = 2461200.5;
  let total = 0;
  let neoRows: NeoRow[] = [];
  let opacity = 0;
  let disposed = false;
  const screen = { x: 0, y: 0, depthM: 0, visible: false };

  const layer: AsteroidCloud = {
    id: 'asteroid-cloud',
    get drawn() { return total; },

    async init(svc: EngineServices): Promise<void> {
      
      const [header, buf] = await Promise.all([
        svc.assets.json<AsteroidHeader>('data/solar/asteroids.json'),
        svc.assets.binary('data/solar/asteroids.bin'),
      ]);
      
      if (disposed) return;
      epochBase = header.epochBaseJD;
      const f = new Float32Array(buf);
      total = Math.min(header.count, Math.floor(f.length / header.stride));
      cloudMat = makeMaterial(palette, 1.0);
      cloud = new THREE.Points(buildGeometry(f, total, header.stride), cloudMat);
      cloud.name = 'asteroid-cloud';
      cloud.frustumCulled = false;
      cloud.visible = false;
      cloud.renderOrder = 2;
      svc.groups.far.add(cloud);

      try {
        neoRows = await loadNeoCatalog();
      } catch {
        neoRows = [];
      }
      if (disposed || neoRows.length === 0) return;
      const nf = new Float32Array(neoRows.length * 9);
      for (let i = 0; i < neoRows.length; i++) {
        const r = neoRows[i];
        nf.set([r.aAU, r.e, r.iDeg, r.nodeDeg, r.argPeriDeg, r.meanAnomalyDeg, r.epochJD - epochBase, r.H ?? 22, 0], i * 9);
      }
      neoMat = makeMaterial(palette, 1.3);
      neoPoints = new THREE.Points(buildGeometry(nf, neoRows.length, 9, (i) => (neoRows[i].pha ? 9 : 13)), neoMat);
      neoPoints.name = 'neo-points';
      neoPoints.frustumCulled = false;
      neoPoints.visible = false;
      neoPoints.renderOrder = 3;
      svc.groups.far.add(neoPoints);
    },

    update(ctx: FrameContext): void {
      if (!cloud) return;
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      // Fade out beyond the outer Solar System (the belt becomes a speck) and when the overlay is off.
      const far = 1 - THREE.MathUtils.smoothstep(dSunAu, 2500, 9000);
      const small = ctx.focusEntityId?.startsWith('sb:') === true || ctx.selectedId?.startsWith('sb:') === true;
      // Outer-system views: the belt and NEO cloud fade out (smoothstep 2.5e11 -> 2e12 m) so they do not form a white blob over the Sun.
      const beltFade = small ? 1 : 1 - THREE.MathUtils.smoothstep(dSunAu * AU_M, 2.5e11, 2e12);
      const target = ctx.overlays.asteroids || small ? far * beltFade : 0;
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 5);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      const show = opacity > 0.003;
      cloud.visible = show;
      if (neoPoints) neoPoints.visible = show && state.neoHighlight;
      if (!show) return;
      const jd = jdTdbFromMs(ctx.timeMs) - epochBase;
      const draw = Math.min(total, Math.max(1000, ctx.quality.particleBudget));
      cloud.geometry.setDrawRange(0, draw);
      const unitsPerAu = AU_M / ctx.metersPerUnit;
      ctx.toRender(sunWorld, cloud.position);
      for (const [pts, mat] of [[cloud, cloudMat], [neoPoints, neoMat]] as const) {
        if (!pts || !mat) continue;
        if (pts !== cloud) pts.position.copy(cloud.position);
        mat.uniforms.uDays.value = jd;
        mat.uniforms.uUnitsPerAu.value = unitsPerAu;
        mat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
        mat.uniforms.uOpacity.value = opacity;
        // NEOs inside 1.6 AU crowd the inner system: fade them unless a small body is focused/selected.
        mat.uniforms.uInnerFade.value = pts === cloud || small ? 1 : 0.15;
      }
      void tmp;
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (!neoPoints || !neoPoints.visible || opacity < 0.4) return [];
      const hits: PickHit[] = [];
      const jd = jdTdbFromMs(ctx.timeMs);
      sun(ctx.timeMs, sunWorld);
      let best: PickHit | null = null;
      for (let i = 0; i < neoRows.length; i++) {
        const r = neoRows[i];
        heliocentricIcrsM(neoElements(r), jd, tmp).add(sunWorld);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y);
        if (d > Math.min(radiusPx, 14)) continue;
        if (!best || d < best.distancePx) {
          best = { entityId: neoEntityId(r), distancePx: d, depthM: screen.depthM, priority: r.pha ? 14 : 8 };
        }
      }
      if (best) hits.push(best);
      return hits;
    },

    dispose(): void {
      disposed = true;
      for (const o of [cloud, neoPoints]) {
        if (!o) continue;
        o.removeFromParent();
        o.geometry.dispose();
      }
      cloudMat?.dispose();
      neoMat?.dispose();
      cloud = null;
      neoPoints = null;
    },
  };
  return layer;
}
