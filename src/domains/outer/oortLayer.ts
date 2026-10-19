/**
 * Oort cloud: an ILLUSTRATIVE seeded point cloud (inner toroidal Hills part 2,000–20,000 au; outer spherical part to 100,000 au)
 * plus a very faint limb shell at the outer edge. Labelled "hypothesised, illustrative"; nothing here is a measured object.
 * Visible from ~800 au out to a few million au (and always when an outer:* entity is focused).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { OORT_HILLS_EDGE_AU, OORT_OUTER_AU, generateOortCloud } from './model';
import { OUTER_IDS } from './entities';
import { createShellVisual, type ShellVisual } from './shell';
import { sunSource } from './sources';

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute float aB;
uniform mat3 uEclToIcrs;
uniform float uUnitsPerAu;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uSize;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(uEclToIcrs * position * uUnitsPerAu, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (uSize + 1.2 * aB) * uPixelRatio;
  vColor = mix(vec3(0.62, 0.72, 0.95), vec3(0.9, 0.94, 1.0), aB) * (0.18 + 0.5 * aB) * uOpacity;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 3.0) * step(r2, 1.0);
  gl_FragColor = vec4(vColor * a, a);
}`;

const ECL_TO_ICRS = new THREE.Matrix3();
{
  const eps = 23.4392911 * DEG;
  const c = Math.cos(eps), s = Math.sin(eps);
  ECL_TO_ICRS.set(1, 0, 0, 0, c, -s, 0, s, c);
}

export function createOortLayer(registry: Pick<EntityRegistry, 'get'>, count = 48000): Layer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let points: THREE.Points | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let limb: ShellVisual | null = null;
  let opacity = 0;
  // Ecliptic-frame label anchors (AU): inner cloud near the ecliptic plane edge, outer cloud off the plane.
  const anchorInner = new THREE.Vector3(OORT_HILLS_EDGE_AU * 0.55, OORT_HILLS_EDGE_AU * 0.15, 0);
  const anchorOuter = new THREE.Vector3(-OORT_OUTER_AU * 0.62, OORT_OUTER_AU * 0.55, OORT_OUTER_AU * 0.5);

  const labelAnchors = [
    [anchorOuter, 'Oort cloud', 'hypothesised · illustrative', 26],
    [anchorInner, 'Inner (Hills) cloud', 'hypothesised · illustrative', 20],
  ] as const;

  return {
    id: 'outer-oort',

    init(svc: EngineServices): void {
      const cloud = generateOortCloud(count);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
      geo.setAttribute('aB', new THREE.BufferAttribute(cloud.brightness, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uEclToIcrs: { value: ECL_TO_ICRS },
          uUnitsPerAu: { value: 1 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0 },
          uSize: { value: 1.3 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      points = new THREE.Points(geo, material);
      points.name = 'oort-cloud';
      points.frustumCulled = false;
      points.visible = false;
      points.renderOrder = 1;
      svc.groups.far.add(points);

      limb = createShellVisual(
        { R: OORT_OUTER_AU, k: 0, p: 1, a: 0, thetaMaxDeg: 180 },
        { color: [0.55, 0.68, 1.0], base: 0.0, rim: 0.12, grid: 0.025, gridThetaDeg: 15, gridPhiDeg: 30 },
        'oort-limb',
        48,
        72,
      );
      limb.mesh.renderOrder = 5;
      svc.groups.transparent.add(limb.mesh);
    },

    update(ctx: FrameContext): void {
      if (!points || !material || !limb) return;
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      const focus = ctx.focusEntityId === OUTER_IDS.oort || ctx.selectedId === OUTER_IDS.oort;
      const fadeOut = 1 - THREE.MathUtils.smoothstep(dSunAu, 5e5, 6e6);
      const target = Math.max(THREE.MathUtils.smoothstep(dSunAu, 700, 4500) * fadeOut, focus ? fadeOut : 0);
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 3);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      const show = opacity > 0.003;
      points.visible = show;
      const unitsPerAu = AU_M / ctx.metersPerUnit;
      limb.setFrame(unitsPerAu, show ? opacity : 0);
      if (!show) return;
      ctx.toRender(sunWorld, points.position);
      limb.mesh.position.copy(points.position);
      material.uniforms.uUnitsPerAu.value = unitsPerAu;
      material.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      material.uniforms.uOpacity.value = opacity;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels || opacity < 0.3) return;
      sun(ctx.timeMs, sunWorld);
      const eps = 23.4392911 * DEG;
      const c = Math.cos(eps), s = Math.sin(eps);
      for (const [a, text, detail, prio] of labelAnchors) {
        tmp.set(a.x, c * a.y - s * a.z, s * a.y + c * a.z).multiplyScalar(AU_M).add(sunWorld);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        out.push({ entityId: text === 'Oort cloud' ? OUTER_IDS.oort : null, text, detail, x: screen.x, y: screen.y, priority: prio, kind: 'annotation', opacity: Math.min(1, opacity) });
      }
    },

    dispose(): void {
      points?.removeFromParent();
      points?.geometry.dispose();
      material?.dispose();
      limb?.dispose();
      points = null;
      limb = null;
    },
  };
}
