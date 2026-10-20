/**
 * Oort cloud: an ILLUSTRATIVE seeded point cloud (inner toroidal Hills part 2,000–20,000 au; outer spherical part to 100,000 au)
 * with a smooth r^-3.5 density falloff (no boundary shell). Labelled "hypothesised, illustrative"; nothing here is a measured object.
 * Visible from ~800 au out to a few million au (and always when an outer:* entity is focused).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOSE_ECLIPTIC_LON_DEG, OORT_HILLS_EDGE_AU, OORT_OUTER_AU, SCALE_RINGS, generateOortCloud } from './model';
import { OUTER_IDS } from './entities';
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
  vColor = mix(vec3(0.62, 0.72, 0.95), vec3(0.9, 0.94, 1.0), aB) * (0.036 + 0.1 * aB) * uOpacity;
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

/** Minimum vertical separation between neighbouring annotation labels, and the horizontal span they are assumed to occupy. */
const LABEL_GAP_PX = 28;
const LABEL_W_PX = 220;
const placedPx = new Float64Array(8);

const ECL_TO_ICRS = new THREE.Matrix3();
{
  const eps = 23.4392911 * DEG;
  const c = Math.cos(eps), s = Math.sin(eps);
  ECL_TO_ICRS.set(1, 0, 0, 0, c, -s, 0, s, c);
}

export function createOortLayer(registry: Pick<EntityRegistry, 'get'>, count = 16000): Layer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let points: THREE.Points | null = null;
  let material: THREE.ShaderMaterial | null = null;
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
    },

    update(ctx: FrameContext): void {
      if (!points || !material) return;
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      const focus = ctx.focusEntityId === OUTER_IDS.oort || ctx.selectedId === OUTER_IDS.oort;
      // Full below ~4e17 m (the tour's 1e17 m Oort chapter), gone by ~2.5e18 m.
      const fadeOut = 1 - THREE.MathUtils.smoothstep(ctx.scaleLog10, 17.6, 18.4);
      const target = Math.max(THREE.MathUtils.smoothstep(dSunAu, 700, 4500) * fadeOut, focus ? fadeOut : 0);
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 3);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      const show = opacity > 0.003;
      points.visible = show;
      const unitsPerAu = AU_M / ctx.metersPerUnit;
      if (!show) return;
      ctx.toRender(sunWorld, points.position);
      material.uniforms.uUnitsPerAu.value = unitsPerAu;
      material.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      material.uniforms.uOpacity.value = opacity;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels || opacity < 0.3) return;
      sun(ctx.timeMs, sunWorld);
      const eps = 23.4392911 * DEG;
      const c = Math.cos(eps), s = Math.sin(eps);
      // Screen position of the 1-light-year ring label (see scaleRings.ts); Oort labels keep >= LABEL_GAP_PX away from it and each other.
      const placed = placedPx;
      let n = 0;
      if (ctx.overlays['scale-markers']) {
        const R = SCALE_RINGS[SCALE_RINGS.length - 1]!.radiusM, lon = NOSE_ECLIPTIC_LON_DEG * DEG + 0.5;
        const ex = Math.cos(lon), ey = Math.sin(lon);
        tmp.set(R * ex, R * ey * c, R * ey * s).add(sunWorld);
        ctx.project(tmp, screen);
        if (screen.visible) { placed[n++] = screen.x; placed[n++] = screen.y; }
      }
      for (const [a, text, detail, prio] of labelAnchors) {
        tmp.set(a.x, c * a.y - s * a.z, s * a.y + c * a.z).multiplyScalar(AU_M).add(sunWorld);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        let y = screen.y;
        for (let pass = 0; pass < 6; pass++) {
          let moved = false;
          for (let k = 0; k < n; k += 2) {
            if (Math.abs(placed[k]! - screen.x) < LABEL_W_PX && Math.abs(placed[k + 1]! - y) < LABEL_GAP_PX) {
              y = placed[k + 1]! + (y >= placed[k + 1]! ? LABEL_GAP_PX : -LABEL_GAP_PX);
              moved = true;
            }
          }
          if (!moved) break;
        }
        placed[n++] = screen.x; placed[n++] = y;
        out.push({ entityId: text === 'Oort cloud' ? OUTER_IDS.oort : null, text, detail, x: screen.x, y, priority: prio, kind: 'annotation', opacity: Math.min(1, opacity) });
      }
    },

    dispose(): void {
      points?.removeFromParent();
      points?.geometry.dispose();
      material?.dispose();
      points = null;
    },
  };
}
