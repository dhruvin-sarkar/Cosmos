import { describe, expect, it } from 'vitest';
import {
  DataLoadError, dataUrl, datasetAgeDays, describeSource, describeSources, getDataset, isStale, listDatasets, loadManifest,
  loadManifestDetailed, parseManifest, shortDatasetTitle, sourceSummaryText, type FetchJson,
} from './manifest';

const NOW = Date.parse('2026-10-17T12:00:00Z');

const dataset = (id: string, domain: string, patch: Record<string, unknown> = {}) => ({
  id, domain,
  name: 'CelesTrak Satellite Catalog (SATCAT), full CSV',
  organization: 'CelesTrak (T.S. Kelso)',
  purpose: 'Authoritative list of on-orbit objects.',
  mechanism: 'HTTPS GET',
  endpoint: 'https://celestrak.org/pub/satcat.csv',
  query: null,
  version: 'SATCAT file Last-Modified 2026-10-15T20:56:28.000Z',
  retrieved: '2026-10-16T18:29:27.616Z',
  license: 'No formal open-data licence. CelesTrak makes the data freely available to all users subject to its usage policy.',
  licenseUrl: 'https://celestrak.org/usage-policy.php',
  citation: 'Orbital data: CelesTrak.',
  rateLimits: '1-2x per day',
  fieldsUsed: ['OBJECT_NAME'],
  updateCadence: 'daily',
  cachePolicy: 'versioned offline snapshot; optional online refresh',
  normalization: 'scripts/data/orbital/build.mjs',
  fallback: 'hide layer',
  files: [{ path: 'data/orbital/catalog.json', bytes: 9013072, records: 35652 }],
  limitations: 'rounded values',
  provenanceClass: 'observed',
  ...patch,
});

const rawManifest = {
  schemaVersion: 1,
  generated: '2026-10-17T06:20:00.000Z',
  datasets: {
    'celestrak-satcat': dataset('celestrak-satcat', 'orbital'),
    'exoplanets-pscomppars': dataset('exoplanets-pscomppars', 'exoplanets', {
      name: 'NASA Exoplanet Archive: Planetary Systems Composite Parameters (PSCompPars), all confirmed planets',
      retrieved: '2026-10-16T18:28:50.774Z',
    }),
  },
};

describe('parseManifest', () => {
  it('accepts a well-formed registry without warnings', () => {
    const { manifest, warnings } = parseManifest(rawManifest);
    expect(warnings).toEqual([]);
    expect(Object.keys(manifest!.datasets)).toEqual(['celestrak-satcat', 'exoplanets-pscomppars']);
  });

  it('fills missing text fields with "Unknown" and drops non-objects', () => {
    const { manifest, warnings } = parseManifest({
      schemaVersion: 1,
      generated: 'x',
      datasets: { a: { id: 'a', name: 'A', files: [{ path: 'data/a.json', records: null }], provenanceClass: 'weird' }, b: 42 },
    });
    expect(manifest!.datasets.a.license).toBe('Unknown');
    expect(manifest!.datasets.a.provenanceClass).toBe('observed');
    expect(manifest!.datasets.a.files).toEqual([{ path: 'data/a.json' }]);
    expect(manifest!.datasets.b).toBeUndefined();
    expect(warnings.some((w) => w.includes('dataset "a": missing') && w.includes('license'))).toBe(true);
    expect(warnings.some((w) => w.includes('"b"'))).toBe(true);
  });

  it('rejects non-registries', () => {
    expect(parseManifest(null).manifest).toBeNull();
    expect(parseManifest({ schemaVersion: 0, datasets: {} }).manifest).toBeNull();
    expect(parseManifest({ schemaVersion: 1 }).manifest).toBeNull();
    expect(parseManifest({ schemaVersion: 2, datasets: {} }).warnings[0]).toMatch(/newer than supported/);
  });
});

describe('loadManifest', () => {
  it('loads through the injected fetcher', async () => {
    const paths: string[] = [];
    const fetchJson: FetchJson = async <T>(path: string) => {
      paths.push(path);
      return rawManifest as T;
    };
    const m = await loadManifest(fetchJson);
    expect(paths).toEqual(['data/manifest.json']);
    expect(getDataset(m, 'celestrak-satcat')?.organization).toBe('CelesTrak (T.S. Kelso)');
  });

  it('resolves to null instead of rejecting, with a reason', async () => {
    const missing: FetchJson = async () => { throw new DataLoadError('HTTP 404 loading data/manifest.json', 'data/manifest.json', 404); };
    expect(await loadManifest(missing)).toBeNull();
    expect((await loadManifestDetailed(missing)).status).toBe('absent');
    const broken: FetchJson = async () => { throw new Error('Invalid JSON'); };
    expect(await loadManifestDetailed(broken)).toMatchObject({ manifest: null, status: 'error', error: 'Invalid JSON' });
    const html: FetchJson = async <T>() => '<!doctype html>' as T;
    expect(await loadManifestDetailed(html)).toMatchObject({ manifest: null, status: 'invalid' });
  });

  it('resolves paths against BASE_URL', () => {
    expect(dataUrl('data/manifest.json')).toBe('/data/manifest.json');
    expect(dataUrl('/data/x.json')).toBe('/data/x.json');
    expect(dataUrl('https://example.org/a.json')).toBe('https://example.org/a.json');
  });
});

describe('dataset queries', () => {
  const manifest = parseManifest(rawManifest).manifest;

  it('lists, ages and flags staleness', () => {
    expect(listDatasets(manifest).map((d) => d.id)).toEqual(['exoplanets-pscomppars', 'celestrak-satcat']);
    expect(listDatasets(manifest, 'orbital').length).toBe(1);
    expect(listDatasets(null)).toEqual([]);
    const satcat = getDataset(manifest, 'celestrak-satcat')!;
    expect(datasetAgeDays(satcat, NOW)).toBeCloseTo(0.73, 2);
    expect(isStale(satcat, 7, NOW)).toBe(false);
    expect(isStale(satcat, 0.5, NOW)).toBe(true);
    expect(isStale({ retrieved: 'not a date' }, 7, NOW)).toBe(true);
    expect(getDataset(manifest, 'toString')).toBeUndefined();
  });

  it('describes sources for tooltips', () => {
    const d = describeSource(manifest, { datasetId: 'exoplanets-pscomppars', field: 'pl_eqt', reference: 'Agol et al. 2021' }, NOW);
    expect(d).toMatchObject({
      found: true,
      shortTitle: 'NASA Exoplanet Archive: Planetary Systems Composite Parameters',
      organization: 'CelesTrak (T.S. Kelso)',
      retrievedDate: '2026-10-16',
      ageText: 'today',
      licenseSummary: 'No formal open-data licence.',
      field: 'pl_eqt',
      reference: 'Agol et al. 2021',
      domain: 'exoplanets',
      provenanceClass: 'observed',
    });
    expect(d.ageDays).toBeCloseTo(0.73, 2);
    expect(sourceSummaryText(d)).toBe('NASA Exoplanet Archive: Planetary Systems Composite Parameters · retrieved 2026-10-16 (today)');
  });

  it('degrades to "Unknown" for unregistered datasets', () => {
    const d = describeSource(manifest, { datasetId: 'jpl-horizons' }, NOW);
    expect(d).toMatchObject({ found: false, title: 'jpl-horizons', license: 'Unknown', ageDays: null, ageText: 'Unknown' });
    expect(sourceSummaryText(d)).toBe('jpl-horizons · source details unavailable');
    expect(describeSource(null, { datasetId: 'x' }).found).toBe(false);
  });

  it('dedupes source lists', () => {
    const list = describeSources(manifest, [
      { datasetId: 'celestrak-satcat', field: 'A' }, { datasetId: 'celestrak-satcat', field: 'B' }, { datasetId: 'nope' },
    ], NOW);
    expect(list.map((d) => d.datasetId)).toEqual(['celestrak-satcat', 'nope']);
  });

  it('shortens long dataset names at a clause break', () => {
    expect(shortDatasetTitle('CelesTrak GP mean element sets (CCSDS OMM keywords, CSV): published groups')).toBe('CelesTrak GP mean element sets');
    expect(shortDatasetTitle('HYG Database v4.4')).toBe('HYG Database v4.4');
    expect(shortDatasetTitle('A'.repeat(100)).length).toBeLessThanOrEqual(72);
  });
});

describe('generated public/data/manifest.json', () => {
  it('parses cleanly when present (scripts/data/build-manifest.mjs output)', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const path = 'public/data/manifest.json';
    if (!existsSync(path)) return;
    const result = parseManifest(JSON.parse(readFileSync(path, 'utf8')));
    expect(result.manifest).not.toBeNull();
    expect(result.manifest?.schemaVersion).toBe(1);
    for (const ds of Object.values(result.manifest?.datasets ?? {})) {
      expect(typeof ds.domain).toBe('string');
      for (const f of ds.files) expect(typeof f.bytes).toBe('number');
    }
  });
});
