// Writes craft.generated.json: spacecraft.json without the sample arrays (names, mission text, coverage), so the sc:* entities
// exist synchronously while the 0.9 MB of state vectors loads lazily. Usage: node src/domains/smallbodies/tools/build-craft-meta.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/solar/spacecraft.json'), 'utf8'));
const craft = j.craft.map(({ samples, ...rest }) => rest);
fs.writeFileSync(path.join(ROOT, 'src/domains/smallbodies/craft.generated.json'), JSON.stringify({ retrieved: j.retrieved, craft }));
console.log('craft', craft.length);
