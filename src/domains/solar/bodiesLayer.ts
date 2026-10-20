/**
 * Planets and dwarf planets: lit ellipsoids (PlanetMaterial) in their IAU orientation, Saturn's and Uranus' rings,
 * render-kit atmosphere shells (Venus haze above the cloud deck, Mars' dusty limb, Pluto's blue haze), moon
 * shadows (eclipses) from the moons registered by other domains, and photometric points while a body is smaller
 * than a few pixels. Also owns the shared camera exposure (ephemeris.exposureState).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import type { EntityRegistry, Entity } from '../../core/entity';
import { AU_M, R_SUN_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { MARS_ATMOSPHERE, type AtmosphereParams } from '../../render/glsl/atmosphere';
import { AtmosphereShell } from '../../render/materials/AtmosphereShell';
import { lodBlend, type LodBlend } from '../../render/lod';
import { createStripTexture } from '../../render/textures';
import type { SolarEntity } from './entities';
import { bodyOrientation, exhibitionDisplayGain, exposureState, sunPosition, SUN_SCENE_IRRADIANCE_1AU } from './ephemeris';
import { PlanetMaterial, type PlanetBrdf } from './planetMaterial';
import { createRingGeometry, SolarRingMaterial } from './ringMaterial';
import { resolveBodyTexture } from './textures';
import { createWindTexture, VENUS_CLOUD_PERIOD_DAYS, WindClock } from './winds';
import { registerScaledBody, renderTransform } from '../../core/visualScale';
import { PSF_GLSL } from '../../render/glsl/psf';

/** Venus: CO₂ Rayleigh at the ~30 mbar cloud-top level plus the upper sulfuric-acid haze (Mie, forward scattering). */
const VENUS_HAZE: AtmosphereParams = {
  planetRadiusM: 6_051_800,
  atmosphereHeightM: 90_000,
  rayleighScaleHeightM: 5_000,
  mieScaleHeightM: 4_000,
  rayleighScattering: [5.6e-7, 1.3e-6, 3.2e-6],
  mieScattering: 6e-6,
  mieExtinction: 6.5e-6,
  mieG: 0.7,
};

/**
 * Pluto: ~1 Pa N₂ (negligible Rayleigh) with layered tholin haze, scale height ~50 km, normal optical depth ≈ 0.004–0.01
 * at visible wavelengths, strongly forward scattering (Gladstone et al. 2016; Cheng et al. 2017): a faint blue limb
 * that only stands out at high phase angles (the New Horizons departure view).
 */
const PLUTO_HAZE: AtmosphereParams = {
  planetRadiusM: 1_188_300,
  atmosphereHeightM: 250_000,
  rayleighScaleHeightM: 50_000,
  mieScaleHeightM: 45_000,
  rayleighScattering: [1.2e-8, 3.5e-8, 9e-8],
  mieScattering: 9e-8,
  mieExtinction: 1.1e-7,
  mieG: 0.75,
};

/** Normal-map strength per body (maps are relief-exaggerated; Pluto's DEM ×3, so 0.3 ≈ true relief). */
const NORMAL_STRENGTH: Record<string, number> = { mars: 0.55, pluto: 0.3 };

/** Geometric albedo the shared exposure is calibrated for (Earth ≈ 0.37). */
const EXPOSURE_REF_ALBEDO = 0.37;

const MOON_OCCLUDERS: Record<string, string[]> = {
  'sol:mars': ['sol:phobos', 'sol:deimos'],
  'sol:jupiter': ['sol:io', 'sol:europa', 'sol:ganymede', 'sol:callisto'],
  'sol:saturn': ['sol:titan', 'sol:rhea', 'sol:dione', 'sol:tethys'],
  'sol:uranus': ['sol:titania', 'sol:oberon', 'sol:ariel', 'sol:umbriel'],
  'sol:neptune': ['sol:triton'],
  'sol:pluto': ['sol:charon'],
};

/** Mean colour of each body's disc (linear sRGB) for the point representation. */
const DOT_COLOR: Record<string, [number, number, number]> = {
  'sol:mercury': [0.55, 0.5, 0.45], 'sol:venus': [1, 0.92, 0.78], 'sol:mars': [1, 0.55, 0.35],
  'sol:jupiter': [1, 0.88, 0.72], 'sol:saturn': [1, 0.9, 0.7], 'sol:uranus': [0.72, 0.92, 1],
  'sol:neptune': [0.45, 0.62, 1], 'sol:ceres': [0.7, 0.68, 0.66], 'sol:pluto': [1, 0.85, 0.72],
  'sol:eris': [0.9, 0.9, 0.9], 'sol:haumea': [0.9, 0.9, 0.9], 'sol:makemake': [1, 0.8, 0.65],
};

/** Uranus' nine classical rings: radius (km), width (km), normal optical depth (French et al. 1991; Esposito 2002). */
const URANUS_RINGS: [number, number, number][] = [
  [41837, 1.5, 0.3], [42235, 2, 0.5], [42571, 2, 0.3], [44718, 9, 0.4], [45661, 9, 0.3],
  [47176, 1.6, 0.4], [47627, 3, 1.5], [48300, 6, 0.5], [51149, 58, 1.0],
];

function uranusStrip(innerM: number, outerM: number, width = 4096): THREE.DataTexture {
  const data = new Uint8Array(4 * width);
  const kmPerTexel = (outerM - innerM) / 1000 / width;
  for (let x = 0; x < width; x++) {
    const r0 = innerM / 1000 + x * kmPerTexel;
    const r1 = r0 + kmPerTexel;
    let alpha = 0;
    for (const [rc, w, tau] of URANUS_RINGS) {
      const overlap = Math.max(0, Math.min(r1, rc + w / 2) - Math.max(r0, rc - w / 2));
      alpha += (overlap / kmPerTexel) * (1 - Math.exp(-tau));
    }
    // Very dark particles (albedo ~0.02–0.05, Voyager 2): stored as sRGB ≈ 60 → linear ≈ 0.045.
    data[4 * x] = 60;
    data[4 * x + 1] = 60;
    data[4 * x + 2] = 62;
    data[4 * x + 3] = Math.round(255 * Math.min(1, alpha));
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const POINT_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aColor;
attribute float aSize;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vSizePx;
void main() {
  vColor = aColor;
  vSizePx = aSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const POINT_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform float uPixelRatio;
varying vec3 vColor;
varying float vSizePx;
${PSF_GLSL}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  // Same Gaussian as before (σ = size/√32), averaged over each pixel: no sampling twinkle while the dot moves.
  float a = psfPixelGauss(d * vSizePx, vSizePx * 0.1767767, 0.5 / uPixelRatio);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  ${LOGDEPTH_FRAGMENT}
}`;

interface BodyVisual {
  entity: SolarEntity;
  a: number;
  group: THREE.Group;
  overlayGroup: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, PlanetMaterial>;
  material: PlanetMaterial;
  ring: THREE.Mesh<THREE.RingGeometry, SolarRingMaterial> | null;
  atmosphere: AtmosphereShell | null;
  world: THREE.Vector3;
  distM: number;
  px: number;
  /** Displayed (possibly enlarged) pixel diameter. */
  shownPx: number;
  enlarge: number;
  /** Best texture tier requested so far. */
  tier: 'low' | 'high' | 'ultra';
  wind: WindClock | null;
  /** Venus: rigid cloud-deck rotation in the body frame (rad) and its rate (rad per simulation second). */
  cloudRot: number;
  cloudRate: number;
  unregister: () => void;
  occluders: (Entity | null)[];
  occluderIds: string[];
  lod: LodBlend;
  index: number;
}

const TIER_RANK = { low: 0, high: 1, ultra: 2 } as const;
const DEG = Math.PI / 180;

/** The one place a body's drawn size and position are decided (exhibition-scale runtime; identity in true scale). */
function displayFactor(v: BodyVisual, tMs: number): number {
  return renderTransform(v.entity, tMs, v.world);
}

export function createBodiesLayer(bodies: SolarEntity[], registryForMoons?: () => EntityRegistry | null): Layer & { advanceClouds(days: number): void } {
  const visuals: BodyVisual[] = [];
  const hiGeo = new THREE.SphereGeometry(1, 256, 128);
  const midGeo = new THREE.SphereGeometry(1, 96, 48);
  const disposables: { dispose(): void }[] = [hiGeo, midGeo];
  const sunWorld = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  const focusPos = new THREE.Vector3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let svcRef: EngineServices | null = null;
  let registry: EntityRegistry | null = null;

  // Point representation.
  const n = bodies.length;
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
  points.name = 'solar-body-points';
  points.frustumCulled = false;
  disposables.push(pointGeo, pointMat);

  const loadTextures = (v: BodyVisual, quality: 'low' | 'high' | 'ultra'): void => {
    const svc = svcRef;
    if (!svc) return;
    const def = v.entity.def;
    const isLive = (): boolean => visuals.includes(v);
    if (def.colorMap) {
      // HD maps from hd.json are albedo-calibrated already: they take their own (hue-only) tint.
      void resolveBodyTexture(svc.assets, svc.renderer, def.key, def.colorMap, quality, 'srgb', (t, info) => v.material.setMap(t, info.hd && def.hdTint ? def.hdTint : def.tint), {
        isCancelled: () => !isLive(),
        screenPx: () => v.shownPx,
      });
    }
    if (def.surface === 'rocky' || def.surface === 'ice' || def.hasNormalMap) {
      if (def.hasNormalMap || quality !== 'low') {
        void resolveBodyTexture(svc.assets, svc.renderer, def.key, 'normal', quality, 'linear', (t) => v.material.setNormalMap(t, NORMAL_STRENGTH[def.key] ?? 0.5), {
          isCancelled: () => !isLive(),
          screenPx: () => v.shownPx,
        }).catch(() => undefined);
      }
    }
  };

  return {
    id: 'solar-bodies',
    init(svc: EngineServices): void {
      svcRef = svc;
      registry = registryForMoons?.() ?? svc.registry;
      svc.groups.far.add(points);
      bodies.forEach((entity, index) => {
        const def = entity.def;
        const a = def.axesM[0];
        const brdf: PlanetBrdf = def.surface;
        const ringDef = def.rings?.[0] ?? null;
        const rotSign = Math.sign(def.rotation.wDot) || 1;
        let wind: WindClock | null = null;
        let windTex: THREE.DataTexture | null = null;
        if (def.winds) {
          const w = createWindTexture(def.winds.profile, a, def.axesM[2], rotSign);
          windTex = w.tex;
          disposables.push(w.tex);
          wind = new WindClock(w.maxDegPerDay, def.winds.shearBudgetDeg);
        }
        const material = new PlanetMaterial({
          brdf,
          tint: new THREE.Color(def.tint[0], def.tint[1], def.tint[2]),
          axes: new THREE.Vector3(1, def.axesM[1] / a, def.axesM[2] / a),
          minnaertK: def.minnaertK,
          ring: ringDef ? { innerA: ringDef.innerM / a, outerA: ringDef.outerM / a } : null,
          wind: windTex,
          cloudRotation: def.key === 'venus',
          palette: def.palette ?? null,
        });
        const vx = def.winds?.vortex;
        if (vx) material.setVortex(vx.lonDeg * DEG, vx.latDeg * DEG, vx.halfLonDeg * DEG, vx.halfLatDeg * DEG, vx.spinDegPerDay * DEG);
        if (def.resolutionCap) {
          const rc = def.resolutionCap;
          material.setResolutionCap(rc.lonDeg, rc.latDeg, rc.fullDeg, rc.blurDeg);
        }
        if (def.mapContrast !== undefined) material.uniforms.uMapContrast.value = def.mapContrast;
        if (def.limbPow !== undefined) material.uniforms.uLimbPow.value = def.limbPow;
        if (def.polarCap) material.uniforms.uPolarCap.value.set(def.polarCap[0] * DEG, def.polarCap[1] * DEG, def.polarCap[2]);
        const mesh = new THREE.Mesh(midGeo, material);
        mesh.name = def.id;
        mesh.frustumCulled = false;
        mesh.scale.set(1, def.axesM[1] / a, def.axesM[2] / a);
        const group = new THREE.Group();
        group.name = `${def.id}:frame`;
        group.add(mesh);
        svc.groups.main.add(group);
        const overlayGroup = new THREE.Group();
        overlayGroup.name = `${def.id}:transparent`;
        svc.groups.transparent.add(overlayGroup);
        disposables.push(material);

        let ring: BodyVisual['ring'] = null;
        if (ringDef) {
          const placeholder = ringDef.strip === 'uranus' ? uranusStrip(ringDef.innerM, ringDef.outerM) : createStripTexture([{ t: 0, rgb: [0, 0, 0], a: 0 }, { t: 1, rgb: [0, 0, 0], a: 0 }], 4);
          disposables.push(placeholder);
          const ringMat = new SolarRingMaterial({
            strip: placeholder,
            innerA: ringDef.innerM / a,
            outerA: ringDef.outerM / a,
            polarRatio: def.axesM[2] / a,
            dustFraction: ringDef.dust,
            albedoScale: ringDef.albedoScale,
            tint: ringDef.tint,
            thinGain: ringDef.thinGain,
            planetShine: def.key === 'saturn' ? 0.1 * (def.geometricAlbedo ?? 0.3) : 0,
          });
          ring = new THREE.Mesh(createRingGeometry(ringDef.innerM / a, ringDef.outerM / a, 512), ringMat);
          ring.name = `${def.id}:rings`;
          ring.frustumCulled = false;
          ring.renderOrder = 1;
          overlayGroup.add(ring);
          disposables.push(ring.geometry, ringMat);
          material.uniforms.uRingStrip.value = placeholder;
          if (def.key === 'saturn') material.uniforms.uRingShine.value = 0.06;
          material.uniforms.uRingThinGain.value = ringDef.thinGain ?? 1;
          if (ringDef.strip === 'saturn') {
            const r = ring;
            void resolveBodyTexture(svc.assets, svc.renderer, 'saturn', 'rings', 'ultra', 'srgb', (t, info) => {
              r.material.uniforms.uStrip.value = t;
              material.uniforms.uRingStrip.value = t;
              // hd.json strip = measured Cassini optical depth: no thin-ring gain (that compensates the illustrative strip).
              const gain = info.hd ? 1 : (ringDef.thinGain ?? 1);
              r.material.uniforms.uThinGain.value = gain;
              material.uniforms.uRingThinGain.value = gain;
            }, { strip: true });
          }
        }

        let atmosphere: AtmosphereShell | null = null;
        const params = def.atmosphere === 'venus' ? VENUS_HAZE : def.atmosphere === 'mars' ? MARS_ATMOSPHERE : def.atmosphere === 'pluto' ? PLUTO_HAZE : null;
        if (params) {
          atmosphere = new AtmosphereShell({ params: { ...params, planetRadiusM: a }, sunIntensity: 5, steps: 10 });
          atmosphere.name = `${def.id}:atmosphere`;
          overlayGroup.add(atmosphere);
          disposables.push(atmosphere);
        }

        const c = DOT_COLOR[def.id] ?? [1, 1, 1];
        pointCol[index * 3] = c[0];
        pointCol[index * 3 + 1] = c[1];
        pointCol[index * 3 + 2] = c[2];

        const v: BodyVisual = {
          entity, a, group, overlayGroup, mesh, material, ring, atmosphere,
          world: new THREE.Vector3(), distM: 1, px: 0, shownPx: 0, enlarge: 1, tier: 'low', wind,
          cloudRot: 0,
          // Venus' clouds super-rotate (retrograde, like the solid body) relative to the surface frame.
          cloudRate: def.key === 'venus' ? (rotSign * (360 / VENUS_CLOUD_PERIOD_DAYS - Math.abs(def.rotation.wDot)) * DEG) / 86_400 : 0,
          unregister: registerScaledBody(entity),
          occluders: [], occluderIds: MOON_OCCLUDERS[def.id] ?? [], lod: { level: 'point', point: 1, sphere: 0, detail: 0, extras: 0 }, index,
        };
        visuals.push(v);
        loadTextures(v, 'low');
      });
    },

    update(ctx: FrameContext): void {
      sunPosition(ctx.timeMs, sunWorld);

      // ── Shared exposure: expose the focused body as if it were at 1 au. ──
      let target = 1;
      const focus = ctx.focusEntityId ? registry?.get(ctx.focusEntityId) : undefined;
      if (focus && focus.id !== 'sol:sun') {
        focus.position(ctx.timeMs, focusPos);
        const dAu = focusPos.distanceTo(sunWorld) / AU_M;
        if (dAu < 300) target = THREE.MathUtils.clamp(dAu * dAu, 0.1, 2500);
        // Bright bodies (Venus, Pluto, Eris) are exposed for their own albedo, as a camera would: otherwise a small
        // disc that the frame meter cannot see (< 2 % coverage) renders near-white. Darker bodies keep the 1 au exposure.
        const albedo = focus.domain === 'solar' ? (focus as Partial<SolarEntity>).def?.geometricAlbedo : null;
        if (albedo && albedo > EXPOSURE_REF_ALBEDO) target *= Math.max(EXPOSURE_REF_ALBEDO / albedo, 0.4);
      }
      exposureState.targetGain = target;
      const k = 1 - Math.exp(-Math.max(ctx.dtRealSec, 0) / 0.6);
      exposureState.gain = Math.exp(Math.log(exposureState.gain) + (Math.log(target) - Math.log(exposureState.gain)) * (ctx.dtRealSec > 0 ? k : 1));

      if (registry && ctx.frame % 60 === 0) {
        // Refresh the moon handles occasionally (moons appear when their domain registers them).
        for (const v of visuals) {
          v.occluders.length = 0;
          for (const id of v.occluderIds) v.occluders.push(registry.get(id) ?? null);
        }
      }

      const shadowsOn = ctx.quality.shadowQuality !== 'off';
      const inv = 1 / ctx.metersPerUnit;
      pointMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;

      for (const v of visuals) {
        const def = v.entity.def;
        // Exhibition scale (src/core/visualScale.ts): drawn position and radius factor (1 in true-scale mode).
        v.enlarge = displayFactor(v, ctx.timeMs);
        v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
        v.px = ctx.pixelDiameter(v.a, v.distM);
        v.shownPx = v.px * v.enlarge;
        lodBlend(v.shownPx, v.lod);

        const dSun = Math.max(v.world.distanceTo(sunWorld), R_SUN_M);
        const r = AU_M / dSun;
        const E0 = SUN_SCENE_IRRADIANCE_1AU * r * r * exposureState.gain;
        // Disc/rings/atmosphere: exhibition display gain while strongly enlarged (1 at true size); the point stays photometric.
        const E = E0 * exhibitionDisplayGain(v.enlarge, dSun);
        sunDir.subVectors(sunWorld, v.world).normalize();

        // Point representation (fades out as the disc fades in).
        const i3 = v.index * 3;
        ctx.toRender(v.world, tmp);
        pointPos[i3] = tmp.x;
        pointPos[i3 + 1] = tmp.y;
        pointPos[i3 + 2] = tmp.z;
        if (v.lod.point > 0.001) {
          // Physical disc radiance × area, spread over the dot; floored so planets stay findable as points.
          tmp2.subVectors(ctx.cameraPosition, v.world).normalize();
          // Lambert-sphere phase function (sin α + (π − α) cos α)/π: matches the disc's integrated flux at the cross-fade.
          const cosA = Math.min(1, Math.max(-1, tmp2.dot(sunDir)));
          const alpha = Math.acos(cosA);
          const phase = (Math.sin(alpha) + (Math.PI - alpha) * cosA) / Math.PI;
          const L = (def.geometricAlbedo ?? 0.3) * E0 / Math.PI * phase;
          const areaPx = Math.PI * 0.25 * v.shownPx * v.shownPx;
          const phys = (L * areaPx) / 4.5;
          const floor = def.kind === 'planet' ? 0.5 : 0.28;
          pointSize[v.index] = def.kind === 'planet' ? 4.2 : 3.4;
          const intensity = Math.max(phys, floor) * v.lod.point;
          pointCol[i3] = (DOT_COLOR[def.id]?.[0] ?? 1) * intensity;
          pointCol[i3 + 1] = (DOT_COLOR[def.id]?.[1] ?? 1) * intensity;
          pointCol[i3 + 2] = (DOT_COLOR[def.id]?.[2] ?? 1) * intensity;
        } else {
          pointCol[i3] = pointCol[i3 + 1] = pointCol[i3 + 2] = 0;
          pointSize[v.index] = 0;
        }

        const show = v.lod.sphere > 0.001 && v.distM > v.a * v.enlarge * 0.5;
        v.group.visible = show;
        v.overlayGroup.visible = show;
        if (!show) continue;

        // Frame: body-fixed axes, uniform scale = equatorial radius (render units).
        const scale = v.a * v.enlarge * inv;
        v.group.position.copy(tmp);
        bodyOrientation(def.rotation, ctx.timeMs, v.group.quaternion);
        v.group.scale.setScalar(scale);
        v.overlayGroup.position.copy(tmp);
        v.overlayGroup.quaternion.copy(v.group.quaternion);
        v.overlayGroup.scale.setScalar(scale);
        v.mesh.geometry = v.shownPx > 260 ? hiGeo : midGeo;

        qInv.copy(v.group.quaternion).invert();
        const u = v.material.uniforms;
        u.uSunDir.value.copy(sunDir).applyQuaternion(qInv);
        u.uCamLocal.value.subVectors(ctx.cameraPosition, v.world).applyQuaternion(qInv).multiplyScalar(1 / (v.a * v.enlarge));
        u.uSunIntensity.value = E * v.lod.sphere;
        u.uSunAngularRadius.value = Math.asin(Math.min(1, R_SUN_M / dSun));
        u.uDetail.value = v.lod.detail;
        if (v.wind) {
          v.wind.advance(ctx.dtSimSec, ctx.dtRealSec);
          v.wind.phases(u.uWind.value);
        }
        if (v.cloudRate !== 0) {
          // Rigid rotation: follows simulation time up to one turn per ~8 s of real time (beyond that it would strobe).
          const cap = (2 * Math.PI) / 8 / Math.abs(v.cloudRate);
          const dt = THREE.MathUtils.clamp(ctx.dtSimSec, -cap * ctx.dtRealSec, cap * ctx.dtRealSec);
          v.cloudRot = (v.cloudRot + v.cloudRate * dt) % (2 * Math.PI);
          u.uCloudRot.value = v.cloudRot;
        }

        // Eclipses by registered moons (only when the disc is large enough for the shadow to show).
        // Drawn positions and radii: an enlarged satellite system casts its shadows at the drawn scale.
        for (let k2 = 0; k2 < 4; k2++) {
          const o = u.uOccluders.value[k2];
          o.w = 0;
          const moon = shadowsOn && v.shownPx > 40 ? v.occluders[k2] : null;
          if (!moon || moon.radiusM === null) continue;
          const mf = renderTransform(moon, ctx.timeMs, tmp2);
          const k3 = 1 / (v.a * v.enlarge);
          tmp2.sub(v.world).applyQuaternion(qInv).multiplyScalar(k3);
          o.set(tmp2.x, tmp2.y, tmp2.z, moon.radiusM * mf * k3);
        }

        // Texture tier: the quality preset's tier once the disc is large; the focused body gets the best HD tier.
        if (v.shownPx > 180 && ctx.quality.textureQuality !== 'low') {
          const focused = ctx.focusEntityId === v.entity.id || ctx.selectedId === v.entity.id;
          const want = focused ? 'ultra' : ctx.quality.textureQuality;
          if (TIER_RANK[want] > TIER_RANK[v.tier]) {
            v.tier = want;
            loadTextures(v, want);
          }
        }

        if (v.ring) {
          const ru = v.ring.material.uniforms;
          ru.uSunDir.value.copy(u.uSunDir.value);
          ru.uCamLocal.value.copy(u.uCamLocal.value);
          ru.uSunIntensity.value = E * v.lod.sphere;
          ru.uSunAngularRadius.value = u.uSunAngularRadius.value;
          v.ring.visible = v.shownPx > 3;
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

    /** Move every cloud deck on by `days` of simulation time, uncapped (sandbox comparisons, tour scripting). */
    advanceClouds(days: number): void {
      for (const v of visuals) {
        v.wind?.advanceDays(days);
        v.cloudRot = (v.cloudRot + v.cloudRate * days * 86_400) % (2 * Math.PI);
        v.material.uniforms.uCloudRot.value = v.cloudRot;
        if (v.wind) v.wind.phases(v.material.uniforms.uWind.value);
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const v of visuals) {
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y) - Math.max(v.shownPx / 2, 3);
        if (d > radiusPx) continue;
        hits.push({ entityId: v.entity.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: v.entity.importance });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      for (const v of visuals) {
        if (v.shownPx > ctx.viewport.height * 0.9) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id,
          text: v.entity.name,
          x: screen.x,
          y: screen.y,
          priority: v.entity.importance,
          kind: 'body',
          offsetPx: Math.min(v.shownPx / 2, 4000) + 4,
        });
      }
    },

    dispose(): void {
      for (const v of visuals) {
        v.unregister();
        v.group.removeFromParent();
        v.overlayGroup.removeFromParent();
      }
      points.removeFromParent();
      for (const d of disposables) d.dispose();
      visuals.length = 0;
    },
  };
}
