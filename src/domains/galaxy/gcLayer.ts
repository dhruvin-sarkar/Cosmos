/**
 * The Galactic Centre: the S-stars on their observed Keplerian orbits around Sgr A* (Gillessen et al. 2017; S2 from
 * GRAVITY 2020), drawn as stars + orbit lines with a trail behind each star, and the surrounding nuclear star cluster as
 * an illustrative star field (ρ ∝ r^−1.8 between 0.02 and 10 pc, mostly old red giants with a sprinkle of young hot
 * stars; Schödel et al. 2018 profile). The S-star positions are exactly the entities' positions (runtime.sStarWorld).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { AU_M, PC_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { OrbitLine } from '../../render/orbitBuilder';
import { decimalYear, offsetMasToIcrs, rng, sStarOffsetFromE, type SStarElements, type V3 } from './model';
import { galaxyRuntime } from './runtime';
import { GALAXY_IDS, sStarEntityId } from './entities';

const ORBIT_SAMPLES = 360;
/** S-stars + orbits: full within 0.25 pc of Sgr A*, gone beyond 1.2 pc. */
const SSTAR_FADE: [number, number] = [0.25 * PC_M, 1.2 * PC_M];
/** Nuclear-cluster field: full within 25 pc, gone beyond 80 pc (the galaxy particles take over). */
const NSC_FADE: [number, number] = [25 * PC_M, 80 * PC_M];
const NSC_COUNT = 24_000;
/** S-stars labelled without hover/selection: S2 plus the brightest (K ≤ 14.5). */
const LABEL_K_MAX = 14.5;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Shared point shader: per-point linear colour × intensity, camera-relative float32 offsets (metres / mpu) from an anchor.
const VERT = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 color;
attribute float flux;
uniform float uPixelRatio;
uniform float uGain;
uniform float uOpacity;
uniform float uMetresPerUnit;
uniform float uRefDist;
varying vec3 vCol;
varying float vCore;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
  // Distance falloff 1/d² (relative to uRefDist), compressed above 1 so a nearby star is a bright point, never a disc.
  float d = max(length(mv.xyz) * uMetresPerUnit, 1.0);
  float k = (uRefDist / d) * (uRefDist / d);
  k = k > 1.0 ? 1.0 + 0.35 * log2(k) : k;
  float I = flux * k * uGain * uOpacity;
  float size = clamp(1.6 + 1.8 * log2(1.0 + I), 1.6, 8.0);
  vCore = I;
  vCol = color;
  gl_PointSize = I > 2e-3 ? size * uPixelRatio : 0.0;
}`;

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vCol;
varying float vCore;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  // Gaussian core + faint halo (energy mostly in the core).
  float psf = exp(-9.0 * r2) + 0.06 * exp(-2.5 * r2);
  gl_FragColor = vec4(vCol * vCore * psf * 3.0, 1.0);
}`;

function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPixelRatio: { value: 1 }, uGain: { value: 1 }, uOpacity: { value: 0 }, uMetresPerUnit: { value: 1 }, uRefDist: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

/** Linear colours: early-type (B, ~25 kK) blue-white; late-type (K/M giants, ~3.5–4 kK) orange. */
const EARLY: [number, number, number] = [0.62, 0.74, 1.0];
const LATE: [number, number, number] = [1.0, 0.62, 0.36];
const UNKNOWN: [number, number, number] = [0.95, 0.9, 0.85];

/** True anomaly → eccentric anomaly. */
const eccFromTrue = (nu: number, e: number): number => 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));

/** Orbit polyline of an S-star relative to Sgr A* (ICRS metres) sampled uniformly in true anomaly; fractions = M/2π. */
export function sStarOrbitPolyline(el: SStarElements, sky: Parameters<typeof offsetMasToIcrs>[0], mPerMas: number, n = ORBIT_SAMPLES): { pts: Float64Array; frac: Float64Array } {
  const pts = new Float64Array(n * 3), frac = new Float64Array(n);
  const off: V3 = { x: 0, y: 0, z: 0 }, w: V3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const nu = -Math.PI + (2 * Math.PI * i) / n;
    const E = eccFromTrue(nu, el.e);
    sStarOffsetFromE(el, E, off);
    offsetMasToIcrs(sky, off, mPerMas, w);
    pts[3 * i] = w.x; pts[3 * i + 1] = w.y; pts[3 * i + 2] = w.z;
    const M = E - el.e * Math.sin(E);
    frac[i] = ((M / (2 * Math.PI)) % 1 + 1) % 1;
  }
  return { pts, frac };
}

export interface GcLayerHandle {
  /** Current S-star layer opacity (0..1). */
  readonly sStarOpacity: number;
}

export function createGalacticCentreLayer(): Layer & GcLayerHandle {
  const rt = galaxyRuntime();
  const origin = rt.frame.origin;
  let svcRef: EngineServices | null = null;
  const group = new THREE.Group();
  group.name = 'galaxy-gc';
  // Orbit lines place themselves camera-relative (OrbitLine.update), so they live in an untransformed group.
  const orbitGroup = new THREE.Group();
  orbitGroup.name = 'galaxy-gc-orbits';
  let starPts: THREE.Points | null = null;
  let starMat: THREE.ShaderMaterial | null = null;
  let nscPts: THREE.Points | null = null;
  let nscMat: THREE.ShaderMaterial | null = null;
  let orbits: OrbitLine[] = [];
  let bound: SStarElements[] = [];
  let builtVersion = -1;
  let sOpacity = 0, nOpacity = 0;
  const w: V3 = { x: 0, y: 0, z: 0 };
  let worldM = new Float64Array(0);
  const v = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };

  function buildStars(): void {
    if (!svcRef) return;
    for (const o of orbits) { o.removeFromParent(); o.dispose(); }
    orbits = [];
    starPts?.removeFromParent();
    starPts?.geometry.dispose();
    bound = rt.sStars.filter((s) => s.periodYr !== null && s.e < 1);
    const n = rt.sStars.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(n * 3), flux = new Float32Array(n);
    rt.sStars.forEach((s, i) => {
      const c = s.spectralClass === 'early' ? EARLY : s.spectralClass === 'late' ? LATE : UNKNOWN;
      col.set(c, 3 * i);
      // K-band flux relative to S2 (K = 13.95), softened so faint stars stay visible.
      flux[i] = Math.pow(10, -0.4 * ((s.kMag ?? 16) - 13.95) * 0.6);
    });
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('flux', new THREE.BufferAttribute(flux, 1));
    starPts = new THREE.Points(geo, starMat!);
    starPts.name = 'galaxy-sstars';
    starPts.frustumCulled = false;
    starPts.renderOrder = 5;
    group.add(starPts);
    for (const s of bound) {
      const isS2 = s.id === 'S2';
      const line = new OrbitLine({ role: isS2 ? 'focused' : 'minor', provenance: s.flag ? 'derived' : 'observed', maxVertices: ORBIT_SAMPLES });
      const { pts, frac } = sStarOrbitPolyline(s, rt.sky, rt.mPerMas);
      line.setPolyline(pts, ORBIT_SAMPLES, true, frac);
      line.name = `galaxy-orbit-${s.id}`;
      line.frustumCulled = false;
      // Render-kit workaround (as in solar/orbitsLayer): the segment quads wind clockwise, so FrontSide culls every line.
      line.material.side = THREE.DoubleSide;
      line.userData.sStar = s;
      orbitGroup.add(line);
      orbits.push(line);
    }
    builtVersion = rt.version;
  }

  function buildNsc(): void {
    const r = rng(4242);
    const pos = new Float32Array(NSC_COUNT * 3), col = new Float32Array(NSC_COUNT * 3), flux = new Float32Array(NSC_COUNT);
    // ρ ∝ r^−γ (γ = 1.8) → dN ∝ r^{2−γ} dr = r^0.2 dr: r = (u (b^1.2 − a^1.2) + a^1.2)^{1/1.2}. Flattened q = 0.75 (Galactic z).
    const a = 0.02, b = 10, g = 1.2;
    const ez = rt.frame.ez;
    for (let i = 0; i < NSC_COUNT; i++) {
      const rad = Math.pow(r() * (Math.pow(b, g) - Math.pow(a, g)) + Math.pow(a, g), 1 / g) * PC_M;
      const cz = 2 * r() - 1, ph = r() * 2 * Math.PI, sz = Math.sqrt(1 - cz * cz);
      let x = rad * sz * Math.cos(ph), y = rad * sz * Math.sin(ph), z = rad * cz;
      // Flatten along the Galactic pole.
      const along = x * ez.x + y * ez.y + z * ez.z;
      x -= 0.25 * along * ez.x; y -= 0.25 * along * ez.y; z -= 0.25 * along * ez.z;
      pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
      const young = rad < 0.5 * PC_M && r() < 0.12;
      const c = young ? EARLY : r() < 0.85 ? LATE : [1.0, 0.8, 0.6];
      col[3 * i] = c[0]!; col[3 * i + 1] = c[1]!; col[3 * i + 2] = c[2]!;
      // Luminosity function: a few bright giants, many faint stars.
      flux[i] = 0.05 + 2.0 * Math.pow(r(), 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('flux', new THREE.BufferAttribute(flux, 1));
    nscPts = new THREE.Points(geo, nscMat!);
    nscPts.name = 'galaxy-nsc';
    nscPts.frustumCulled = false;
    nscPts.renderOrder = -30;
    group.add(nscPts);
  }

  return {
    id: 'galaxy-gc',
    get sStarOpacity() { return sOpacity; },

    init(svc: EngineServices): void {
      svcRef = svc;
      starMat = pointMaterial();
      nscMat = pointMaterial();
      group.visible = false;
      orbitGroup.visible = false;
      svc.groups.transparent.add(group, orbitGroup);
    },

    update(ctx: FrameContext): void {
      if (!starMat || !nscMat) return;
      const cam = ctx.cameraPosition;
      const dGc = Math.hypot(cam.x - origin.x, cam.y - origin.y, cam.z - origin.z);
      const sT = 1 - smooth(SSTAR_FADE[0], SSTAR_FADE[1], dGc);
      const nT = 1 - smooth(NSC_FADE[0], NSC_FADE[1], dGc);
      const k = Math.min(1, ctx.dtRealSec * 4);
      sOpacity += (sT - sOpacity) * k; if (Math.abs(sT - sOpacity) < 0.002) sOpacity = sT;
      nOpacity += (nT - nOpacity) * k; if (Math.abs(nT - nOpacity) < 0.002) nOpacity = nT;
      group.visible = sOpacity > 0.002 || nOpacity > 0.002;
      orbitGroup.visible = sOpacity > 0.002;
      if (!group.visible) return;
      const mpu = ctx.metersPerUnit;
      const inv = 1 / mpu;
      // Everything is placed relative to Sgr A*.
      group.position.set((origin.x - cam.x) * inv, (origin.y - cam.y) * inv, (origin.z - cam.z) * inv);
      group.scale.setScalar(1);

      if (nOpacity > 0.002) {
        if (!nscPts) buildNsc();
        const u = nscMat.uniforms;
        u.uOpacity.value = nOpacity;
        u.uPixelRatio.value = ctx.viewport.pixelRatio;
        u.uMetresPerUnit.value = mpu;
        u.uRefDist.value = 0.3 * PC_M;
        // Dimmer around the S-stars so the 40 tracked stars stand out against the cluster.
        u.uGain.value = 0.5 * (1 - 0.55 * sOpacity);
        nscPts!.scale.setScalar(inv);
        nscPts!.visible = true;
      } else if (nscPts) nscPts.visible = false;

      const showS = sOpacity > 0.002;
      if (showS && builtVersion !== rt.version) buildStars();
      if (starPts) starPts.visible = showS;
      for (const o of orbits) o.visible = showS;
      if (!showS || !starPts) return;
      const t = ctx.timeMs;
      const yr = decimalYear(t);
      const attr = starPts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      if (worldM.length !== 3 * rt.sStars.length) worldM = new Float64Array(3 * rt.sStars.length);
      rt.sStars.forEach((s, i) => {
        rt.sStarWorld(s, t, w);
        const ok = Number.isFinite(w.x);
        worldM[3 * i] = ok ? w.x : Number.NaN; worldM[3 * i + 1] = w.y; worldM[3 * i + 2] = w.z;
        arr[3 * i] = ok ? (w.x - origin.x) * inv : 0;
        arr[3 * i + 1] = ok ? (w.y - origin.y) * inv : 0;
        arr[3 * i + 2] = ok ? (w.z - origin.z) * inv : 0;
      });
      attr.needsUpdate = true;
      const u = starMat.uniforms;
      u.uOpacity.value = sOpacity;
      u.uPixelRatio.value = ctx.viewport.pixelRatio;
      u.uMetresPerUnit.value = mpu;
      u.uRefDist.value = 3000 * AU_M;
      u.uGain.value = 5;
      const focusId = ctx.focusEntityId ?? ctx.selectedId;
      // Inside the S-star orbits (black-hole close-ups, S2's pericentre is 120 AU) the lines would only clutter the view.
      const lineFade = smooth(15 * AU_M, 150 * AU_M, dGc);
      for (const o of orbits) {
        const s = o.userData.sStar as SStarElements;
        o.parentPositionM.set(origin.x, origin.y, origin.z);
        o.update(ctx);
        const P = s.periodYr!;
        o.setHead((((yr - s.tPeriYr) / P) % 1 + 1) % 1, 0.12);
        const focused = focusId === `mw:${s.id.toLowerCase()}`;
        o.material.setFade(sOpacity * lineFade * (s.id === 'S2' || focused ? 0.9 : 0.24));
        o.visible = lineFade > 0.002;
      }
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!starPts?.visible || sOpacity < 0.3) return;
      // The black hole at the common focus of the orbits (beyond ~0.3 pc the landmarks layer labels it).
      v.set(origin.x, origin.y, origin.z);
      ctx.project(v, sp);
      if (sp.visible) out.push({ entityId: GALAXY_IDS.sgrA, text: 'Sgr A*', x: sp.x, y: sp.y, priority: 80, kind: 'landmark', offsetPx: 6, opacity: sOpacity });
      rt.sStars.forEach((s, i) => {
        const id = sStarEntityId(s.id);
        const focused = id === ctx.selectedId || id === ctx.hoveredId;
        if (!focused && s.id !== 'S2' && (s.kMag ?? 99) > LABEL_K_MAX) return;
        if (!Number.isFinite(worldM[3 * i])) return;
        v.set(worldM[3 * i]!, worldM[3 * i + 1]!, worldM[3 * i + 2]!);
        ctx.project(v, sp);
        if (!sp.visible) return;
        out.push({ entityId: id, text: s.id, x: sp.x, y: sp.y, priority: (s.id === 'S2' ? 60 : 30) + (focused ? 100 : 0), kind: 'star', offsetPx: 8, opacity: sOpacity });
      });
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (!starPts?.visible || sOpacity < 0.3) return [];
      const hits: PickHit[] = [];
      rt.sStars.forEach((s, i) => {
        if (!Number.isFinite(worldM[3 * i])) return;
        v.set(worldM[3 * i]!, worldM[3 * i + 1]!, worldM[3 * i + 2]!);
        ctx.project(v, sp);
        if (!sp.visible) return;
        const d = Math.hypot(sp.x - x, sp.y - y);
        if (d <= radiusPx) hits.push({ entityId: sStarEntityId(s.id), distancePx: d, depthM: sp.depthM, priority: s.id === 'S2' ? 60 : 22 });
      });
      return hits;
    },

    dispose(): void {
      for (const o of orbits) o.dispose();
      orbits = [];
      starPts?.geometry.dispose();
      nscPts?.geometry.dispose();
      starMat?.dispose();
      nscMat?.dispose();
      group.removeFromParent();
      orbitGroup.removeFromParent();
      starPts = nscPts = null;
      starMat = nscMat = null;
      svcRef = null;
    },
  };
}
