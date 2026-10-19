/**
 * Orbital propagation worker: loads the CelesTrak catalog (9 MB JSON, parsed off the main thread), builds an SGP4
 * record for every GP row (satellite.js 7), and on request propagates all of them to one instant and converts each
 * TEME state to perifocal two-body elements in ICRS axes (kepler.ts). The main thread / GPU advances those with
 * Kepler's equation until the next refresh. SATCAT-shape rows get illustrative node / perigee / phase (stable hash).
 */
import { json2satrec, propagate, type SatRec } from 'satellite.js';
import { temeToIcrsMatrix } from '../../core/frames';
import {
  CLASS_PAYLOAD, F, FLAG_ACTIVE, FLAG_NO_ORBIT, FLAG_RECONSTRUCTED, FLAG_STARLINK, classCode, regimeCode,
  type CatalogFile, type CatalogRow, type MetaMessage, type WorkerIn, type WorkerOut,
} from './catalogTypes';
import { ELEMENT_STRIDE, MU_EARTH, classicalToElements, stateToElements } from './kepler';

const ctx = self as unknown as { postMessage(m: WorkerOut, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null };

let rows: CatalogRow[] = [];
let satrecs: (SatRec | null)[] = [];
/** SATCAT-shape: a (m), e, i (rad), node, argp, M at REF_MS, n (rad/s); NaN a = none. */
let shape: Float64Array = new Float64Array(0);
let flags: Uint8Array = new Uint8Array(0);
let ready: Promise<void> | null = null;
const REF_MS = Date.UTC(2026, 0, 1);
const R_KM = 6378.135;
const DEG = Math.PI / 180;
const m = new Float64Array(9);

function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

async function init(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalog ${res.status} ${url}`);
  const cat = (await res.json()) as CatalogFile;
  rows = cat.rows;
  const n = rows.length;
  satrecs = new Array(n).fill(null);
  shape = new Float64Array(n * 7).fill(Number.NaN);
  flags = new Uint8Array(n);
  const meta: MetaMessage = {
    type: 'meta', generated: cat.generated, count: n,
    norad: new Uint32Array(n), flags, regime: new Uint8Array(n), names: new Array<string>(n), epochMs: new Float64Array(n).fill(Number.NaN),
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const norad = String(r[F.norad]);
    const name = String(r[F.name] ?? norad);
    const cls = classCode(r[F.objectClass]);
    let f = cls;
    if (r[F.isActive] === true) f |= FLAG_ACTIVE;
    const groups = r[F.groups] as string[] | null;
    if (cls === CLASS_PAYLOAD && (name.startsWith('STARLINK') || groups?.includes('starlink'))) f |= FLAG_STARLINK;
    const src = r[F.elementSource];
    if (src === 'celestrak-gp') {
      try {
        satrecs[i] = json2satrec({
          OBJECT_NAME: name, OBJECT_ID: String(r[F.intlDes] ?? ''), EPOCH: String(r[F.epochUTC]).replace(/Z$/, ''),
          MEAN_MOTION: r[F.meanMotion] as number, ECCENTRICITY: r[F.ecc] as number, INCLINATION: r[F.inc] as number,
          RA_OF_ASC_NODE: r[F.raan] as number, ARG_OF_PERICENTER: r[F.argp] as number, MEAN_ANOMALY: r[F.meanAnomaly] as number,
          EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: Number(norad), ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
          BSTAR: r[F.bstar] as number, MEAN_MOTION_DOT: r[F.ndot] as number, MEAN_MOTION_DDOT: r[F.nddot] as number,
        });
        meta.epochMs[i] = Date.parse(String(r[F.epochUTC]));
      } catch {
        f |= FLAG_NO_ORBIT;
      }
    } else if (src === 'satcat-shape' && r[F.perigeeKm] != null && r[F.apogeeKm] != null && r[F.inc] != null) {
      const rp = (R_KM + (r[F.perigeeKm] as number)) * 1000, ra = (R_KM + (r[F.apogeeKm] as number)) * 1000;
      const a = (rp + ra) / 2;
      const o = 7 * i;
      shape[o] = a;
      shape[o + 1] = Math.max(0, Math.min(0.95, (ra - rp) / (ra + rp)));
      shape[o + 2] = (r[F.inc] as number) * DEG;
      shape[o + 3] = hash01(norad, 1) * 2 * Math.PI;
      shape[o + 4] = hash01(norad, 2) * 2 * Math.PI;
      shape[o + 5] = hash01(norad, 3) * 2 * Math.PI;
      shape[o + 6] = Math.sqrt(MU_EARTH / (a * a * a));
      f |= FLAG_RECONSTRUCTED;
    } else {
      f |= FLAG_NO_ORBIT;
    }
    flags[i] = f;
    meta.norad[i] = Number(norad);
    meta.names[i] = name;
    meta.regime[i] = regimeCode(r[F.perigeeKm] as number | null, r[F.apogeeKm] as number | null, r[F.ecc] as number | null);
  }
  // Transfer copies of the typed arrays (the worker keeps `flags`).
  ctx.postMessage({ ...meta, flags: flags.slice() });
}

function propagateAll(tMs: number, buf: Float32Array): number {
  temeToIcrsMatrix(tMs, m);
  const date = new Date(tMs);
  let failed = 0;
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const o = i * ELEMENT_STRIDE;
    const rec = satrecs[i];
    if (rec) {
      const pv = propagate(rec, date);
      const p = pv?.position, v = pv?.velocity;
      if (!p || !v || typeof p === 'boolean' || !Number.isFinite(p.x)) {
        buf.fill(0, o, o + ELEMENT_STRIDE);
        failed++;
        continue;
      }
      // TEME km, km/s → ICRS m, m/s.
      const rx = (m[0] * p.x + m[1] * p.y + m[2] * p.z) * 1000;
      const ry = (m[3] * p.x + m[4] * p.y + m[5] * p.z) * 1000;
      const rz = (m[6] * p.x + m[7] * p.y + m[8] * p.z) * 1000;
      const vx = (m[0] * v.x + m[1] * v.y + m[2] * v.z) * 1000;
      const vy = (m[3] * v.x + m[4] * v.y + m[5] * v.z) * 1000;
      const vz = (m[6] * v.x + m[7] * v.y + m[8] * v.z) * 1000;
      if (!stateToElements(rx, ry, rz, vx, vy, vz, buf, o)) failed++;
    } else if (flags[i] & FLAG_RECONSTRUCTED) {
      const s = 7 * i;
      const M = shape[s + 5] + shape[s + 6] * ((tMs - REF_MS) / 1000);
      classicalToElements(shape[s], shape[s + 1], shape[s + 2], shape[s + 3], shape[s + 4], M, buf, o);
    } else {
      buf.fill(0, o, o + ELEMENT_STRIDE);
    }
  }
  return failed;
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    ready = init(msg.url).catch((err: unknown) => {
      ctx.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) });
      throw err;
    });
    return;
  }
  if (!ready) return;
  if (msg.type === 'propagate') {
    void ready.then(() => {
      const need = rows.length * ELEMENT_STRIDE;
      const buf = msg.buf && msg.buf.length === need ? msg.buf : new Float32Array(need);
      const t0 = performance.now();
      const failed = propagateAll(msg.tMs, buf);
      ctx.postMessage({ type: 'elements', t0Ms: msg.tMs, buf, costMs: performance.now() - t0, failed }, [buf.buffer]);
    }, () => undefined);
  } else if (msg.type === 'row') {
    void ready.then(() => ctx.postMessage({ type: 'row', reqId: msg.reqId, row: rows[msg.index] ?? null }), () => undefined);
  }
};

export {};
