/**
 * Earth–Moon render layer.
 *
 * Per body: a photometric point when the disc is tiny (energy-matched to the disc, with a visibility floor),
 * cross-fading into the full shaded sphere. Earth adds the render-kit atmosphere shell (single scattering:
 * blue limb, aerial perspective over the disc, red terminator). Relief normals fade in once a disc spans
 * ~400 px. Textures load lowest tier first and climb toward QualityProfile.textureQuality as the body grows.
 *
 * Everything is placed with ctx.toRender (camera-relative) and oriented by the body-fixed → ICRS matrices from
 * ./ephemeris (render axes are ICRS axes). No allocations in update().
 */
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { AU_M, R_SUN_M } from '../../core/units';
import { AtmosphereShell } from '../../render/materials/AtmosphereShell';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { EarthSurfaceMaterial } from './earthMaterial';
import { MoonSurfaceMaterial } from './moonMaterial';
import { AURORA_TOP, AuroraMaterial } from './aurora';
import { dipoleAxis, kpAt, ovalEquatorwardMlatDeg, parseStorms, type KpReading, type SpaceWeatherJson, type StormSpan } from './spaceWeather';
import { registerScaledBody, renderTransform } from '../../core/visualScale';
import { evaluate, icrsToBodyFixed, rotationToQuaternion } from './ephemeris';
import { ProgressiveMap, TIER_ORDER, loadTextureTable, maxTierFor, type TextureTable, type Tier } from './textures';
import { R_EARTH_M, R_MOON_M } from './entities';

/** Solar irradiance at 1 AU in scene-linear units (render-kit LitBody / AtmosphereShell convention). */
export const SUN_IRRADIANCE_1AU = 5;
/** Earth Bond albedo for Earthshine (NSSDCA: 0.306). */
const EARTH_BOND_ALBEDO = 0.306;
/**
 * Display gain applied to Earthshine and to the refracted light in the umbra. Both are ~10⁻⁴ of sunlight and would
 * render black next to the sunlit crescent; the eye adapts locally and sees them, so they are brightened by this
 * factor (disclosed in the Moon's fact sheet).
 */
export const LOW_LIGHT_DISPLAY_GAIN = 900;
/**
 * Mean irradiance in the umbra from sunlight refracted by the Earth's atmosphere, fraction of direct sunlight
 * (Danjon L ≈ 2–3 totality: the Moon fades by ~10⁻⁴–10⁻⁵).
 */
const UMBRA_REFRACTED_FRACTION = 6e-5;
/** The umbra needs a stronger lift than Earthshine to read as copper-red at exhibition exposure. */
export const UMBRA_DISPLAY_GAIN = 4000;
/**
 * Aurora display gain: emission per Earth radius of path for the strongest arcs. A bright arc (~100 kR in 557.7 nm) is
 * comparable to city lights in ISS night photographs; this gain puts it there at Kp ~ 5 (disclosed in the fact sheet).
 */
const AURORA_GAIN = 6;
/** Cloud drift: the cloud field is advected by climatological zonal winds; faded out at fast time rates. */
const DRIFT_FADE_RATE_START = 1500;
const DRIFT_FADE_RATE_END = 6000;
/** Earth relief: the normal map is built with slopes ×6; 0.5 renders them ×3 for legible terminator relief. */
const EARTH_NORMAL_STRENGTH = 0.5;
/**
 * In-scattered (path) radiance scale of the single-scattering shell. Calibrated against DSCOVR EPIC frames rendered
 * from the same geometry (sandbox view 'epic'): the uncalibrated shell (440 nm Rayleigh coefficient for the whole
 * blue channel, no multiple-scattering energy loss) washes the disc out ~2× relative to the land.
 */
const EARTH_HAZE_SCALE = 0.5;
const MOON_NORMAL_STRENGTH = 1.0;
const DETAIL_START_PX = 400;
const DETAIL_FULL_PX = 800;
const MESH_MIN_PX = 1.5;
const POINT_FADE_END_PX = 4;
const POINT_SIGMA_PX = 0.8;

const POINT_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = uSize;
  ${LOGDEPTH_VERTEX}
}
`;
const POINT_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uSize;
uniform float uSigma;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = (gl_PointCoord - 0.5) * uSize;
  float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma));
  gl_FragColor = vec4(uColor * g, 1.0);
}
`;

interface BodyVis {
  entity: Entity;
  radiusM: number;
  mesh: THREE.Mesh;
  point: THREE.Points;
  pointMat: THREE.ShaderMaterial;
  /** Point colour (linear, unit luminance-ish) and geometric albedo for the energy match. */
  tint: THREE.Color;
  geomAlbedo: number;
  world: THREE.Vector3;
  distanceM: number;
  pxTrue: number;
  enlarge: number;
  maps: ProgressiveMap[];
  /** Highest tier requested so far (never downgrade). */
  requested: Tier | null;
}

function phaseIntegral(alpha: number): number {
  // Lambert-sphere phase function (normalized to 1 at full phase).
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
}

function tierForPx(px: number): Tier {
  return px < 300 ? 'low' : px < 1100 ? 'high' : 'ultra';
}
/**
 * Close range = camera within CLOSE_RANGE_IN radii of the centre (below ~2200 km altitude), where an 8K map (~5 km/texel)
 * is coarser than a pixel. Only there: the 16K day map on Ultra (~700 MB VRAM) and, on the 'high' (4K) profile, the 8K
 * day + cloud maps of the focused Earth (~+270 MB). Both are released beyond CLOSE_RANGE_OUT.
 */
const CLOSE_RANGE_IN = 1.35;
const CLOSE_RANGE_OUT = 1.7;
const BOOST_MAP_INDICES = [0, 2] as const;

export interface EarthMoonLayerOptions {
  earth: Entity;
  moon: Entity;
}

export function createEarthMoonLayer(opts: EarthMoonLayerOptions): Layer {
  const earthMat = new EarthSurfaceMaterial();
  const moonMat = new MoonSurfaceMaterial();
  const earthGeo = new THREE.SphereGeometry(1, 256, 128).rotateX(Math.PI / 2);
  const moonGeo = new THREE.SphereGeometry(1, 160, 80).rotateX(Math.PI / 2);
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const atmosphere = new AtmosphereShell({ sunIntensity: SUN_IRRADIANCE_1AU, steps: 12 });
  atmosphere.name = 'sol:earth:atmosphere';
  atmosphere.renderOrder = 1;
  const auroraMat = new AuroraMaterial();
  const auroraGeo = new THREE.SphereGeometry(AURORA_TOP, 192, 96).rotateX(Math.PI / 2);
  const aurora = new THREE.Mesh(auroraGeo, auroraMat);
  aurora.name = 'sol:earth:aurora';
  aurora.frustumCulled = false;
  aurora.renderOrder = 2;
  aurora.visible = false;
  dipoleAxis(auroraMat.uniforms.uDipole.value);
  let storms: StormSpan[] = [];
  const kp: KpReading = { kp: 2, basis: 'typical', stormMaxKp: null };
  let auroraClock = 0;
  let flowSimSec = 0;
  let boosted = false;
  const unregister: (() => void)[] = [];

  const makePoint = (name: string): { point: THREE.Points; mat: THREE.ShaderMaterial } => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Vector3() }, uSize: { value: 8 }, uSigma: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const point = new THREE.Points(pointGeo, mat);
    point.name = name;
    point.frustumCulled = false;
    point.visible = false;
    return { point, mat };
  };

  const mkBody = (entity: Entity, radiusM: number, material: THREE.Material, geo: THREE.BufferGeometry, tint: number, geomAlbedo: number): BodyVis => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = entity.id;
    mesh.frustumCulled = false;
    mesh.visible = false;
    const { point, mat } = makePoint(`${entity.id}:point`);
    return {
      entity, radiusM, mesh, point, pointMat: mat, tint: new THREE.Color(tint), geomAlbedo,
      world: new THREE.Vector3(), distanceM: 0, pxTrue: 0, enlarge: 1, maps: [], requested: null,
    };
  };

  const earth = mkBody(opts.earth, R_EARTH_M, earthMat, earthGeo, 0x9fc1ff, 0.367);
  const moon = mkBody(opts.moon, R_MOON_M, moonMat, moonGeo, 0xe6ddd0, 0.12);
  const bodies = [earth, moon];

  let services: EngineServices | null = null;
  let table: TextureTable | null = null;
  let qualityMax: Tier = 'high';

  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const screen: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };

  const setupMaps = (svc: EngineServices, t: TextureTable): void => {
    const repeat = (tex: THREE.Texture): THREE.Texture => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    };
    const u = earthMat.uniforms;
    earth.maps = [
      new ProgressiveMap(svc.assets, t, 'earth', 'day', 'srgb', tex => { u.uDay.value = repeat(tex); }),
      new ProgressiveMap(svc.assets, t, 'earth', 'night', 'srgb', tex => { u.uNight.value = repeat(tex); }),
      new ProgressiveMap(svc.assets, t, 'earth', 'clouds', 'linear', tex => {
        u.uClouds.value = repeat(tex);
        const w = (tex.image as { width?: number } | null)?.width;
        if (w) u.uCloudTexel.value = 1 / w;
      }),
      new ProgressiveMap(svc.assets, t, 'earth', 'specular', 'linear', tex => { u.uSpec.value = repeat(tex); }),
      new ProgressiveMap(svc.assets, t, 'earth', 'normal', 'linear', tex => { u.uNormal.value = repeat(tex); u.uHasNormal.value = 1; }),
    ];
    const m = moonMat.uniforms;
    moon.maps = [
      new ProgressiveMap(svc.assets, t, 'moon', 'color', 'srgb', tex => { m.uColor.value = repeat(tex); }),
      new ProgressiveMap(svc.assets, t, 'moon', 'normal', 'linear', tex => { m.uNormal.value = repeat(tex); m.uHasNormal.value = 1; }),
    ];
    for (const b of bodies) {
      b.requested = 'low';
      for (const map of b.maps) map.request('low');
    }
  };

  const requestTier = (b: BodyVis): void => {
    if (!b.requested) return;
    const px = b.pxTrue * b.enlarge;
    const range = b.distanceM / (b.radiusM * b.enlarge);
    // The 16K tier is the only one ever released (VRAM); lower tiers are kept once loaded.
    if (b.requested === 'max' && (qualityMax !== 'max' || range > CLOSE_RANGE_OUT)) {
      b.requested = 'ultra';
      for (const map of b.maps) map.cap('ultra');
      return;
    }
    const byPx = range < CLOSE_RANGE_IN ? 'max' : tierForPx(px);
    let want = TIER_ORDER[Math.min(TIER_ORDER.indexOf(byPx), TIER_ORDER.indexOf(qualityMax))]!;
    if (want === 'max' && (services?.renderer.capabilities.maxTextureSize ?? 0) < 16384) want = 'ultra';
    if (TIER_ORDER.indexOf(want) <= TIER_ORDER.indexOf(b.requested)) return;
    b.requested = want;
    for (const map of b.maps) map.request(want);
  };

  /**
   * Visual-scale hook: the single place a body's drawn radius factor and drawn position are decided
   * (src/core/visualScale.ts: exhibition enlargement, Moon offset magnified around the enlarged Earth; identity in
   * true-scale mode or without a registration). Writes the DRAWN position into `out`.
   */
  const visualFactor = (b: BodyVis, ctx: FrameContext, out: THREE.Vector3): number => {
    const f = renderTransform(b.entity, ctx.timeMs, out);
    return Number.isFinite(f) && f >= 1 ? f : 1;
  };

  /** Position, scale and LOD for one body; returns true when the mesh is drawn. */
  const placeBody = (b: BodyVis, ctx: FrameContext, trueWorld: THREE.Vector3, rot: Float64Array, sunWorld: THREE.Vector3): boolean => {
    b.world.copy(trueWorld);
    b.enlarge = visualFactor(b, ctx, b.world);
    const world = b.world;
    b.distanceM = Math.max(world.distanceTo(ctx.cameraPosition), 1);
    b.pxTrue = ctx.pixelDiameter(b.radiusM, b.distanceM);
    const px = b.pxTrue * b.enlarge;
    const meshOn = px >= MESH_MIN_PX;
    b.mesh.visible = meshOn;
    if (meshOn) {
      ctx.toRender(world, b.mesh.position);
      b.mesh.scale.setScalar((b.radiusM * b.enlarge) / ctx.metersPerUnit);
      rotationToQuaternion(rot, b.mesh.quaternion);
    }
    // Photometric point: flux of the lit disc (geometric albedo × Lambert phase), floor so it stays visible.
    const fade = 1 - THREE.MathUtils.smoothstep(px, MESH_MIN_PX, POINT_FADE_END_PX);
    b.point.visible = fade > 0.001;
    if (b.point.visible) {
      ctx.toRender(world, b.point.position);
      v1.subVectors(sunWorld, world).normalize();
      v2.subVectors(ctx.cameraPosition, world).normalize();
      const alpha = Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
      const sunDist = sunWorld.distanceTo(world);
      const E = SUN_IRRADIANCE_1AU * (AU_M / sunDist) ** 2;
      const rPx = px / 2;
      const flux = b.geomAlbedo * E * phaseIntegral(alpha) * rPx * rPx; // scene-linear × CSS px²
      const shown = Math.min(Math.max(flux, 3.0), 14);
      const peak = (shown / (2 * Math.PI * POINT_SIGMA_PX * POINT_SIGMA_PX)) * fade;
      const dpr = ctx.viewport.pixelRatio;
      b.pointMat.uniforms.uSize.value = Math.ceil(POINT_SIGMA_PX * 8 * dpr);
      b.pointMat.uniforms.uSigma.value = POINT_SIGMA_PX * dpr;
      (b.pointMat.uniforms.uColor.value as THREE.Vector3).set(b.tint.r * peak, b.tint.g * peak, b.tint.b * peak);
    }
    return meshOn;
  };

  /** Illustrative aurora (./aurora): on while the Earth is a real disc; Kp from the DONKI storm list at the sim time. */
  const updateAurora = (ctx: FrameContext, px: number, camBf: THREE.Vector3, sunBf: THREE.Vector3): void => {
    aurora.visible = px > 24;
    if (!aurora.visible) return;
    aurora.position.copy(earth.mesh.position);
    aurora.scale.copy(earth.mesh.scale);
    aurora.quaternion.copy(earth.mesh.quaternion);
    kpAt(storms, ctx.timeMs, kp);
    const a = auroraMat.uniforms;
    a.uCamPos.value.copy(camBf);
    a.uSunDir.value.copy(sunBf);
    a.uKp.value = kp.kp;
    a.uEqMidnight.value = ovalEquatorwardMlatDeg(kp.kp);
    // Dayside boundary ~11 deg poleward of the nightside one (Feldstein-Starkov oval, ~77 -> 72 deg from Kp 0 to 9).
    a.uEqNoon.value = 77 - 0.6 * Math.min(9, kp.kp);
    // Brightness grows roughly linearly with Kp (hemispheric power ~10 GW quiet -> 100+ GW in storms).
    a.uGain.value = AURORA_GAIN * (0.3 + 0.35 * kp.kp);
    if (!ctx.reducedMotion) auroraClock += Math.min(ctx.dtRealSec, 0.1);
    a.uTime.value = auroraClock % 10000;
    auroraMat.setInside(camBf.length() < AURORA_TOP);
    auroraMat.setSteps(ctx.quality.textureQuality === 'low' ? 12 : 24);
  };

  return {
    id: 'earth-moon',

    init(svc: EngineServices): void {
      services = svc;
      svc.groups.main.add(earth.mesh, moon.mesh);
      svc.groups.transparent.add(atmosphere, aurora);
      svc.groups.far.add(earth.point, moon.point);
      atmosphere.visible = false;
      unregister.push(registerScaledBody(opts.earth, { radiusM: R_EARTH_M }), registerScaledBody(opts.moon, { radiusM: R_MOON_M }));
      void svc.assets.json<SpaceWeatherJson>('data/solar/space-weather.json')
        .then(j => { storms = parseStorms(j); })
        .catch(() => { storms = []; });
      // Progressive: resolve the texture table in the background; the layer runs immediately with fallbacks.
      void loadTextureTable(svc.assets).then(t => {
        if (!services) return;
        table = t;
        setupMaps(svc, t);
      });
    },

    update(ctx: FrameContext): void {
      const s = evaluate(ctx.timeMs);
      const newMax = maxTierFor(ctx.quality.textureQuality);
      if (newMax !== qualityMax) qualityMax = newMax;
      const shadowsOn = ctx.quality.shadowQuality !== 'off';

      // ── Earth ──
      const earthOn = placeBody(earth, ctx, s.earth, s.earthRot, s.sun);
      const moonOn = placeBody(moon, ctx, s.moon, s.moonRot, s.sun);
      const eclipses = shadowsOn && earth.enlarge < 1.001 && moon.enlarge < 1.001;
      const sunDistE = s.sun.distanceTo(s.earth);
      const eIrr = SUN_IRRADIANCE_1AU * (AU_M / sunDistE) ** 2;
      if (earthOn) {
        const u = earthMat.uniforms;
        v1.subVectors(s.sun, earth.world).normalize();
        icrsToBodyFixed(s.earthRot, v1, u.uSunDir.value);
        v2.subVectors(ctx.cameraPosition, earth.world).multiplyScalar(1 / (R_EARTH_M * earth.enlarge));
        icrsToBodyFixed(s.earthRot, v2, u.uCamPos.value);
        // Procedural close-range detail below ~3000 km altitude (camera distance in planet radii).
        u.uDetail.value = 1 - THREE.MathUtils.smoothstep(v2.length(), 1.15, 1.5);
        u.uSunIntensity.value = eIrr;
        u.uSunAngRadius.value = R_SUN_M / sunDistE;
        v3.subVectors(moon.world, earth.world).multiplyScalar(1 / R_EARTH_M);
        icrsToBodyFixed(s.earthRot, v3, u.uMoonPos.value);
        u.uMoonRadius.value = eclipses ? R_MOON_M / R_EARTH_M : 0;
        const px = earth.pxTrue * earth.enlarge;
        u.uNormalStrength.value = EARTH_NORMAL_STRENGTH * THREE.MathUtils.smoothstep(px, DETAIL_START_PX, DETAIL_FULL_PX);
        // Atmosphere shell (hidden when the disc is a few pixels: the limb is sub-pixel).
        atmosphere.visible = px > 4;
        if (atmosphere.visible) {
          atmosphere.position.copy(earth.mesh.position);
          atmosphere.scale.copy(earth.mesh.scale);
          atmosphere.sunDirectionWorld.copy(v1);
          atmosphere.material.uniforms.uSunIntensity.value = eIrr * EARTH_HAZE_SCALE;
        }
        // Clouds drift with the climatological zonal wind (simulation time); faded out when time runs fast, where the
        // bounded two-phase flow would visibly pulse.
        flowSimSec += ctx.dtSimSec;
        const period = u.uFlowPeriodS.value;
        u.uFlowPhase.value = (((flowSimSec / period) % 1) + 1) % 1;
        const rate = ctx.dtRealSec > 1e-4 ? Math.abs(ctx.dtSimSec / ctx.dtRealSec) : 1;
        u.uDrift.value = 1 - THREE.MathUtils.smoothstep(rate, DRIFT_FADE_RATE_START, DRIFT_FADE_RATE_END);
        updateAurora(ctx, px, u.uCamPos.value, u.uSunDir.value);
      } else {
        atmosphere.visible = false;
        aurora.visible = false;
      }

      // ── Moon ──
      if (moonOn) {
        const u = moonMat.uniforms;
        const sunDistM = s.sun.distanceTo(s.moon);
        v1.subVectors(s.sun, moon.world).normalize();
        icrsToBodyFixed(s.moonRot, v1, u.uSunDir.value);
        v2.subVectors(ctx.cameraPosition, moon.world).multiplyScalar(1 / (R_MOON_M * moon.enlarge));
        icrsToBodyFixed(s.moonRot, v2, u.uCamPos.value);
        // Earth direction from the drawn positions (eclipses are off while either body is enlarged); Earthshine from the
        // true distance.
        const dEM = s.earth.distanceTo(s.moon);
        v3.subVectors(earth.world, moon.world);
        v3.multiplyScalar(1 / R_MOON_M);
        icrsToBodyFixed(s.moonRot, v3, u.uEarthPos.value);
        u.uSunIntensity.value = SUN_IRRADIANCE_1AU * (AU_M / sunDistM) ** 2;
        u.uSunAngRadius.value = R_SUN_M / sunDistM;
        // Danjon: the atmosphere enlarges the Earth's shadow by ~2 %.
        u.uEarthRadius.value = eclipses ? (R_EARTH_M * 1.02) / R_MOON_M : 0;
        // Earthshine: Earth's day side seen from the Moon (Lambert sphere, Bond albedo), phase angle at the Earth.
        v1.subVectors(s.sun, s.earth).normalize();
        v2.subVectors(s.moon, s.earth).normalize();
        const alphaE = Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
        const es = EARTH_BOND_ALBEDO * (2 / 3) * phaseIntegral(alphaE) * (R_EARTH_M / dEM) ** 2;
        u.uEarthshine.value = es * LOW_LIGHT_DISPLAY_GAIN;
        u.uUmbraGlow.value = UMBRA_REFRACTED_FRACTION * UMBRA_DISPLAY_GAIN;
        const px = moon.pxTrue * moon.enlarge;
        u.uNormalStrength.value = MOON_NORMAL_STRENGTH * THREE.MathUtils.smoothstep(px, DETAIL_START_PX * 0.5, DETAIL_FULL_PX * 0.5);
      }

      if (table) {
        requestTier(earth);
        requestTier(moon);
        const range = earth.distanceM / (earth.radiusM * earth.enlarge);
        const focused = ctx.focusEntityId === earth.entity.id;
        if (!boosted && qualityMax === 'high' && focused && range < CLOSE_RANGE_IN) {
          boosted = true;
          for (const i of BOOST_MAP_INDICES) earth.maps[i]?.request('ultra');
        } else if (boosted && (qualityMax !== 'high' || !focused || range > CLOSE_RANGE_OUT)) {
          boosted = false;
          for (const i of BOOST_MAP_INDICES) earth.maps[i]?.cap(qualityMax);
        }
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const b of bodies) {
        ctx.project(b.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y);
        const r = (b.pxTrue * b.enlarge) / 2;
        if (d > Math.max(r, radiusPx)) continue;
        hits.push({ entityId: b.entity.id, distancePx: d <= r ? 0 : d - r, depthM: screen.depthM, priority: b.entity.importance });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      // The Moon's label only once it clearly separates from the (drawn) Earth disc, unless it is focused or selected.
      ctx.project(earth.world, screen);
      const ex = screen.x, ey = screen.y, eVis = screen.visible;
      const earthRpx = (earth.pxTrue * earth.enlarge) / 2;
      for (const b of bodies) {
        ctx.project(b.world, screen);
        if (!screen.visible) continue;
        if (b === moon && eVis && ctx.focusEntityId !== b.entity.id && ctx.selectedId !== b.entity.id) {
          const sep = Math.hypot(screen.x - ex, screen.y - ey) - earthRpx - (b.pxTrue * b.enlarge) / 2;
          if (sep < 40) continue;
        }
        out.push({
          entityId: b.entity.id,
          text: b.entity.name,
          x: screen.x,
          y: screen.y,
          priority: b.entity.importance,
          kind: 'body',
          offsetPx: Math.min((b.pxTrue * b.enlarge) / 2, 4000) + 3,
        });
      }
    },

    dispose(): void {
      services = null;
      for (const b of bodies) {
        for (const m of b.maps) m.dispose();
        b.mesh.removeFromParent();
        b.point.removeFromParent();
        b.pointMat.dispose();
      }
      atmosphere.removeFromParent();
      atmosphere.dispose();
      for (const un of unregister.splice(0)) un();
      aurora.removeFromParent();
      auroraMat.dispose();
      auroraGeo.dispose();
      earthMat.dispose();
      moonMat.dispose();
      earthGeo.dispose();
      moonGeo.dispose();
      pointGeo.dispose();
    },
  };
}
