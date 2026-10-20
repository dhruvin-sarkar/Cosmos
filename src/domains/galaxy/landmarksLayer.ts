/**
 * Galactic landmarks at galactic scales: the Messier objects, Harris/Baumgardt globular clusters and the curated nebulae,
 * clusters and stellar black holes, as small ring markers at their catalogued 3-D positions (colour by type), with
 * labels and picking for the provider-resolved entities (FactSheets in entities.ts). Fades in once the view spans
 * ≳ 3 kpc (where the catalogue stars have handed over to the reconstructed galaxy) and out at intergalactic scales.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { galaxyRuntime, type LandmarkRecord } from './runtime';

/** Fade window in Cosmic Ruler units (log10 m of visible width): in over [19.9, 20.3], out over [22.0, 22.5]. */
const FADE_IN: [number, number] = [19.9, 20.3];
const FADE_OUT: [number, number] = [22.0, 22.5];
/** Labels only for landmarks at least this important (others label on hover/selection). */
const LABEL_MIN_IMPORTANCE = 34;

/** Marker colours (linear sRGB, display-referred: markers are UI, not light). */
const TYPE_COLOR: Record<string, readonly [number, number, number]> = {
  'globular-cluster': [1.0, 0.78, 0.45],
  'open-cluster': [0.62, 0.78, 1.0],
  'emission-nebula': [1.0, 0.45, 0.62],
  'star-forming-region': [1.0, 0.45, 0.62],
  'planetary-nebula': [0.45, 0.95, 0.85],
  'supernova-remnant': [1.0, 0.6, 0.3],
  'reflection-nebula': [0.55, 0.7, 1.0],
  'dark-nebula': [0.6, 0.55, 0.5],
  'black-hole': [0.75, 0.55, 1.0],
  pulsar: [0.6, 0.9, 1.0],
};
const DEFAULT_COLOR: readonly [number, number, number] = [0.8, 0.8, 0.8];

const VERT = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 color;
attribute float hl;
uniform float uPixelRatio;
uniform float uOpacity;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
  vCol = color;
  vA = uOpacity * (0.55 + 0.45 * hl);
  gl_PointSize = (9.0 + 5.0 * hl) * uPixelRatio;
}`;

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vCol;
varying float vA;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  // Thin ring (≈ 1.2 px) with a faint centre dot.
  float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 0.98, r));
  float dot = 1.0 - smoothstep(0.12, 0.24, r);
  float a = max(ring, 0.6 * dot) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, a);
}`;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createGalaxyLandmarksLayer(): Layer {
  const rt = galaxyRuntime();
  const origin = rt.frame.origin;
  const group = new THREE.Group();
  group.name = 'galaxy-landmarks';
  let pts: THREE.Points | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  let hlAttr: THREE.BufferAttribute | null = null;
  let built = -1;
  let opacity = 0;
  let list: LandmarkRecord[] = [];
  let lastSel: string | null = null, lastHover: string | null = null;
  const v = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };

  function build(): void {
    list = rt.landmarks.filter((l) => l.kind !== 'star' || l.type === 'pulsar');
    const n = list.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), hl = new Float32Array(n);
    list.forEach((l, i) => {
      pos[3 * i] = l.world.x - origin.x; pos[3 * i + 1] = l.world.y - origin.y; pos[3 * i + 2] = l.world.z - origin.z;
      const c = TYPE_COLOR[l.type] ?? DEFAULT_COLOR;
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    hlAttr = new THREE.BufferAttribute(hl, 1);
    geo.setAttribute('hl', hlAttr);
    if (pts) { pts.geometry.dispose(); pts.removeFromParent(); }
    pts = new THREE.Points(geo, mat!);
    pts.name = 'galaxy-landmarks';
    pts.frustumCulled = false;
    group.add(pts);
    built = rt.version;
    lastSel = lastHover = null;
  }

  function setHighlight(id: string | null, on: number): void {
    if (!id || !hlAttr) return;
    const i = list.findIndex((l) => l.id === id);
    if (i < 0) return;
    hlAttr.setX(i, on);
    hlAttr.needsUpdate = true;
  }

  return {
    id: 'galaxy-landmarks',

    init(svc: EngineServices): void {
      mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      group.visible = false;
      svc.groups.overlay.add(group);
    },

    update(ctx: FrameContext): void {
      if (!mat) return;
      const target = smooth(FADE_IN[0], FADE_IN[1], ctx.scaleLog10) * (1 - smooth(FADE_OUT[0], FADE_OUT[1], ctx.scaleLog10));
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 4);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      group.visible = opacity > 0.002 && rt.loaded;
      if (!group.visible) return;
      if (built !== rt.version || !pts) build();
      if (ctx.selectedId !== lastSel || ctx.hoveredId !== lastHover) {
        setHighlight(lastSel, 0); setHighlight(lastHover, 0);
        setHighlight(ctx.selectedId, 1); setHighlight(ctx.hoveredId, 1);
        lastSel = ctx.selectedId; lastHover = ctx.hoveredId;
      }
      const inv = 1 / ctx.metersPerUnit;
      const cam = ctx.cameraPosition;
      group.position.set((origin.x - cam.x) * inv, (origin.y - cam.y) * inv, (origin.z - cam.z) * inv);
      group.scale.setScalar(inv);
      mat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      mat.uniforms.uOpacity.value = opacity;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!group.visible || opacity < 0.3) return;
      for (const l of list) {
        const focused = l.id === ctx.selectedId || l.id === ctx.hoveredId;
        if (!focused && l.importance < LABEL_MIN_IMPORTANCE) continue;
        v.set(l.world.x, l.world.y, l.world.z);
        ctx.project(v, sp);
        if (!sp.visible) continue;
        out.push({ entityId: l.id, text: l.name, x: sp.x, y: sp.y, priority: l.importance + (focused ? 100 : 0), kind: 'landmark', offsetPx: 8, opacity });
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (!group.visible || opacity < 0.3) return [];
      const hits: PickHit[] = [];
      for (const l of list) {
        v.set(l.world.x, l.world.y, l.world.z);
        ctx.project(v, sp);
        if (!sp.visible) continue;
        const d = Math.hypot(sp.x - x, sp.y - y);
        if (d <= radiusPx) hits.push({ entityId: l.id, distancePx: d, depthM: sp.depthM, priority: l.importance });
      }
      return hits;
    },

    dispose(): void {
      group.removeFromParent();
      pts?.geometry.dispose();
      mat?.dispose();
      pts = null; mat = null; hlAttr = null;
    },
  };
}
