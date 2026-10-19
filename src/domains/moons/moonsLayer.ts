/**
 * Moons layer: lit moon meshes (MoonMaterial) in their body-fixed frames, Titan's haze shell, photometric points while a
 * moon is smaller than a few pixels, thin orbit lines (relative to the parent planet) and labels that only appear once
 * the moon separates from its planet on screen. Positions come from the entities (parent runtime position + offset).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import type { Entity } from '../../core/entity';
import { AU_M, R_SUN_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import type { AtmosphereParams } from '../../render/glsl/atmosphere';
import { AtmosphereShell } from '../../render/materials/AtmosphereShell';
import { lodBlend, type LodBlend } from '../../render/lod';
import { OrbitLine } from '../../render/orbitBuilder';
import { exhibitionDisplayGain, exposureState, sunPosition, SUN_SCENE_IRRADIANCE_1AU } from '../solar/ephemeris';
import { resolveBodyTexture } from '../solar/textures';
import { MOON_LOOKS, MOON_RECORDS, PARENT_ENTITY, PARENT_INFO, SIDEREAL_DAYS, moonEntityId, type MoonRecord } from './data';
import { moonOffset, moonRotation } from './ephemeris';
import { createEllipsoidGeometry, createIrregularGeometry, parseShapeModel } from './geometry';
import { DetachedHaze, PlumeSystem, enceladusPlumeSpec, ioPlumeSpec } from './effects';
import { createSatelliteSystemTransform, mapSatelliteOffset, registerScaledBody, renderTransform, satelliteSystem } from '../../core/visualScale';
import { MoonMaterial, type MoonSpecial } from './moonMaterial';
import { meanRadiusM } from './entities';

const DEG = Math.PI / 180;

/** Titan: a thick tholin haze. Orange single-scattering (red-biased coefficients), no sea-level Mie; ~600 km deep. */
const TITAN_HAZE: AtmosphereParams = {
  planetRadiusM: 2_574_700,
  atmosphereHeightM: 650_000,
  rayleighScaleHeightM: 70_000,
  mieScaleHeightM: 60_000,
  rayleighScattering: [2.2e-6, 1.1e-6, 2.6e-7],
  mieScattering: 1.5e-6,
  mieExtinction: 2.2e-6,
  mieG: 0.62,
};

/** Named large features placed at their published positions (planetographic east-positive lon, lat in degrees). */
const FEATURES: Record<string, { lon: number; lat: number; radius: number; depth: number }[]> = {
  phobos: [{ lon: -49, lat: 1, radius: 0.42, depth: 0.16 }], // Stickney
  mimas: [{ lon: -112, lat: 0, radius: 0.36, depth: 0.1 }], // Herschel
  tethys: [{ lon: -128, lat: 29, radius: 0.42, depth: 0.045 }], // Odysseus
};

const dirOf = (lonDeg: number, latDeg: number): [number, number, number] => [
  Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG),
  Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG),
  Math.sin(latDeg * DEG),
];

const POINT_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const POINT_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 16.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  ${LOGDEPTH_FRAGMENT}
}`;

/** Moons with a real shape model (compact binary under public/data/moons; see scripts/data/moons). */
const SHAPE_MODELS: Record<string, string> = { phobos: 'data/moons/phobos.shape.bin' };

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface MoonVisual {
  rec: MoonRecord;
  entity: Entity;
  index: number;
  parentId: string;
  radiusM: number;
  aOrbitM: number;
  group: THREE.Group;
  overlayGroup: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, MoonMaterial>;
  material: MoonMaterial;
  atmosphere: AtmosphereShell | null;
  detached: DetachedHaze | null;
  plume: PlumeSystem | null;
  shapeRequested: boolean;
  orbitFactor: number;
  /** True parent-relative orbit samples (m) of the last rebuild; mapped through the parent's satellite system. */
  orbitTrue: Float64Array;
  orbitN: number;
  trueWorld: THREE.Vector3;
  orbit: OrbitLine | null;
  orbitBuiltMs: number;
  orbitPeriodMs: number;
  world: THREE.Vector3;
  parentWorld: THREE.Vector3;
  distM: number;
  px: number;
  shownPx: number;
  enlarge: number;
  sepPx: number;
  highRequested: boolean;
  geometryBuilt: boolean;
  meanLum: number;
  lod: LodBlend;
  dot: [number, number, number];
}

function buildGeometry(rec: MoonRecord, radiusM: number): THREE.BufferGeometry {
  const look = MOON_LOOKS[rec.id];
  const m = radiusM / 1000;
  const radii: [number, number, number] = [rec.radiiKm[0] / m, rec.radiiKm[1] / m, rec.radiiKm[2] / m];
  if (look.irregular) {
    const feats = (FEATURES[rec.id] ?? []).map((f) => ({ dir: dirOf(f.lon, f.lat), radius: f.radius, depth: f.depth }));
    const seed = Array.from(rec.id).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return createIrregularGeometry(radii, { seed, craters: Math.round(26 * look.craters), detail: 30, features: feats, lumpiness: rec.id === 'hyperion' ? 0.07 : 0.05 });
  }
  return createEllipsoidGeometry(radii, 128, 64);
}

/** Mean linear luminance of an equirectangular map (cos-latitude weighted, 64×32 box). */
function meanLinearLuminance(tex: THREE.Texture): number | null {
  const img = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width) return null;
  try {
    const w = 64, h = 32;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0, wsum = 0;
    for (let y = 0; y < h; y++) {
      const wt = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lin = (v: number): number => Math.pow(v / 255, 2.2);
        sum += wt * (0.3 * lin(d[i]) + 0.55 * lin(d[i + 1]) + 0.15 * lin(d[i + 2]));
        wsum += wt;
      }
    }
    return sum / wsum;
  } catch {
    return null;
  }
}

export function createMoonsLayer(entities: Entity[]): Layer {
  const visuals: MoonVisual[] = [];
  const disposables: { dispose(): void }[] = [];
  const sunWorld = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const off = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  const rot = new Float64Array(9);
  const m4 = new THREE.Matrix4();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const parentScreen = { x: 0, y: 0, depthM: 0, visible: false };
  const idToParent = new Map<string, string>();
  let svcRef: EngineServices | null = null;
  let rebuilds = 0;
  const sys = createSatelliteSystemTransform();
  const unregisters: (() => void)[] = [];
  let orbitPts: Float64Array = new Float64Array(3 * 160);
  let orbitFrac: Float64Array = new Float64Array(160);

  const n = entities.length;
  const pointPos = new Float32Array(n * 3);
  const pointCol = new Float32Array(n * 3);
  const pointSize = new Float32Array(n);
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPos, 3).setUsage(THREE.DynamicDrawUsage));
  pointGeo.setAttribute('aColor', new THREE.BufferAttribute(pointCol, 3).setUsage(THREE.DynamicDrawUsage));
  pointGeo.setAttribute('aSize', new THREE.BufferAttribute(pointSize, 1).setUsage(THREE.DynamicDrawUsage));
  const pointMat = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: { uPixelRatio: { value: 1 } },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const points = new THREE.Points(pointGeo, pointMat);
  points.name = 'moon-points';
  points.frustumCulled = false;
  disposables.push(pointGeo, pointMat);

  const loadTextures = (v: MoonVisual, quality: 'low' | 'high' | 'ultra'): void => {
    const svc = svcRef;
    const dir = MOON_LOOKS[v.rec.id].texture;
    if (!svc || !dir) return;
    void resolveBodyTexture(svc.assets, svc.renderer, dir, 'color', quality, 'srgb', (t) => {
      if (!visuals.includes(v)) return;
      if (v.meanLum <= 0) v.meanLum = meanLinearLuminance(t) ?? 0.3;
      const width = (t.image as { width?: number } | null)?.width ?? 1024;
      v.material.setMap(t, v.meanLum, MOON_LOOKS[v.rec.id].albedo, width);
    }, { isCancelled: () => !visuals.includes(v) });
  };

  const loadShape = async (v: MoonVisual): Promise<void> => {
    const svc = svcRef;
    const path = SHAPE_MODELS[v.rec.id];
    if (!svc || !path) return;
    try {
      const url = (svc.assets as { url?: (p: string) => string }).url?.(path) ?? '/' + path;
      const res = await fetch(url);
      if (!res.ok || !visuals.includes(v)) return;
      const g = parseShapeModel(await res.arrayBuffer(), v.radiusM / 1000);
      if (!g || !visuals.includes(v)) return;
      const old = v.mesh.geometry;
      v.mesh.geometry = g;
      disposables.push(g);
      old.dispose();
      v.material.setShapeModel();
    } catch {
      /* keep the illustrative shape */
    }
  };

  /** Re-sample the TRUE orbit (parent-relative) around tMs. */
  const rebuildOrbit = (v: MoonVisual, tMs: number): void => {
    if (!v.orbit) return;
    const N = v.rec.orbit.e > 0.2 ? 144 : 96;
    const period = v.orbitPeriodMs;
    for (let k = 0; k < N; k++) {
      moonOffset(v.rec, tMs + (k * period) / N, off);
      v.orbitTrue[3 * k] = off.x;
      v.orbitTrue[3 * k + 1] = off.y;
      v.orbitTrue[3 * k + 2] = off.z;
    }
    v.orbitN = N;
    v.orbitBuiltMs = tMs;
    v.orbitFactor = Number.NaN;
  };

  /** Map the true samples through the parent's satellite system (exhibition scale; identity at factor 1) into the line. */
  const mapOrbit = (v: MoonVisual, factor: number, coreM: number): void => {
    if (!v.orbit || v.orbitN < 2) return;
    const N = v.orbitN;
    for (let k = 0; k < N; k++) {
      const x = v.orbitTrue[3 * k], y = v.orbitTrue[3 * k + 1], z = v.orbitTrue[3 * k + 2];
      const a = Math.sqrt(x * x + y * y + z * z);
      const s = factor > 1 && a > 0 ? mapSatelliteOffset(factor, coreM, a) / a : 1;
      orbitPts[3 * k] = x * s;
      orbitPts[3 * k + 1] = y * s;
      orbitPts[3 * k + 2] = z * s;
      orbitFrac[k] = k / N;
    }
    v.orbit.setPolyline(orbitPts, N, true, orbitFrac);
    v.orbitFactor = factor;
  };

  return {
    id: 'moons',
    init(svc: EngineServices): void {
      svcRef = svc;
      svc.groups.far.add(points);
      entities.forEach((entity, index) => {
        const rec = MOON_RECORDS.find((r) => moonEntityId(r.id) === entity.id)!;
        const look = MOON_LOOKS[rec.id];
        const radiusM = meanRadiusM(rec);
        const base = new THREE.Color(look.color);
        const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
        const mapped = !!look.texture;
        // Mapped: hue only (the map supplies brightness). Unmapped: luminance = geometric albedo.
        base.multiplyScalar(mapped ? 1 / lum : (look.albedo * 0.88) / lum);
        const special = (look.special ?? 'none') as MoonSpecial;
        const tint = look.tint;
        const rampDark = new THREE.Vector3(...(tint?.dark ?? [1, 1, 1]));
        const rampLight = new THREE.Vector3(...(tint?.light ?? [1, 1, 1]));
        const seed = Array.from(rec.id).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 3) / 7;
        const feats = look.irregular ? [] : (FEATURES[rec.id] ?? []).map((f) => ({ dir: dirOf(f.lon, f.lat), radius: f.radius, depth: f.depth }));
        const icy = look.surge <= 0.5 && look.albedo > 0.3;
        const material = new MoonMaterial({
          color: base, albedo: look.albedo, icy, surge: look.surge, craters: look.craters, mottling: look.mottling,
          seed, special, rampDark, rampLight, features: feats,
        });
        const placeholder = new THREE.BufferGeometry();
        const mesh = new THREE.Mesh(placeholder, material);
        mesh.name = entity.id;
        mesh.frustumCulled = false;
        const group = new THREE.Group();
        group.name = `${entity.id}:frame`;
        group.add(mesh);
        svc.groups.main.add(group);
        const overlayGroup = new THREE.Group();
        overlayGroup.name = `${entity.id}:transparent`;
        svc.groups.transparent.add(overlayGroup);
        disposables.push(material, placeholder);

        let atmosphere: AtmosphereShell | null = null;
        if (special === 'titan') {
          atmosphere = new AtmosphereShell({ params: { ...TITAN_HAZE, planetRadiusM: radiusM }, sunIntensity: 5, steps: 10 });
          atmosphere.name = 'titan:haze';
          overlayGroup.add(atmosphere);
          disposables.push(atmosphere);
        }
        let detached: DetachedHaze | null = null;
        if (special === 'titan') {
          detached = new DetachedHaze(1.19, 1.2, 1.0);
          overlayGroup.add(detached);
          disposables.push(detached);
        }
        let plume: PlumeSystem | null = null;
        const gravity = (rec.gm * 1e9) / (radiusM * radiusM);
        if (rec.id === 'enceladus' || rec.id === 'io') {
          plume = new PlumeSystem(rec.id === 'io' ? ioPlumeSpec(radiusM, gravity) : enceladusPlumeSpec(radiusM, gravity));
          overlayGroup.add(plume);
          disposables.push(plume);
        }
        let orbit: OrbitLine | null = null;
        if (rec.id !== 'moon') {
          orbit = new OrbitLine({ role: 'minor', provenance: 'derived', maxVertices: 160 });
          orbit.name = `${entity.id}:orbit`;
          svc.groups.overlay.add(orbit);
        }
        const c = new THREE.Color(look.color);
        const v: MoonVisual = {
          rec, entity, index, parentId: PARENT_ENTITY[rec.parent], radiusM, aOrbitM: rec.orbit.aKm * 1000,
          group, overlayGroup, mesh, material, atmosphere, detached, plume, shapeRequested: false, orbitFactor: Number.NaN, orbitTrue: new Float64Array(3 * 160), orbitN: 0, trueWorld: new THREE.Vector3(), orbit, orbitBuiltMs: Number.NaN,
          orbitPeriodMs: (SIDEREAL_DAYS[rec.id] ?? rec.orbit.periodDays) * 86_400_000,
          world: new THREE.Vector3(), parentWorld: new THREE.Vector3(), distM: 1, px: 0, shownPx: 0, enlarge: 1, sepPx: 1e6,
          highRequested: false, geometryBuilt: false, meanLum: 0, lod: { level: 'point', point: 1, sphere: 0, detail: 0, extras: 0 },
          dot: [c.r, c.g, c.b],
        };
        idToParent.set(entity.id, v.parentId);
        // Exhibition scale: offset magnified around the registered parent, radius capped clear of it (src/core/visualScale.ts).
        unregisters.push(registerScaledBody(entity, { radiusM }));
        visuals.push(v);
        loadTextures(v, 'low');
      });
    },

    update(ctx: FrameContext): void {
      sunPosition(ctx.timeMs, sunWorld);
      const inv = 1 / ctx.metersPerUnit;
      pointMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      rebuilds = 0;

      for (const v of visuals) {
        const rec = v.rec;
        // Drawn position + radius factor (exhibition scale); the parent's satellite system gives its drawn centre.
        v.enlarge = renderTransform(v.entity, ctx.timeMs, v.world);
        moonOffset(rec, ctx.timeMs, off);
        const sysOn = satelliteSystem(v.parentId, ctx.timeMs, sys);
        if (sysOn) {
          v.parentWorld.copy(sys.renderPosition);
          v.trueWorld.copy(sys.truePosition).add(off);
        } else {
          v.entity.position(ctx.timeMs, v.trueWorld);
          v.parentWorld.copy(v.world).sub(off);
        }
        const parentFactor = sysOn ? sys.factor : 1;
        const parentCoreM = sysOn ? sys.coreRadiusM : 0;
        v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
        v.px = ctx.pixelDiameter(v.radiusM, v.distM);
        const parentDist = Math.max(v.parentWorld.distanceTo(ctx.cameraPosition), 1);
        v.sepPx = (v.world.distanceTo(v.parentWorld) / parentDist) * ctx.pixelsPerRadian;
        v.shownPx = v.px * v.enlarge;
        lodBlend(v.shownPx, v.lod);

        const dSun = Math.max(v.world.distanceTo(sunWorld), R_SUN_M);
        const r = AU_M / dSun;
        const E0 = SUN_SCENE_IRRADIANCE_1AU * r * r * exposureState.gain;
        const E = E0 * exhibitionDisplayGain(v.enlarge, dSun);
        sunDir.subVectors(sunWorld, v.world).normalize();
        const look = MOON_LOOKS[rec.id];

        // Photometric point (fades as the disc fades in, and when it sits on top of its planet).
        ctx.toRender(v.world, tmp);
        const i3 = v.index * 3;
        pointPos[i3] = tmp.x;
        pointPos[i3 + 1] = tmp.y;
        pointPos[i3 + 2] = tmp.z;
        const sepFade = smooth(3, 10, v.sepPx);
        if (v.lod.point > 0.001 && sepFade > 0.001) {
          tmp2.subVectors(ctx.cameraPosition, v.world).normalize();
          const phase = 0.5 * (1 + tmp2.dot(sunDir));
          const L = (look.albedo * E0) / Math.PI * phase;
          const areaPx = Math.PI * 0.25 * v.shownPx * v.shownPx;
          // Floor: a moon must read as a clear dot from planet-system distances (major moons brighter), like the naked-eye Galileans.
          const imp = v.entity.importance ?? 40;
          const floor = imp >= 70 ? 1.1 : imp >= 50 ? 0.65 : 0.3;
          const intensity = Math.max((L * areaPx) / 4.5, floor) * v.lod.point * sepFade;
          pointSize[v.index] = imp >= 70 ? 8 : imp >= 50 ? 6 : 4;
          pointCol[i3] = v.dot[0] * intensity;
          pointCol[i3 + 1] = v.dot[1] * intensity;
          pointCol[i3 + 2] = v.dot[2] * intensity;
        } else {
          pointCol[i3] = pointCol[i3 + 1] = pointCol[i3 + 2] = 0;
          pointSize[v.index] = 0;
        }

        // Orbit line (relative to the parent planet).
        if (v.orbit) {
          const orbitPx = ctx.pixelDiameter(mapSatelliteOffset(parentFactor, parentCoreM, v.aOrbitM), Math.max(parentDist, v.aOrbitM));
          const fade = ctx.overlays.orbits ? smooth(24, 90, orbitPx) * (1 - smooth(14, 60, v.px)) : 0;
          v.orbit.visible = fade > 0.003;
          if (v.orbit.visible) {
            if (rebuilds < 2 && !(Math.abs(ctx.timeMs - v.orbitBuiltMs) < v.orbitPeriodMs / 48)) {
              rebuildOrbit(v, ctx.timeMs);
              rebuilds++;
            }
            if (!(Math.abs(parentFactor - v.orbitFactor) <= 1e-3 * parentFactor)) mapOrbit(v, parentFactor, parentCoreM);
            const focused = ctx.focusEntityId === v.entity.id || ctx.selectedId === v.entity.id;
            const sysFocus = ctx.focusEntityId === v.parentId || (ctx.focusEntityId !== null && idToParent.get(ctx.focusEntityId) === v.parentId);
            const role = focused ? 'focused' : sysFocus ? 'planet' : 'minor';
            if (v.orbit.material.role !== role) v.orbit.material.role = role;
            v.orbit.material.setFade(fade);
            v.orbit.setHead(0, 0.25);
            v.orbit.parentPositionM.copy(v.parentWorld);
            v.orbit.update(ctx);
          }
        }

        const show = v.lod.sphere > 0.001 && v.distM > v.radiusM * v.enlarge * 0.5;
        v.group.visible = show;
        v.overlayGroup.visible = show;
        if (!show) continue;

        if (!v.geometryBuilt) {
          v.geometryBuilt = true;
          const g = buildGeometry(rec, v.radiusM);
          v.mesh.geometry = g;
          disposables.push(g);
        }
        if (!v.shapeRequested && SHAPE_MODELS[rec.id] && v.shownPx > 24) {
          v.shapeRequested = true;
          void loadShape(v);
        }

        moonRotation(rec, ctx.timeMs, rot);
        m4.set(rot[0], rot[1], rot[2], 0, rot[3], rot[4], rot[5], 0, rot[6], rot[7], rot[8], 0, 0, 0, 0, 1);
        v.group.quaternion.setFromRotationMatrix(m4);
        const scale = v.radiusM * v.enlarge * inv;
        v.group.position.copy(tmp);
        v.group.scale.setScalar(scale);
        v.overlayGroup.position.copy(tmp);
        v.overlayGroup.quaternion.copy(v.group.quaternion);
        v.overlayGroup.scale.setScalar(scale);

        qInv.copy(v.group.quaternion).invert();
        const u = v.material.uniforms;
        const unit = 1 / (v.radiusM * v.enlarge);
        u.uSunDir.value.copy(sunDir).applyQuaternion(qInv);
        u.uCamLocal.value.subVectors(ctx.cameraPosition, v.world).applyQuaternion(qInv).multiplyScalar(unit);
        u.uSunIntensity.value = E * v.lod.sphere;
        u.uSunAngularRadius.value = Math.asin(Math.min(1, R_SUN_M / dSun));
        u.uDetail.value = v.lod.detail;

        // Parent planet: umbra/penumbra on the moon, and planetshine (Lambert sphere, phase-dependent).
        const pinfo = PARENT_INFO[rec.parent];
        const Rp = pinfo.radiusKm * 1000;
        tmp2.copy(off).negate(); // moon → planet (TRUE geometry)
        const dMP = Math.max(tmp2.length(), Rp);
        const shadowsOn = ctx.quality.shadowQuality !== 'off' && v.enlarge < 1.001 && parentFactor < 1.001;
        u.uPlanet.value.set(0, 0, 0, 0);
        tmp.copy(tmp2).applyQuaternion(qInv).multiplyScalar(unit);
        if (shadowsOn) u.uPlanet.value.set(tmp.x, tmp.y, tmp.z, Rp * unit);
        // Phase angle at the planet between the Sun and the moon: cosα = (sun − planet)·(moon − planet).
        tmp.subVectors(sunWorld, v.trueWorld).sub(tmp2).normalize();
        const cosA = THREE.MathUtils.clamp(-tmp.dot(tmp2) / dMP, -1, 1);
        const alpha = Math.acos(cosA);
        const phi = (Math.sin(alpha) + (Math.PI - alpha) * cosA) / Math.PI;
        const dPlanetSun = Math.max(tmp.set(v.trueWorld.x + tmp2.x - sunWorld.x, v.trueWorld.y + tmp2.y - sunWorld.y, v.trueWorld.z + tmp2.z - sunWorld.z).length(), R_SUN_M);
        const Ep = SUN_SCENE_IRRADIANCE_1AU * (AU_M / dPlanetSun) ** 2 * exposureState.gain;
        const shine = Ep * pinfo.albedo * (Rp / dMP) ** 2 * phi * v.lod.sphere;
        u.uPlanetShine.value.set(pinfo.color[0] * shine, pinfo.color[1] * shine, pinfo.color[2] * shine);

        if (!v.highRequested && v.shownPx > 180 && ctx.quality.textureQuality !== 'low') {
          v.highRequested = true;
          loadTextures(v, ctx.quality.textureQuality);
        }
        if (v.detached) {
          v.detached.visible = v.lod.detail > 0.01;
          v.detached.sunDirectionWorld.copy(sunDir);
          v.detached.material.uniforms.uSunIntensity.value = E * v.lod.detail;
        }
        if (v.plume) {
          v.plume.visible = v.lod.sphere > 0.2;
          if (v.plume.visible) {
            v.plume.sunDirectionWorld.copy(sunDir);
            v.plume.step(ctx.dtRealSec, E * v.lod.sphere, scale, ctx.pixelsPerRadian, ctx.viewport.pixelRatio);
          }
        }
        if (v.atmosphere) {
          v.atmosphere.visible = v.lod.detail > 0.01;
          v.atmosphere.sunDirectionWorld.copy(sunDir);
          v.atmosphere.material.uniforms.uSunIntensity.value = E * v.lod.detail;
        }
      }
      (pointGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (pointGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (pointGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const v of visuals) {
        if (v.sepPx < 8 && v.shownPx < 8) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y) - Math.max(v.shownPx / 2, 3);
        if (d > radiusPx) continue;
        hits.push({ entityId: v.entity.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: v.entity.importance ?? 40 });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      const focus = ctx.focusEntityId;
      const focusSystem = focus ? (idToParent.get(focus) ?? focus) : null;
      for (const v of visuals) {
        if (v.shownPx > ctx.viewport.height * 0.9) continue;
        const inSystem = focusSystem === v.parentId;
        const minSep = inSystem ? 18 : 60;
        if (v.sepPx < minSep) continue;
        const imp = v.entity.importance ?? 40;
        if (!inSystem && imp < 70) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id,
          text: v.entity.name,
          x: screen.x,
          y: screen.y,
          priority: imp - 10,
          kind: 'body',
          offsetPx: Math.min(v.shownPx / 2, 4000) + 4,
        });
      }
      void parentScreen;
    },

    dispose(): void {
      for (const u of unregisters) u();
      unregisters.length = 0;
      for (const v of visuals) {
        v.group.removeFromParent();
        v.overlayGroup.removeFromParent();
        if (v.orbit) {
          v.orbit.removeFromParent();
          v.orbit.dispose();
        }
      }
      points.removeFromParent();
      for (const d of disposables) d.dispose();
      visuals.length = 0;
      orbitPts = new Float64Array(0);
      orbitFrac = new Float64Array(0);
    },
  };
}
