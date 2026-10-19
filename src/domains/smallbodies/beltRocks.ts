/**
 * Near-field asteroid rocks: as the camera flies into the main belt / Hildas / Trojans, the nearest real catalogue asteroids
 * (asteroids.bin, 75,855 numbered objects, H < 15) fade in as lit, tumbling 3D rocks exactly at their propagated positions,
 * while the GPU point cloud keeps drawing everything farther away.
 *
 * Honesty: orbits and positions are real (two-body propagation of SBDB osculating elements); sizes come from H with a
 * class-typical albedo; shapes, spin axes and periods and the C/S/M/D colour class are ILLUSTRATIVE (drawn from the
 * taxonomic mix at that distance from the Sun, DeMeo & Carry 2014). In exhibition scale the rocks are enlarged (smooth max
 * of the true and a target apparent size, exactly true within 40 radii); in true scale they are drawn at their real size.
 *
 * CPU: a time-sliced scan (≤ SLICE Kepler solves per frame) keeps the K nearest candidates; the K selected rocks are
 * propagated exactly every frame. GPU: 8 instanced shape variants (≈ 2.4k triangles each) → ≤ 8 draw calls.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { getScaleView } from '../../core/visualScale';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { solarSceneIrradianceAt } from '../solar/ephemeris';
import { jdTdbFromMs } from './orbits';
import { buildSmallBodyGeometry, type ShapeSpec } from './shape';
import { sunSource } from './sources';

/** Max rocks drawn. */
const K = 220;
/** Kepler solves per frame in the background scan. */
const SLICE = 2000;
const CAND_CAP = 4096;
const VARIANTS = 8;
/** Exhibition-scale target apparent diameter (fraction of viewport height) of a 5 km rock at the reference distance. */
const TARGET_FRAC = 0.02;
/** Cap of the exhibition target (fraction of viewport height). */
const TARGET_MAX_FRAC = 0.045;
/** Rocks shown larger than this (px) use the high-detail geometry. */
const HI_LOD_PX = 28;
const REF_RADIUS_M = 2500;
/** Distance where the target size starts to fall off (≈ the typical spacing of H < 15 asteroids in the belt). */
const FALLOFF_M = 8e9;
const MIN_PX = 1.4;
const FULL_PX = 3.5;

const GAUSS_K = 0.01720209895;

/** Geometric albedo (V) and linear reflectance colour per illustrative class. Sources: DeMeo & Carry 2013/2014; Mainzer et al. 2011 (NEOWISE). */
const CLASS_COLOR: Record<'C' | 'S' | 'X' | 'V' | 'D' | 'B', { pV: number; rgb: [number, number, number] }> = {
  C: { pV: 0.06, rgb: [0.058, 0.055, 0.051] },
  S: { pV: 0.25, rgb: [0.27, 0.225, 0.17] },
  X: { pV: 0.16, rgb: [0.16, 0.152, 0.145] },
  V: { pV: 0.38, rgb: [0.42, 0.39, 0.33] },
  D: { pV: 0.06, rgb: [0.074, 0.056, 0.044] },
  B: { pV: 0.07, rgb: [0.066, 0.07, 0.078] },
};
type RockClass = keyof typeof CLASS_COLOR;
const CLASS_NAMES = Object.keys(CLASS_COLOR) as RockClass[];

/** Taxonomic mix (by mass/number of bright objects) as a function of semi-major axis — DeMeo & Carry 2014, Fig. 4 (simplified). */
function classFor(aAU: number, u: number): RockClass {
  const pick = (t: [RockClass, number][]): RockClass => {
    let acc = 0;
    for (const [c, p] of t) { acc += p; if (u < acc) return c; }
    return t[t.length - 1][0];
  };
  if (aAU < 2.5) return pick([['S', 0.58], ['V', 0.1], ['X', 0.14], ['C', 0.18]]);
  if (aAU < 2.82) return pick([['S', 0.4], ['C', 0.36], ['X', 0.19], ['B', 0.05]]);
  if (aAU < 3.3) return pick([['C', 0.56], ['S', 0.18], ['X', 0.16], ['B', 0.1]]);
  if (aAU < 4.6) return pick([['D', 0.42], ['C', 0.38], ['X', 0.2]]);
  return pick([['D', 0.72], ['C', 0.18], ['X', 0.1]]);
}

function hashU(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec2 aRock; // fade, seed
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vPosW;
varying vec3 vR0;
varying vec3 vR1;
varying vec3 vR2;
varying vec3 vAlbedo;
varying vec2 vRock;
void main() {
  vObj = position;
  mat3 r = mat3(modelMatrix * instanceMatrix);
  vR0 = normalize(r[0]); vR1 = normalize(r[1]); vR2 = normalize(r[2]);
  vNormalW = normalize(r * normal);
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vAlbedo = instanceColor;
  vRock = aRock;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uSunPos;
uniform float uIrradiance;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vPosW;
varying vec3 vR0;
varying vec3 vR1;
varying vec3 vR2;
varying vec3 vAlbedo;
varying vec2 vRock;

float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}

void main() {
  // Screen-door fade (opaque, no sorting) while a rock resolves out of the point cloud.
  if (vRock.x < 0.999 && bayer4(gl_FragCoord.xy) > vRock.x) discard;
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  vec3 p = vObj * 5.0 + vRock.y;
  float e = 0.05;
  float h0 = fbm(p);
  vec3 g = vec3(fbm(p + vec3(e, 0.0, 0.0)) - h0, fbm(p + vec3(0.0, e, 0.0)) - h0, fbm(p + vec3(0.0, 0.0, e)) - h0) / e;
  vec3 gw = mat3(vR0, vR1, vR2) * g;
  n = normalize(n - 0.18 * (gw - dot(gw, n) * n));
  vec3 sunDir = normalize(uSunPos - vPosW);
  float mu0 = max(dot(n, sunDir), 0.0);
  vec3 toCam = normalize(cameraPosition - vPosW);
  float mu = max(dot(n, toCam), 1e-3);
  float L = 0.6;
  float brdf = 2.0 * L * mu0 / (mu0 + mu) + (1.0 - L) * mu0;
  float cg = clamp(dot(sunDir, toCam), -1.0, 1.0);
  float tanHalf = sqrt((1.0 - cg) / max(1.0 + cg, 1e-4));
  float surge = 1.0 + 0.8 / (1.0 + tanHalf / 0.06);
  float terr = fbm(vObj * 2.1 + vRock.y * 0.7);
  float variation = mix(0.8, 1.16, smoothstep(0.3, 0.7, terr)) * (0.93 + 0.14 * h0);
  gl_FragColor = vec4(vAlbedo * variation * (uIrradiance / 3.14159265) * brdf * surge, 1.0);
}`;

interface Orbits {
  n: number;
  a: Float64Array;
  e: Float64Array;
  mm: Float64Array; // mean motion rad/day
  m0: Float64Array;
  ep: Float64Array; // epoch offset, days
  pq: Float64Array; // P (3) and Q·b/a (3), ICRS
  qA: Float32Array; // perihelion AU
  QA: Float32Array; // aphelion AU
  zA: Float32Array; // max |ecliptic z|, AU
  rM: Float32Array; // radius from H, m
  cls: Uint8Array;
}

function buildOrbits(f: Float32Array, count: number, stride: number): Orbits {
  const o: Orbits = {
    n: count, a: new Float64Array(count), e: new Float64Array(count), mm: new Float64Array(count), m0: new Float64Array(count),
    ep: new Float64Array(count), pq: new Float64Array(count * 6), qA: new Float32Array(count), QA: new Float32Array(count), zA: new Float32Array(count),
    rM: new Float32Array(count), cls: new Uint8Array(count),
  };
  const eps = 23.4392911 * DEG, ce = Math.cos(eps), se = Math.sin(eps);
  for (let i = 0; i < count; i++) {
    const r = i * stride;
    const a = f[r], e = Math.min(f[r + 1], 0.97), inc = f[r + 2] * DEG, node = f[r + 3] * DEG, w = f[r + 4] * DEG;
    o.a[i] = a; o.e[i] = e;
    o.mm[i] = GAUSS_K / (a * Math.sqrt(a));
    o.m0[i] = f[r + 5] * DEG;
    o.ep[i] = f[r + 6];
    const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(inc), si = Math.sin(inc);
    // Perifocal → ecliptic.
    const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
    const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
    const b = Math.sqrt(1 - e * e);
    const k = i * 6;
    // Ecliptic → ICRS (rotate about x by +ε).
    o.pq[k] = px; o.pq[k + 1] = ce * py - se * pz; o.pq[k + 2] = se * py + ce * pz;
    o.pq[k + 3] = qx * b; o.pq[k + 4] = (ce * qy - se * qz) * b; o.pq[k + 5] = (se * qy + ce * qz) * b;
    o.qA[i] = a * (1 - e);
    o.QA[i] = a * (1 + e);
    o.zA[i] = a * (1 + e) * si;
    const c = classFor(a, hashU(i, 7));
    o.cls[i] = CLASS_NAMES.indexOf(c);
    const H = f[r + 7];
    o.rM[i] = ((1329 / Math.sqrt(CLASS_COLOR[c].pV)) * Math.pow(10, -H / 5) * 1000) / 2;
  }
  return o;
}

/** Heliocentric ICRS position (m) of row i at `days` (JD TDB − epochBase). */
function rowPosition(o: Orbits, i: number, days: number, out: THREE.Vector3): THREE.Vector3 {
  const e = o.e[i];
  let M = (o.m0[i] + o.mm[i] * (days - o.ep[i])) % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let it = 0; it < 6; it++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  const am = o.a[i] * AU_M;
  const x = am * (Math.cos(E) - e), y = am * Math.sin(E);
  const k = i * 6, pq = o.pq;
  return out.set(x * pq[k] + y * pq[k + 3], x * pq[k + 1] + y * pq[k + 4], x * pq[k + 2] + y * pq[k + 5]);
}

const RECIPES: ShapeSpec['recipe'][] = ['shard', 'ellipsoid', 'elongated', 'peanut', 'shard', 'top', 'bilobed', 'shard'];
const AXES: [number, number, number][] = [
  [1.3, 0.95, 0.8], [1.1, 1.0, 0.9], [1.7, 0.85, 0.75], [1.5, 0.9, 0.8], [1.2, 1.05, 0.7], [1.0, 1.0, 0.9], [1.6, 1.0, 0.7], [1.4, 0.8, 0.75],
];

export interface BeltRocksLayer extends Layer {
  /** Rocks currently drawn. */
  readonly drawnRocks: number;
}

export function createBeltRocksLayer(registry: Pick<EntityRegistry, 'get'>): BeltRocksLayer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const camHelio = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmpR = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };

  let orbits: Orbits | null = null;
  let epochBase = 2461200.5;
  let disposed = false;
  let svcRef: EngineServices | null = null;
  const meshes: THREE.InstancedMesh[] = [];
  const rockAttr: THREE.InstancedBufferAttribute[] = [];
  let material: THREE.ShaderMaterial | null = null;

  // Background scan state.
  let cursor = 0;
  let selR = 0.25 * AU_M;
  const candIdx = new Int32Array(CAND_CAP);
  const candD = new Float64Array(CAND_CAP);
  let candN = 0;
  // Current selection.
  const sel = new Int32Array(K);
  let selN = 0;
  const order = new Int32Array(CAND_CAP);
  let drawn = 0;
  let labelRock = -1;
  const labelPos = new THREE.Vector3();
  let labelPx = 0;
  let active = false;

  const finishPass = (): void => {
    // Keep the K nearest candidates.
    for (let i = 0; i < candN; i++) order[i] = i;
    const ord = order.subarray(0, candN);
    ord.sort((x, y) => candD[x] - candD[y]);
    selN = Math.min(K, candN);
    for (let i = 0; i < selN; i++) sel[i] = candIdx[ord[i]];
    // Adapt the selection radius so a pass yields ≈ 2K candidates.
    if (candN < K) selR = Math.min(selR * 1.6, 1.2 * AU_M);
    else if (candN > 3 * K) selR = Math.max(selR * 0.7, 2e8);
    candN = 0;
  };

  const scan = (days: number): void => {
    if (!orbits) return;
    const o = orbits;
    const rc = camHelio.length() / AU_M;
    const rs = selR / AU_M;
    const eps = 23.4392911 * DEG;
    const zc = Math.abs(-Math.sin(eps) * camHelio.y + Math.cos(eps) * camHelio.z) / AU_M;
    const end = Math.min(o.n, cursor + SLICE);
    for (let i = cursor; i < end; i++) {
      if (rc + rs < o.qA[i] || rc - rs > o.QA[i] || zc - rs > o.zA[i]) continue;
      rowPosition(o, i, days, tmp);
      const d = tmp.distanceTo(camHelio);
      if (d > selR) continue;
      if (candN < CAND_CAP) {
        candIdx[candN] = i;
        candD[candN] = d;
        candN++;
      }
    }
    cursor = end;
    if (cursor >= o.n) {
      cursor = 0;
      finishPass();
    }
  };

  return {
    id: 'belt-rocks',
    get drawnRocks() { return drawn; },

    async init(svc: EngineServices): Promise<void> {
      svcRef = svc;
      const [header, buf] = await Promise.all([
        svc.assets.json<{ count: number; stride: number; epochBaseJD: number }>('data/solar/asteroids.json'),
        svc.assets.binary('data/solar/asteroids.bin'),
      ]);
      if (disposed) return;
      epochBase = header.epochBaseJD;
      const f = new Float32Array(buf);
      orbits = buildOrbits(f, Math.min(header.count, Math.floor(f.length / header.stride)), header.stride);
      material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uSunPos: { value: new THREE.Vector3() }, uIrradiance: { value: 1 } },
      });
      // Low-detail (≈ 500 triangles) and high-detail (≈ 6.5k triangles) geometry for each of the 8 shape variants.
      for (let lv = 0; lv < 2 * VARIANTS; lv++) {
        const v = lv % VARIANTS;
        const geo = buildSmallBodyGeometry({ id: `belt-rock-${v}`, recipe: RECIPES[v], axes: AXES[v], detail: lv < VARIANTS ? 4 : 17, craters: 30 + v * 4, lumpiness: 0.06 });
        const mesh = new THREE.InstancedMesh(geo, material, K);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, color.setRGB(0, 0, 0));
        mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        const ra = new THREE.InstancedBufferAttribute(new Float32Array(K * 2), 2).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aRock', ra);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.name = `belt-rocks-${lv}`;
        svc.groups.main.add(mesh);
        meshes.push(mesh);
        rockAttr.push(ra);
      }
    },

    update(ctx: FrameContext): void {
      drawn = 0;
      labelRock = -1;
      if (!orbits || !material || !svcRef) return;
      sun(ctx.timeMs, sunWorld);
      camHelio.subVectors(ctx.cameraPosition, sunWorld);
      const rc = camHelio.length() / AU_M;
      const smallFocus = ctx.focusEntityId?.startsWith('sb:') === true;
      const want = (ctx.overlays.asteroids || smallFocus) && rc > 1.15 && rc < 6.4;
      if (!want) {
        if (active) {
          for (const m of meshes) m.count = 0;
          selN = 0;
          candN = 0;
          cursor = 0;
          active = false;
        }
        return;
      }
      if (!active) {
        active = true;
        cursor = 0;
        candN = 0;
      }
      const days = jdTdbFromMs(ctx.timeMs) - epochBase;
      scan(days);
      if (selN === 0) return;

      const view = getScaleView();
      const weight = view.weight; // eased exhibition weight (0 in true scale)
      const H = ctx.viewport.height;
      const pxPerRad = ctx.pixelsPerRadian;
      material.uniforms.uIrradiance.value = solarSceneIrradianceAt(ctx.cameraPosition, ctx.timeMs);
      ctx.toRender(sunWorld, material.uniforms.uSunPos.value);
      for (const m of meshes) m.count = 0;
      const hoursSinceJ2000 = (ctx.timeMs - 946728000000) / 3.6e6;
      const o = orbits;
      for (let s = 0; s < selN; s++) {
        const i = sel[s];
        rowPosition(o, i, days, tmpR).add(sunWorld);
        const d = Math.max(tmpR.distanceTo(ctx.cameraPosition), 1);
        const R = o.rM[i];
        const p = (2 * R / d) * pxPerRad;
        // Exhibition size: smooth max of true and target apparent diameter, target falling off with distance; gate → true within 40 R.
        const T = Math.min(TARGET_FRAC * Math.sqrt(R / REF_RADIUS_M), TARGET_MAX_FRAC) * H / Math.sqrt(1 + (d / FALLOFF_M) ** 2);
        const D = Math.pow(p ** 4 + T ** 4, 0.25);
        const gate = THREE.MathUtils.smoothstep(d / R, 40, 160);
        const f = 1 + (D / Math.max(p, 1e-12) - 1) * gate * weight;
        const shown = p * f;
        if (shown < MIN_PX) continue;
        const fade = THREE.MathUtils.smoothstep(shown, MIN_PX, FULL_PX);
        const v = (i % VARIANTS) + (shown > HI_LOD_PX ? VARIANTS : 0);
        const mesh = meshes[v];
        const slot = mesh.count++;
        ctx.toRender(tmpR, tmp);
        const u1 = hashU(i, 11), u2 = hashU(i, 13), u3 = hashU(i, 17);
        const lat = Math.asin(2 * u1 - 1), lon = u2 * Math.PI * 2;
        axis.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
        const periodH = 2.5 + 22 * u3 * u3;
        const phase = ((hoursSinceJ2000 / periodH) % 1) * Math.PI * 2 + u1 * 6.283;
        quat.setFromAxisAngle(axis, phase);
        scl.setScalar((R * f) / ctx.metersPerUnit);
        m4.compose(tmp, quat, scl);
        mesh.setMatrixAt(slot, m4);
        const c = CLASS_COLOR[CLASS_NAMES[o.cls[i]]].rgb;
        const tint = 0.85 + 0.3 * hashU(i, 19);
        mesh.setColorAt(slot, color.setRGB(c[0] * tint, c[1] * tint, c[2] * tint));
        const ra = rockAttr[v];
        ra.setXY(slot, fade, (i % 997) * 0.37);
        drawn++;
        if (shown > 18 && (labelRock < 0 || shown > labelPx)) {
          labelRock = i;
          labelPx = shown;
          labelPos.copy(tmpR);
        }
      }
      for (let v = 0; v < meshes.length; v++) {
        const mesh = meshes[v];
        if (mesh.count === 0) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        rockAttr[v].needsUpdate = true;
      }
      if (labelRock < 0) labelPx = 0;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels || labelRock < 0 || !orbits) return;
      ctx.project(labelPos, screen);
      if (!screen.visible) return;
      const dKm = (orbits.rM[labelRock] * 2) / 1000;
      out.push({
        entityId: null,
        text: 'Catalogued asteroid',
        detail: `≈ ${dKm < 10 ? dKm.toFixed(1) : dKm.toFixed(0)} km · real orbit · illustrative shape`,
        x: screen.x,
        y: screen.y,
        priority: 2,
        kind: 'annotation',
        offsetPx: labelPx / 2 + 8,
        opacity: 0.8,
      });
    },

    dispose(): void {
      disposed = true;
      for (const m of meshes) {
        m.removeFromParent();
        m.geometry.dispose();
        m.dispose();
      }
      meshes.length = 0;
      material?.dispose();
      orbits = null;
    },
  };
}
