// Fetch arXiv abstracts of every reference (one API call) and cache them; used to cross-check headline numbers.
import { REFS } from './refs.mjs';
import { arxivAbstracts, log } from './lib.mjs';
const ids = Object.values(REFS).map((r) => r.arxiv).filter((a) => a && !a.includes('/'));
const { entries } = await arxivAbstracts(ids);
for (const [k, r] of Object.entries(REFS)) {
  if (!r.arxiv || r.arxiv.includes('/')) continue;
  const e = entries[r.arxiv];
  log(k, e ? (e.journalRef ?? '(no jref)') : 'MISSING');
}
