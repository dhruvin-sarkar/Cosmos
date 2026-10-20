// tex-moons: register moon / small-body maps that exist on disk but are missing from public/textures/index.json, so the
// resolver gets a low-tier preview and a high tier (it otherwise only sees the hd.json 8k/4k tiers). Idempotent; only adds
// or refreshes the bodies listed here, never touches other entries.
//   node scripts/data/textures-hd/moons-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TEX, log } from './lib.mjs';

const USGS = 'Public domain (U.S. Government work; NASA/USGS data products). Credit: USGS Astrogeology Science Center';
const JPL = 'Public domain (NASA/JPL-Caltech/USGS). Credit: USGS Astrogeology / JPL Solar System Simulator';
const BODIES = {
  phobos: { credit: 'Viking Orbiter mosaic of Phobos (USGS Astrogeology)', license: USGS },
  deimos: { credit: 'Viking Orbiter mosaic of Deimos (USGS Astrogeology)', license: USGS },
  mimas: { credit: 'Cassini ISS global mosaic of Mimas (DLR; USGS Astrogeology)', license: USGS },
  tethys: { credit: 'Cassini ISS global mosaic of Tethys (Roatsch et al., DLR; USGS Astrogeology)', license: USGS },
  dione: { credit: 'Cassini ISS + Voyager global mosaic of Dione (Roatsch et al., DLR; USGS Astrogeology)', license: USGS },
  rhea: { credit: 'Cassini ISS + Voyager global mosaic of Rhea (Roatsch et al., DLR; USGS Astrogeology)', license: USGS },
  iapetus: { credit: 'Cassini ISS + Voyager global mosaic of Iapetus (USGS Astrogeology)', license: USGS },
  hyperion: { credit: 'Voyager 2 / Cassini mosaic of Hyperion (USGS Astrogeology)', license: USGS },
  miranda: { credit: 'Voyager 2 mosaic of Miranda, southern hemisphere (USGS Astrogeology)', license: JPL },
  ariel: { credit: 'Voyager 2 mosaic of Ariel, southern hemisphere (USGS Astrogeology)', license: JPL },
  umbriel: { credit: 'Voyager 2 mosaic of Umbriel, southern hemisphere (USGS Astrogeology)', license: JPL },
  titania: { credit: 'Voyager 2 mosaic of Titania, southern hemisphere (USGS Astrogeology)', license: JPL },
  oberon: { credit: 'Voyager 2 mosaic of Oberon, southern hemisphere (USGS Astrogeology)', license: JPL },
  enceladus: { credit: 'Cassini ISS global mosaic of Enceladus (USGS Astrogeology)', license: USGS },
  charon: { credit: 'New Horizons LORRI/MVIC mosaic of Charon (USGS Astrogeology)', license: USGS },
};
const ROLES = { color: 'jpg', coverage: 'png', normal: 'png' };

const file = path.join(TEX, 'index.json');
const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const [body, meta] of Object.entries(BODIES)) {
  for (const [role, ext] of Object.entries(ROLES)) {
    const has = (n) => fs.existsSync(path.join(TEX, body, n));
    const name = (t) => `${role === 'normal' ? 'normal_hd' : role}_${t}.${ext}`;
    const low = ['1k', '2k'].map(name).find(has);
    const high = ['4k', '2k'].map(name).find((n) => has(n) && n !== low);
    if (!low && !high) continue;
    if (idx.bodies[body]?.[role] && role !== 'normal' && !['miranda', 'ariel', 'umbriel', 'titania', 'oberon'].includes(body)) continue; // keep existing data-team entries
    const e = {};
    if (high) e.high = `textures/${body}/${high}`;
    if (low) e.low = `textures/${body}/${low}`;
    (idx.bodies[body] ??= {})[role] = e;
    if (role === 'color') idx.credits[`${body}/color`] = { credit: meta.credit, license: meta.license, source: 'see public/textures/hd.json and docs/data/textures-hd.md (moons section)' };
    log(body, role, JSON.stringify(e));
  }
}
fs.writeFileSync(file, JSON.stringify(idx));
