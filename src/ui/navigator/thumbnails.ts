/**
 * Small real-texture thumbnails: each body's lowest-tier equirectangular map (from public/textures/index.json) is
 * projected onto a lit sphere in a 2D canvas once and cached as a data URL. Only bodies listed in the index are
 * requested, so a missing map never produces a network error; those bodies get a neutral shaded disc instead.
 * Lighting is a single sun from the upper left (≈ 40° phase): night sides stay black, as in the 3D view.
 */
import type { Entity } from '../../core/entity';

const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
const SIZE = 96; // device pixels (48 CSS px at 2×)
const SAMPLE_W = 256;
const SAMPLE_H = 128;

interface TextureIndex {
  bodies?: Record<string, Record<string, Record<string, string>>>;
}

let indexPromise: Promise<TextureIndex | null> | null = null;
const cache = new Map<string, Promise<string | null>>();
const done = new Map<string, string | null>();

function loadIndex(): Promise<TextureIndex | null> {
  indexPromise ??= fetch(`${BASE}textures/index.json`)
    .then(r => (r.ok ? (r.json() as Promise<TextureIndex>) : null))
    .catch(() => null);
  return indexPromise;
}

/** 'sol:io' → 'io'. */
export function textureKey(entity: Entity): string | null {
  const m = /^sol:([a-z0-9-]+)$/.exec(entity.id);
  return m ? m[1] : null;
}

function lowTier(maps: Record<string, string> | undefined): string | null {
  if (!maps) return null;
  return maps.low ?? maps.high ?? maps.ultra ?? null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`thumbnail: ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray | null {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

// sRGB ↔ linear lookup (8-bit in, linear float out) so the lighting is done in linear light.
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function toSrgb(l: number): number {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

const LX = -0.62, LY = 0.3, LZ = 0.72; // unit-ish light direction (view space, y up, z toward viewer)
const LN = Math.hypot(LX, LY, LZ);
const TILT = (12 * Math.PI) / 180;

type Style = 'rocky' | 'gas' | 'sun' | 'plain';

function styleOf(e: Entity): Style {
  if (e.kind === 'star') return 'sun';
  if (['sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune', 'sol:venus'].includes(e.id)) return 'gas';
  return 'rocky';
}

interface RingStrip {
  rgba: Uint8ClampedArray;
  width: number;
}

/** Render the sphere (and Saturn's rings) into a data URL. */
function render(map: Uint8ClampedArray | null, style: Style, ring: RingStrip | null): string | null {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(SIZE, SIZE);
  const out = img.data;
  const half = SIZE / 2;
  // Ringed planets shrink so the ring fits: outer A ring ≈ 2.27 R.
  const R = ring ? half / 2.35 : half - 1;
  const sinI = Math.sin((22 * Math.PI) / 180);
  const cosT = Math.cos(TILT);
  const sinT = Math.sin(TILT);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = (px + 0.5 - half) / R;
      const y = (half - py - 0.5) / R;
      const rr = x * x + y * y;
      const o = (py * SIZE + px) * 4;
      let r = 0, gg = 0, b = 0, a = 0;
      // Ring sample (ring plane seen 22° from edge-on; near half below the planet centre).
      let ringA = 0, rr0 = 0, rg0 = 0, rb0 = 0, ringFront = false;
      if (ring) {
        const ry = y / sinI;
        const rad = Math.sqrt(x * x + ry * ry);
        if (rad >= 1.24 && rad <= 2.27) {
          const t = (rad - 1.24) / (2.27 - 1.24);
          const ri = Math.min(ring.width - 1, Math.floor(t * ring.width)) * 4;
          ringA = ring.rgba[ri + 3] / 255;
          const lit = 0.9;
          rr0 = TO_LIN[ring.rgba[ri]] * lit;
          rg0 = TO_LIN[ring.rgba[ri + 1]] * lit;
          rb0 = TO_LIN[ring.rgba[ri + 2]] * lit;
          ringFront = ry < 0;
          // Planet shadow on the far ring behind the night side.
          if (!ringFront && x > 0.2 && Math.abs(ry) < 1.6) ringA *= 0.25;
        }
      }
      if (rr <= 1) {
        const z = Math.sqrt(1 - rr);
        const ndl = Math.max(0, (x * LX + y * LY + z * LZ) / LN);
        let lr: number, lg: number, lb: number;
        if (style === 'sun') {
          const mu = z;
          const limb = 1 - 0.6 * (1 - mu) - 0.15 * (1 - mu) * (1 - mu);
          lr = 1.0 * limb; lg = 0.86 * limb; lb = 0.62 * limb;
        } else {
          let sr = 0.45, sg = 0.45, sb = 0.45;
          if (map) {
            const by = y * cosT + z * sinT;
            const bz = -y * sinT + z * cosT;
            const lat = Math.asin(Math.max(-1, Math.min(1, by)));
            const lon = Math.atan2(x, bz);
            const u = (lon / (2 * Math.PI) + 0.5) % 1;
            const v = 0.5 - lat / Math.PI;
            const sx = Math.min(SAMPLE_W - 1, Math.floor(u * SAMPLE_W));
            const sy = Math.min(SAMPLE_H - 1, Math.floor(v * SAMPLE_H));
            const si = (sy * SAMPLE_W + sx) * 4;
            sr = TO_LIN[map[si]]; sg = TO_LIN[map[si + 1]]; sb = TO_LIN[map[si + 2]];
          }
          // Lunar-Lambert-ish for rocky bodies (flatter disc), limb-darkened Lambert for gas giants.
          const shade = style === 'gas' ? ndl * (0.55 + 0.45 * z) : ndl > 0 ? (2 * ndl) / (ndl + z + 0.15) * 0.62 + ndl * 0.25 : 0;
          lr = sr * shade * 1.5; lg = sg * shade * 1.5; lb = sb * shade * 1.5;
        }
        r = lr; gg = lg; b = lb; a = 1;
        // Soft edge.
        const edge = Math.min(1, (1 - Math.sqrt(rr)) * R);
        a = edge;
        if (ringFront && ringA > 0) {
          r = r * (1 - ringA) + rr0 * ringA;
          gg = gg * (1 - ringA) + rg0 * ringA;
          b = b * (1 - ringA) + rb0 * ringA;
        }
      } else if (ringA > 0) {
        r = rr0; gg = rg0; b = rb0; a = ringA;
      }
      out[o] = toSrgb(r);
      out[o + 1] = toSrgb(gg);
      out[o + 2] = toSrgb(b);
      out[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

async function build(entity: Entity): Promise<string | null> {
  const style = styleOf(entity);
  if (style === 'sun') return render(null, 'sun', null);
  const key = textureKey(entity);
  const index = await loadIndex();
  const maps = key ? index?.bodies?.[key] : undefined;
  const path = lowTier(maps?.day) ?? lowTier(maps?.atmosphere) ?? lowTier(maps?.color);
  let map: Uint8ClampedArray | null = null;
  if (path) {
    try {
      map = pixels(await loadImage(BASE + path.replace(/^\//, '')), SAMPLE_W, SAMPLE_H);
    } catch {
      map = null;
    }
  }
  let ring: RingStrip | null = null;
  const ringPath = lowTier(maps?.rings);
  if (ringPath) {
    try {
      const img = await loadImage(BASE + ringPath.replace(/^\//, ''));
      const w = 256;
      const px = pixels(img, w, 1);
      if (px) ring = { rgba: px, width: w };
    } catch {
      ring = null;
    }
  }
  return render(map, map ? style : 'plain', ring);
}

/** Cached thumbnail URL if already rendered (synchronous; undefined while pending or not requested). */
export function peekThumbnail(entity: Entity): string | null | undefined {
  return done.get(entity.id);
}

/** Request a thumbnail; resolves to a data URL, or null when rendering is impossible (no 2D canvas). */
export function requestThumbnail(entity: Entity): Promise<string | null> {
  let p = cache.get(entity.id);
  if (!p) {
    p = build(entity)
      .catch(() => null)
      .then(url => {
        done.set(entity.id, url);
        return url;
      });
    cache.set(entity.id, p);
  }
  return p;
}
