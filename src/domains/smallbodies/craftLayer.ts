/**
 * Spacecraft layer: true-size lit procedural models when close (craftModels.ts), a sunlit glint inside a diamond marker when
 * far, a fading trail of each craft's recent path (plus the path ahead when focused), labels and picking.
 *
 * - Positions: JPL Horizons tracks (spacecraft.ts / craftTracks.ts). Exhibition scale (src/core/visualScale.ts): every craft
 *   is registered as a scaled body; a craft near a planet (Juno, Cassini, flybys) is registered as a satellite of that planet
 *   so it is magnified around the enlarged planet exactly like its moons and never ends up inside it. Trails use the same map.
 * - Lighting: the Sun only (scene irradiance with the exposure gain), eclipsed by the nearby planet (umbra/penumbra from the
 *   angular radii), plus physically motivated planetshine from that planet; shields cast their shadow on what is behind them.
 * - JWST's trail is drawn in the rotating Sun–Earth frame (positions rotated about the ecliptic pole by Earth's heliocentric
 *   longitude change), so its halo orbit reads as a loop around L2 instead of a spiral smeared along Earth's orbit.
 * - Cassini and DART are historic: drawn only between launch and the end of their mission (unless focused).
 * Attitude is illustrative: high-gain antenna (+Z) toward Earth, or the heat shield toward the Sun; panels rolled to the Sun.
 */
import * as THREE from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { OrbitLine } from '../../render/orbitBuilder';
import { createSatelliteSystemTransform, mapSatelliteOffset, registerScaledBody, renderTransform, satelliteSystem } from '../../core/visualScale';
import { exhibitionDisplayGain, exposureState, solarSceneIrradianceAt } from '../solar/ephemeris';
import { CRAFT_Z_ARRAYS, CraftMaterial, craftGeometry, disposeCraftGeometries } from './craftModels';
import { CRAFT_INFO, CRAFT_META, ILLUSTRATIVE_LABEL, TRACKS, loadAllTracks, type CraftInfo, type CraftMeta } from './spacecraft';
import { CENTER_ENTITY, centerSource } from './craftSources';
import { jdTdbFromMs, msFromJdTdb } from './orbits';

const MIN_MESH_PX = 5;
const MARKER_HIDE_PX = 26;
const MAX_MESHES = 6;
const TRAIL_N = 240;
const FUTURE_N = 160;
const R_SUN_M = 6.957e8;
const AU_M = 1.495978707e11;
const SUN_POINT_FROM = (15 * Math.PI) / 180;
const SUN_POINT_TO = (35 * Math.PI) / 180;
const OBLIQUITY = (23.4392911 * Math.PI) / 180;

/** Planets a heliocentric craft can be captured by (for exhibition-scale mapping, eclipses and planetshine). */
interface Host { id: string; radiusM: number; captureM: number; albedo: number; rgb: [number, number, number] }
const HOSTS: Host[] = [
  { id: 'sol:mercury', radiusM: 2.4397e6, captureM: 1.2e8, albedo: 0.142, rgb: [0.78, 0.74, 0.7] },
  { id: 'sol:venus', radiusM: 6.0518e6, captureM: 6e8, albedo: 0.689, rgb: [1.0, 0.93, 0.78] },
  { id: 'sol:earth', radiusM: 6.371e6, captureM: 1.5e9, albedo: 0.434, rgb: [0.72, 0.84, 1.0] },
  { id: 'sol:mars', radiusM: 3.3895e6, captureM: 5e8, albedo: 0.17, rgb: [1.0, 0.68, 0.48] },
  { id: 'sol:jupiter', radiusM: 6.9911e7, captureM: 2.5e10, albedo: 0.538, rgb: [1.0, 0.9, 0.74] },
  { id: 'sol:saturn', radiusM: 5.8232e7, captureM: 3e10, albedo: 0.499, rgb: [1.0, 0.92, 0.74] },
  { id: 'sol:uranus', radiusM: 2.5362e7, captureM: 2e10, albedo: 0.488, rgb: [0.75, 0.95, 1.0] },
  { id: 'sol:neptune', radiusM: 2.4622e7, captureM: 3e10, albedo: 0.442, rgb: [0.62, 0.76, 1.0] },
];
const HOST_BY_ID = new Map(HOSTS.map((h) => [h.id, h]));

interface Visual {
  entity: Entity;
  info: CraftInfo;
  meta: CraftMeta;
  id: string;
  world: THREE.Vector3;
  trueW: THREE.Vector3;
  distM: number;
  px: number;
  enlarge: number;
  active: boolean;
  shown: boolean;
  glint: number;
  mesh: THREE.Mesh | null;
  material: CraftMaterial | null;
  trail: OrbitLine | null;
  future: OrbitLine | null;
  /** Dynamic host of a heliocentric craft (planet id) or null. Planet-centred tracks use their centre. */
  hostId: string | null;
  unregister: () => void;
  /** Trail offsets relative to the frame body F at the sample times (m), and the build state. */
  rel: Float64Array;
  relN: number;
  relJd: number;
  relFrame: string;
  relExtentM: number;
  frel: Float64Array;
  frelN: number;
  frelJd: number;
  drawn: Float64Array;
}

const MARKER_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec4 aColor;
attribute float aGlint;
uniform float uPixelRatio;
varying vec4 vColor;
varying float vGlint;
void main() {
  vColor = aColor;
  vGlint = aGlint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
  #include <logdepthbuf_vertex>
}`;

const MARKER_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vColor;
varying float vGlint;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  vec2 d = abs(c) * 2.0;
  float diamond = d.x + d.y; // L1 norm: diamond outline
  float ring = smoothstep(0.62, 0.7, diamond) * (1.0 - smoothstep(0.8, 0.9, diamond));
  // Sunlit glint: a tight warm core with a faint soft falloff (no spikes).
  float r = length(c) * 2.0;
  float core = exp(-r * r * 90.0) + 0.12 * exp(-r * r * 14.0);
  vec3 col = vColor.rgb * ring * vColor.a + vec3(1.0, 0.95, 0.86) * core * vGlint;
  float a = max(ring * vColor.a, min(core * vGlint, 1.0));
  gl_FragColor = vec4(col, a);
}`;

const MARKER_RGB = [0.5, 0.82, 0.88] as const;

export interface CraftLayer extends Layer {
  readonly visuals: readonly Visual[];
  /** Resolves when the trajectories are loaded. */
  readonly ready: Promise<void>;
}

/** Lambert-sphere phase law (1 at full phase). */
function lambertPhase(alpha: number): number {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
}
const sstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
/** Earth's heliocentric ecliptic longitude (rad), low-precision (≈ 0.01°): mean longitude + equation of centre. */
function earthHelioLongitude(jd: number): number {
  const d = jd - 2451545.0;
  const M = ((357.529 + 0.98560028 * d) * Math.PI) / 180;
  const L = 100.464 + 0.985647 * d + 1.915 * Math.sin(M) + 0.02 * Math.sin(2 * M);
  return (L * Math.PI) / 180;
}

export function createCraftLayer(entities: readonly Entity[], registry: Pick<EntityRegistry, 'get'>): CraftLayer {
  const sun = centerSource(registry, 'sun');
  const earth = centerSource(registry, 'earth');
  const sunW = new THREE.Vector3();
  const earthW = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmp3 = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const zAx = new THREE.Vector3();
  const yAx = new THREE.Vector3();
  const xAx = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const spinQ = new THREE.Quaternion();
  const invQ = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const eclPole = new THREE.Vector3(0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY));
  const sys = createSatelliteSystemTransform();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const visuals: Visual[] = [];
  const metaById = new Map(CRAFT_META.map((m) => [m.id, m]));
  for (const e of entities) {
    const id = e.id.slice(3);
    const info = CRAFT_INFO[id];
    const meta = metaById.get(id);
    if (!info || !meta) continue;
    visuals.push({
      entity: e, info, meta, id, world: new THREE.Vector3(), trueW: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1,
      active: true, shown: false, glint: 0, mesh: null, material: null, trail: null, future: null, hostId: null, unregister: () => undefined,
      rel: new Float64Array(3 * (TRAIL_N + 1)), relN: 0, relJd: Number.NaN, relFrame: '', relExtentM: 1,
      frel: new Float64Array(3 * FUTURE_N), frelN: 0, frelJd: Number.NaN,
      drawn: new Float64Array(3 * (TRAIL_N + 1)),
    });
  }
  const centres = new Map<string, (tMs: number, out: THREE.Vector3) => THREE.Vector3>();
  const posOf = (id: string): ((tMs: number, out: THREE.Vector3) => THREE.Vector3) => {
    let f = centres.get(id);
    if (!f) {
      const key = (Object.keys(CENTER_ENTITY) as (keyof typeof CENTER_ENTITY)[]).find((k) => CENTER_ENTITY[k] === id);
      if (key) f = centerSource(registry, key);
      else {
        let e: Entity | undefined;
        f = (tMs, out) => {
          e ??= registry.get(id);
          return e ? e.position(tMs, out) : sun(tMs, out);
        };
      }
      centres.set(id, f);
    }
    return f;
  };

  let svcRef: EngineServices | null = null;
  let markerPoints: THREE.Points | null = null;
  let markerGeo: THREE.BufferGeometry | null = null;
  let markerMat: THREE.ShaderMaterial | null = null;
  let markerPos = new Float32Array(0);
  let markerSize = new Float32Array(0);
  let markerColor = new Float32Array(0);
  let markerGlint = new Float32Array(0);
  let disposed = false;
  let frame = 0;
  let hostJd = Number.NaN;

  const ready = loadAllTracks().then(() => {
    if (disposed) return;
    for (const v of visuals) v.relJd = Number.NaN;
  });

  const register = (v: Visual): void => {
    v.unregister();
    v.unregister = registerScaledBody(v.entity, { radiusM: v.info.radiusM, parentId: v.hostId ?? v.entity.parentId });
  };

  /** Frame body of the trail and of the exhibition-scale mapping. */
  const frameOf = (v: Visual): string => (v.meta.centerId !== 'sun' ? CENTER_ENTITY[v.meta.centerId] : v.hostId ?? 'sol:sun');

  /** Re-evaluate which planet (if any) each heliocentric craft is close to. */
  const updateHosts = (tMs: number): void => {
    for (const v of visuals) {
      if (v.meta.centerId !== 'sun' || !v.active) continue;
      v.entity.position(tMs, tmp);
      let best: string | null = null;
      for (const h of HOSTS) {
        const d = posOf(h.id)(tMs, tmp2).distanceTo(tmp);
        const limit = h.captureM * (v.hostId === h.id ? 1.3 : 1);
        if (d < limit) { best = h.id; break; }
      }
      if (best !== v.hostId) {
        v.hostId = best;
        v.relJd = Number.NaN;
        register(v);
      }
    }
  };

  /** Offsets of the craft relative to frame body `fid` at JD `jd` (m), into `out`. */
  const relAt = (v: Visual, fid: string, jd: number, out: THREE.Vector3): THREE.Vector3 => {
    const tr = TRACKS.get(v.id)!;
    tr.positionM(jd, out);
    const centreId = CENTER_ENTITY[v.meta.centerId];
    if (fid !== centreId) {
      const tMs = msFromJdTdb(jd);
      out.add(posOf(centreId)(tMs, tmp3)).sub(posOf(fid)(tMs, tmp3));
    }
    return out;
  };

  /** JWST: rotate an Earth-centred offset sampled at `jd` into the rotating Sun–Earth frame of `jdNow`. */
  const rotating = (jd: number, jdNow: number, p: THREE.Vector3): void => {
    p.applyAxisAngle(eclPole, earthHelioLongitude(jdNow) - earthHelioLongitude(jd));
  };

  const buildTrail = (v: Visual, jd: number, fid: string): void => {
    const tr = TRACKS.get(v.id)!;
    const end = Math.min(jd, tr.endJD);
    const start = Math.max(end - v.info.trailDays, tr.startJD);
    let n = 0, ext = 1;
    if (end > start) {
      for (let i = 0; i < TRAIL_N; i++) {
        const t = start + ((end - start) * i) / (TRAIL_N - 1);
        relAt(v, fid, t, tmp);
        if (v.id === 'jwst') rotating(t, jd, tmp);
        v.rel[3 * n] = tmp.x; v.rel[3 * n + 1] = tmp.y; v.rel[3 * n + 2] = tmp.z;
        ext = Math.max(ext, tmp.length());
        n++;
      }
    }
    v.relN = n;
    v.relJd = jd;
    v.relFrame = fid;
    v.relExtentM = ext;
    // Path ahead (shown when focused).
    const fEnd = Math.min(jd + v.info.trailDays * 0.5, tr.endJD);
    const fStart = Math.max(jd, tr.startJD);
    let m = 0;
    if (fEnd > fStart) {
      for (let i = 0; i < FUTURE_N; i++) {
        const t = fStart + ((fEnd - fStart) * i) / (FUTURE_N - 1);
        relAt(v, fid, t, tmp);
        if (v.id === 'jwst') rotating(t, jd, tmp);
        v.frel[3 * m] = tmp.x; v.frel[3 * m + 1] = tmp.y; v.frel[3 * m + 2] = tmp.z;
        m++;
      }
    }
    v.frelN = m;
    v.frelJd = jd;
  };

  /** Map frame-relative offsets through the frame body's exhibition-scale transform into `out` (m, rel. to its drawn pos). */
  const mapOffsets = (src: Float64Array, n: number, out: Float64Array): void => {
    const f = sys.factor, core = sys.coreRadiusM;
    for (let i = 0; i < n; i++) {
      const x = src[3 * i], y = src[3 * i + 1], z = src[3 * i + 2];
      const a = Math.sqrt(x * x + y * y + z * z);
      const s = f > 1 && a > 0 ? mapSatelliteOffset(f, core, a) / a : 1;
      out[3 * i] = x * s; out[3 * i + 1] = y * s; out[3 * i + 2] = z * s;
    }
  };

  const ensureMesh = (v: Visual): void => {
    if (v.mesh || !svcRef) return;
    v.material = new CraftMaterial(v.info.model);
    v.mesh = new THREE.Mesh(craftGeometry(v.info.model), v.material);
    v.mesh.name = v.entity.id;
    v.mesh.frustumCulled = false;
    svcRef.groups.main.add(v.mesh);
  };

  const ensureLines = (v: Visual): void => {
    if (v.trail || !svcRef) return;
    v.trail = new OrbitLine({ role: 'minor', provenance: 'observed', maxVertices: TRAIL_N + 1 });
    v.trail.material.side = THREE.DoubleSide;
    v.trail.visible = false;
    v.future = new OrbitLine({ role: 'minor', provenance: 'observed', maxVertices: FUTURE_N });
    v.future.material.side = THREE.DoubleSide;
    v.future.visible = false;
    svcRef.groups.overlay.add(v.trail, v.future);
  };

  const orient = (v: Visual, tMs: number): void => {
    if (v.info.attitude === 'sun') zAx.copy(sunDir);
    else {
      zAx.subVectors(earthW, v.trueW).normalize();
      if (CRAFT_Z_ARRAYS.has(v.info.model)) {
        // Earth far from the Sun in the craft's sky (e.g. near an Earth flyby): turn the arrays to the Sun.
        const w = sstep(SUN_POINT_FROM, SUN_POINT_TO, Math.acos(Math.min(Math.max(zAx.dot(sunDir), -1), 1)));
        if (w > 0) zAx.lerp(sunDir, w).normalize();
      }
    }
    if (!(zAx.lengthSq() > 0.5)) zAx.set(0, 0, 1);
    // Roll about Z so the panel normal (+Y) faces the Sun as closely as possible.
    yAx.copy(sunDir).addScaledVector(zAx, -sunDir.dot(zAx));
    if (yAx.lengthSq() < 1e-6) yAx.set(0, 1, 0).addScaledVector(zAx, -zAx.y);
    if (yAx.lengthSq() < 1e-6) yAx.set(1, 0, 0);
    yAx.normalize();
    xAx.crossVectors(yAx, zAx);
    basis.makeBasis(xAx, yAx, zAx);
    const q = v.mesh!.quaternion.setFromRotationMatrix(basis);
    if (v.id === 'juno') q.multiply(spinQ.setFromAxisAngle(Z, ((tMs / 1000) * 2 * Math.PI * 2) / 60 % (2 * Math.PI))); // 2 rpm
  };

  return {
    id: 'spacecraft',
    visuals,
    ready,

    init(svc: EngineServices): void {
      svcRef = svc;
      for (const v of visuals) register(v);
      const MAXM = Math.max(visuals.length, 1);
      markerPos = new Float32Array(MAXM * 3);
      markerSize = new Float32Array(MAXM);
      markerColor = new Float32Array(MAXM * 4);
      markerGlint = new Float32Array(MAXM);
      markerGeo = new THREE.BufferGeometry();
      markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPos, 3).setUsage(THREE.DynamicDrawUsage));
      markerGeo.setAttribute('aSize', new THREE.BufferAttribute(markerSize, 1).setUsage(THREE.DynamicDrawUsage));
      markerGeo.setAttribute('aColor', new THREE.BufferAttribute(markerColor, 4).setUsage(THREE.DynamicDrawUsage));
      markerGeo.setAttribute('aGlint', new THREE.BufferAttribute(markerGlint, 1).setUsage(THREE.DynamicDrawUsage));
      markerGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
      markerMat = new THREE.ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      markerPoints = new THREE.Points(markerGeo, markerMat);
      markerPoints.frustumCulled = false;
      markerPoints.name = 'spacecraft-markers';
      svc.groups.overlay.add(markerPoints);
    },

    update(ctx: FrameContext): void {
      frame++;
      const tMs = ctx.timeMs;
      const jd = jdTdbFromMs(tMs);
      sun(tMs, sunW);
      earth(tMs, earthW);
      for (const v of visuals) {
        const w = historicWindowOf(v.meta);
        v.active = jd >= v.meta.startJD && (w === null || jd <= w);
      }
      if (frame % 20 === 1 || !(Math.abs(jd - hostJd) < 0.5)) {
        hostJd = jd;
        updateHosts(tMs);
      }
      const fieldM = Math.pow(10, ctx.scaleLog10);
      let nm = 0;
      let meshes = 0;
      let built = 0;
      for (const v of visuals) {
        const focusedLike = v.entity.id === ctx.selectedId || v.entity.id === ctx.focusEntityId;
        v.shown = (ctx.overlays.spacecraft && v.active) || focusedLike;
        v.enlarge = renderTransform(v.entity, tMs, v.world);
        v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
        v.px = ctx.pixelDiameter(v.info.radiusM * 2, v.distM);
        const shownPx = v.px * v.enlarge;
        if (!v.shown) {
          if (v.mesh) v.mesh.visible = false;
          if (v.trail) v.trail.visible = false;
          if (v.future) v.future.visible = false;
          continue;
        }
        v.entity.position(tMs, v.trueW);

        // Illumination: Sun direction, distance, eclipse by the nearby planet, planetshine.
        sunDir.subVectors(sunW, v.trueW);
        const dSun = Math.max(sunDir.length(), 1);
        sunDir.multiplyScalar(1 / dSun);
        const fid = frameOf(v);
        const host = HOST_BY_ID.get(fid);
        let eclipse = 1;
        let fill = 0;
        if (host) {
          posOf(host.id)(tMs, tmp2).sub(v.trueW); // craft → planet
          const dP = Math.max(tmp2.length(), host.radiusM * 1.0001);
          const aP = Math.asin(Math.min(host.radiusM / dP, 1));
          const aS = Math.asin(Math.min(R_SUN_M / dSun, 1));
          const theta = Math.acos(Math.min(Math.max(tmp2.dot(sunDir) / dP, -1), 1));
          const depth = Math.min(1, (aP / Math.max(aS, 1e-12)) ** 2);
          eclipse = 1 - (1 - sstep(Math.abs(aP - aS), aP + aS, theta)) * depth;
          // Phase angle at the planet between the Sun and the craft.
          tmp3.copy(sunW).sub(v.trueW).sub(tmp2); // planet → Sun
          const alpha = Math.acos(Math.min(Math.max(-tmp2.dot(tmp3) / (dP * Math.max(tmp3.length(), 1)), -1), 1));
          fill = host.albedo * (host.radiusM / dP) ** 2 * lambertPhase(alpha);
          tmp2.multiplyScalar(1 / dP);
        }
        const gain = exhibitionDisplayGain(v.enlarge, dSun);
        let irr = solarSceneIrradianceAt(v.trueW, tMs) * gain;
        // The shared exposure (solar bodiesLayer) exposes the focus as if at 1 au but clamps its gain to [0.1, 2500]:
        // undo most of the clamp for a focused craft (Parker at 0.046 au, Voyager at 170 au) and let the meter do the rest.
        if (focusedLike) irr *= Math.pow((dSun / AU_M) ** 2 / Math.max(exposureState.targetGain, 1e-6), 0.9);

        // Model.
        const wantMesh = shownPx >= MIN_MESH_PX && meshes < MAX_MESHES;
        if (wantMesh && !v.mesh && built < 1) {
          ensureMesh(v);
          built++;
        }
        if (v.mesh && v.material) {
          v.mesh.visible = wantMesh;
          if (wantMesh) {
            meshes++;
            ctx.toRender(v.world, v.mesh.position);
            v.mesh.scale.setScalar(v.enlarge / ctx.metersPerUnit);
            orient(v, tMs);
            const u = v.material.uniforms;
            u.uSunDir.value.copy(sunDir);
            u.uSunObj.value.copy(sunDir).applyQuaternion(invQ.copy(v.mesh.quaternion).invert());
            u.uDrive.value = Math.atan2(u.uSunObj.value.z, u.uSunObj.value.y); // array drive: wing normal (+Y) → Sun
            u.uIrradiance.value = irr * eclipse;
            u.uUnits.value = v.enlarge / ctx.metersPerUnit;
            if (host) {
              u.uFillDir.value.copy(tmp2);
              u.uFill.value.set(host.rgb[0], host.rgb[1], host.rgb[2]).multiplyScalar(irr * fill);
            } else u.uFill.value.set(0, 0, 0);
            v.mesh.updateMatrixWorld(true);
          }
        }

        // Trail of the recent path (and the path ahead when focused), in the frame body's (mapped) frame.
        const tr = TRACKS.get(v.id);
        if (tr && v.info.trailDays > 0) {
          const step = v.info.trailDays / TRAIL_N;
          if (v.relFrame !== fid || !(Math.abs(jd - v.relJd) < step) || (v.id === 'jwst' && !(Math.abs(jd - v.relJd) < 0.05))) {
            if (built < 3) { buildTrail(v, jd, fid); built++; }
          }
          const lineFade = focusedLike ? 1 : sstep(0.002 * v.relExtentM, 0.02 * v.relExtentM, fieldM);
          const wantTrail = focusedLike && v.relN > 1 && v.relFrame === fid && lineFade > 0.003;
          if (wantTrail) ensureLines(v);
          if (v.trail && v.future) {
            v.trail.visible = wantTrail;
            v.future.visible = wantTrail && focusedLike && v.frelN > 1;
            if (wantTrail) {
              // Frame body's drawn position and enlargement (the Sun's satellites are never remapped by visualScale).
              let origin: THREE.Vector3;
              if (fid !== 'sol:sun' && satelliteSystem(fid, tMs, sys)) origin = sys.renderPosition;
              else {
                sys.factor = 1;
                origin = fid === 'sol:sun' ? sunW : posOf(fid)(tMs, tmp3);
              }
              mapOffsets(v.rel, v.relN, v.drawn);
              // Close the trail exactly on the drawn craft.
              const k = v.relN;
              v.drawn[3 * k] = v.world.x - origin.x; v.drawn[3 * k + 1] = v.world.y - origin.y; v.drawn[3 * k + 2] = v.world.z - origin.z;
              const covered = jd <= tr.endJD;
              v.trail.setPolyline(v.drawn, covered ? k + 1 : k, false);
              v.trail.parentPositionM.copy(origin);
              v.trail.material.role = focusedLike ? 'focused' : 'minor';
              v.trail.material.setFade((focusedLike ? 0.9 : 0.42) * lineFade);
              v.trail.setHead(0.9999, 0);
              v.trail.update(ctx);
              if (v.future.visible) {
                mapOffsets(v.frel, v.frelN, v.drawn);
                v.future.setPolyline(v.drawn, v.frelN, false);
                v.future.parentPositionM.copy(origin);
                v.future.material.role = 'minor';
                v.future.material.setFade(0.3);
                v.future.setHead(-1);
                v.future.update(ctx);
              }
            }
          }
        }

        // Marker: diamond ring (UI) around a sunlit glint, while the model is small on screen.
        ctx.toRender(v.world, tmp);
        markerPos[3 * nm] = tmp.x;
        markerPos[3 * nm + 1] = tmp.y;
        markerPos[3 * nm + 2] = tmp.z;
        let fade = 1 - sstep(MARKER_HIDE_PX * 0.4, MARKER_HIDE_PX, shownPx);
        // At planet-scale views only nearby craft keep a marker.
        if (!focusedLike && fieldM < (fid !== 'sol:sun' ? 2e8 : 3e9)) fade *= 1 - sstep(100 * fieldM, 200 * fieldM, v.distM);
        // Interstellar and wider views: the markers would pile up on the Sun.
        if (!focusedLike) fade *= 1 - sstep(1e14, 1e15, fieldM);
        tmp.subVectors(ctx.cameraPosition, v.world).normalize();
        v.glint = (0.25 + 0.75 * lambertPhase(Math.acos(Math.min(Math.max(tmp.dot(sunDir), -1), 1)))) * eclipse;
        markerColor[4 * nm] = MARKER_RGB[0];
        markerColor[4 * nm + 1] = MARKER_RGB[1];
        markerColor[4 * nm + 2] = MARKER_RGB[2];
        markerColor[4 * nm + 3] = 0.6 * fade * (v.active ? 1 : 0.5);
        markerGlint[nm] = 0.9 * fade * v.glint * (v.active ? 1 : 0);
        markerSize[nm] = fade > 0.01 ? 13 : 0;
        nm++;
      }
      if (markerGeo && markerMat) {
        markerGeo.setDrawRange(0, nm);
        for (const k of ['position', 'aSize', 'aColor', 'aGlint']) (markerGeo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
        markerMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const v of visuals) {
        if (!v.shown) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y) - Math.max((v.px * v.enlarge) / 2, 6);
        if (d > radiusPx) continue;
        hits.push({ entityId: v.entity.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: v.entity.importance });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      const fieldM = Math.pow(10, ctx.scaleLog10);
      for (const v of visuals) {
        if (!v.shown) continue;
        const mine = v.entity.id === ctx.selectedId || v.entity.id === ctx.focusEntityId;
        const local = frameOf(v) !== 'sol:sun';
        if (!mine && fieldM < (local ? 2e8 : 3e9) && v.distM > 200 * fieldM) continue;
        if (!mine && fieldM > 1e15) continue;
        const shownPx = v.px * v.enlarge;
        if (shownPx > ctx.viewport.height * 0.9) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id, text: v.entity.name, x: screen.x, y: screen.y,
          priority: v.entity.importance, kind: 'body', offsetPx: Math.min(shownPx / 2, 4000) + 10,
          detail: v.active ? ILLUSTRATIVE_LABEL : `Mission ended · final position`,
        });
      }
    },

    dispose(): void {
      disposed = true;
      for (const v of visuals) {
        v.unregister();
        v.mesh?.removeFromParent();
        v.material?.dispose();
        for (const l of [v.trail, v.future]) {
          l?.removeFromParent();
          l?.dispose();
        }
      }
      disposeCraftGeometries();
      markerPoints?.removeFromParent();
      markerGeo?.dispose();
      markerMat?.dispose();
    },
  };
}

function historicWindowOf(m: CraftMeta): number | null {
  return m.historic ? m.endJD : null;
}
