/**
 * Interstellar marker field: one small ring per planet-host star at its real 3-D position (NASA Exoplanet Archive
 * distance; the HYG position when the host is a catalogued Hipparcos star). Colour = discovery method of the first
 * planet (Okabe–Ito), showcase systems carry a centre dot. A scientific annotation: it fades in only at interstellar
 * scales and is filtered live by the explorer panel (method, discovery year, showcase only).
 *
 * Declutter: from the stellar neighbourhood outwards (view scale > ~1e17 m) only the ~25 most prominent hosts keep their
 * ring (the showcase systems, then the brightest / nearest / richest others); the rest shrink to 1 px dots at 30 %
 * opacity so the real stars and their labels stay readable. A dot regains its ring while hovered or selected, and all
 * of them do while the exoplanet explorer is open or a filter is set.
 *
 * Precision: float32 offsets relative to a rebase origin that follows the camera (rewritten when the camera has moved
 * more than 1e-4 of its distance to the nearest marker), so markers stay exact from inside the Solar System to kpc.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { METHOD_COLORS, sysId, type ExoCatalog } from './catalog';
import { loadExoCatalog } from './catalogClient';
import { hostPlaceable, hostPosition } from './runtime';
import { SHOWCASE, SHOWCASE_BY_HOST } from './showcase';
import { exoOverlayActive, exoView } from './state';

/** Marker field fades in between these view scales (log10 m of visible width): ~0.003 pc → ~0.03 pc. */
export const MARKER_SCALE_IN: readonly [number, number] = [14.0, 15.0];
/** ...and fades out again at galactic scale (~1 kpc → ~3 kpc of visible width), where the Kepler field and the
 * microlensing hosts would otherwise read as a streak at the Sun over the Milky Way. */
export const MARKER_SCALE_OUT: readonly [number, number] = [19.4, 19.9];
/** Non-prominent hosts collapse to dots across this view-scale range (~1.3 pc → ~3.2 pc of visible width; a view from ~30 pc reads 1e17 m). */
export const MARKER_DECLUTTER: readonly [number, number] = [16.6, 17.0];
/** How many hosts keep their ring when decluttered. */
export const MARKER_PROMINENT = 25;
/** Opacity of a decluttered dot relative to a full marker. */
const DOT_OPACITY = 0.3;

/** Prominence of a non-showcase host: naked-eye brightness first, then planet count and proximity. */
export function hostProminence(vmag: number, nPlanets: number, distPc: number): number {
  const m = Number.isFinite(vmag) ? vmag : 16;
  const d = Number.isFinite(distPc) ? distPc : 1e4;
  return -m + 1.5 * Math.log2(Math.max(1, nPlanets)) + (d < 6 ? 3 : 0);
}

const VERT = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aColor;
attribute float aSize;
attribute float aVis;
attribute float aTop;
attribute float aIdx;
uniform float uPixelRatio;
uniform float uCull;
uniform vec2 uFocus;
varying vec3 vColor;
varying float vVis;
varying float vShow;
varying float vDot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vVis = aVis;
  vShow = step(1.5, aSize);
  float top = max(aTop, max(step(abs(aIdx - uFocus.x), 0.5), step(abs(aIdx - uFocus.y), 0.5)));
  vDot = uCull * (1.0 - top);
  float ringPx = aSize > 1.5 ? 11.0 : 7.0;
  // A decluttered dot is a hard 1-device-pixel point: no ring, no anti-aliased disc.
  gl_PointSize = aVis > 0.0 ? (vDot > 0.999 ? 1.0 : mix(ringPx * uPixelRatio, 1.0, vDot)) : 0.0;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform float uOpacity;
varying vec3 vColor;
varying float vVis;
varying float vShow;
varying float vDot;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float aa = fwidth(r) * 1.2;
  float ring = smoothstep(0.62 - aa, 0.62, r) * (1.0 - smoothstep(0.9 - aa, 0.9, r));
  float dot_ = vShow * (1.0 - smoothstep(0.22 - aa, 0.22, r));
  float a = mix(max(ring, dot_), ${DOT_OPACITY.toFixed(2)}, vDot) * vVis * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;

export interface ExoMarkersLayer extends Layer {
  /** Count of markers passing the current filter (for the explorer panel). */
  visibleCount(): number;
}

export function createExoMarkersLayer(): ExoMarkersLayer {
  let svc: EngineServices | null = null;
  let cat: ExoCatalog | null = null;
  let points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let hosts = new Int32Array(0);
  let world = new Float64Array(0);
  let gpu = new Float32Array(0);
  let vis = new Float32Array(0);
  let viewVersion = -1;
  let visible = 0;
  let fade = 0;
  let cull = 0;
  let prominent = new Float32Array(0);
  const focusIds: (string | null)[] = [null, null];
  const focusIdx = [-1, -1];
  let posDirty = true;
  let unsub: (() => void) | null = null;
  const origin = new THREE.Vector3(Number.NaN, 0, 0);
  const tmp = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const showcaseIdx: number[] = [];
  let nameIdx: Map<string, number> | null = null;

  function build(c: ExoCatalog): void {
    cat = c;
    const list: number[] = [];
    for (let h = 0; h < c.hosts.count; h++) if (hostPlaceable(c, h)) list.push(h);
    hosts = Int32Array.from(list);
    const n = hosts.length;
    world = new Float64Array(3 * n);
    gpu = new Float32Array(3 * n);
    vis = new Float32Array(n);
    const color = new Float32Array(3 * n);
    const size = new Float32Array(n);
    const top = new Float32Array(n);
    const idx = new Float32Array(n);
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const h = hosts[k];
      col.set(METHOD_COLORS[c.hosts.method[h]]); // sRGB hex → linear working colour
      const show = SHOWCASE_BY_HOST.has(c.hosts.name[h]);
      const gain = show ? 0.55 : 0.32;
      color[3 * k] = col.r * gain;
      color[3 * k + 1] = col.g * gain;
      color[3 * k + 2] = col.b * gain;
      size[k] = show ? 2 : 1;
      if (show) showcaseIdx.push(k);
      idx[k] = k;
    }
    // Prominent set: every showcase host, topped up to MARKER_PROMINENT with the highest-ranked others.
    const rank: number[] = [];
    for (let k = 0; k < n; k++) {
      if (SHOWCASE_BY_HOST.has(c.hosts.name[hosts[k]])) top[k] = 1;
      else rank.push(k);
    }
    const score = (k: number): number => hostProminence(c.hosts.vmag[hosts[k]], c.hosts.nPlanets[hosts[k]], c.hosts.distPc[hosts[k]]);
    rank.sort((a, b) => score(b) - score(a));
    for (let i = 0; i < Math.max(0, MARKER_PROMINENT - showcaseIdx.length) && i < rank.length; i++) top[rank[i]] = 1;
    prominent = top;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(gpu, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geom.setAttribute('aVis', new THREE.BufferAttribute(vis, 1).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    geom.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uPixelRatio: { value: 1 }, uCull: { value: 0 }, uFocus: { value: new THREE.Vector2(-1, -1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    points.name = 'exoplanets:markers';
    points.visible = false;
    svc?.groups.overlay.add(points);
    // Host positions snap to the HYG star once the stars provider registers.
    unsub = svc?.registry.onChange(() => (posDirty = true)) ?? null;
  }

  function refreshPositions(): void {
    if (!cat) return;
    for (let k = 0; k < hosts.length; k++) {
      hostPosition(cat, hosts[k], tmp);
      world[3 * k] = tmp.x;
      world[3 * k + 1] = tmp.y;
      world[3 * k + 2] = tmp.z;
    }
    origin.x = Number.NaN;
    posDirty = false;
  }

  function refreshFilter(): void {
    if (!cat || !points) return;
    const v = exoView;
    let count = 0;
    for (let k = 0; k < hosts.length; k++) {
      const h = hosts[k];
      const y = cat.hosts.firstYear[h];
      let ok = (cat.hosts.methodMask[h] & v.methodMask) !== 0 && (y === 0 || (y >= v.yearMin && y <= v.yearMax));
      if (v.showcaseOnly && !SHOWCASE_BY_HOST.has(cat.hosts.name[h])) ok = false;
      if (h === v.openHost) ok = false;
      vis[k] = ok ? 1 : 0;
      if (ok) count++;
    }
    visible = count;
    points.geometry.getAttribute('aVis').needsUpdate = true;
    viewVersion = v.version;
  }

  function rebase(cam: THREE.Vector3): void {
    origin.copy(cam);
    for (let i = 0; i < world.length; i += 3) {
      gpu[i] = world[i] - cam.x;
      gpu[i + 1] = world[i + 1] - cam.y;
      gpu[i + 2] = world[i + 2] - cam.z;
    }
    points!.geometry.getAttribute('position').needsUpdate = true;
  }

  return {
    id: 'exoplanets-markers',
    visibleCount: () => visible,

    init(s) {
      svc = s;
      loadExoCatalog().then((l) => build(l.catalog)).catch((e) => console.warn('[exoplanets] catalogue failed to load', e));
    },

    update(ctx: FrameContext) {
      if (!points || !cat) return;
      const s = ctx.scaleLog10;
      fade = exoView.markers
        ? THREE.MathUtils.smoothstep(s, MARKER_SCALE_IN[0], MARKER_SCALE_IN[1]) * (1 - THREE.MathUtils.smoothstep(s, MARKER_SCALE_OUT[0], MARKER_SCALE_OUT[1]))
        : 0;
      points.visible = fade > 0.002;
      if (!points.visible) return;
      if (posDirty) refreshPositions();
      if (viewVersion !== exoView.version) refreshFilter();
      const cam = ctx.cameraPosition;
      // The nearest marker is at least ~1e14 m away while the field is visible: rebasing every ~1e10 m is ample.
      if (!Number.isFinite(origin.x) || origin.distanceToSquared(cam) > 1e20) rebase(cam);
      const inv = 1 / ctx.metersPerUnit;
      points.position.set((origin.x - cam.x) * inv, (origin.y - cam.y) * inv, (origin.z - cam.z) * inv);
      points.scale.setScalar(inv);
      // Declutter beyond the stellar neighbourhood unless the user is working with the marker field.
      const cullTarget = exoOverlayActive() ? 0 : THREE.MathUtils.smoothstep(s, MARKER_DECLUTTER[0], MARKER_DECLUTTER[1]);
      cull += (cullTarget - cull) * Math.min(1, ctx.dtRealSec * 5);
      if (Math.abs(cullTarget - cull) < 1e-3) cull = cullTarget;
      const u = points.material.uniforms;
      u.uOpacity.value = fade;
      u.uCull.value = cull;
      (u.uFocus.value as THREE.Vector2).set(hostIndexOf(ctx.hoveredId, 0), hostIndexOf(ctx.selectedId, 1));
      u.uPixelRatio.value = ctx.viewport.pixelRatio;
    },

    pick(ctx, x, y, radiusPx): PickHit[] {
      if (!points?.visible || !cat || fade < 0.3) return [];
      const hits: PickHit[] = [];
      for (let k = 0; k < hosts.length; k++) {
        if (vis[k] === 0) continue;
        tmp.set(world[3 * k], world[3 * k + 1], world[3 * k + 2]);
        ctx.project(tmp, sp);
        if (!sp.visible) continue;
        const d = Math.hypot(sp.x - x, sp.y - y);
        if (d > radiusPx) continue;
        const name = cat.hosts.name[hosts[k]];
        // Decluttered dots stay hoverable but yield to the real stars around them.
        const pri = SHOWCASE_BY_HOST.get(name)?.importance ?? (prominent[k] || cull < 0.5 ? 15 : 6);
        hits.push({ entityId: sysId(name), distancePx: d, depthM: sp.depthM, priority: pri });
      }
      hits.sort((a, b) => a.distancePx - b.distancePx);
      return hits.slice(0, 6);
    },

    collectLabels(ctx, out: LabelCandidate[]) {
      if (!points?.visible || !cat || fade < 0.35) return;
      for (const k of showcaseIdx) {
        if (vis[k] === 0) continue;
        tmp.set(world[3 * k], world[3 * k + 1], world[3 * k + 2]);
        ctx.project(tmp, sp);
        if (!sp.visible) continue;
        const show = SHOWCASE_BY_HOST.get(cat.hosts.name[hosts[k]])!;
        out.push({
          entityId: sysId(show.host), text: show.title, x: sp.x, y: sp.y, priority: 20 + show.importance / 4, kind: 'star',
          offsetPx: 9, opacity: fade, detail: `${cat.hosts.nPlanets[hosts[k]]} planets · ${cat.hosts.distPc[hosts[k]].toFixed(1)} pc`,
        });
      }
      // Hovered / selected non-showcase hosts get their label too.
      for (const id of [ctx.hoveredId, ctx.selectedId]) {
        if (!id || !id.startsWith('sys:')) continue;
        const name = id.slice(4);
        if (SHOWCASE_BY_HOST.has(name)) continue;
        const k = hostsByName().get(name);
        if (k === undefined || vis[k] === 0) continue;
        tmp.set(world[3 * k], world[3 * k + 1], world[3 * k + 2]);
        ctx.project(tmp, sp);
        if (sp.visible) out.push({ entityId: id, text: name, x: sp.x, y: sp.y, priority: 60, kind: 'star', offsetPx: 8, opacity: fade });
      }
    },

    dispose() {
      unsub?.();
      if (points) {
        points.removeFromParent();
        points.geometry.dispose();
        points.material.dispose();
      }
      points = null;
    },
  };

  // Memoised per slot (hover / selection) so the per-frame lookup allocates nothing while the ids are unchanged.
  function hostIndexOf(id: string | null, slot: number): number {
    if (id === focusIds[slot]) return focusIdx[slot];
    focusIds[slot] = id;
    focusIdx[slot] = id && id.startsWith('sys:') && cat ? hostsByName().get(id.slice(4)) ?? -1 : -1;
    return focusIdx[slot];
  }

  function hostsByName(): Map<string, number> {
    if (!nameIdx) {
      nameIdx = new Map();
      for (let k = 0; k < hosts.length; k++) nameIdx.set(cat!.hosts.name[hosts[k]], k);
    }
    return nameIdx;
  }
}

/** Showcase host names in display order (explorer list). */
export const SHOWCASE_HOSTS = SHOWCASE.map((s) => s.host);
