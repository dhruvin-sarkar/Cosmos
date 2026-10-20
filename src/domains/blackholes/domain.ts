/**
 * Black-holes domain: the nearest and most famous stellar-mass black holes (Gaia BH1–3, Cygnus X-1, V404 Cygni,
 * A0620-00, GRS 1915+105, GRO J1655-40, XTE J1118+480, MAXI J1820+070), the supermassive M31* and M87* on their host
 * galaxies, and GW150914, with ray-traced lensing, accretion discs, jets, companion stars and an approach readout.
 * Entity ids 'bh:<catalogue id>' and 'bh:<id>:companion'. Auto-discovered by src/domains/index.ts.
 */
import * as THREE from 'three';
import type { DiscoveredDomain } from '../index';
import type { CameraViewState } from '../../core/types';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { buildModel, entityId, loadCatalogue, type BlackHoleModel } from './catalog';
import { createBlackHoleEntities, makeContext } from './entities';
import { createBlackHoleLayer, type BlackHoleLayer } from './layer';
import { createReadout, type Readout } from './readout';

/** Catalogue ids (kept in sync with public/data/blackholes/blackholes.json; tests check it). */
export const BLACKHOLE_IDS = [
  'gaia-bh1', 'gaia-bh2', 'gaia-bh3', 'cygnus-x1', 'v404-cygni', 'a0620-00', 'grs1915', 'gro-j1655', 'xte-j1118',
  'maxi-j1820', 'm31', 'm87', 'gw150914',
] as const;

export const domain: DiscoveredDomain = {
  id: 'blackholes',
  order: 24,
  provides: BLACKHOLE_IDS.map((id) => entityId({ id })),
  create: (ctx) => {
    const layer = createBlackHoleLayer();
    let readout: Readout | null = null;
    let models: BlackHoleModel[] = [];
    const readoutLayer: Layer = {
      id: 'blackholes-readout',
      init(svc: EngineServices) {
        readout = createReadout(svc.renderer.domElement.parentElement, svc.store);
      },
      update(f: FrameContext) {
        readout?.update(layer.hero, layer.heroDistanceM, f.dtRealSec);
      },
      dispose() {
        readout?.dispose();
        readout = null;
      },
    };
    void loadCatalogue().then((cat) => {
      models = cat.objects.map(buildModel);
      const ents = createBlackHoleEntities(models, makeContext(cat), ctx.registry);
      for (const e of ents.entities) ctx.registry.register(e);
      layer.setModels(models, ents);
      if (typeof window !== 'undefined') (window as unknown as { __blackholes?: unknown }).__blackholes = { layer, models, catalogue: cat, view: (id: string, o: ViewOpts = {}) => blackHoleView(models, id, o, layer) };
    }).catch((err: unknown) => {
      console.warn('[blackholes] catalogue failed to load', err);
    });
    return { layers: [layer, readoutLayer], entities: [], providers: [] };
  },
};

export interface ViewOpts {
  /** Angle between the view direction and the disc axis, degrees (90 = edge-on). Default 80. */
  inclinationDeg?: number;
  /** Azimuth around the axis from the direction of the companion (or Earth), degrees. Default 30. */
  azimuthDeg?: number;
  /** Camera distance in Schwarzschild radii (default 30) or metres when `distanceM` is given. */
  distanceRs?: number;
  distanceM?: number;
  /** Look at a point this many r_s to the camera's right of the hole (frames the hole off-centre). */
  lookOffsetRs?: number;
  /** Use the line of sight from Earth instead of inclination/azimuth. */
  fromEarth?: boolean;
  /** Put the companion star exactly behind the hole (Einstein ring); needs `layer`. */
  behindCompanion?: boolean;
  /** Frame the hole and its companion together (aim between them); needs `layer`. */
  frameSystem?: boolean;
}

const tmpOff = new THREE.Vector3();

/** Camera view for tours and screenshots: the black hole `bh:<id>` seen at a chosen inclination and distance. */
export function blackHoleView(
  models: readonly BlackHoleModel[], id: string, o: ViewOpts = {}, layer?: Pick<BlackHoleLayer, 'companionOffset' | 'timeMs'>, timeMs = layer?.timeMs ?? Date.now(),
): CameraViewState | null {
  const m = models.find((x) => x.id === id || x.raw.id === id);
  if (!m) return null;
  const hasOff = !!layer && (o.behindCompanion || o.frameSystem) && layer.companionOffset(m.id, timeMs, tmpOff);
  const n = m.normal.clone();
  const ref = m.binary ? m.binary.P.clone() : m.bary.clone().negate().normalize();
  ref.addScaledVector(n, -ref.dot(n)).normalize();
  const ref2 = new THREE.Vector3().crossVectors(n, ref);
  const inc = ((o.inclinationDeg ?? 80) * Math.PI) / 180;
  const az = ((o.azimuthDeg ?? 30) * Math.PI) / 180;
  const dir = hasOff && o.behindCompanion
    ? tmpOff.clone().negate().normalize()
    : o.fromEarth
    ? m.bary.clone().negate().normalize()
    : n.clone().multiplyScalar(Math.cos(inc)).addScaledVector(ref, Math.sin(inc) * Math.cos(az)).addScaledVector(ref2, Math.sin(inc) * Math.sin(az)).normalize();
  const dist = o.distanceM ?? (o.distanceRs ?? 30) * m.rsM;
  const eye = dir.clone().multiplyScalar(dist);
  const up = n.clone().addScaledVector(dir, -n.dot(dir));
  if (up.lengthSq() < 1e-8) up.set(0, 0, 1);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, dir).negate().normalize();
  const target = right.multiplyScalar((o.lookOffsetRs ?? 0) * m.rsM);
  if (hasOff && o.frameSystem) target.addScaledVector(tmpOff, 0.5);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, up));
  return { anchorId: m.id, offset: [eye.x, eye.y, eye.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: m.id, scaleLog10: Math.log10(dist * 1.2) };
}
