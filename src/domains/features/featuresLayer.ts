/**
 * Surface-feature layer: anchor dots on the drawn surface + landmark labels, decluttered by importance against the body's
 * on-screen size, faded at the horizon and hidden on the far side. Follows the exhibition scale (core/visualScale): every
 * position is the parent's DRAWN centre + drawn radius · n̂. Also turns a travel to a feature into a sunlit, north-up view
 * from above the site (the camera rig has no surface-site arrival of its own).
 *
 * Marks (docs/design/VISUAL_DIRECTION.md, "Leader lines for surface callouts"): 3 px anchor dot for named features, a ring
 * with centre dot for landing sites, a dashed ring for the drifting Great Red Spot.
 */
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { CameraViewState, EngineServices, FrameContext, Layer, LabelCandidate, PickHit, ScreenPoint } from '../../core/types';
import { RENDER_ORDER } from '../../core/types';
import { registerScaledBody, renderTransform } from '../../core/visualScale';
import type { BodyFrame } from './bodyFrames';
import type { FeatureEntity } from './entities';

/** Body disc radius (CSS px) below which a body shows no features at all. */
const MIN_BODY_PX = 46;
/** Lift of the anchor above the drawn surface (fraction of the radius) so it never z-fights the sphere. */
const LIFT = 0.0012;
const MAX_LABELS = 8;
/** Labels need the feature well inside the visible hemisphere (cosine of the view angle); markers fade nearer the limb. */
const LABEL_MIN_COS = 0.15;
/** Night-side features keep this fraction of their opacity (still findable, but the lit surface leads). */
const NIGHT_ALPHA = 0.3;
const MARKER_DOT = 0, MARKER_SITE = 1, MARKER_APPROX = 2;

interface Slot {
  e: FeatureEntity;
  marker: number;
  importance: number;
  world: THREE.Vector3;
  alpha: number;
  sx: number;
  sy: number;
  depthM: number;
  onScreen: boolean;
  /** Cosine between the surface normal and the direction to the camera (horizon test). */
  cosH: number;
}

interface Group {
  frame: BodyFrame;
  entity: Entity | null;
  slots: Slot[];
  visible: boolean;
}

/** Minimum editorial importance shown for a body disc of radius `px` CSS px (hero features first, all at close range). */
export function importanceThreshold(px: number): number {
  if (px < MIN_BODY_PX) return Infinity;
  return Math.max(0, 100 - 21 * Math.log2(px / 36));
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAlpha;
attribute float aKind;
uniform float uPixelRatio;
varying float vAlpha;
varying float vKind;
void main() {
  vAlpha = aAlpha;
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (aKind > 0.5 ? 13.0 : 7.0) * uPixelRatio;
  if (aAlpha <= 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uInk;
uniform vec3 uBrass;
uniform float uPixelRatio;
varying float vAlpha;
varying float vKind;
void main() {
  #include <logdepthbuf_fragment>
  float size = vKind > 0.5 ? 13.0 : 7.0;
  float r = length(gl_PointCoord - 0.5) * size;            // CSS px from the centre
  float aa = 0.6;
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // 3 px ink dot with a 1 px dark halo for contrast on bright terrain.
    float dot_ = 1.0 - smoothstep(1.5 - aa, 1.5 + aa, r);
    float halo = 1.0 - smoothstep(2.6 - aa, 2.6 + aa, r);
    col = mix(vec3(0.0), uInk, dot_ / max(halo, 1e-3));
    a = halo * mix(0.55, 1.0, dot_);
  } else {
    // Ring (r ≈ 5 px) with a centre dot; dashed ring for approximate positions.
    float ring = 1.0 - smoothstep(0.85, 0.85 + aa, abs(r - 4.4));
    if (vKind > 1.5) {
      vec2 d = gl_PointCoord - 0.5;
      float ang = atan(d.y, d.x);
      ring *= step(0.0, sin(ang * 6.0));
    }
    float dot_ = 1.0 - smoothstep(1.3 - aa, 1.3 + aa, r);
    col = uBrass;
    a = max(ring, dot_);
  }
  if (a < 0.01) discard;
  // Overlay ink: linear HDR value ~1 so the tone mapper renders it as UI-white, never bloom.
  gl_FragColor = vec4(col, a * vAlpha);
}
`;

export function createFeaturesLayer(features: FeatureEntity[]): Layer & { readonly entities: FeatureEntity[] } {
  const groups: Group[] = [];
  const byBody = new Map<string, Group>();
  const byId = new Map<string, Slot>();
  for (const e of features) {
    let g = byBody.get(e.frame.key);
    if (!g) {
      g = { frame: e.frame, entity: null, slots: [], visible: false };
      byBody.set(e.frame.key, g);
      groups.push(g);
    }
    const r = e.record;
    const slot: Slot = {
      e, importance: r.importance,
      marker: r.dynamic ? MARKER_APPROX : r.category === 'landing-site' ? MARKER_SITE : MARKER_DOT,
      world: new THREE.Vector3(), alpha: 0, sx: 0, sy: 0, depthM: 0, onScreen: false, cosH: 0,
    };
    g.slots.push(slot);
    byId.set(e.id, slot);
  }
  const n = features.length;
  const pos = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  const kind = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const alphaAttr = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  const kindAttr = new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aAlpha', alphaAttr);
  geo.setAttribute('aKind', kindAttr);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uInk: { value: new THREE.Color(0.93, 0.91, 0.86) },
      uBrass: { value: new THREE.Color(0.91, 0.79, 0.5) },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    // Occlusion is analytic (horizon test): a depth-tested sprite would be cut by the curved surface around the anchor.
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = RENDER_ORDER.overlay + 1;
  points.visible = false;

  let svc: EngineServices | null = null;
  const unregister: Array<() => void> = [];
  let retryFrame = 0;

  const bodyPos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const nW = new THREE.Vector3();
  const sunPos = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  let sunEntity: Entity | null = null;
  const toCam = new THREE.Vector3();
  const rTmp = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const labelOrder: Slot[] = [];
  const byImportance = (a: Slot, b: Slot): number => b.importance - a.importance;

  // ── Travel override: sunlit, north-up view from above the site ───────────────────────────
  let suppressId: string | null = null;
  let suppressUntil = 0;
  const vP = new THREE.Vector3(), vN = new THREE.Vector3(), vSun = new THREE.Vector3(), vT = new THREE.Vector3();
  const vD = new THREE.Vector3(), vUp = new THREE.Vector3(), vX = new THREE.Vector3(), vPole = new THREE.Vector3();
  const vM = new THREE.Matrix4(), vQ = new THREE.Quaternion();

  /** Camera view hovering above a feature: tilted 22° toward the Sun, north up, framing ≈ the feature + context. */
  function siteView(slot: Slot, tMs: number, fovYRad: number): CameraViewState | null {
    const e = slot.e;
    const parent = e.parent();
    if (!parent) return null;
    e.position(tMs, vP);
    parent.position(tMs, vT);
    vN.subVectors(vP, vT).normalize();
    const sun = svc?.registry.get('sol:sun');
    if (sun) sun.position(tMs, vSun); else vSun.set(0, 0, 0);
    vSun.sub(vP).normalize();
    vT.copy(vSun).addScaledVector(vN, -vSun.dot(vN));
    // Solar elevation at the site. At night the view widens until the terminator is in frame and leans toward the Sun,
    // so the site is shown in context next to sunlit ground instead of as a black screen.
    const sunEl = Math.asin(THREE.MathUtils.clamp(vSun.dot(vN), -1, 1));
    const night = sunEl < 0.03;
    const tilt = vT.lengthSq() > 1e-8 ? (night ? 38 : 22) * THREE.MathUtils.DEG2RAD : 0;
    if (tilt > 0) vT.normalize();
    vD.copy(vN).multiplyScalar(Math.cos(tilt)).addScaledVector(vT, Math.sin(tilt)).normalize();
    // Up = the body's north projected on the view plane.
    e.frame.orient(tMs, vQ);
    vPole.set(0, 0, 1).applyQuaternion(vQ);
    vUp.copy(vPole).addScaledVector(vD, -vPole.dot(vD));
    if (vUp.lengthSq() < 1e-6) vUp.copy(vT).addScaledVector(vD, -vT.dot(vD));
    if (vUp.lengthSq() < 1e-6) vUp.set(0, 0, 1).addScaledVector(vD, -vD.z);
    vUp.normalize();
    vX.crossVectors(vUp, vD).normalize();
    vM.makeBasis(vX, vUp, vD);
    vQ.setFromRotationMatrix(vM);
    let framing = e.framingRadiusM ?? 1e5;
    if (night) framing = Math.min(Math.max(framing, e.bodyRadiusM() * (0.25 - sunEl)), e.bodyRadiusM() * 1.15);
    const h = framing / Math.sin(0.86 * fovYRad * 0.5);
    return {
      anchorId: e.id,
      offset: [vD.x * h, vD.y * h, vD.z * h],
      quaternion: [vQ.x, vQ.y, vQ.z, vQ.w],
      mode: 'orbit',
      focusId: e.id,
      scaleLog10: Math.log10(2 * h * Math.tan(fovYRad / 2)),
    };
  }

  function onTravelStart(targetId: string): void {
    if (!svc) return;
    const slot = byId.get(targetId);
    if (!slot) return;
    const now = performance.now();
    if (suppressId === targetId && now < suppressUntil) return;
    const s = svc;
    queueMicrotask(() => {
      const fov = THREE.MathUtils.degToRad(s.camera.fov);
      const view = siteView(slot, s.time.nowMs, fov);
      if (!view) return;
      suppressId = targetId;
      suppressUntil = performance.now() + 1500;
      // An instant travel has already ended by now: keep it instant.
      void s.cameraController.setView(view, s.cameraController.traveling ? undefined : { instant: true });
    });
  }

  const layer: Layer & { readonly entities: FeatureEntity[] } = {
    id: 'features',
    entities: features,

    init(s: EngineServices): void {
      svc = s;
      s.groups.overlay.add(points);
      for (const e of features) unregister.push(registerScaledBody(e, { parentId: e.parentId, kind: 'region', radiusM: 1000 }));
      unregister.push(s.events.on('travel-start', (p) => onTravelStart(p.targetId)));
    },

    update(ctx: FrameContext): void {
      const showAll = ctx.overlays.labels;
      const sel = ctx.selectedId, hov = ctx.hoveredId, foc = ctx.focusEntityId;
      mat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      const reg = svc?.registry ?? null;
      const retry = ++retryFrame % 60 === 0;
      let w = 0;
      if (!sunEntity && reg && (retry || ctx.frame < 3)) sunEntity = reg.get('sol:sun') ?? null;
      if (sunEntity) sunEntity.position(ctx.timeMs, sunPos); else sunPos.set(0, 0, 0);
      for (const g of groups) {
        g.visible = false;
        if (!g.entity && reg && (retry || ctx.frame < 3)) g.entity = reg.get(g.frame.entityId) ?? null;
        if (!g.entity) continue;
        const factor = renderTransform(g.entity, ctx.timeMs, bodyPos);
        const R = (g.entity.radiusM ?? g.frame.radiusM) * factor;
        const D = bodyPos.distanceTo(ctx.cameraPosition);
        if (!(D > R)) continue;
        const px = ctx.pixelDiameter(R, D) / 2;
        const thr = showAll ? importanceThreshold(px) : Infinity;
        let any = thr < 101;
        if (!any) {
          for (const s of g.slots) if (s.e.id === sel || s.e.id === foc || s.e.id === hov) any = true;
          if (!any || px < 12) continue;
        }
        g.frame.orient(ctx.timeMs, q);
        sunDir.subVectors(sunPos, bodyPos).normalize();
        g.visible = true;
        const lift = R * (1 + LIFT);
        for (const s of g.slots) {
          const id = s.e.id;
          const forced = id === sel || id === foc || id === hov;
          const ia = THREE.MathUtils.clamp((s.importance - thr) / 8 + 1, 0, 1);
          nW.copy(s.e.normal).applyQuaternion(q);
          s.world.copy(bodyPos).addScaledVector(nW, lift);
          toCam.subVectors(ctx.cameraPosition, s.world);
          const cosH = nW.dot(toCam) / Math.max(toCam.length(), 1e-9);
          s.cosH = cosH;
          const ha = THREE.MathUtils.smoothstep(cosH, 0.03, 0.2);
          const day = THREE.MathUtils.smoothstep(nW.dot(sunDir), -0.06, 0.08);
          s.alpha = (forced ? 1 : ia * (NIGHT_ALPHA + (1 - NIGHT_ALPHA) * day)) * ha;
          s.onScreen = false;
          if (s.alpha <= 0.01) continue;
          ctx.project(s.world, sp);
          if (!sp.visible) { s.alpha = 0; continue; }
          s.sx = sp.x; s.sy = sp.y; s.depthM = sp.depthM; s.onScreen = true;
          ctx.toRender(s.world, rTmp);
          pos[w * 3] = rTmp.x; pos[w * 3 + 1] = rTmp.y; pos[w * 3 + 2] = rTmp.z;
          alpha[w] = s.alpha;
          kind[w] = s.marker;
          w++;
        }
      }
      geo.setDrawRange(0, w);
      points.visible = w > 0;
      if (w > 0) {
        posAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
        kindAttr.needsUpdate = true;
      }
    },

    pick(_ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const g of groups) {
        if (!g.visible) continue;
        for (const s of g.slots) {
          if (!s.onScreen || s.alpha < 0.3) continue;
          const d = Math.hypot(s.sx - x, s.sy - y) - 6;
          if (d > Math.min(radiusPx, 10)) continue;
          hits.push({ entityId: s.e.id, distancePx: Math.max(d, 0), depthM: s.depthM, priority: s.e.importance });
        }
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      labelOrder.length = 0;
      for (const g of groups) {
        if (!g.visible) continue;
        for (const s of g.slots) if (s.onScreen && s.alpha > 0.02 && s.cosH >= LABEL_MIN_COS) labelOrder.push(s);
      }
      if (labelOrder.length === 0) return;
      labelOrder.sort(byImportance);
      const sel = ctx.selectedId, foc = ctx.focusEntityId, hov = ctx.hoveredId;
      let count = 0;
      for (const s of labelOrder) {
        const id = s.e.id;
        const forced = id === sel || id === foc || id === hov;
        if (!forced && count >= MAX_LABELS) continue;
        count++;
        const r = s.e.record;
        out.push({
          entityId: id,
          text: r.name,
          x: s.sx,
          y: s.sy,
          priority: 20 + r.importance * 0.4,
          kind: 'landmark',
          offsetPx: s.marker === MARKER_DOT ? 4 : 7,
          opacity: s.alpha,
          detail: r.dynamic ? 'drifts; position approximate' : r.category === 'landing-site' && r.mission ? `${r.mission.agency} · ${r.mission.date.slice(0, 4)}` : r.type,
        });
      }
    },

    dispose(): void {
      for (const u of unregister.splice(0)) u();
      points.removeFromParent();
      geo.dispose();
      mat.dispose();
      svc = null;
    },
  };
  return layer;
}
