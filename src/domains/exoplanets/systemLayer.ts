/**
 * The open planetary system: host star(s) with an HDR photosphere and glare, planets as procedural artist's
 * impressions (planetMaterial.ts) on their real Keplerian orbits, the Kopparapu habitable zone as a soft ring in the
 * orbital plane (optimistic band faint, conservative band stronger) and Earth's orbit (1 AU, dotted) for scale.
 *
 * Which system is open: the focused (or selected) 'sys:' / 'exo:' entity, else the planet host nearest to the camera
 * within 0.05 pc. One system at a time; everything is built on open and disposed on close.
 *
 * Exhibition scale: every drawn radius goes through runtime.exhibitFactor (one function, bounded by the system's
 * orbital clearances); orbits and distances are never scaled. Lighting is scene-linear with no ambient term; the
 * camera exposure follows the focused planet (planets are lit as if the camera were exposed for it), and strongly
 * enlarged discs get part of the inverse-square falloff back, as in the solar domain.
 */
import * as THREE from 'three';
import { AU_M } from '../../core/units';
import type { CameraViewState, EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { blackbodyLinearSrgb } from '../../render/glsl/blackbody';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { GlowSprite } from '../../render/materials/GlowSpriteMaterial';
import { StarSurfaceMaterial } from '../../render/materials/StarSurfaceMaterial';
import { OrbitLine } from '../../render/orbitBuilder';
import { EXO_PREFIX, SYS_PREFIX, exoId, sysId, type ExoCatalog, type ExoIndex } from './catalog';
import { loadExoCatalog } from './catalogClient';
import { INFRARED_LAMBDA, VISIBLE_LAMBDA, planetLook } from './appearance';
import { meanAnomalyAt, type PlanetModel, type StarModel, type SystemModel } from './physics';
import { ExoPlanetMaterial } from './planetMaterial';
import { exhibitFactor, getSystemModel, hostPlaceable, hostPosition, planetOffset, setExoRegistry, starOffsets } from './runtime';
import { SHOWCASE_BY_HOST } from './showcase';
import { exoView, setExoView } from './state';
import { PC_M } from '../../core/units';
import { POST_EXPOSURE_UNIFORM } from '../../core/post';

/** Scene-linear irradiance of the reference exposure (as the solar domain's sunlight at 1 au). */
const SCENE_IRRADIANCE_REF = 5;
/** Exposure-scaled disc luminance of a Sun-like photosphere: just above display white (bloom knee ~0.8-1.6). */
const STAR_DISPLAY_WHITE = 3;
const OPEN_RADIUS_M = 0.05 * PC_M;
const HZ_COLOR = new THREE.Color('#009E73'); // Okabe–Ito bluish green (category colour for the habitable zone)

const sphereGeom = new THREE.SphereGeometry(1, 96, 64);

// ── Habitable-zone ring ───────────────────────────────────────────────────────────────────────

const HZ_VERT = /* glsl */ `
${VERTEX_PRELUDE}
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;
const HZ_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec4 uEdges; // optimistic inner, conservative inner, conservative outer, optimistic outer (fractions of the quad)
uniform vec3 uColor;
uniform float uOpacity;
uniform float uExposure;
varying vec2 vP;
float band(float r, float a, float b, float w) { return smoothstep(a - w, a + w, r) * (1.0 - smoothstep(b - w, b + w, r)); }
void main() {
  float r = length(vP);
  float w = max(fwidth(r) * 1.5, 0.004);
  float opt = band(r, uEdges.x, uEdges.w, w * 2.0);
  float con = band(r, uEdges.y, uEdges.z, w * 2.0);
  // Soft inner glow toward the conservative edges reads as a "zone", not a hard annulus.
  // Display-referred like the orbit lines: divide by the post exposure so the zone stays a quiet overlay whatever the
  // star's brightness. Conservative band ~4 %, optimistic ~1.5 %, thin brighter edges on the conservative limits.
  float a = 0.016 * opt + 0.03 * con;
  float edge = (1.0 - smoothstep(0.0, w * 2.0, abs(r - uEdges.y))) + (1.0 - smoothstep(0.0, w * 2.0, abs(r - uEdges.z)));
  a += 0.07 * edge;
  a *= uOpacity / max(uExposure, 1e-4);
  if (a < 0.0004) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;

// ── Views ───────────────────────────────────────────────────────────────────────────────────

interface StarView {
  star: StarModel;
  mesh: THREE.Mesh<THREE.SphereGeometry, StarSurfaceMaterial>;
  glare: GlowSprite;
  veil: GlowSprite;
  world: THREE.Vector3;
  /** Linear light colour, white-balanced to the Sun, unit luminance. */
  light: THREE.Color;
  px: number;
  drawnR: number;
}

interface PlanetView {
  p: PlanetModel;
  mesh: THREE.Mesh<THREE.SphereGeometry, ExoPlanetMaterial>;
  orbit: OrbitLine;
  /** Orbit-plane basis in ICRS: node direction, in-plane 90°, normal. */
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  n: THREE.Vector3;
  world: THREE.Vector3;
  emitDay: THREE.Color;
  emitNight: THREE.Color;
  px: number;
  drawnR: number;
}

interface SystemView {
  host: number;
  model: SystemModel;
  stars: StarView[];
  planets: PlanetView[];
  hz: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  hzMid: number;
  earth: OrbitLine;
  /** System plane basis (ICRS). */
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  n: THREE.Vector3;
  /** Fade length scale, m. */
  extM: number;
  fade: number;
  sRef: number;
  lambdas: readonly number[];
}

const SUN_LIGHT = (() => {
  const c = blackbodyLinearSrgb(5772);
  return new THREE.Color(c.r, c.g, c.b);
})();

function starLight(teffK: number, out: THREE.Color): THREE.Color {
  const c = blackbodyLinearSrgb(teffK);
  out.setRGB(c.r / SUN_LIGHT.r, c.g / SUN_LIGHT.g, c.b / SUN_LIGHT.b);
  const y = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  return out.multiplyScalar(1 / y);
}

/**
 * Stylised photosphere radiance in exposure-scaled units (divided by the metered exposure each frame): hotter stars
 * brighter, cool dwarfs still glow, all close to display white so AgX keeps the blackbody colour (orange K, red M
 * dwarfs) instead of clipping every star to white; the glare sprites carry the brightness.
 */
export function starIntensity(teffK: number): number {
  return STAR_DISPLAY_WHITE * THREE.MathUtils.clamp((teffK / 5772) ** 1.5, 0.35, 4);
}

/** Orbit-plane basis (ICRS) for elements (i, Ω) in the sky-plane frame. */
function planeBasis(frame: Float64Array, inclRad: number, raanRad: number, e1: THREE.Vector3, e2: THREE.Vector3, n: THREE.Vector3): void {
  const cO = Math.cos(raanRad), sO = Math.sin(raanRad), ci = Math.cos(inclRad), si = Math.sin(inclRad);
  const toW = (x: number, y: number, z: number, out: THREE.Vector3): void => {
    out.set(frame[0] * x + frame[3] * y + frame[6] * z, frame[1] * x + frame[4] * y + frame[7] * z, frame[2] * x + frame[5] * y + frame[8] * z);
  };
  toW(cO, sO, 0, e1);
  toW(-sO * ci, cO * ci, si, e2);
  toW(sO * si, -cO * si, ci, n);
}

export interface ExoSystemLayer extends Layer {
  /** Host index of the open system (−1 = none). */
  openHost(): number;
}

export function createExoSystemLayer(): ExoSystemLayer {
  let svc: EngineServices | null = null;
  let cat: ExoCatalog | null = null;
  let index: ExoIndex | null = null;
  let view: SystemView | null = null;
  let nearHost = -1;
  let lastBand = '';
  const hostW = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const off0 = new THREE.Vector3();
  const off1 = new THREE.Vector3();
  const qAlign = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const mBasis = new THREE.Matrix4();
  const m3 = new THREE.Matrix3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const zAxis = new THREE.Vector3(0, 0, 1);

  function hostOfId(id: string | null): number {
    if (!id || !cat || !index) return -1;
    if (id.startsWith(SYS_PREFIX)) return index.hostByName.get(id.slice(SYS_PREFIX.length)) ?? -1;
    if (id.startsWith(EXO_PREFIX)) {
      const i = index.planetByName.get(id.slice(EXO_PREFIX.length));
      return i === undefined ? -1 : cat.planets.host[i];
    }
    return -1;
  }

  function findNearHost(cam: THREE.Vector3): number {
    if (!cat) return -1;
    let best = -1, bestD = OPEN_RADIUS_M;
    const h = cat.hosts;
    // Cheap pre-filter in pc before the exact (HYG-snapped) position.
    const cx = cam.x / PC_M, cy = cam.y / PC_M, cz = cam.z / PC_M;
    for (let i = 0; i < h.count; i++) {
      const dx = h.xPc[i] - cx, dy = h.yPc[i] - cy, dz = h.zPc[i] - cz;
      if (!(dx * dx + dy * dy + dz * dz < 0.25)) continue;
      const d = hostPosition(cat, i, tmp).distanceTo(cam);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function buildStar(s: StarModel): StarView {
    const mat = new StarSurfaceMaterial({
      teffK: s.teffK, intensity: starIntensity(s.teffK),
      granuleCount: THREE.MathUtils.clamp(3400 * (s.radiusM / 6.957e8), 220, 6000),
    });
    const mesh = new THREE.Mesh(sphereGeom, mat);
    mesh.frustumCulled = false;
    mesh.name = `exoplanets:star:${s.name}`;
    const bb = blackbodyLinearSrgb(s.teffK);
    const glare = new GlowSprite({ color: new THREE.Color(bb.r, bb.g, bb.b), intensity: 2, coreFraction: 0.1, minRadiusPx: 22 });
    const veil = new GlowSprite({ color: new THREE.Color(bb.r, bb.g, bb.b), intensity: 0.1, coreFraction: 0.18, minRadiusPx: 60 });
    svc!.groups.main.add(mesh);
    svc!.groups.transparent.add(glare, veil);
    return { star: s, mesh, glare, veil, world: new THREE.Vector3(), light: starLight(s.teffK, new THREE.Color()), px: 0, drawnR: s.radiusM };
  }

  function applyLook(pv: PlanetView, m: SystemModel, lambdas: readonly number[]): void {
    const look = planetLook(pv.p, m.star, lambdas);
    const light = starLight(m.star.teffK, new THREE.Color());
    pv.emitDay.copy(look.emitDay).multiply(light);
    pv.emitNight.copy(look.emitNight).multiply(light);
    pv.mesh.material.uniforms.uEmitDay.value.copy(pv.emitDay);
    pv.mesh.material.uniforms.uEmitNight.value.copy(pv.emitNight);
  }

  function open(host: number, lambdas: readonly number[]): void {
    close();
    if (!cat || !svc) return;
    const m = getSystemModel(cat, host);
    const stars = [buildStar(m.star)];
    if (m.companion) stars.push(buildStar(m.companion.star));
    const sysE1 = new THREE.Vector3(), sysE2 = new THREE.Vector3(), sysN = new THREE.Vector3();
    planeBasis(m.frame, m.systemInclRad, m.raanRad, sysE1, sysE2, sysN);
    m3.fromArray(m.frame);

    const planets: PlanetView[] = [];
    for (const p of m.planets) {
      if (!p.placeable) continue;
      const look = planetLook(p, m.star, lambdas);
      const mat = new ExoPlanetMaterial(look);
      const mesh = new THREE.Mesh(sphereGeom, mat);
      mesh.frustumCulled = false;
      mesh.name = `exoplanets:planet:${p.name}`;
      svc.groups.main.add(mesh);
      const orbit = new OrbitLine({ role: 'planet', provenance: p.inclIllustrative ? 'illustrative' : 'derived', maxVertices: 512 });
      orbit.setFromElements(
        { semiMajorAxisM: p.aM, eccentricity: p.ecc, inclinationRad: p.inclRad, raanRad: p.raanRad, argPeriapsisRad: p.omegaRad, meanAnomalyRad: 0 },
        p.muM3S2, { samples: 384, frame: m3 },
      );
      orbit.name = `exoplanets:orbit:${p.name}`;
      // Render-kit workaround (as in the solar domain): the segment quads wind clockwise on screen, so FrontSide culls them.
      orbit.material.side = THREE.DoubleSide;
      svc.groups.overlay.add(orbit);
      const pv: PlanetView = {
        p, mesh, orbit, e1: new THREE.Vector3(), e2: new THREE.Vector3(), n: new THREE.Vector3(), world: new THREE.Vector3(),
        emitDay: new THREE.Color(), emitNight: new THREE.Color(), px: 0, drawnR: p.radiusM,
      };
      planeBasis(m.frame, p.inclRad, p.raanRad, pv.e1, pv.e2, pv.n);
      applyLook(pv, m, lambdas);
      planets.push(pv);
    }

    // Habitable zone (overlay), when the limits are finite.
    const hz = m.hz;
    let hzMesh: SystemView['hz'] = null;
    const outer = hz.earlyMars.distanceM;
    if (outer > 0 && Number.isFinite(outer)) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uEdges: { value: new THREE.Vector4(hz.recentVenus.distanceM / outer, hz.runawayGreenhouse.distanceM / outer, hz.maximumGreenhouse.distanceM / outer, 1) },
          uColor: { value: HZ_COLOR.clone().multiplyScalar(0.9) },
          uOpacity: { value: 1 },
          uExposure: POST_EXPOSURE_UNIFORM,
        },
        vertexShader: HZ_VERT, fragmentShader: HZ_FRAG,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      hzMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 2.04, 1, 1), mat);
      hzMesh.frustumCulled = false;
      hzMesh.name = 'exoplanets:habitable-zone';
      mBasis.makeBasis(sysE1, sysE2, sysN);
      hzMesh.quaternion.setFromRotationMatrix(mBasis);
      svc.groups.overlay.add(hzMesh);
    }

    // Earth's orbit for scale: 1 AU circle in the system plane (illustrative → dotted).
    const earth = new OrbitLine({ role: 'minor', provenance: 'illustrative', maxVertices: 257 });
    earth.material.side = THREE.DoubleSide;
    const pts = new Float64Array(3 * 256);
    for (let k = 0; k < 256; k++) {
      const a = (k / 256) * 2 * Math.PI;
      tmp.copy(sysE1).multiplyScalar(Math.cos(a) * AU_M).addScaledVector(sysE2, Math.sin(a) * AU_M);
      pts[3 * k] = tmp.x;
      pts[3 * k + 1] = tmp.y;
      pts[3 * k + 2] = tmp.z;
    }
    earth.setPolyline(pts, 256, true);
    earth.setHead(-1);
    earth.name = 'exoplanets:earth-orbit';
    svc.groups.overlay.add(earth);

    const hzOuter = Number.isFinite(outer) ? outer : 0;
    view = {
      host, model: m, stars, planets, hz: hzMesh,
      hzMid: 0.5 * (hz.runawayGreenhouse.distanceM + hz.maximumGreenhouse.distanceM),
      earth, e1: sysE1, e2: sysE2, n: sysN,
      extM: Math.max(m.extentM, hzOuter, 20 * m.star.radiusM),
      fade: 0, sRef: NaN, lambdas,
    };
    setExoView({ openHost: host });
  }

  function close(): void {
    if (!view) return;
    for (const s of view.stars) {
      s.mesh.removeFromParent();
      s.mesh.material.dispose();
      s.glare.removeFromParent();
      s.veil.removeFromParent();
      s.glare.dispose();
      s.veil.dispose();
    }
    for (const p of view.planets) {
      p.mesh.removeFromParent();
      p.mesh.material.dispose();
      p.orbit.removeFromParent();
      p.orbit.geometry.dispose();
      p.orbit.material.dispose();
    }
    if (view.hz) {
      view.hz.removeFromParent();
      view.hz.geometry.dispose();
      view.hz.material.dispose();
    }
    view.earth.removeFromParent();
    view.earth.geometry.dispose();
    view.earth.material.dispose();
    view = null;
    setExoView({ openHost: -1 });
  }

  function updateStars(v: SystemView, ctx: FrameContext): void {
    const cam = ctx.cameraPosition;
    starOffsets(v.model, ctx.timeMs, off0, off1);
    let f = 1;
    for (let k = 0; k < v.stars.length; k++) {
      const s = v.stars[k];
      s.world.copy(hostW).add(k === 0 ? off0 : off1);
      const d = Math.max(s.world.distanceTo(cam), 1);
      // One factor for the whole system (the primary's), so a binary keeps its true size ratio.
      if (k === 0) f = exhibitFactor(s.star.radiusM, 'star', d, v.model.starClearanceM);
      s.drawnR = s.star.radiusM * f;
      s.px = ctx.pixelDiameter(s.drawnR, d);
      ctx.toRender(s.world, s.mesh.position);
      const rU = s.drawnR / ctx.metersPerUnit;
      s.mesh.scale.setScalar(rU);
      s.mesh.visible = s.px > 0.8;
      if (s.mesh.visible) {
        s.mesh.material.setTime((ctx.timeMs / 1000) % 1e6);
        // The metered exposure lifts these dim scenes several stops; hold the disc near display white so AgX keeps
        // the photosphere's blackbody hue (orange K, red M) instead of clipping every star to white.
        s.mesh.material.intensity = starIntensity(s.star.teffK) / Math.max(POST_EXPOSURE_UNIFORM.value, 1);
      }
      const w = 1 - THREE.MathUtils.smoothstep(s.px, 6, 60);
      for (const g of [s.glare, s.veil]) {
        g.position.copy(s.mesh.position);
        g.material.setViewportHeight(ctx.viewport.height);
      }
      s.glare.material.setRadius(rU * 2);
      s.veil.material.setRadius(rU * 6);
      s.glare.material.uniforms.uOpacity.value = w;
      s.veil.material.uniforms.uOpacity.value = 0.5 * w;
      s.glare.visible = s.veil.visible = w > 0.002;
    }
  }

  function updatePlanets(v: SystemView, ctx: FrameContext): void {
    const cam = ctx.cameraPosition;
    const m = v.model;
    const focusHost = hostOfId(ctx.focusEntityId);
    // Exposure reference: the focused planet, else the system's median insolation; eased in log space.
    let sTarget = NaN;
    if (focusHost === v.host && ctx.focusEntityId?.startsWith(EXO_PREFIX)) {
      const pv = v.planets.find((x) => exoId(x.p.name) === ctx.focusEntityId);
      if (pv) sTarget = pv.p.insolation;
    }
    if (!(sTarget > 0)) {
      const ss = v.planets.map((x) => x.p.insolation).filter((x) => x > 0).sort((a, b) => a - b);
      sTarget = ss.length ? ss[Math.floor(ss.length / 2)] : 1;
    }
    sTarget = THREE.MathUtils.clamp(sTarget, 1e-3, 3e4);
    if (!(v.sRef > 0)) v.sRef = sTarget;
    const k = ctx.dtRealSec > 0 ? 1 - Math.exp(-ctx.dtRealSec / 0.6) : 1;
    v.sRef = Math.exp(Math.log(v.sRef) + (Math.log(sTarget) - Math.log(v.sRef)) * k);

    const tSec = ctx.timeMs / 1000;
    for (const pv of v.planets) {
      const p = pv.p;
      planetOffset(m, p, ctx.timeMs, tmp);
      pv.world.copy(hostW).add(tmp);
      const d = Math.max(pv.world.distanceTo(cam), 1);
      const f = exhibitFactor(p.radiusM, 'planet', d, p.clearanceM);
      pv.drawnR = p.radiusM * f;
      pv.px = ctx.pixelDiameter(pv.drawnR, d);
      const rU = pv.drawnR / ctx.metersPerUnit;
      ctx.toRender(pv.world, pv.mesh.position);
      pv.mesh.scale.setScalar(rU);
      pv.mesh.visible = pv.px > 0.6 && v.fade > 0.01;

      // Orbit line (fades with distance; the focused planet's orbit is brighter).
      const focused = ctx.focusEntityId === exoId(p.name) || ctx.selectedId === exoId(p.name);
      const role = focused ? 'focused' : 'planet';
      if (pv.orbit.material.role !== role) pv.orbit.material.role = role;
      pv.orbit.parentPositionM.copy(hostW);
      pv.orbit.setHead(meanAnomalyAt(p, ctx.timeMs) / (2 * Math.PI));
      pv.orbit.visible = ctx.overlays.orbits && v.fade > 0.01;
      if (pv.orbit.visible) {
        pv.orbit.update(ctx);
        pv.orbit.material.setFade(v.fade * (focused ? 1 : 0.8));
      }
      if (!pv.mesh.visible) continue;

      // Orientation: spin axis = orbit normal; locked planets keep one face on the star, others turn once a day
      // (illustrative: exoplanet rotation periods are unknown).
      tmp2.subVectors(v.stars[0].world, pv.world).normalize();
      const spin = p.tidallyLocked ? Math.atan2(tmp2.dot(pv.e2), tmp2.dot(pv.e1)) : ((tSec % 86_400) / 86_400) * 2 * Math.PI;
      mBasis.makeBasis(pv.e1, pv.e2, pv.n);
      qAlign.setFromRotationMatrix(mBasis);
      qSpin.setFromAxisAngle(zAxis, spin);
      pv.mesh.quaternion.copy(qAlign).multiply(qSpin);
      qInv.copy(pv.mesh.quaternion).invert();

      const u = pv.mesh.material.uniforms;
      const enlargeW = THREE.MathUtils.smoothstep(f, 1.5, 20);
      const gamma = 1 - 0.55 * enlargeW;
      let eMain = 0;
      for (let si = 0; si < 2; si++) {
        const s = v.stars[si];
        const dirU = si === 0 ? u.uL0Dir.value : u.uL1Dir.value;
        const col = si === 0 ? u.uL0.value : u.uL1.value;
        if (!s) {
          col.setRGB(0, 0, 0);
          continue;
        }
        dirU.subVectors(s.world, pv.world);
        const r = dirU.length();
        dirU.multiplyScalar(1 / r).applyQuaternion(qInv);
        // Insolation from this star relative to the exposure reference.
        const S = s.star.luminosityW / 3.828e26 / (r / AU_M) ** 2;
        const E = SCENE_IRRADIANCE_REF * Math.pow(S / v.sRef, gamma);
        if (si === 0) eMain = E;
        col.copy(s.light).multiplyScalar(E);
      }
      u.uEmitGain.value = eMain / Math.PI;
      u.uCamLocal.value.copy(pv.mesh.position).negate().applyQuaternion(qInv).multiplyScalar(1 / rU);
      u.uTime.value = (tSec % 1e6) / 600;
    }
  }

  function updateOverlays(v: SystemView, ctx: FrameContext): void {
    const on = ctx.overlays['habitable-zones'] && v.fade > 0.01;
    if (v.hz) {
      v.hz.visible = on;
      if (on) {
        ctx.toRender(hostW, v.hz.position);
        v.hz.scale.setScalar(v.model.hz.earlyMars.distanceM / ctx.metersPerUnit);
        v.hz.material.uniforms.uOpacity.value = v.fade;
      }
    }
    v.earth.visible = ctx.overlays.orbits && v.fade > 0.01;
    if (v.earth.visible) {
      v.earth.parentPositionM.copy(hostW);
      v.earth.update(ctx);
      v.earth.material.setFade(0.7 * v.fade);
    }
  }

  // ── System framing ──────────────────────────────────────────────────────────────────────
  // Most known systems transit, so the line of sight from the Sun lies in their orbital plane and the orbits collapse
  // into a line. On travel to a 'sys:' entity the camera is redirected to look down on the orbital plane from
  // SYSTEM_VIEW_ELEVATION above it, keeping the side that faces the Sun (as the features domain does for sites).
  const SYSTEM_VIEW_ELEVATION = 52 * THREE.MathUtils.DEG2RAD;
  const fv = { e1: new THREE.Vector3(), e2: new THREE.Vector3(), n: new THREE.Vector3(), d: new THREE.Vector3(), up: new THREE.Vector3(), x: new THREE.Vector3(), host: new THREE.Vector3() };
  const fvM = new THREE.Matrix4();
  const fvQ = new THREE.Quaternion();
  let suppressUntil = 0;
  let unsubTravel: (() => void) | null = null;

  function systemView(host: number, entityId: string, fovYRad: number): CameraViewState | null {
    if (!cat || !svc || !hostPlaceable(cat, host)) return null;
    const m = getSystemModel(cat, host);
    planeBasis(m.frame, m.systemInclRad, m.raanRad, fv.e1, fv.e2, fv.n);
    hostPosition(cat, host, fv.host);
    // Start from the direction back toward the Sun (our line of sight), so the view keeps the side facing home.
    fv.d.copy(fv.host).negate();
    if (!(fv.d.lengthSq() > 0)) fv.d.copy(fv.e1);
    fv.d.normalize();
    const side = fv.d.dot(fv.n) >= 0 ? 1 : -1;
    fv.n.multiplyScalar(side);
    fv.d.addScaledVector(fv.n, -fv.d.dot(fv.n));
    if (fv.d.lengthSq() < 1e-8) fv.d.copy(fv.e1);
    fv.d.normalize().multiplyScalar(Math.cos(SYSTEM_VIEW_ELEVATION)).addScaledVector(fv.n, Math.sin(SYSTEM_VIEW_ELEVATION)).normalize();
    fv.up.copy(fv.n).addScaledVector(fv.d, -fv.n.dot(fv.d)).normalize();
    fv.x.crossVectors(fv.up, fv.d).normalize();
    fvM.makeBasis(fv.x, fv.up, fv.d);
    fvQ.setFromRotationMatrix(fvM);
    const e = svc.registry.get(entityId);
    const h = e?.viewDistance?.default ?? 4 * (e?.framingRadiusM ?? AU_M);
    return {
      anchorId: entityId,
      offset: [fv.d.x * h, fv.d.y * h, fv.d.z * h],
      quaternion: [fvQ.x, fvQ.y, fvQ.z, fvQ.w],
      mode: 'orbit',
      focusId: entityId,
      scaleLog10: Math.log10(2 * h * Math.tan(fovYRad / 2)),
    };
  }

  function onTravelStart(targetId: string): void {
    if (!svc || !targetId.startsWith(SYS_PREFIX) || performance.now() < suppressUntil) return;
    const host = hostOfId(targetId);
    if (host < 0) return;
    const s = svc;
    queueMicrotask(() => {
      const v = systemView(host, targetId, THREE.MathUtils.degToRad(s.camera.fov));
      if (!v) return;
      suppressUntil = performance.now() + 1500;
      void s.cameraController.setView(v, s.cameraController.traveling ? undefined : { instant: true });
    });
  }

  return {
    id: 'exoplanets-system',
    openHost: () => view?.host ?? -1,

    init(s) {
      svc = s;
      setExoRegistry(s.registry);
      unsubTravel = s.events.on('travel-start', (p) => onTravelStart(p.targetId));
      loadExoCatalog().then((l) => {
        cat = l.catalog;
        index = l.index;
      }).catch(() => undefined);
    },

    update(ctx: FrameContext) {
      if (!cat) return;
      // Which system should be open?
      let want = hostOfId(ctx.focusEntityId);
      if (want < 0) want = hostOfId(ctx.selectedId);
      if (want < 0) {
        if (ctx.frame % 20 === 0 || nearHost < 0) nearHost = ctx.scaleLog10 < 17 ? findNearHost(ctx.cameraPosition) : -1;
        want = nearHost;
      }
      if (want >= 0 && !hostPlaceable(cat, want)) want = -1;
      const band = ctx.spectralBand;
      const lambdas = band === 'near-infrared' || band === 'mid-infrared' || band === 'far-infrared' ? INFRARED_LAMBDA : VISIBLE_LAMBDA;
      if ((view?.host ?? -1) !== want) {
        if (want < 0) close();
        else open(want, lambdas);
      }
      const v = view;
      if (!v) return;
      if (band !== lastBand) {
        lastBand = band;
        if (v.lambdas !== lambdas) {
          v.lambdas = lambdas;
          for (const pv of v.planets) applyLook(pv, v.model, lambdas);
        }
      }
      hostPosition(cat, v.host, hostW);
      const d = hostW.distanceTo(ctx.cameraPosition);
      v.fade = 1 - THREE.MathUtils.smoothstep(d, 120 * v.extM, 1500 * v.extM);
      updateStars(v, ctx);
      updatePlanets(v, ctx);
      updateOverlays(v, ctx);
    },

    pick(ctx, x, y, radiusPx): PickHit[] {
      const v = view;
      if (!v || !cat) return [];
      const hits: PickHit[] = [];
      const test = (world: THREE.Vector3, px: number, id: string, pri: number): void => {
        ctx.project(world, sp);
        if (!sp.visible) return;
        const dd = Math.hypot(sp.x - x, sp.y - y);
        if (dd <= Math.max(radiusPx, px / 2)) hits.push({ entityId: id, distancePx: Math.max(0, dd - px / 2), depthM: sp.depthM, priority: pri });
      };
      for (const pv of v.planets) if (pv.mesh.visible) test(pv.world, pv.px, exoId(pv.p.name), 40);
      test(v.stars[0].world, v.stars[0].px, sysId(v.model.name), 45);
      return hits;
    },

    collectLabels(ctx, out: LabelCandidate[]) {
      const v = view;
      if (!v || !cat || v.fade < 0.05) return;
      const show = SHOWCASE_BY_HOST.get(v.model.name);
      ctx.project(v.stars[0].world, sp);
      if (sp.visible) {
        out.push({ entityId: sysId(v.model.name), text: show?.title ?? v.model.name, x: sp.x, y: sp.y, priority: 55, kind: 'star', offsetPx: v.stars[0].px / 2 + 8 });
      }
      for (const pv of v.planets) {
        if (!pv.mesh.visible && v.fade < 0.3) continue;
        ctx.project(pv.world, sp);
        if (!sp.visible) continue;
        out.push({
          entityId: exoId(pv.p.name), text: pv.p.name, x: sp.x, y: sp.y, priority: 42, kind: 'body',
          offsetPx: pv.px / 2 + 6, opacity: v.fade,
        });
      }
      if (v.hz && v.hz.visible && v.hzMid > 0) {
        tmp.copy(hostW).addScaledVector(v.e2, -v.hzMid);
        ctx.project(tmp, sp);
        if (sp.visible) out.push({ entityId: null, text: 'Habitable zone', x: sp.x, y: sp.y, priority: 18, kind: 'annotation', opacity: v.fade });
      }
      if (v.earth.visible) {
        tmp.copy(hostW).addScaledVector(v.e1, AU_M);
        ctx.project(tmp, sp);
        if (sp.visible) out.push({ entityId: null, text: 'Earth\'s orbit (1 AU), for scale', x: sp.x, y: sp.y, priority: 12, kind: 'annotation', opacity: 0.8 * v.fade });
      }
    },

    dispose() {
      unsubTravel?.();
      unsubTravel = null;
      close();
    },
  };
}

export { exoView };
