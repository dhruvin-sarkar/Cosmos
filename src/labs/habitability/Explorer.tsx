/**
 * Exoplanet explorer (part of the habitability lab): counts by method and year, mass–radius and period–distance charts,
 * search with fly-to, the showcase systems, and the filters of the 3-D planet-host marker field (shared state with the
 * markers layer, so filtering here filters the sky).
 */
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../ui/components/Button';
import { Slider } from '../../ui/components/Slider';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Toggle } from '../../ui/components/Toggle';
import { useCommands } from '../../ui/hooks';
import { METHOD_GROUPS, MASS_PROV, exoId, hostPlanetRange, sysId, type ExoCatalog, type ExoIndex } from '../../domains/exoplanets/catalog';
import { SHOWCASE } from '../../domains/exoplanets/showcase';
import { DISCOVERY_YEAR_MAX, DISCOVERY_YEAR_MIN, resetExoFilters, setExoView } from '../../domains/exoplanets/state';
import { countByMethodYear, planetPasses, searchExo, type SearchHit } from '../../domains/exoplanets/stats';
import { MethodLegend, SCATTERS, Scatter, YearChart, type ScatterSpec } from './ExoCharts';
import { useExoView } from './useExo';

const RANGE: [number, number] = [DISCOVERY_YEAR_MIN, DISCOVERY_YEAR_MAX];
const fmtN = (v: number): string => v.toLocaleString('en-US');
const fin = (v: number): boolean => Number.isFinite(v) && v > 0;

export function useExplorer(catalog: ExoCatalog) {
  const view = useExoView();
  const filter = useMemo(() => ({ methodMask: view.methodMask, yearMin: view.yearMin, yearMax: view.yearMax }),
    [view.methodMask, view.yearMin, view.yearMax]);
  const counts = useMemo(() => countByMethodYear(catalog, filter, RANGE), [catalog, filter]);
  const allCounts = useMemo(() => countByMethodYear(catalog, { methodMask: 0x7f, yearMin: RANGE[0], yearMax: RANGE[1] }, RANGE), [catalog]);
  const showcaseHosts = useMemo(() => new Set(SHOWCASE.map((s) => s.host)), []);
  const pass = useMemo(() => {
    const only = view.showcaseOnly;
    return (i: number): boolean => {
      if (!planetPasses(catalog, i, filter, RANGE)) return false;
      if (!only) return true;
      const h = catalog.planets.host[i];
      return h >= 0 && showcaseHosts.has(catalog.hosts.name[h]);
    };
  }, [catalog, filter, view.showcaseOnly, showcaseHosts]);
  const highlight = useMemo(() => {
    const s = new Set<number>();
    for (let h = 0; h < catalog.hosts.count; h++) {
      if (!showcaseHosts.has(catalog.hosts.name[h])) continue;
      const [a, b] = hostPlanetRange(catalog, h);
      for (let i = a; i < b; i++) s.add(i);
    }
    return s;
  }, [catalog, showcaseHosts]);
  return { view, counts, allCounts, pass, highlight };
}

function PlanetCard({ c, i, onLab, onFly }: { c: ExoCatalog; i: number; onLab(i: number): void; onFly(host: string): void }) {
  const P = c.planets;
  const h = P.host[i];
  const row = (k: string, v: ReactNode): ReactNode => (
    <div className="cx-fact">
      <span className="cx-fact__label">{k}</span>
      <span className="cx-fact__value cx-num">{v}</span>
    </div>
  );
  const unk = <span className="hab-unknown">Unknown</span>;
  return (
    <div className="hab-card">
      <p className="hab-card__title">{P.name[i]}</p>
      <div className="cx-facts">
        {row('Discovered', `${P.year[i] || 'year unknown'} · ${c.methodNames[P.methodRaw[i]] ?? METHOD_GROUPS[P.method[i]]}`)}
        {row('Radius', fin(P.radiusE[i]) ? `${P.radiusE[i].toPrecision(3)} Earth` : unk)}
        {row(P.massProv[i] === 2 ? 'Minimum mass' : 'Mass', fin(P.massE[i]) ? `${P.massE[i].toPrecision(3)} Earth${P.massProv[i] === 4 ? ' (estimated from radius)' : ''}` : unk)}
        {row('Orbital period', fin(P.periodDays[i]) ? `${P.periodDays[i] < 2 ? P.periodDays[i].toPrecision(3) : fmtN(Math.round(P.periodDays[i] * 10) / 10)} days` : unk)}
        {row('Distance', h >= 0 && fin(c.hosts.distPc[h]) ? `${fmtN(Math.round(c.hosts.distPc[h] * 3.26156 * 10) / 10)} light-years` : unk)}
      </div>
      <div className="hab-card__actions">
        {h >= 0 && <Button size="sm" variant="primary" onClick={() => onFly(c.hosts.name[h])}>Fly to {c.hosts.name[h]}</Button>}
        <Button size="sm" onClick={() => onLab(i)}>Test habitability</Button>
      </div>
      <p className="hab-src">NASA Exoplanet Archive, Planetary Systems Composite Parameters{MASS_PROV[P.massProv[i]] ? ` · mass: ${MASS_PROV[P.massProv[i]]}` : ''}</p>
    </div>
  );
}

export interface ExplorerParts {
  realState: ReactNode;
  variables: ReactNode;
  visualization: ReactNode;
}

export function useExplorerParts(loaded: { catalog: ExoCatalog; index: ExoIndex }, onLab: (planet: number) => void): ExplorerParts {
  const { catalog, index } = loaded;
  const commands = useCommands();
  const { view, counts, allCounts, pass, highlight } = useExplorer(catalog);
  // While the explorer is open every planet host gets its full ring in the sky (not just the prominent ones).
  useEffect(() => {
    setExoView({ explorer: true });
    return () => setExoView({ explorer: false });
  }, []);
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const hits = useMemo(() => searchExo(catalog, index, q, 8), [catalog, index, q]);
  const [scatter, setScatter] = useState<ScatterSpec['id']>('mass-radius');
  const [picked, setPicked] = useState<number | null>(null);
  const spec = SCATTERS.find((s) => s.id === scatter) ?? SCATTERS[0];
  const fly = (host: string): void => void commands.focus(sysId(host)).catch(() => undefined);
  const openHit = (h: SearchHit): void => {
    if (h.kind === 'planet') {
      setPicked(h.planet);
      void commands.focus(exoId(catalog.planets.name[h.planet])).catch(() => undefined);
    } else fly(catalog.hosts.name[h.host]);
  };
  const toggleMethod = (m: number): void => {
    const next = view.methodMask ^ (1 << m);
    setExoView({ methodMask: next === 0 ? 0x7f : next });
  };

  const realState = (
    <>
      <p className="hab-lede">
        Astronomers have confirmed <span className="cx-num">{fmtN(allCounts.total)}</span> planets around{' '}
        <span className="cx-num">{fmtN(allCounts.hosts)}</span> other stars. Most were found by the dip in starlight as a planet
        crosses its star (transit) or by the star's tiny wobble (radial velocity).
      </p>
      <MethodLegend counts={counts.byMethod} mask={view.methodMask} onToggle={toggleMethod} />
      <p className="hab-src">NASA Exoplanet Archive, Planetary Systems Composite Parameters, retrieved {catalog.retrieved.slice(0, 10)}. {catalog.acknowledgement}</p>
    </>
  );

  const variables = (
    <>
      <label className="hab-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" placeholder="Search planets and stars (e.g. TRAPPIST-1 e)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search exoplanets" />
      </label>
      {hits.length > 0 && (
        <ul className="hab-hits">
          {hits.map((h) => (
            <li key={`${h.kind}${h.host}:${h.planet}`}>
              <button type="button" className="hab-hit" onClick={() => openHit(h)}>
                <span>{h.label}</span>
                <span className="hab-hit__detail">{h.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked != null && <PlanetCard c={catalog} i={picked} onLab={onLab} onFly={fly} />}
      <Slider label="Discovered from" value={view.yearMin} onChange={(v) => setExoView({ yearMin: Math.min(Math.round(v), view.yearMax) })}
        min={DISCOVERY_YEAR_MIN} max={DISCOVERY_YEAR_MAX} step={1} format={(v) => String(Math.round(v))} />
      <Slider label="Discovered until" value={view.yearMax} onChange={(v) => setExoView({ yearMax: Math.max(Math.round(v), view.yearMin) })}
        min={DISCOVERY_YEAR_MIN} max={DISCOVERY_YEAR_MAX} step={1} format={(v) => String(Math.round(v))} />
      <Toggle checked={view.showcaseOnly} onCheckedChange={(v) => setExoView({ showcaseOnly: v })} label="Only the featured systems" />
      <Toggle checked={view.markers} onCheckedChange={(v) => setExoView({ markers: v })} label="Show planet-host stars in the sky"
        description="A faint marker on every star with a known planet, coloured by how its first planet was found." />
      <h4 className="hab-subhead">Featured systems</h4>
      <ul className="hab-showcase">
        {SHOWCASE.map((s) => (
          <li key={s.host}>
            <button type="button" className="hab-hit" onClick={() => fly(s.host)}>
              <span>{s.title}</span>
              <span className="hab-hit__detail">{s.tagline}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  const visualization = (
    <div className="hab-viz">
      <div className="hab-viz__head">
        <p className="hab-viz__title">
          <span className="cx-num">{fmtN(counts.total)}</span> planets around <span className="cx-num">{fmtN(counts.hosts)}</span> stars
          {counts.total !== allCounts.total && <span className="hab-viz__sub"> (filtered)</span>}
        </p>
        <Button size="sm" variant="quiet" onClick={resetExoFilters}>Clear filters</Button>
      </div>
      <p className="hab-viz__cap">Discoveries per year</p>
      <YearChart counts={counts} />
      <SegmentedControl<ScatterSpec['id']> label="Chart" size="sm" value={scatter} onChange={setScatter}
        options={SCATTERS.map((s) => ({ value: s.id, label: s.title }))} />
      <Scatter spec={spec} catalog={catalog} pass={pass} highlight={highlight} onPick={setPicked} />
      <p className="hab-viz__cap">
        {spec.id === 'mass-radius'
          ? 'Each dot is a planet with both values known; rings are Solar System planets, white-edged dots the featured systems. Masses marked "minimum" (radial velocity) are lower limits. Click a dot for details.'
          : 'Transits found by Kepler sit thousands of light-years away; radial-velocity planets orbit nearby stars; microlensing finds planets across the Galaxy. Click a dot for details.'}
      </p>
    </div>
  );

  return { realState, variables, visualization };
}
