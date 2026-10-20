/**
 * Shared runtime of the exoplanets domain: cached system models, host positions (the stars domain's catalogue position
 * when the host is a HYG star, so the system sits exactly on the star the sky draws; else the archive position), true
 * planet / companion positions, and the domain's single exhibition-scale function.
 */
import * as THREE from 'three';
import { PC_M } from '../../core/units';
import type { EntityRegistry } from '../../core/entity';
import { bodyScale, getScaleView } from '../../core/visualScale';
import type { ExoCatalog } from './catalog';
import { applyFrame, orbitOffset, systemModel, type PlanetModel, type SystemModel } from './physics';
import { showcaseExtras } from './showcase';

const models = new Map<number, SystemModel>();
const hostPos = new Map<number, THREE.Vector3>();
let registry: EntityRegistry | null = null;
const v3 = { x: 0, y: 0, z: 0 };
const binaryOrbits = new WeakMap<SystemModel, Parameters<typeof orbitOffset>[0]>();

export function setExoRegistry(r: EntityRegistry): void {
  registry = r;
}

export function getSystemModel(c: ExoCatalog, host: number): SystemModel {
  let m = models.get(host);
  if (!m) {
    m = systemModel(c, host, showcaseExtras(c.hosts.name[host]));
    models.set(host, m);
  }
  return m;
}

/** Whether a host can be placed in 3-D. */
export function hostPlaceable(c: ExoCatalog, host: number): boolean {
  return Number.isFinite(c.hosts.xPc[host]);
}

/** Host (system barycentre) world position, ICRS m rel. SSB. Static; resolved once. */
export function hostPosition(c: ExoCatalog, host: number, out: THREE.Vector3): THREE.Vector3 {
  let p = hostPos.get(host);
  if (!p) {
    p = new THREE.Vector3(c.hosts.xPc[host] * PC_M, c.hosts.yPc[host] * PC_M, c.hosts.zPc[host] * PC_M);
    const hip = c.hosts.hip[host];
    if (hip > 0 && registry) {
      try {
        const star = registry.get(`star:hip:${hip}`);
        if (star) {
          star.position(0, out);
          // Accept the HYG position only when it agrees with the archive (guards against a wrong cross-match).
          if (Number.isFinite(out.x) && out.distanceTo(p) < 0.05 * p.length() + 0.02 * PC_M) p.copy(out);
        }
      } catch {
        /* keep the archive position */
      }
      // Only cache once the stars provider could answer (it registers after its detail tables load).
      if (!registry.get(`star:hip:${hip}`)) return out.copy(p);
    }
    hostPos.set(host, p);
  }
  return out.copy(p);
}

/** Planet offset from the system barycentre (ICRS m) at tMs. */
export function planetOffset(m: SystemModel, p: PlanetModel, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  if (!p.placeable) return out.set(0, 0, 0);
  orbitOffset(p, tMs, v3);
  applyFrame(m.frame, v3.x, v3.y, v3.z, v3);
  return out.set(v3.x, v3.y, v3.z);
}

/** Offsets of the primary (out0) and the companion (out1) from the barycentre; out1 = out0 = 0 without a companion. */
export function starOffsets(m: SystemModel, tMs: number, out0: THREE.Vector3, out1: THREE.Vector3): void {
  const c = m.companion;
  if (!c) {
    out0.set(0, 0, 0);
    out1.set(0, 0, 0);
    return;
  }
  let o = binaryOrbits.get(m);
  if (!o) {
    o = { ...c, raanRad: m.raanRad };
    binaryOrbits.set(m, o);
  }
  orbitOffset(o, tMs, v3);
  applyFrame(m.frame, v3.x, v3.y, v3.z, v3);
  out0.set(-c.massFraction * v3.x, -c.massFraction * v3.y, -c.massFraction * v3.z);
  out1.set((1 - c.massFraction) * v3.x, (1 - c.massFraction) * v3.y, (1 - c.massFraction) * v3.z);
}

/**
 * The domain's ONE exhibition-scale function (docs/design/VISUAL_SCALE.md): planets and host stars use the shared
 * bodyScale law with an explicit clearance cap, weighted by the global True-scale / Exhibition blend.
 */
export function exhibitFactor(radiusM: number, kind: 'planet' | 'star', cameraDistanceM: number, maxDrawnRadiusM: number): number {
  const v = getScaleView();
  if (!(v.weight > 0)) return 1;
  const f = bodyScale(radiusM, kind, cameraDistanceM, v.viewportHeightPx, v.fovYRad, {
    maxFactor: Math.max(1, maxDrawnRadiusM / radiusM),
  });
  return 1 + (f - 1) * v.weight;
}

export function clearExoRuntime(): void {
  models.clear();
  hostPos.clear();
}
