/**
 * The star field: ~109k HYG v4.4 stars at their 3-D catalogue positions, drawn as photometric point sources whose
 * apparent magnitude is computed from the CURRENT camera position (StarFieldMaterial), so the sky changes as you
 * fly. Two clouds share one material:
 *  - "near": every star within 25 pc of the Sun, always drawn (red dwarfs such as Proxima are far down the
 *    brightest-first list but matter as soon as you travel);
 *  - "field": the rest, brightest-first, limited to QualityProfile.starBudget (a prefix is a valid LOD subset).
 * Plus the Sun itself as a point star once the camera is beyond the heliosphere (the solar domain draws it inside).
 *
 * Close-ups: the few stars whose point intensity crosses the handover range get the same treatment as the Sun in
 * the solar domain — an HDR photosphere (render-kit StarSurfaceMaterial; Teff colour, derived radius) and a glare
 * sprite while the disc is unresolved — and their point fades out.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, ScreenPoint } from '../../core/types';
import { AU_M, PC_M, R_SUN_M } from '../../core/units';
import { ChunkedPointCloud, splitOctree } from '../../render/chunkedPoints';
import { blackbodyLinearSrgb } from '../../render/glsl/blackbody';
import { GlowSprite } from '../../render/materials/GlowSpriteMaterial';
import { StarSurfaceMaterial } from '../../render/materials/StarSurfaceMaterial';
import { formatDistance } from '../../data/format';
import type { StarCatalog } from './catalog';
import { displayName, indexForStarId, starIdForIndex } from './ids';
import {
  HANDOVER_END,
  HANDOVER_START,
  SUN_ABS_MAG_V,
  SUN_TEFF_K,
  skyExposureForScale,
  starIntensity,
  type SkyExposure,
} from './photometry';
import type { StarsRuntime } from './runtime';
import { StarFieldMaterial } from './starFieldMaterial';
import { backgroundLift } from '../../render/post/exposure';

const NEAR_PC = 25;
const CLOSEUP_SLOTS = 3;
/** Sun's surface radiance in the solar domain (sunLayer SUN_DISC_INTENSITY); other photospheres scale from it. */
const SUN_DISC_INTENSITY = 14;
/** Keep the k-scaled far field inside the camera far plane (1e15 render units). */
const MAX_RENDER_DEPTH = 2e14;
const CATALOG_MAX_PC = 1100;

interface Slot {
  index: number;
  intensity: number;
  mesh: THREE.Mesh<THREE.SphereGeometry, StarSurfaceMaterial>;
  glare: GlowSprite;
  veil: GlowSprite;
  world: THREE.Vector3;
  px: number;
}

export interface StarsLayerOptions {
  runtime: StarsRuntime;
  /** Called once the detail tables are loaded (register providers, etc.). */
  onDetails?(svc: EngineServices): void;
}

export interface StarsLayerDebug {
  readonly drawn: number;
  readonly closeups: readonly number[];
  /** Stars examined by the last close-up scan. */
  scanned: number;
  ms: { clouds: number; scan: number; slots: number };
  exposure: SkyExposure;
}

export function createStarsLayer(opts: StarsLayerOptions): Layer & { debug: StarsLayerDebug } {
  const rt = opts.runtime;
  const material = new StarFieldMaterial();
  const sunMaterial = new StarFieldMaterial({ nearFade: false });
  let field: ChunkedPointCloud | null = null;
  let near: ChunkedPointCloud | null = null;
  /** field-cloud local index → catalogue index. */
  let fieldToGlobal: Uint32Array = new Uint32Array(0);
  let nearToGlobal: Uint32Array = new Uint32Array(0);
  let cat: StarCatalog | null = null;
  /** 10^(−0.4 M) per star: I = E·10^(0.4 refMag)·100·lumF / d_pc², so the near-star test needs no log/pow. */
  let lumF = new Float32Array(0);
  /** Flat chunk list for the close-up scan (global star indices, bounding sphere, brightest member). */
  const scanChunks: { x: number; y: number; z: number; r: number; maxLum: number; ids: Uint32Array }[] = [];
  let svcRef: EngineServices | null = null;
  const exposure: SkyExposure = { refMag: 0, exposure: 20, limitMag: 7, limitSoftness: 1.2, opacity: 1 };

  // Sun as a point star (beyond the heliosphere).
  const sunGeom = new THREE.BufferGeometry();
  sunGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  sunGeom.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array([SUN_ABS_MAG_V]), 1));
  sunGeom.setAttribute('aTeff', new THREE.BufferAttribute(new Float32Array([SUN_TEFF_K]), 1));
  sunGeom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const sunPoint = new THREE.Points(sunGeom, sunMaterial);
  sunPoint.frustumCulled = false;
  sunPoint.name = 'stars:sun-point';
  const sunWorld = new THREE.Vector3();

  // Close-up slots.
  const sphere = new THREE.SphereGeometry(1, 96, 48);
  const slots: Slot[] = [];
  for (let s = 0; s < CLOSEUP_SLOTS; s++) {
    const mat = new StarSurfaceMaterial({ teffK: 5772, intensity: SUN_DISC_INTENSITY });
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = `stars:closeup-${s}`;
    const glare = new GlowSprite({ intensity: 3, coreFraction: 0.1, minRadiusPx: 26 });
    const veil = new GlowSprite({ intensity: 0.12, coreFraction: 0.18, minRadiusPx: 70 });
    glare.visible = veil.visible = false;
    slots.push({ index: -1, intensity: 0, mesh, glare, veil, world: new THREE.Vector3(), px: 0 });
  }
  // Candidate buffers for the close-up search (no per-frame allocation).
  const candIdx = new Int32Array(CLOSEUP_SLOTS);
  const candI = new Float64Array(CLOSEUP_SLOTS);
  const tmpColor = { r: 0, g: 0, b: 0 };

  // Labels / picking scratch.
  let labelIdx = new Int32Array(0);
  let labelText: string[] = [];
  let labelId: string[] = [];
  const labelPool: LabelCandidate[] = [];
  const tmpV = new THREE.Vector3();
  const screen: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  let budget = 80_000;
  const debug: StarsLayerDebug = {
    get drawn() {
      return (field?.drawnCount ?? 0) + (near?.drawnCount ?? 0);
    },
    get closeups() {
      return slots.filter((s) => s.index >= 0).map((s) => s.index);
    },
    exposure,
    scanned: 0,
    ms: { clouds: 0, scan: 0, slots: 0 },
  };

  const buildLabels = (): void => {
    const d = cat?.details;
    if (!cat || !d) return;
    const idx: number[] = [];
    const text: string[] = [];
    const ids: string[] = [];
    for (const row of d.named) {
      if (!row.properName || row.index === null) continue;
      const id = starIdForIndex(cat, row.index);
      if (!id) continue;
      idx.push(row.index);
      text.push(row.properName);
      ids.push(id);
    }
    labelIdx = Int32Array.from(idx);
    labelText = text;
    labelId = ids;
  };

  const appMagFrom = (i: number, cam: THREE.Vector3): number => {
    const p = cat!.positionsM;
    const d = Math.hypot(p[3 * i] - cam.x, p[3 * i + 1] - cam.y, p[3 * i + 2] - cam.z) / PC_M;
    return cat!.absMag[i] + 5 * Math.log10(Math.max(d, 1e-14)) - 5;
  };

  const worldOf = (i: number, out: THREE.Vector3): THREE.Vector3 =>
    out.set(cat!.positionsM[3 * i], cat!.positionsM[3 * i + 1], cat!.positionsM[3 * i + 2]);

  function buildClouds(svc: EngineServices, c: StarCatalog): void {
    const n = c.count;
    let nNear = 0;
    for (let i = 0; i < n; i++) if (c.distPc[i] < NEAR_PC) nNear++;
    const nField = n - nNear;
    const split = (wantNear: boolean, m: number) => {
      const map = new Uint32Array(m);
      const pos = new Float64Array(3 * m);
      const mag = new Float32Array(m);
      const teff = new Float32Array(m);
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (c.distPc[i] < NEAR_PC !== wantNear) continue;
        map[k] = i;
        pos[3 * k] = c.positionsM[3 * i];
        pos[3 * k + 1] = c.positionsM[3 * i + 1];
        pos[3 * k + 2] = c.positionsM[3 * i + 2];
        mag[k] = c.absMag[i];
        teff[k] = c.teffK[i];
        k++;
      }
      const cloud = new ChunkedPointCloud({
        positionsM: pos,
        attributes: { aMag: { array: mag, itemSize: 1 }, aTeff: { array: teff, itemSize: 1 } },
        absMag: mag,
        material,
        // Field chunks of 16k points: ~4x fewer draw calls than 4k (CPU submission cost), culling granularity is irrelevant
        // from inside the Solar System where every chunk surrounds the camera (perf).
        targetPointsPerChunk: wantNear ? 512 : 16384,
      });
      return { cloud, map };
    };
    const f = split(false, nField);
    const nr = split(true, nNear);
    field = f.cloud;
    fieldToGlobal = f.map;
    near = nr.cloud;
    nearToGlobal = nr.map;
    field.object.name = 'stars:field';
    near.object.name = 'stars:near';
    svc.groups.far.add(field.object, near.object);
    // A finer octree than the render chunks keeps the per-frame close-up scan to a few hundred stars.
    const all = new Uint32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    const leaves: Uint32Array[] = [];
    splitOctree(c.positionsM, all, 192, 0, leaves);
    const P = c.positionsM;
    for (const ids of leaves) {
      let sx = 0, sy = 0, sz = 0, maxLum = 0;
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        sx += P[3 * i];
        sy += P[3 * i + 1];
        sz += P[3 * i + 2];
        maxLum = Math.max(maxLum, lumF[i]);
      }
      const x = sx / ids.length, y = sy / ids.length, z = sz / ids.length;
      let r2 = 0;
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        r2 = Math.max(r2, (P[3 * i] - x) ** 2 + (P[3 * i + 1] - y) ** 2 + (P[3 * i + 2] - z) ** 2);
      }
      scanChunks.push({ x, y, z, r: Math.sqrt(r2), maxLum, ids });
    }
  }

  function updateCloseups(ctx: FrameContext): void {
    const t0 = performance.now();
    debug.scanned = 0;
    candIdx.fill(-1);
    candI.fill(0);
    const cam = ctx.cameraPosition;
    const thresh = HANDOVER_START * 0.5;
    // I = kI · lumF / d² (d in metres); a star qualifies when lumF · kI / thresh > d².
    const kI = exposure.exposure * Math.pow(10, 0.4 * exposure.refMag) * 100 * PC_M * PC_M;
    const kT = kI / thresh;
    if (cat && field && near && exposure.opacity > 0.001) {
      const p = cat.positionsM;
      const lf = lumF;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (let c = 0; c < scanChunks.length; c++) {
        const ch = scanChunks[c];
        const dc = Math.hypot(ch.x - cx, ch.y - cy, ch.z - cz) - ch.r;
        if (dc > 0 && dc * dc > ch.maxLum * kT) continue;
        const ids = ch.ids;
        debug.scanned += ids.length;
        for (let k = 0; k < ids.length; k++) {
          const i = ids[k];
          const dx = p[3 * i] - cx, dy = p[3 * i + 1] - cy, dz = p[3 * i + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz + 1;
          const l = lf[i];
          if (l * kT < d2) continue;
          const I = (kI * l) / d2;
          if (I <= candI[CLOSEUP_SLOTS - 1]) continue;
          let j = CLOSEUP_SLOTS - 1;
          while (j > 0 && candI[j - 1] < I) {
            candI[j] = candI[j - 1];
            candIdx[j] = candIdx[j - 1];
            j--;
          }
          candI[j] = I;
          candIdx[j] = i;
        }
      }
    }
    const t1 = performance.now();
    debug.ms.scan = t1 - t0;
    // Keep slot assignment stable: a star keeps its slot while it stays a candidate.
    for (const s of slots) {
      let keep = -1;
      for (let j = 0; j < CLOSEUP_SLOTS; j++) if (candIdx[j] === s.index) keep = j;
      if (keep < 0) s.index = -1;
      else {
        s.intensity = candI[keep];
        candIdx[keep] = -2;
      }
    }
    for (let j = 0; j < CLOSEUP_SLOTS; j++) {
      if (candIdx[j] < 0) continue;
      const free = slots.find((s) => s.index < 0);
      if (!free) break;
      free.index = candIdx[j];
      free.intensity = candI[j];
      const t = cat!.teffK[free.index] > 0 ? cat!.teffK[free.index] : SUN_TEFF_K;
      free.mesh.material.teffK = t;
      // V-band surface brightness relative to the Sun: 10^(−0.4 (M_V − M_V☉)) / (R/R☉)².
      const R = cat!.radiusRsun[free.index];
      const sb = Math.pow(10, -0.4 * (cat!.absMag[free.index] - SUN_ABS_MAG_V)) / (R * R);
      free.mesh.material.intensity = THREE.MathUtils.clamp(SUN_DISC_INTENSITY * sb, 0.5, 400);
      blackbodyLinearSrgb(t, tmpColor);
      free.glare.material.uniforms.uColor.value.setRGB(tmpColor.r, tmpColor.g, tmpColor.b);
      free.veil.material.uniforms.uColor.value.setRGB(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    for (const s of slots) {
      if (s.index < 0) {
        s.mesh.visible = s.glare.visible = s.veil.visible = false;
        continue;
      }
      worldOf(s.index, s.world);
      const R = cat!.radiusRsun[s.index] * R_SUN_M;
      const dist = Math.max(s.world.distanceTo(cam), 1);
      s.px = ctx.pixelDiameter(R, dist);
      const rUnits = R / ctx.metersPerUnit;
      ctx.toRender(s.world, s.mesh.position);
      s.mesh.visible = s.px > 0.6;
      if (s.mesh.visible) {
        s.mesh.scale.setScalar(rUnits);
        s.mesh.material.setTime(ctx.timeMs / 1000);
      }
      const handover = THREE.MathUtils.smoothstep(s.intensity, HANDOVER_START, HANDOVER_END);
      const unresolved = 1 - THREE.MathUtils.smoothstep(s.px, 4, 40);
      const w = handover * unresolved * exposure.opacity;
      s.glare.position.copy(s.mesh.position);
      s.veil.position.copy(s.mesh.position);
      s.glare.material.setViewportHeight(ctx.viewport.height);
      s.veil.material.setViewportHeight(ctx.viewport.height);
      s.glare.material.setRadius(rUnits * 2);
      s.veil.material.setRadius(rUnits * 6);
      s.glare.material.uniforms.uOpacity.value = w;
      s.veil.material.uniforms.uOpacity.value = 0.5 * w;
      s.glare.visible = s.veil.visible = w > 0.002;
    }
  }

  const layer: Layer & { debug: StarsLayerDebug } = {
    id: 'stars-field',
    debug,

    async init(svc: EngineServices): Promise<void> {
      svcRef = svc;
      svc.groups.far.add(sunPoint);
      for (const s of slots) {
        svc.groups.main.add(s.mesh);
        svc.groups.transparent.add(s.veil, s.glare);
      }
      const c = await rt.loadCatalog(svc.assets);
      cat = c;
      lumF = new Float32Array(c.count);
      for (let i = 0; i < c.count; i++) lumF[i] = Math.pow(10, -0.4 * c.absMag[i]);
      buildClouds(svc, c);
      // Detail tables (names, HIP index, constellations) load in the background.
      void rt.loadDetails(svc.assets).then(() => {
        buildLabels();
        opts.onDetails?.(svc);
      });
    },

    update(ctx: FrameContext): void {
      skyExposureForScale(ctx.scaleLog10, exposure);
      const cam = ctx.cameraPosition;
      const camR = cam.length();
      const farM = camR + CATALOG_MAX_PC * PC_M;
      const k = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / farM);
      const visible = exposure.opacity > 0.001 && camR < 3 * CATALOG_MAX_PC * PC_M;
      material.setFrame(ctx.metersPerUnit, ctx.viewport.pixelRatio, k, exposure);
      // Bounded dimming: auto exposure pulled far down by a bright body never crushes the star field (exposure.ts).
      material.uniforms.uOpacity.value = exposure.opacity * backgroundLift.value;
      const tc0 = performance.now();
      budget = Math.max(0, ctx.quality.starBudget - (near ? near.count : 0));
      if (field && near && svcRef) {
        field.object.visible = near.object.visible = visible;
        if (visible) {
          field.update(cam, ctx.metersPerUnit, svcRef.camera, { budget, limitMag: exposure.limitMag });
          near.update(cam, ctx.metersPerUnit, svcRef.camera, { limitMag: exposure.limitMag });
        }
      }
      debug.ms.clouds = performance.now() - tc0;
      // The Sun as a star: fades in beyond ~300 AU, where the solar domain's glare hands over.
      const sun = svcRef?.registry.get('sol:sun');
      if (sun) sun.position(ctx.timeMs, sunWorld);
      else sunWorld.set(0, 0, 0);
      const sunAu = sunWorld.distanceTo(cam) / AU_M;
      const sunW = THREE.MathUtils.smoothstep(sunAu, 300, 3000) * exposure.opacity;
      sunPoint.visible = sunW > 0.001;
      if (sunPoint.visible) {
        sunMaterial.setFrame(ctx.metersPerUnit, ctx.viewport.pixelRatio, k, exposure);
        sunMaterial.uniforms.uOpacity.value = sunW;
        ctx.toRender(sunWorld, sunPoint.position);
      }
      const tc = performance.now();
      updateCloseups(ctx);
      debug.ms.slots = performance.now() - tc - debug.ms.scan;
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (!cat || exposure.opacity < 0.05) return [];
      const cam = ctx.cameraPosition;
      let best = -1;
      let bestD = Infinity;
      let bestDepth = 0;
      let bestMag = 99;
      const lim = exposure.limitMag - 0.6;
      const test = (i: number): void => {
        const m = appMagFrom(i, cam);
        if (m > lim) return;
        ctx.project(worldOf(i, tmpV), screen);
        if (!screen.visible) return;
        // Bright stars are easier to hit: they look bigger.
        const reach = radiusPx + Math.max(0, 2.5 - m);
        const d = Math.hypot(screen.x - x, screen.y - y);
        if (d > reach) return;
        const score = d - Math.max(0, 2.5 - m);
        if (score < bestD) {
          bestD = score;
          best = i;
          bestDepth = screen.depthM;
          bestMag = m;
        }
      };
      const nField = Math.min(budget, fieldToGlobal.length);
      for (let k = 0; k < nField; k++) test(fieldToGlobal[k]);
      for (let k = 0; k < nearToGlobal.length; k++) test(nearToGlobal[k]);
      if (best < 0) return [];
      const id = starIdForIndex(cat, best);
      if (!id) return [];
      return [{ entityId: id, distancePx: Math.max(0, bestD), depthM: bestDepth, priority: Math.max(5, 60 - 6 * bestMag) }];
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!cat || exposure.opacity < 0.05) return;
      const cam = ctx.cameraPosition;
      const limit = exposure.limitMag - 4.6;
      let used = 0;
      const push = (i: number, text: string, id: string, m: number, detail: boolean): void => {
        ctx.project(worldOf(i, tmpV), screen);
        if (!screen.visible) return;
        let c = labelPool[used];
        if (!c) {
          c = { entityId: id, text, x: 0, y: 0, priority: 0, kind: 'star' };
          labelPool[used] = c;
        }
        used++;
        c.entityId = id;
        c.text = text;
        c.x = screen.x;
        c.y = screen.y;
        c.priority = Math.max(5, Math.min(75, 52 - 7 * m));
        c.kind = 'star';
        c.offsetPx = 5 + Math.max(0, 2 - m);
        // A resolved photosphere: sit the label beside the disc, not on it.
        for (const sl of slots) if (sl.index === i && sl.mesh.visible) c.offsetPx = Math.max(c.offsetPx, 0.5 * sl.px + 8);
        c.opacity = Math.min(1, (limit + 0.6 - m) / 0.6) * exposure.opacity;
        c.detail = detail ? `${formatDistance(tmpV.distanceTo(cam), { prefer: 'ly' })} · mag ${m.toFixed(2)}` : undefined;
        out.push(c);
      };
      const sel = ctx.selectedId, hov = ctx.hoveredId;
      for (let k = 0; k < labelIdx.length; k++) {
        const i = labelIdx[k];
        const m = appMagFrom(i, cam);
        const id = labelId[k];
        const isSel = id === sel || id === hov;
        if (m > limit && !isSel) continue;
        push(i, labelText[k], id, Math.min(m, limit), isSel);
      }
      // Selected / hovered stars without a proper name.
      for (let pass = 0; pass < 2; pass++) {
        const id = pass === 0 ? sel : hov === sel ? null : hov;
        if (!id || !id.startsWith('star:')) continue;
        const i = indexForStarId(cat, id);
        if (i < 0 || cat.details?.namedByIndex.get(i)?.properName) continue;
        push(i, displayName(cat.details?.namedByIndex.get(i), cat.hipOf[i]), id, Math.min(appMagFrom(i, cam), limit), true);
      }
    },

    dispose(): void {
      field?.dispose();
      near?.dispose();
      sunPoint.removeFromParent();
      sunGeom.dispose();
      material.dispose();
      sunMaterial.dispose();
      for (const s of slots) {
        s.mesh.removeFromParent();
        s.glare.removeFromParent();
        s.veil.removeFromParent();
        s.mesh.material.dispose();
        s.glare.dispose();
        s.veil.dispose();
      }
      sphere.dispose();
    },
  };
  return layer;
}
