/**
 * Black-holes render layer. Every catalogue system gets a photometric point for its companion star (far away) plus a
 * label and picking; the nearest system (the "hero") gets the full treatment: the shared ray-traced lens/disc/jet
 * renderer (src/render/blackhole), the companion star as a resolved sphere and the mass-transfer stream.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { PointStarMaterial } from '../../render/materials/PointStarMaterial';
import { BlackHoleLens, type BlackHoleLensParams } from '../../render/blackhole/lens';
import { blackbodyLinearSrgb } from '../../render/glsl/blackbody';
import { companionId, type BlackHoleModel } from './catalog';
import { createCompanionMesh, createMassStream } from './companion';
import type { BlackHoleEntities } from './entities';

export interface BlackHoleLayer extends Layer {
  /** Hero system this frame (nearest to the camera), or null. */
  readonly hero: BlackHoleModel | null;
  /** Camera distance from the hero black hole, m. */
  readonly heroDistanceM: number;
  /** Simulation time of the last update (Unix ms). */
  readonly timeMs: number;
  readonly lens: BlackHoleLens;
  setModels(models: readonly BlackHoleModel[], ents: BlackHoleEntities): void;
  /** Companion minus black hole at time t (m, ICRS); false when the system has no companion orbit. */
  companionOffset(id: string, timeMs: number, out: THREE.Vector3): boolean;
}

/** Companion surface intensity (linear HDR): low enough that limb darkening and mottling survive the tone mapping; strongly compressed T dependence. */
const starIntensity = (teffK: number): number => 12 * Math.pow(teffK / 5772, 0.5);

export function createBlackHoleLayer(): BlackHoleLayer {
  let svc: EngineServices | null = null;
  let models: readonly BlackHoleModel[] = [];
  let ents: BlackHoleEntities | null = null;
  const lens = new BlackHoleLens();
  const comp = createCompanionMesh();
  const stream = createMassStream();
  let pts: THREE.Points<THREE.BufferGeometry, PointStarMaterial> | null = null;
  let ptsPos: THREE.BufferAttribute | null = null;
  let ptsMag: THREE.BufferAttribute | null = null;
  let compIndex: number[] = [];
  let absMags: number[] = [];
  let hero: BlackHoleModel | null = null;
  let heroDist = Infinity;
  let elapsed = 0;
  let lastTimeMs = Date.now();

  const bhW: THREE.Vector3[] = [];
  const starW: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  const toBh = new THREE.Vector3();
  const uAx = new THREE.Vector3();
  const wAx = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const rgb = { r: 0, g: 0, b: 0 };
  const params: BlackHoleLensParams = {
    key: '', rsM: 1, spin: 0, normal: new THREE.Vector3(0, 0, 1), disc: null, jet: null, star: null,
  };
  const lensStar = { centerWorld: new THREE.Vector3(), radiusM: 1, colorHdr: new THREE.Vector3() };
  const lensDisc: { outerRs: number; displayPeakK: number; gain: number; intensityExponent?: number } = { outerRs: 30, displayPeakK: 9000, gain: 4 };
  const lensJet: { beta: number; gain: number; width: number; lengthRs: number; baseRs?: number; fadeInRs?: number; ribbonGain?: number; axis: THREE.Vector3 } = { beta: 0.9, gain: 1, width: 0.3, lengthRs: 1e4, axis: new THREE.Vector3() };
  const hideInCapture: THREE.Object3D[] = [comp.mesh, stream.points];

  function buildPoints(): void {
    if (!svc) return;
    if (pts) { pts.removeFromParent(); pts.geometry.dispose(); pts.material.dispose(); pts = null; }
    compIndex = [];
    absMags = [];
    models.forEach((m, i) => { if (m.companion) { compIndex.push(i); absMags.push(m.companion.absMagV); } });
    if (!compIndex.length) return;
    const n = compIndex.length;
    const geo = new THREE.BufferGeometry();
    ptsPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    ptsPos.setUsage(THREE.DynamicDrawUsage);
    ptsMag = new THREE.BufferAttribute(new Float32Array(absMags), 1);
    ptsMag.setUsage(THREE.DynamicDrawUsage);
    const teff = new Float32Array(compIndex.map((i) => models[i].companion!.teffK));
    geo.setAttribute('position', ptsPos);
    geo.setAttribute('aMag', ptsMag);
    geo.setAttribute('aTeff', new THREE.BufferAttribute(teff, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
    const mat = new PointStarMaterial({ magnitudeMode: 'absolute', limitMag: 9, exposure: 20 });
    pts = new THREE.Points(geo, mat);
    pts.name = 'blackhole-companions';
    pts.frustumCulled = false;
    svc.groups.far.add(pts);
  }

  return {
    id: 'blackholes',
    get hero() { return hero; },
    get heroDistanceM() { return heroDist; },
    get timeMs() { return lastTimeMs; },
    lens,

    companionOffset(id, timeMs, out) {
      const m = models.find((x) => x.id === id || x.raw.id === id);
      if (!m || !m.binary || !ents) return false;
      ents.bhPosition(m, timeMs, v);
      ents.starPosition(m, timeMs, out);
      out.sub(v);
      return true;
    },

    setModels(next, e) {
      models = next;
      ents = e;
      bhW.length = 0;
      starW.length = 0;
      for (let i = 0; i < models.length; i++) { bhW.push(new THREE.Vector3()); starW.push(new THREE.Vector3()); }
      buildPoints();
    },

    init(s: EngineServices): void {
      svc = s;
      lens.init(s);
      s.groups.main.add(comp.mesh);
      s.groups.transparent.add(stream.points);
      buildPoints();
    },

    update(ctx: FrameContext): void {
      if (!svc || !ents || !models.length) { lens.hide(); return; }
      if (!ctx.reducedMotion) elapsed += ctx.dtRealSec;
      const cam = ctx.cameraPosition;
      const t = ctx.timeMs;
      lastTimeMs = t;
      hero = null;
      heroDist = Infinity;
      let heroIdx = -1;
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        ents.bhPosition(m, t, bhW[i]);
        if (m.binary) ents.starPosition(m, t, starW[i]);
        const d = bhW[i].distanceTo(cam);
        if (d < heroDist) { heroDist = d; heroIdx = i; }
      }
      hero = heroIdx >= 0 ? models[heroIdx] : null;

      // Companion points (absolute magnitudes; hidden when the hero's star is resolved).
      if (pts && ptsPos && ptsMag) {
        const inv = 1 / ctx.metersPerUnit;
        pts.material.setMetersPerUnit(ctx.metersPerUnit);
        pts.material.setPixelRatio(ctx.viewport.pixelRatio);
        const arr = ptsPos.array as Float32Array;
        const mags = ptsMag.array as Float32Array;
        for (let k = 0; k < compIndex.length; k++) {
          const i = compIndex[k];
          const s = starW[i];
          arr[k * 3] = (s.x - cam.x) * inv;
          arr[k * 3 + 1] = (s.y - cam.y) * inv;
          arr[k * 3 + 2] = (s.z - cam.z) * inv;
          const rad = models[i].companion!.radiusM;
          const px = ctx.pixelDiameter(rad, s.distanceTo(cam));
          mags[k] = px > 4 ? 99 : absMags[k];
        }
        ptsPos.needsUpdate = true;
        ptsMag.needsUpdate = true;
      }

      comp.mesh.visible = false;
      stream.points.visible = false;
      if (!hero) { lens.hide(); return; }
      const m = hero;
      const bh = bhW[heroIdx];
      const inv = 1 / ctx.metersPerUnit;

      // Companion sphere.
      const c = m.companion;
      if (c && m.binary) {
        const s = starW[heroIdx];
        const dS = s.distanceTo(cam);
        if (ctx.pixelDiameter(c.radiusM, dS) > 2) {
          ctx.toRender(s, v);
          toBh.subVectors(bh, s).normalize();
          comp.set(c.teffK, starIntensity(c.teffK), c.rocheFill, c.radiusM > 5e9 ? 14 : 22);
          comp.update(v, c.radiusM * inv, toBh, ctx.cameraQuaternion, elapsed);
          comp.mesh.visible = true;
        }
        // Mass-transfer stream, in units of the separation.
        if (m.stream && m.disc) {
          const sep = s.distanceTo(bh);
          if (ctx.pixelDiameter(sep, heroDist) > 30) {
            uAx.subVectors(s, bh).divideScalar(sep);
            wAx.crossVectors(m.normal, uAx).normalize();
            const q = c.massMsun / m.massMsun;
            const l1 = Math.min(0.75, Math.max(0.25, 0.5 - 0.227 * Math.log10(q)));
            const starEdge = 1 - c.radiusM / sep;
            ctx.toRender(bh, v);
            stream.update({
              bhRender: v, u: uAx, w: wAx, n: m.normal, aUnits: sep * inv, l1: m.stream === 'wind' ? starEdge : l1,
              discR: (m.disc.outerRs * m.rsM) / sep, wind: m.stream === 'wind', timeSec: elapsed,
              pixelRatio: ctx.viewport.pixelRatio, pxPerUnit: ctx.pixelsPerRadian,
              gain: m.raw.accretionState === 'persistent' ? 9 : 3,
            });
            stream.points.visible = true;
          }
        }
      }

      // Lens + disc + jets.
      params.key = m.id;
      params.rsM = m.rsM;
      params.spin = m.spin;
      params.normal.copy(m.normal);
      if (m.disc) {
        lensDisc.outerRs = m.disc.outerRs;
        lensDisc.displayPeakK = m.disc.displayPeakK;
        lensDisc.gain = m.disc.gain;
        lensDisc.intensityExponent = m.disc.intensityExponent;
        params.disc = lensDisc;
      } else params.disc = null;
      if (m.jet) {
        lensJet.beta = m.jet.beta;
        lensJet.gain = m.jet.gain;
        lensJet.width = m.jet.width;
        lensJet.lengthRs = m.jet.lengthRs;
        lensJet.baseRs = m.jet.baseRs;
        lensJet.fadeInRs = m.jet.fadeInRs;
        lensJet.ribbonGain = m.jet.ribbonGain;
        lensJet.axis.copy(m.jet.axis);
        params.jet = lensJet;
      } else params.jet = null;
      if (c && m.binary) {
        lensStar.centerWorld.copy(starW[heroIdx]);
        lensStar.radiusM = c.radiusM;
        blackbodyLinearSrgb(c.teffK, rgb);
        const k = starIntensity(c.teffK) * 0.92;
        lensStar.colorHdr.set(rgb.r * k, rgb.g * k, rgb.b * k);
        params.star = lensStar;
      } else params.star = null;
      params.maxRadiusM = m.maxProxyM ?? undefined;
      lens.update(ctx, bh, params, hideInCapture);
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ents) return;
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        const focused = m.id === ctx.selectedId || m.id === ctx.hoveredId || m.id === ctx.focusEntityId;
        const d = bhW[i].distanceTo(ctx.cameraPosition);
        const galactic = m.raw.class === 'stellar-xrb' || m.raw.class === 'stellar-dormant';
        const near = d < 2e6 * m.rsM + (m.binary ? m.binary.aM * 40 : 0);
        const show = focused || near || (galactic && ctx.scaleLog10 > 16.5 && ctx.scaleLog10 < 21.3);
        if (!show) continue;
        ctx.project(bhW[i], sp);
        if (!sp.visible) continue;
        out.push({ entityId: m.id, text: m.raw.name, x: sp.x, y: sp.y, priority: m.raw.class === 'supermassive' ? 60 : 50 + (focused ? 100 : 0), kind: 'landmark', offsetPx: 10 });
        if (m.companion && near && hero === m) {
          ctx.project(starW[i], sp);
          if (sp.visible) out.push({ entityId: companionId(m.raw), text: m.companion.name, x: sp.x, y: sp.y, priority: 35, kind: 'star', offsetPx: 8 + ctx.pixelDiameter(m.companion.radiusM, sp.depthM) / 2 });
        }
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        ctx.project(bhW[i], sp);
        if (sp.visible) {
          const d = Math.hypot(sp.x - x, sp.y - y);
          const rPx = Math.max(radiusPx, ctx.pixelDiameter(3 * m.rsM, Math.max(sp.depthM, 1)) / 2);
          if (d <= rPx) hits.push({ entityId: m.id, distancePx: d, depthM: sp.depthM, priority: 60 });
        }
        if (m.companion) {
          ctx.project(starW[i], sp);
          if (!sp.visible) continue;
          const d = Math.hypot(sp.x - x, sp.y - y);
          const rPx = Math.max(radiusPx, ctx.pixelDiameter(m.companion.radiusM, Math.max(sp.depthM, 1)) / 2);
          if (d <= rPx) hits.push({ entityId: companionId(m.raw), distancePx: d, depthM: sp.depthM, priority: 40 });
        }
      }
      return hits;
    },

    dispose(): void {
      lens.dispose();
      comp.mesh.removeFromParent();
      comp.dispose();
      stream.points.removeFromParent();
      stream.dispose();
      if (pts) { pts.removeFromParent(); pts.geometry.dispose(); pts.material.dispose(); pts = null; }
      svc = null;
    },
  };
}
