/**
 * Notable satellites layer: procedural models (ISS, Tiangong, Hubble) at true size when close, oriented in LVLH
 * (+X along velocity, +Z nadir) with solar arrays tracking the Sun; sunlit glints otherwise (dim in Earth's shadow);
 * Sun-lit with a soft Earth eclipse (penumbra from the Sun's and Earth's angular radii) and Earthshine; the ISS orbit
 * track (one revolution, trail-faded) and, when the ISS is focused or selected, its ground track for the next
 * revolution; labels and picking. Positions come from the entities (Earth's entity + offset-scaled SGP4 offsets).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { OrbitLine } from '../../render/orbitBuilder';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { solarSceneIrradianceAt } from '../solar/ephemeris';
import { SpacecraftMaterial, modelDef, disposeModels, type ModelId } from './models';
import type { NotableSat } from './notable';
import { R_EARTH_M, earthPosition, mapRel, orbitalScale, satWorld, sunPosition, updateOrbitalScale } from './scene';

const R_SUN_M = 6.957e8;
/** Model drawn above this on-screen size (px); the glint fades out between GLINT_FADE px. */
const MODEL_MIN_PX = 2.5;
const GLINT_FADE: [number, number] = [3, 9];
const ORBIT_SAMPLES = 240;
const GROUND_SAMPLES = 240;
const EARTH_OMEGA = 7.2921159e-5; // rad/s
const FAR_HIDE_M = 2.5e9;
const SHORT_LABEL: Record<string, string> = { 'sc:iss': 'ISS', 'sat:48274': 'Tiangong', 'sat:20580': 'Hubble' };

const GLINT_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const GLINT_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * 4.0) * 0.25;
  float a = (core + halo) * (1.0 - smoothstep(0.85, 1.0, r));
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

interface Visual {
  sat: NotableSat;
  world: THREE.Vector3;
  rel: THREE.Vector3;
  vel: THREE.Vector3;
  ok: boolean;
  distM: number;
  px: number;
  lit: number;
  group: THREE.Group | null;
  arrays: THREE.Mesh[];
  material: SpacecraftMaterial | null;
  orbit: OrbitLine | null;
  ground: OrbitLine | null;
  shown: boolean;
}

export interface SatLayer extends Layer {
  readonly visuals: readonly Visual[];
}

export function createSatLayer(sats: readonly NotableSat[]): SatLayer {
  let svc: EngineServices | null = null;
  const visuals: Visual[] = sats.map((sat) => ({
    sat, world: new THREE.Vector3(), rel: new THREE.Vector3(), vel: new THREE.Vector3(), ok: false, distM: 1, px: 0, lit: 1,
    group: null, arrays: [], material: null, orbit: null, ground: null, shown: false,
  }));
  const earthW = new THREE.Vector3();
  const sunW = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const xAx = new THREE.Vector3();
  const yAx = new THREE.Vector3();
  const zAx = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const qBody = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const poly = new Float64Array(3 * Math.max(ORBIT_SAMPLES, GROUND_SAMPLES));
  const frac = new Float64Array(Math.max(ORBIT_SAMPLES, GROUND_SAMPLES));
  let glints: THREE.Points | null = null;
  let glintPos: Float32Array;
  let glintCol: Float32Array;
  let glintSize: Float32Array;
  let glintMat: THREE.ShaderMaterial | null = null;
  const sunFromEarth = new THREE.Vector3();

  function ensureModel(v: Visual): void {
    if (v.group || !svc || v.sat.info.model === 'glint') return;
    const def = modelDef(v.sat.info.model as ModelId);
    const mat = new SpacecraftMaterial();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(def.structure, mat));
    for (const a of def.arrays) {
      const m = new THREE.Mesh(a.geometry, mat);
      m.position.set(a.position[0], a.position[1], a.position[2]);
      g.add(m);
      v.arrays.push(m);
    }
    for (const c of g.children) c.frustumCulled = false;
    g.visible = false;
    svc.groups.main.add(g);
    v.group = g;
    v.material = mat;
  }

  function ensureOrbit(v: Visual): OrbitLine {
    if (!v.orbit) {
      v.orbit = new OrbitLine({ role: 'minor', provenance: 'observed', maxVertices: ORBIT_SAMPLES + 2 });
      // Render-kit workaround (as in solar/orbitsLayer): the segment quads wind clockwise, so FrontSide culls them.
      v.orbit.material.side = THREE.DoubleSide;
      v.orbit.visible = false;
      svc?.groups.overlay.add(v.orbit);
    }
    return v.orbit;
  }

  function ensureGround(v: Visual): OrbitLine {
    if (!v.ground) {
      v.ground = new OrbitLine({ role: 'minor', provenance: 'derived', maxVertices: GROUND_SAMPLES + 2 });
      v.ground.material.side = THREE.DoubleSide;
      v.ground.visible = false;
      svc?.groups.overlay.add(v.ground);
    }
    return v.ground;
  }

  /** Lit fraction of the Sun's disc seen from a point `rel` (m from Earth's centre). */
  function sunlitFraction(rel: THREE.Vector3, sunFromEarth: THREE.Vector3): number {
    const r = rel.length();
    if (r <= R_EARTH_M) return 0;
    tmp2.subVectors(sunFromEarth, rel);
    const dSun = tmp2.length();
    const rhoS = Math.asin(Math.min(1, R_SUN_M / dSun));
    const rhoE = Math.asin(Math.min(1, R_EARTH_M / r));
    const cosT = -(tmp2.dot(rel)) / (dSun * r);
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
    if (theta >= rhoE + rhoS) return 1;
    if (theta <= rhoE - rhoS) return 0;
    const x = (theta - (rhoE - rhoS)) / (2 * rhoS);
    return x * x * (3 - 2 * x);
  }

  function updateOrbitLine(v: Visual, ctx: FrameContext, focused: boolean): void {
    const track = v.sat.track;
    const showOrbit = focused || (v.sat.info.id === 'sc:iss' && ctx.overlays.orbits && orbitalScale.earthDistM < 1.2e8);
    if (!showOrbit || !v.ok) {
      if (v.orbit) v.orbit.visible = false;
      if (v.ground) v.ground.visible = false;
      return;
    }
    const period = track.periodSec(ctx.timeMs);
    if (!Number.isFinite(period)) return;
    const line = ensureOrbit(v);
    // One revolution ending at the satellite (trail fades behind it).
    const n = ORBIT_SAMPLES;
    for (let i = 0; i < n; i++) {
      const dt = -period + (period * i) / (n - 1);
      track.positionAhead(ctx.timeMs, dt, tmp);
      mapRel(tmp);
      poly[3 * i] = tmp.x; poly[3 * i + 1] = tmp.y; poly[3 * i + 2] = tmp.z;
      frac[i] = i / (n - 1);
    }
    line.setPolyline(poly, n, false, frac);
    line.material.role = focused ? 'focused' : 'minor';
    // Fade out right at the craft so the line never pierces the close-up model.
    const nearFade = THREE.MathUtils.smoothstep(v.distM, v.sat.info.radiusM * 4, v.sat.info.radiusM * 40);
    line.material.uniforms.uOpacity.value = (focused ? 0.9 : 0.42) * nearFade;
    line.setHead(1, 0.08);
    line.parentPositionM.copy(orbitalScale.earthDraw);
    line.visible = true;
    line.update(ctx);
    // Ground track (next revolution) on the drawn Earth's surface, Earth-fixed at the current instant.
    if (focused && v.sat.info.id === 'sc:iss') {
      const g = ensureGround(v);
      const R = R_EARTH_M * orbitalScale.earthFactor * 1.004;
      for (let i = 0; i < GROUND_SAMPLES; i++) {
        const dt = (period * i) / (GROUND_SAMPLES - 1);
        track.positionAhead(ctx.timeMs, dt, tmp);
        // Rotate back by Earth's spin over dt about the (ICRS ≈ true) pole so the track is fixed to the ground now.
        const a = -EARTH_OMEGA * dt, c = Math.cos(a), s = Math.sin(a);
        const x = tmp.x * c - tmp.y * s, y = tmp.x * s + tmp.y * c, z = tmp.z;
        const L = Math.hypot(x, y, z) || 1;
        poly[3 * i] = (x / L) * R; poly[3 * i + 1] = (y / L) * R; poly[3 * i + 2] = (z / L) * R;
        frac[i] = 1 - i / (GROUND_SAMPLES - 1);
      }
      g.setPolyline(poly, GROUND_SAMPLES, false, frac);
      g.material.role = 'focused';
      g.material.uniforms.uOpacity.value = 0.45;
      g.setHead(1, 0.15);
      g.parentPositionM.copy(orbitalScale.earthDraw);
      g.visible = true;
      g.update(ctx);
    } else if (v.ground) {
      v.ground.visible = false;
    }
  }

  return {
    id: 'orbital-satellites',
    visuals,
    init(s) {
      svc = s;
      const n = visuals.length;
      glintPos = new Float32Array(3 * n);
      glintCol = new Float32Array(3 * n);
      glintSize = new Float32Array(n);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(glintPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aColor', new THREE.BufferAttribute(glintCol, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(glintSize, 1).setUsage(THREE.DynamicDrawUsage));
      glintMat = new THREE.ShaderMaterial({
        vertexShader: GLINT_VERTEX, fragmentShader: GLINT_FRAGMENT, uniforms: { uPixelRatio: { value: 1 } },
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
      });
      glints = new THREE.Points(geo, glintMat);
      glints.frustumCulled = false;
      glints.renderOrder = 3;
      s.groups.far.add(glints);
    },
    update(ctx) {
      const t = ctx.timeMs;
      earthPosition(t, earthW);
      updateOrbitalScale(ctx, svc?.store ?? null, earthW);
      sunPosition(t, sunW);
      sunFromEarth.subVectors(sunW, earthW);
      sunDir.copy(sunFromEarth).normalize();
      const far = orbitalScale.earthDistM > FAR_HIDE_M;
      const irr = solarSceneIrradianceAt(earthW, t);
      for (let i = 0; i < visuals.length; i++) {
        const v = visuals[i];
        const track = v.sat.track;
        v.ok = !far && track.position(t, v.rel);
        const focused = ctx.focusEntityId === v.sat.info.id || ctx.selectedId === v.sat.info.id;
        if (!v.ok) {
          glintSize[i] = 0;
          if (v.group) v.group.visible = false;
          updateOrbitLine(v, ctx, false);
          v.shown = false;
          continue;
        }
        track.velocity(t, v.vel);
        satWorld(v.rel, v.world);
        v.distM = Math.max(1e-3, v.world.distanceTo(ctx.cameraPosition));
        v.px = ctx.pixelDiameter(v.sat.info.radiusM, v.distM);
        v.lit = sunlitFraction(v.rel, sunFromEarth);
        v.shown = true;
        // Model.
        const wantModel = v.sat.info.model !== 'glint' && v.px > MODEL_MIN_PX;
        if (wantModel) ensureModel(v);
        if (v.group && v.material) {
          v.group.visible = wantModel;
          if (wantModel) {
            // LVLH basis: x = along-track (velocity ⟂ r), z = nadir, y = z × x.
            zAx.copy(v.rel).normalize().negate();
            xAx.copy(v.vel).addScaledVector(zAx, -v.vel.dot(zAx)).normalize();
            yAx.crossVectors(zAx, xAx);
            basis.makeBasis(xAx, yAx, zAx);
            qBody.setFromRotationMatrix(basis);
            v.group.quaternion.copy(qBody);
            ctx.toRender(v.world, v.group.position);
            v.group.scale.setScalar(1 / ctx.metersPerUnit);
            // Sun in the body frame → array tracking (alpha about +Y, beta about the wing axis).
            qInv.copy(qBody).invert();
            tmp2.copy(sunDir).applyQuaternion(qInv);
            const alpha = Math.atan2(-tmp2.z, tmp2.x);
            const beta = v.sat.info.model === 'hubble' ? 0 : Math.asin(Math.max(-1, Math.min(1, tmp2.y)));
            qA.setFromAxisAngle(Y, alpha);
            qB.setFromAxisAngle(Z, beta);
            for (const a of v.arrays) a.quaternion.copy(qA).multiply(qB);
            const u = v.material.uniforms;
            u.uSunDir.value.copy(sunDir);
            u.uIrradiance.value = irr * v.lit;
            const r = v.rel.length();
            u.uEarthDir.value.copy(v.rel).multiplyScalar(-1 / r);
            const q = R_EARTH_M / r;
            u.uEarthshine.value = irr * 0.3 * q * q * 0.5 * (1 + v.rel.dot(sunDir) / r);
            u.uSunIrr.value = irr;
            u.uEarthQ.value = q;
          }
        }
        // Glint (fades out as the model grows).
        const fadeOut = v.sat.info.model === 'glint' ? 1 : 1 - THREE.MathUtils.smoothstep(v.px, GLINT_FADE[0], GLINT_FADE[1]);
        ctx.toRender(v.world, tmp2);
        glintPos[3 * i] = tmp2.x; glintPos[3 * i + 1] = tmp2.y; glintPos[3 * i + 2] = tmp2.z;
        const big = v.sat.info.kind === 'space-station' ? 1.35 : v.sat.info.id === 'sat:20580' ? 1.15 : 1;
        const lum = (v.lit * 1.6 + 0.12) * fadeOut;
        const warm = v.lit > 0.5;
        glintCol[3 * i] = lum * (warm ? 1.0 : 0.55);
        glintCol[3 * i + 1] = lum * (warm ? 0.95 : 0.65);
        glintCol[3 * i + 2] = lum * (warm ? 0.86 : 0.9);
        glintSize[i] = fadeOut > 0.001 ? (5 + 2 * v.lit) * big * (focused ? 1.3 : 1) : 0;
        updateOrbitLine(v, ctx, focused);
      }
      if (glints && glintMat) {
        glints.visible = !far;
        glintMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio * ctx.quality.renderScale;
        const geo = glints.geometry;
        geo.getAttribute('position').needsUpdate = true;
        geo.getAttribute('aColor').needsUpdate = true;
        geo.getAttribute('aSize').needsUpdate = true;
      }
    },
    pick(ctx, x, y, radiusPx): PickHit[] {
      const hits: PickHit[] = [];
      for (const v of visuals) {
        if (!v.shown) continue;
        ctx.project(v.world, sp);
        if (!sp.visible) continue;
        const d = Math.hypot(sp.x - x, sp.y - y);
        const r = radiusPx + Math.min(v.px / 2, 2000);
        if (d <= r) hits.push({ entityId: v.sat.info.id, distancePx: Math.max(0, d - v.px / 2), depthM: sp.depthM, priority: v.sat.info.importance });
      }
      return hits;
    },
    collectLabels(ctx, out: LabelCandidate[]) {
      for (const v of visuals) {
        if (!v.shown) continue;
        const id = v.sat.info.id;
        const focused = ctx.focusEntityId === id || ctx.selectedId === id || ctx.hoveredId === id;
        const hero = v.sat.info.importance >= 80;
        if (!focused && !hero && !ctx.overlays.satellites) continue;
        if (!focused && orbitalScale.earthDistM > 2.5e8) continue;
        ctx.project(v.world, sp);
        if (!sp.visible) continue;
        out.push({
          entityId: id,
          text: SHORT_LABEL[id] ?? v.sat.info.name,
          x: sp.x, y: sp.y,
          priority: v.sat.info.importance * 0.6,
          kind: 'satellite',
          offsetPx: Math.min(v.px / 2, 3000) + 6,
          detail: v.sat.info.model === 'glint' ? undefined : 'Illustrative model, real position',
        });
      }
    },
    dispose() {
      for (const v of visuals) {
        if (v.group) svc?.groups.main.remove(v.group);
        v.material?.dispose();
        for (const l of [v.orbit, v.ground]) if (l) { svc?.groups.overlay.remove(l); l.geometry.dispose(); l.material.dispose(); }
      }
      if (glints) { svc?.groups.far.remove(glints); glints.geometry.dispose(); }
      glintMat?.dispose();
      disposeModels();
    },
  };
}
