import { describe, expect, it } from 'vitest';
import type { FetchJson } from './manifest';
import {
  availableQualities, creditFor, loadTextureIndex, loadTextureIndexDetailed, normalizeTexturePath, parseTextureIndex,
  resolveTexture, resolveTextureInfo, textureMapTypes,
} from './textures';

const raw = {
  convention: 'equirectangular 2:1, x = 0 at 180°W, increasing eastward',
  bodies: {
    earth: {
      day: { ultra: 'earth/day_8k.jpg', high: 'earth/day_4k.jpg', low: 'earth/day_2k.jpg' },
      night: { high: { path: 'textures/earth/night_4k.jpg', width: 4096, height: 2048, credit: 'black-marble' } },
      clouds: { low: '/textures/earth/clouds_2k.png' },
    },
    mars: { color: { high: 'mars/color_4k.jpg' } },
    'sol:moon': { color: 'moon/color.jpg' },
  },
  credits: {
    'earth/day_8k.jpg': 'NASA Earth Observatory — Blue Marble Next Generation',
    'black-marble': { title: 'Black Marble 2016', source: 'NASA Earth Observatory', license: 'Public domain' },
    'textures/mars/': { text: 'NASA/JPL-Caltech, USGS', license: 'Public domain' },
    'sol:moon': 'NASA/GSFC/Arizona State University (LRO LROC)',
    earth: 'NASA (Earth imagery)',
  },
};

const index = parseTextureIndex(raw).index!;

describe('parseTextureIndex', () => {
  it('normalizes paths relative to the index directory', () => {
    expect(index.bodies.earth.day.ultra?.path).toBe('textures/earth/day_8k.jpg');
    expect(index.bodies.earth.night.high).toMatchObject({ path: 'textures/earth/night_4k.jpg', width: 4096, credit: 'black-marble' });
    expect(index.bodies.earth.clouds.low?.path).toBe('textures/earth/clouds_2k.png');
    expect(index.bodies['sol:moon'].color.high?.path).toBe('textures/moon/color.jpg');
    expect(index.convention).toMatch(/equirectangular/);
    expect(normalizeTexturePath('./a/../b/c.jpg')).toBe('textures/b/c.jpg');
    expect(normalizeTexturePath('public/models/iss.glb')).toBe('models/iss.glb');
  });

  it('rejects malformed indexes and reports unusable entries', () => {
    expect(parseTextureIndex(null).index).toBeNull();
    expect(parseTextureIndex({ credits: {} }).index).toBeNull();
    const r = parseTextureIndex({ bodies: { x: { day: { high: { width: 4 } } }, y: 'nope' } });
    expect(r.index!.bodies).toEqual({});
    expect(r.warnings.length).toBe(2);
  });
});

describe('resolveTexture', () => {
  it('returns the requested tier when present', () => {
    expect(resolveTexture(index, 'earth', 'day', 'ultra')).toBe('textures/earth/day_8k.jpg');
    expect(resolveTexture(index, 'earth', 'day', 'low')).toBe('textures/earth/day_2k.jpg');
  });

  it('falls back to cheaper tiers first, then richer ones', () => {
    expect(resolveTextureInfo(index, 'earth', 'night', 'ultra')).toMatchObject({ quality: 'high', requested: 'ultra', fallback: true });
    expect(resolveTexture(index, 'earth', 'night', 'low')).toBe('textures/earth/night_4k.jpg');
    expect(resolveTexture(index, 'earth', 'clouds', 'high')).toBe('textures/earth/clouds_2k.png');
    expect(resolveTextureInfo(index, 'earth', 'day', 'high')).toMatchObject({ quality: 'high', fallback: false });
  });

  it('accepts namespaced entity ids and color-map aliases', () => {
    expect(resolveTexture(index, 'sol:earth', 'day', 'high')).toBe('textures/earth/day_4k.jpg');
    expect(resolveTexture(index, 'sol:moon', 'color', 'low')).toBe('textures/moon/color.jpg');
    expect(resolveTextureInfo(index, 'sol:mars', 'albedo', 'high')).toMatchObject({ mapType: 'color', fallback: true });
  });

  it('returns null for unknown bodies/maps and a missing index', () => {
    expect(resolveTexture(index, 'sol:pluto', 'color')).toBeNull();
    expect(resolveTexture(index, 'earth', 'specular')).toBeNull();
    expect(resolveTexture(null, 'earth', 'day')).toBeNull();
  });

  it('lists map types and tiers', () => {
    expect(textureMapTypes(index, 'sol:earth')).toEqual(['day', 'night', 'clouds']);
    expect(availableQualities(index, 'earth', 'day')).toEqual(['low', 'high', 'ultra']);
    expect(availableQualities(index, 'earth', 'nope')).toEqual([]);
  });
});

describe('creditFor', () => {
  it('resolves exact, variant, directory and body credits', () => {
    expect(creditFor(index, 'textures/earth/day_8k.jpg')?.text).toBe('NASA Earth Observatory — Blue Marble Next Generation');
    expect(creditFor(index, '/textures/earth/day_8k.jpg')?.text).toBe('NASA Earth Observatory — Blue Marble Next Generation');
    expect(creditFor(index, 'textures/earth/night_4k.jpg')).toMatchObject({
      text: 'Black Marble 2016 · NASA Earth Observatory · Public domain', license: 'Public domain',
    });
    expect(creditFor(index, 'textures/mars/color_4k.jpg')?.text).toBe('NASA/JPL-Caltech, USGS');
    expect(creditFor(index, 'textures/moon/color.jpg')?.text).toBe('NASA/GSFC/Arizona State University (LRO LROC)');
    expect(creditFor(index, 'textures/earth/day_4k.jpg')?.text).toBe('NASA (Earth imagery)');
    expect(creditFor(index, 'textures/unknown.jpg')).toBeNull();
    expect(creditFor(null, 'x')).toBeNull();
  });
});

describe('loadTextureIndex', () => {
  it('loads via the fetcher and never rejects', async () => {
    const ok: FetchJson = async <T>(path: string) => {
      expect(path).toBe('textures/index.json');
      return raw as T;
    };
    expect(resolveTexture(await loadTextureIndex(ok), 'earth', 'day', 'high')).toBe('textures/earth/day_4k.jpg');
    const fail: FetchJson = async () => { throw new Error('HTTP 404'); };
    expect(await loadTextureIndex(fail)).toBeNull();
    expect((await loadTextureIndexDetailed(fail)).status).toBe('error');
  });
});
