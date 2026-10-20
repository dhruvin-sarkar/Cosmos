/**
 * The edge of the observable universe ('cosmology:edge').
 *  - Last-scattering sphere at the comoving distance to z* = 1089.8 (13 880 Mpc, cosmology.json derived), textured
 *    with the Planck PR3 SMICA CMB temperature map (ICRS, so the Galactic plane and the Cold Spot sit where they are
 *    on our sky). Seen from outside, the map is mirrored relative to our sky (we look at the sphere's outer face).
 *  - Redshift shells: view-facing circles at the comoving distance of z = 0.05 … 1089.8, labelled with redshift,
 *    comoving distance and lookback time (the readouts as you zoom out).
 *  - The particle horizon (46.2 billion light-years) as a dotted circle, and a "you are here" marker.
 * Temperatures: a ±300 µK colour map (Planck-like blue → cream → red); hovering reports nothing — values come from
 * the readout helper `cmbTemperatureAt` for the inspector.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { GPC_M, JULIAN_YEAR_S, MPC_M } from '../../core/units';
import { comovingDistanceM, lookbackTimeS, redshiftFromComovingDistance, Z_LAST_SCATTERING } from '../../science/cosmology';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { smooth } from '../galaxies/fade';
import { CMB_ID, LAST_SCATTERING_MPC, OBSERVABLE_ID, PARTICLE_HORIZON_MPC } from './constants';

const MAX_RENDER_DEPTH = 1e14;
const SEG = 160;
const LY_PER_MPC = 3.2615637771674333e6;

export const SHELL_REDSHIFTS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 6, 20, Z_LAST_SCATTERING];

export interface ShellInfo { z: number; distanceM: number; lookbackYr: number; label: string }

/** Readout for an observer-centred distance: the redshift and lookback time of light emitted there (null inside 30 Mpc). */
export function distanceReadout(distM: number): string | null {
  if (!(distM > 30 * MPC_M)) return null;
  const mpc = distM / MPC_M;
  const where = mpc >= 1000 ? `${(mpc / 1000).toPrecision(3)} Gpc` : `${Math.round(mpc)} Mpc`;
  const gly = (mpc * LY_PER_MPC / 1e9).toPrecision(3);
  if (distM >= PARTICLE_HORIZON_MPC * MPC_M) return `${where} (${gly} billion ly) from the Milky Way · beyond the particle horizon: no light from here has reached us yet`;
  const z = redshiftFromComovingDistance(distM);
  const lb = lookbackTimeS(z) / JULIAN_YEAR_S / 1e9;
  const zt = z >= 100 ? z.toFixed(0) : z >= 10 ? z.toFixed(1) : z >= 1 ? z.toFixed(2) : z.toFixed(3);
  return `${where} (${gly} billion ly) from the Milky Way · light from here: redshift z = ${zt}, emitted ${lb.toPrecision(3)} billion years ago`;
}

export function shellInfo(z: number): ShellInfo {
  const d = z === Z_LAST_SCATTERING ? LAST_SCATTERING_MPC * MPC_M : comovingDistanceM(z);
  const lb = lookbackTimeS(z) / JULIAN_YEAR_S;
  const gly = (d / MPC_M) * LY_PER_MPC / 1e9;
  const dist = d >= GPC_M ? `${(d / GPC_M).toPrecision(3)} Gpc` : `${Math.round(d / MPC_M)} Mpc`;
  const time = lb >= 1e9 ? `${(lb / 1e9).toPrecision(3)} billion years ago` : `${Math.round(lb / 1e6)} million years ago`;
  const zt = z === Z_LAST_SCATTERING ? 'z = 1090 · last scattering (CMB)' : `z = ${z}`;
  return { z, distanceM: d, lookbackYr: lb, label: `${zt} · ${dist} (${gly.toPrecision(3)} billion ly) · light left ${time}` };
}

class CmbMaterial extends THREE.ShaderMaterial {
  declare uniforms: { uMap: { value: THREE.Texture | null }; uGain: { value: number }; uOpacity: { value: number }; uRangeUk: { value: number } };
  constructor(map: THREE.Texture) {
    super({
      uniforms: { uMap: { value: map }, uGain: { value: 0.55 }, uOpacity: { value: 1 }, uRangeUk: { value: 300 } },
      vertexShader: /* glsl */ `
        ${VERTEX_PRELUDE}
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          ${LOGDEPTH_VERTEX}
        }`,
      fragmentShader: /* glsl */ `
        ${FRAGMENT_PRELUDE}
        uniform sampler2D uMap;
        uniform float uGain, uOpacity, uRangeUk;
        varying vec3 vDir;
        vec3 planck(float t) {
          // Planck-like diverging map: deep blue → light blue → cream → orange → red → dark red (sRGB stops, linearised).
          vec3 c0 = vec3(0.00, 0.00, 0.85), c1 = vec3(0.00, 0.43, 1.00), c2 = vec3(0.36, 0.80, 1.00);
          vec3 c3 = vec3(1.00, 0.94, 0.86), c4 = vec3(1.00, 0.70, 0.30), c5 = vec3(0.94, 0.33, 0.07), c6 = vec3(0.45, 0.02, 0.0);
          float x = clamp(t, 0.0, 1.0) * 6.0;
          vec3 c = x < 1.0 ? mix(c0, c1, x) : x < 2.0 ? mix(c1, c2, x - 1.0) : x < 3.0 ? mix(c2, c3, x - 2.0)
            : x < 4.0 ? mix(c3, c4, x - 3.0) : x < 5.0 ? mix(c4, c5, x - 4.0) : mix(c5, c6, x - 5.0);
          return pow(c, vec3(2.2));
        }
        void main() {
          ${LOGDEPTH_FRAGMENT}
          vec3 d = normalize(vDir);
          float ra = atan(d.y, d.x);              // ICRS right ascension
          float u = fract(ra / 6.2831853 + 1.0);   // texture: RA = 0 at the left edge, RA increasing right (bands.json)
          float u2 = fract(u + 0.5) - 0.5;         // seam-free twin for derivatives
          float v = 0.5 + asin(clamp(d.z, -1.0, 1.0)) / 3.1415927;
          vec2 dx = vec2(dFdx(u), dFdx(v)), dy = vec2(dFdy(u), dFdy(v));
          vec2 dx2 = vec2(dFdx(u2), dFdx(v)), dy2 = vec2(dFdy(u2), dFdy(v));
          if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
          float g = textureGrad(uMap, vec2(u, v), dx, dy).r;
          float dT = (g - 0.5) * 1000.0;           // µK (texture spans ±500 µK)
          vec3 col = planck(0.5 + 0.5 * dT / uRangeUk);
          gl_FragColor = vec4(col * uGain * uOpacity, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
  }
}

export function createEdgeLayer(): Layer {
  let svc: EngineServices | null = null;
  let sphere: THREE.Mesh | null = null;
  let mat: CmbMaterial | null = null;
  let upgraded = false;
  let lines: THREE.LineSegments | null = null;
  let linePos: Float32Array | null = null;
  let lineCol: Float32Array | null = null;
  const shells = SHELL_REDSHIFTS.map(shellInfo);
  const horizonM = PARTICLE_HORIZON_MPC * MPC_M;
  const shellOp = new Float32Array(shells.length + 1);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const sp = { x: 0, y: 0, depthM: 0, visible: false };
  let cmbOp = 0;
  let outside = false;
  let readoutKey = -1;
  let readoutText: string | null = null;

  return {
    id: 'cosmology:edge',
    init(s: EngineServices): void {
      svc = s;
      const tex = s.assets.texture('textures/galaxies/cmb_dT_1k.jpg', { colorSpace: 'linear', fallbackColor: 0x808080, anisotropy: 8 });
      tex.wrapS = THREE.RepeatWrapping;
      mat = new CmbMaterial(tex);
      sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), mat);
      sphere.frustumCulled = false;
      sphere.visible = false;
      sphere.renderOrder = -5;
      s.groups.transparent.add(sphere);
      const n = (shells.length + 1) * SEG * 2;
      linePos = new Float32Array(n * 3);
      lineCol = new Float32Array(n * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
      lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      lines.frustumCulled = false;
      s.groups.overlay.add(lines);
    },

    update(ctx: FrameContext): void {
      if (!svc || !sphere || !mat || !lines || !linePos || !lineCol) return;
      const R = LAST_SCATTERING_MPC * MPC_M;
      const camR = ctx.cameraPosition.length();
      outside = camR > R * 1.001;
      // Outside: the full sphere. Inside: a faint backdrop once the field reaches ~Gpc scales.
      cmbOp = outside ? smooth(25.9, 26.5, ctx.scaleLog10) : 0.35 * smooth(26.0, 26.9, ctx.scaleLog10);
      sphere.visible = cmbOp > 0.002;
      const k = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / (camR + R));
      const toUnits = k / ctx.metersPerUnit;
      if (sphere.visible) {
        sphere.position.set(-ctx.cameraPosition.x * toUnits, -ctx.cameraPosition.y * toUnits, -ctx.cameraPosition.z * toUnits);
        sphere.scale.setScalar(R * toUnits);
        mat.side = outside ? THREE.FrontSide : THREE.BackSide;
        mat.uniforms.uOpacity.value = cmbOp;
        if (!upgraded && ctx.quality.textureQuality !== 'low') {
          upgraded = true;
          void svc.assets.textureAsync('textures/galaxies/cmb_dT_4k.jpg', { colorSpace: 'linear', anisotropy: 16 }).then((t) => {
            t.wrapS = THREE.RepeatWrapping;
            const old = mat!.uniforms.uMap.value;
            mat!.uniforms.uMap.value = t;
            old?.dispose();
          }).catch(() => undefined);
        }
      }
      // Shell circles about the observer, facing the camera.
      // Below ~1 Mpc scales every shell is faded out: skip the per-frame rebuild (perf).
      const show = ctx.overlays.labels && ctx.scaleLog10 > 24.0;
      lines.visible = show;
      if (!show) { shellOp.fill(0); return; }
      right.set(1, 0, 0).applyQuaternion(ctx.cameraQuaternion);
      up.set(0, 1, 0).applyQuaternion(ctx.cameraQuaternion);
      const cx = -ctx.cameraPosition.x * toUnits, cy = -ctx.cameraPosition.y * toUnits, cz = -ctx.cameraPosition.z * toUnits;
      const minDim = Math.min(ctx.viewport.width, ctx.viewport.height);
      let v = 0;
      for (let j = 0; j <= shells.length; j++) {
        const rM = j < shells.length ? shells[j].distanceM : horizonM;
        const d = Math.max(camR, 1);
        const rPx = (rM / Math.max(d, rM * 1.02)) * ctx.pixelsPerRadian;
        // Visible while the circle is a readable size on screen and the camera is well away from it.
        let op = smooth(28, 90, rPx) * (1 - smooth(minDim * 0.55, minDim * 0.95, rPx)) * smooth(24.0, 24.6, ctx.scaleLog10);
        if (camR > rM * 0.7 && camR < rM * 1.4 && j < shells.length - 1) op *= 0.4;
        // From outside the last-scattering sphere its surface hides the inner shells.
        if (outside && j < shells.length - 1) op = 0;
        shellOp[j] = op;
        const ink = (j === shells.length ? 0.12 : j === shells.length - 1 ? 0.22 : 0.16) * op;
        const r = rM * toUnits;
        for (let i = 0; i < SEG; i++) {
          const on = j === shells.length && i % 2 === 1 ? 0 : ink; // particle horizon dotted
          for (let e = 0; e < 2; e++) {
            const a = ((i + e) / SEG) * Math.PI * 2;
            const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
            linePos[v * 3] = cx + ca * right.x + sa * up.x;
            linePos[v * 3 + 1] = cy + ca * right.y + sa * up.y;
            linePos[v * 3 + 2] = cz + ca * right.z + sa * up.z;
            lineCol[v * 3] = 0.82 * on; lineCol[v * 3 + 1] = 0.78 * on; lineCol[v * 3 + 2] = 0.68 * on;
            v++;
          }
        }
      }
      (lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (lines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!svc) return;
      // Shell readouts anchored at the upper-right of each circle (45° on screen).
      right.set(1, 0, 0).applyQuaternion(ctx.cameraQuaternion);
      up.set(0, 1, 0).applyQuaternion(ctx.cameraQuaternion);
      for (let j = 0; j <= shells.length; j++) {
        const op = shellOp[j];
        if (op < 0.2) continue;
        const rM = j < shells.length ? shells[j].distanceM : horizonM;
        const ang = j === shells.length ? -0.62 : 0.62 - j * 0.035;
        scratch.copy(right).multiplyScalar(Math.cos(ang) * rM).addScaledVector(up, Math.sin(ang) * rM);
        ctx.project(scratch, sp);
        if (!sp.visible) continue;
        const text = j < shells.length ? shells[j].label : `Particle horizon · ${(PARTICLE_HORIZON_MPC / 1000).toFixed(2)} Gpc (46.2 billion ly): edge of the observable universe`;
        out.push({ entityId: j >= shells.length - 1 ? (j === shells.length ? OBSERVABLE_ID : CMB_ID) : null, text, x: sp.x, y: sp.y, priority: 58 - j, kind: 'annotation', offsetPx: 4, opacity: op });
      }
      // Readout: the camera's comoving distance from us as redshift and lookback time (recomputed on 0.5% steps).
      const camR = ctx.cameraPosition.length();
      const ro = smooth(24.3, 24.9, ctx.scaleLog10);
      if (ro > 0.05 && camR > 30 * MPC_M) {
        const key = Math.round(Math.log(camR) * 200);
        if (key !== readoutKey) { readoutKey = key; readoutText = distanceReadout(camR); }
        if (readoutText) out.push({ entityId: null, text: readoutText, x: ctx.viewport.width * 0.5, y: ctx.viewport.height * 0.9, priority: 95, kind: 'annotation', offsetPx: 0, opacity: ro });
      }
      // You are here: at Gpc scales the whole Local Group is a point.
      const here = smooth(24.4, 25.0, ctx.scaleLog10);
      if (here > 0.05) {
        scratch.set(0, 0, 0);
        ctx.project(scratch, sp);
        if (sp.visible) out.push({ entityId: 'mw:galaxy', text: 'You are here · Milky Way', x: sp.x, y: sp.y, priority: 90, kind: 'annotation', offsetPx: 6, opacity: here });
      }
      if (cmbOp > 0.3 && outside) {
        const R = LAST_SCATTERING_MPC * MPC_M;
        scratch.copy(up).multiplyScalar(-R * 1.0);
        ctx.project(scratch, sp);
        if (sp.visible) out.push({ entityId: CMB_ID, text: 'Cosmic microwave background · Planck 2018 (seen from outside: mirrored)', x: sp.x, y: sp.y + 18, priority: 85, kind: 'structure', offsetPx: 0, opacity: cmbOp });
      }
    },

    pick(ctx: FrameContext, x: number, y: number, _r: number): PickHit[] {
      if (!outside || cmbOp < 0.3) return [];
      scratch.set(0, 0, 0);
      ctx.project(scratch, sp);
      const rPx = (LAST_SCATTERING_MPC * MPC_M / Math.max(ctx.cameraPosition.length(), 1)) * ctx.pixelsPerRadian;
      const dd = Math.hypot(sp.x - x, sp.y - y);
      return dd < rPx ? [{ entityId: CMB_ID, distancePx: dd, depthM: sp.depthM, priority: 10 }] : [];
    },

    dispose(): void {
      sphere?.removeFromParent();
      sphere?.geometry.dispose();
      mat?.uniforms.uMap.value?.dispose();
      mat?.dispose();
      lines?.removeFromParent();
      lines?.geometry.dispose();
      (lines?.material as THREE.Material | undefined)?.dispose();
    },
  };
}
