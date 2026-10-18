#!/usr/bin/env node
/**
 * Merge every public/data/<domain>/manifest.part.json into public/data/manifest.json.
 *
 *   node scripts/data/build-manifest.mjs [--check]
 *
 * Part format: { "domain": "<domain>", "datasets": DatasetRecord[] } (a bare DatasetRecord[] is also accepted, with the
 * folder name as domain). Output: { schemaVersion: 1, generated, datasets: { [id]: { ...record, domain } } }.
 * Missing required fields and duplicate ids are reported as warnings; the build never crashes on one bad domain.
 * File byte sizes are filled from disk when absent (and corrected when stale). --check exits non-zero on warnings.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(PUBLIC_DIR, 'data');
const OUT = join(DATA_DIR, 'manifest.json');

/** Required DatasetRecord fields (src/data/provenance.ts) and their expected JS types. */
export const REQUIRED_FIELDS = {
  id: 'string', name: 'string', organization: 'string', purpose: 'string', mechanism: 'string', endpoint: 'string',
  version: 'string', retrieved: 'string', license: 'string', citation: 'string', rateLimits: 'string',
  fieldsUsed: 'array', updateCadence: 'string', cachePolicy: 'string', normalization: 'string', fallback: 'string',
  files: 'array', limitations: 'string', provenanceClass: 'string',
};
const NULLABLE_FIELDS = { query: 'string', licenseUrl: 'string' };
const PROVENANCE_CLASSES = new Set(['observed', 'derived', 'reconstructed', 'illustrative']);

function typeOf(v) {
  return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
}

/** Validate and normalize one record in place; returns warnings. */
export function validateRecord(rec, where) {
  const warnings = [];
  for (const [k, t] of Object.entries(REQUIRED_FIELDS)) {
    if (!(k in rec)) warnings.push(`${where}: missing required field "${k}"`);
    else if (typeOf(rec[k]) !== t) warnings.push(`${where}: field "${k}" should be ${t}, got ${typeOf(rec[k])}`);
    else if (t === 'string' && rec[k].trim() === '') warnings.push(`${where}: field "${k}" is empty`);
  }
  for (const [k, t] of Object.entries(NULLABLE_FIELDS)) {
    if (!(k in rec)) {
      warnings.push(`${where}: missing field "${k}" (use null when not applicable)`);
      rec[k] = null;
    } else if (rec[k] !== null && typeOf(rec[k]) !== t) warnings.push(`${where}: field "${k}" should be ${t} or null`);
  }
  if (typeof rec.provenanceClass === 'string' && !PROVENANCE_CLASSES.has(rec.provenanceClass)) {
    warnings.push(`${where}: provenanceClass "${rec.provenanceClass}" is not one of ${[...PROVENANCE_CLASSES].join('/')}`);
  }
  if (typeof rec.retrieved === 'string' && Number.isNaN(Date.parse(rec.retrieved))) {
    warnings.push(`${where}: retrieved "${rec.retrieved}" is not an ISO-8601 timestamp`);
  }
  return warnings;
}

/** Fill/correct files[].bytes from disk; drop null record counts (TS type is number | undefined). */
function fillFileSizes(rec, where, warnings) {
  if (!Array.isArray(rec.files)) return;
  rec.files = rec.files.filter((f, i) => {
    if (!f || typeof f.path !== 'string') {
      warnings.push(`${where}: files[${i}] has no path; dropped`);
      return false;
    }
    return true;
  });
  for (const f of rec.files) {
    f.path = f.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^public\//, '');
    if (f.records === null) delete f.records;
    const abs = join(PUBLIC_DIR, f.path);
    if (!existsSync(abs)) {
      warnings.push(`${where}: file "${f.path}" not found under public/`);
      continue;
    }
    const size = statSync(abs).size;
    if (typeof f.bytes !== 'number' || f.bytes !== size) f.bytes = size;
  }
}

export function buildManifest({ dataDir = DATA_DIR, now = new Date() } = {}) {
  const warnings = [];
  const datasets = {};
  const domains = existsSync(dataDir)
    ? readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
    : [];
  const summary = [];
  for (const dir of domains) {
    const partPath = join(dataDir, dir, 'manifest.part.json');
    if (!existsSync(partPath)) {
      summary.push({ domain: dir, datasets: 0, note: 'no manifest.part.json' });
      continue;
    }
    let part;
    try {
      part = JSON.parse(readFileSync(partPath, 'utf8'));
    } catch (err) {
      warnings.push(`${dir}/manifest.part.json: invalid JSON (${err.message}); domain skipped`);
      summary.push({ domain: dir, datasets: 0, note: 'invalid JSON' });
      continue;
    }
    const domain = Array.isArray(part) ? dir : typeof part?.domain === 'string' && part.domain ? part.domain : dir;
    const list = Array.isArray(part) ? part : Array.isArray(part?.datasets) ? part.datasets : null;
    if (!list) {
      warnings.push(`${dir}/manifest.part.json: expected { domain, datasets: [] }; domain skipped`);
      summary.push({ domain: dir, datasets: 0, note: 'bad shape' });
      continue;
    }
    if (domain !== dir) warnings.push(`${dir}/manifest.part.json: declares domain "${domain}" (folder is "${dir}")`);
    let count = 0;
    list.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        warnings.push(`${dir}: datasets[${i}] is not an object; skipped`);
        return;
      }
      const rec = { ...raw };
      const where = `${dir}:${typeof rec.id === 'string' ? rec.id : `#${i}`}`;
      warnings.push(...validateRecord(rec, where));
      if (typeof rec.id !== 'string' || !rec.id) {
        warnings.push(`${where}: no id; skipped`);
        return;
      }
      fillFileSizes(rec, where, warnings);
      if (datasets[rec.id]) {
        warnings.push(`${where}: duplicate dataset id "${rec.id}" (already defined by domain "${datasets[rec.id].domain}"); later one ignored`);
        return;
      }
      datasets[rec.id] = { ...rec, domain };
      count++;
    });
    summary.push({ domain, datasets: count });
  }
  return { manifest: { schemaVersion: 1, generated: now.toISOString(), datasets }, warnings, summary };
}

function main() {
  const check = process.argv.includes('--check');
  const { manifest, warnings, summary } = buildManifest();
  writeFileSync(OUT, JSON.stringify(manifest, null, 1) + '\n');
  for (const s of summary) console.log(`  ${s.domain.padEnd(14)} ${String(s.datasets).padStart(3)} dataset(s)${s.note ? `  (${s.note})` : ''}`);
  const total = Object.keys(manifest.datasets).length;
  console.log(`Wrote ${total} dataset(s) to ${OUT.replace(ROOT, '.').replace(/\\/g, '/')}`);
  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
  if (check && warnings.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
