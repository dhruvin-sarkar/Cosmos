/**
 * Habitable-zone strip: orbital distance on a log axis, the optimistic (soft) and conservative (solid) habitable zone of
 * the chosen star (Kopparapu et al. 2013/2014), the planet, and the Solar System's Venus–Earth–Mars for comparison
 * scaled to the same insolation (where they would sit around this star). The star's disc colour is its blackbody colour.
 */
import { AU_M } from '../../core/units';
import { blackbodyChroma } from '../../render/glsl/blackbody';
import type { HabitableZone } from '../../science/exoplanets';
import { useElementSize } from '../debris/Charts';

const toSrgb = (c: number): number => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

export function starCss(teffK: number): string {
  const c = blackbodyChroma(Math.min(Math.max(teffK, 1000), 40000));
  return `rgb(${toSrgb(c.r)} ${toSrgb(c.g)} ${toSrgb(c.b)})`;
}

export function HzDiagram({ hz, lum, teffK, distanceAu, modified }: { hz: HabitableZone; lum: number; teffK: number; distanceAu: number; modified: boolean }) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const au = (l: { distanceM: number }): number => l.distanceM / AU_M;
  const inO = au(hz.recentVenus), inC = au(hz.runawayGreenhouse), outC = au(hz.maximumGreenhouse), outO = au(hz.earlyMars);
  const centre = Math.sqrt(inC * outC);
  // Axis spans ~1.6 decades around the HZ (room on the left for the star), always including the planet.
  let lo = Math.min(inO / 5, distanceAu / 1.6), hi = Math.max(outO * 4, distanceAu * 1.6);
  if (!(lo > 0)) lo = 1e-3;
  if (!(hi > lo)) hi = lo * 1000;
  const L = 18, R = 18, mid = h * 0.46;
  const pw = Math.max(1, w - L - R);
  const sx = (d: number): number => L + ((Math.log10(d) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * pw;
  const decs: number[] = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) decs.push(10 ** e);
  // Solar System planets at the same insolation: d = d☉ · √(L/L☉).
  const sl = Math.sqrt(lum);
  const refs = [{ n: 'Venus', d: 0.723 * sl }, { n: 'Earth', d: 1 * sl }, { n: 'Mars', d: 1.524 * sl }].filter((r) => r.d > lo && r.d < hi);
  const px = sx(distanceAu);
  const fmt = (d: number): string => (d >= 1 ? d.toPrecision(3) : d.toPrecision(2));
  return (
    <div ref={ref} className="hab-chart hab-chart--hz">
      {w > 0 && (
        <svg width={w} height={h} role="img"
          aria-label={`Habitable zone from ${fmt(inO)} to ${fmt(outO)} AU (conservative ${fmt(inC)} to ${fmt(outC)} AU); planet at ${fmt(distanceAu)} AU`}>
          <defs>
            <radialGradient id="hab-star-glow">
              <stop offset="0" stopColor={starCss(teffK)} stopOpacity="1" />
              <stop offset="0.35" stopColor={starCss(teffK)} stopOpacity="0.55" />
              <stop offset="1" stopColor={starCss(teffK)} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect className="dl-plotbg" x={0} y={0} width={w} height={h} />
          <circle cx={L - 4} cy={mid} r={h * 0.42} fill="url(#hab-star-glow)" />
          <rect className="hab-hz hab-hz--opt" x={sx(inO)} y={mid - 26} width={Math.max(1, sx(outO) - sx(inO))} height={52} />
          <rect className="hab-hz hab-hz--con" x={sx(inC)} y={mid - 26} width={Math.max(1, sx(outC) - sx(inC))} height={52} />
          <line className="dl-grid dl-grid--major" x1={L} x2={L + pw} y1={mid} y2={mid} />
          {decs.map((d) => (
            <g key={d}>
              <line className="dl-tick" x1={sx(d)} x2={sx(d)} y1={h - 26} y2={h - 20} />
              <text className="dl-axis-label" x={sx(d)} y={h - 7} textAnchor="middle">{d >= 1 ? d : d.toString()} AU</text>
            </g>
          ))}
          <text className="hab-hz__label" x={(sx(inC) + sx(outC)) / 2} y={mid - 32} textAnchor="middle">Habitable zone</text>
          {refs.map((r, k) => (
            <g key={r.n}>
              <circle cx={sx(r.d)} cy={mid} r={3} className="hab-ref" />
              <text className="hab-ref__label" x={sx(r.d)} y={mid + (k % 2 ? 54 : 40)} textAnchor="middle">{r.n}*</text>
            </g>
          ))}
          <circle cx={px} cy={mid} r={7} className={modified ? 'hab-planet is-modified' : 'hab-planet'} />
          <text className="hab-planet__label" x={px} y={mid - 14} textAnchor="middle">{fmt(distanceAu)} AU</text>
        </svg>
      )}
    </div>
  );
}
