// tex-moons: orientation check. Correlates map B against a verified map A (x=0 at 180W, east-positive) under the four
// longitude conventions (identity, 180-deg shift, mirror = west-positive, mirror+shift). Pixels <3 (no data) are ignored.
//   node scripts/data/textures-hd/moons-orient.mjs <verified A> <candidate B>
import { sharp } from './lib.mjs';
const [a, b] = process.argv.slice(2);
const W = 360, H = 180;
const g = async (p) => sharp(p, { limitInputPixels: false }).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer();
const A = await g(a), B = await g(b);
const tf = { id: (x) => x, shift180: (x) => (x + W / 2) % W, mirror: (x) => W - 1 - x, mirrorShift: (x) => (W - 1 - x + W / 2) % W };
for (const [k, f] of Object.entries(tf)) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let y = 20; y < H - 20; y++) for (let x = 0; x < W; x++) {
    const va = A[y * W + x], vb = B[y * W + f(x)];
    if (va < 3 || vb < 3) continue;
    sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
  }
  const c = (sab / n - (sa / n) * (sb / n)) / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
  console.log(k.padEnd(12), c.toFixed(3));
}
