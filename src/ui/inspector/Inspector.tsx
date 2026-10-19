import { useMemo, useState, type ReactNode } from 'react';
import { Vector3 } from 'three';
import { X } from 'lucide-react';
import type { Capability, Entity, LabId } from '../../core/entity';
import { C_M_PER_S } from '../../core/units';
import type { Fact, FactSheet, Quantity, SourceRef } from '../../data/provenance';
import { PROVENANCE_LABEL } from '../../data/provenance';
import { describeSource } from '../../data/manifest';
import { useCommands, useCosmos, useEntity, useFactSheet, useManifest, useRegistry, safeGetEntity, setUi, useStoreApi, useInterval } from '../hooks';
import { useUiExtensions } from '../context';
import { cx } from '../lib/dom';
import { kindLabel } from '../icons';
import { formatDuration } from '../format';
import { Button, IconButton } from '../components/Button';
import { ProvenanceBadge, ProvenanceGlyph, ProvenanceLegend, ProvenanceRule } from '../components/Provenance';
import { QuantityView } from '../components/QuantityView';
import { Skeleton } from '../components/Spinner';
import { Tooltip } from '../components/Tooltip';
import { EmptyState } from '../components/Misc';
import { classificationFrom, INSPECTOR_SECTIONS, labsOf, nameSize, quickFacts, sectionsFor, type InspectorSectionId } from './facts';

const ORBITING = new Set(['planet', 'dwarf-planet', 'moon', 'exoplanet', 'satellite', 'space-station', 'rocket-body', 'debris', 'asteroid', 'comet']);

const LAB_NAMES: Record<string, string> = {
  debris: 'Orbital debris lab',
  defense: 'Asteroid deflection lab',
  habitability: 'Habitability lab',
  relativity: 'Black hole lab',
};

function SourceTip({ source, model }: { source?: SourceRef; model?: string }) {
  const manifest = useManifest();
  if (!source && !model) return null;
  const d = source ? describeSource(manifest, source) : null;
  return (
    <span className="cx-src-tip">
      {d && <strong>{d.shortTitle}</strong>}
      {d && d.found && (
        <span>
          {d.organization}, version {d.version}. Retrieved {d.retrievedDate} ({d.ageText}). {d.licenseSummary}
        </span>
      )}
      {d && !d.found && <span>Source details are not in the data registry.</span>}
      {source?.field && <span>Field <span className="cx-id">{source.field}</span></span>}
      {source?.reference && <span>Reference <span className="cx-id">{source.reference}</span></span>}
      {model && <span>Model <span className="cx-id">{model}</span></span>}
    </span>
  );
}

/** One fact: label above value, provenance glyph, source tooltip, and "Show calculation" for derived values. */
export function FactRow({ fact, sheet }: { fact: Fact; sheet: FactSheet | null }) {
  const [calc, setCalc] = useState(false);
  const q = fact.quantity;
  const source = fact.source ?? q?.source;
  const model = q?.model;
  return (
    <div className="cx-fact">
      <dt className="cx-fact__label">
        {fact.help ? (
          <Tooltip content={fact.help}>
            <span tabIndex={0} className="cx-fact__help">{fact.label}</span>
          </Tooltip>
        ) : (
          fact.label
        )}
      </dt>
      <dd className="cx-fact__value">
        <ProvenanceBadge kind={fact.provenance} showLabel={false} detail={source || model ? <SourceTip source={source} model={model} /> : undefined} />
        {q ? <QuantityView quantity={q} smart={q.unit === 'm'} /> : fact.text?.trim() ? <span className="cx-fact__text">{fact.text}</span> : <span className="cx-q cx-q--unknown">Unknown</span>}
      </dd>
      {model && (
        <dd className="cx-fact__calc">
          <button type="button" className="cx-link" aria-expanded={calc} onClick={() => setCalc(c => !c)}>
            {calc ? 'Hide calculation' : 'Show calculation'}
          </button>
          {calc && (
            <div className="cx-fact__calc-body">
              <p>
                Calculated with model <span className="cx-id">{model}</span> from measured values.
              </p>
              {sheet?.assumptions && sheet.assumptions.length > 0 && (
                <ul>
                  {sheet.assumptions.map(a => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </dd>
      )}
    </div>
  );
}

function FactGrid({ facts, sheet }: { facts: Fact[]; sheet: FactSheet | null }) {
  if (facts.length === 0) return null;
  return (
    <dl className="cx-facts">
      {facts.map(f => (
        <FactRow key={f.key} fact={f} sheet={sheet} />
      ))}
    </dl>
  );
}

const scratchA = new Vector3();
const scratchB = new Vector3();

function distanceBetween(a: Entity | undefined, b: Entity | undefined, tMs: number): number | null {
  if (!a || !b || a.id === b.id) return null;
  try {
    a.position(tMs, scratchA);
    b.position(tMs, scratchB);
    const d = scratchA.distanceTo(scratchB);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

function geometry(value: number | null): Quantity {
  return { value, unit: 'm', provenance: 'derived', model: 'ephemeris-geometry@1', sigDigits: 3 };
}

/** Live distances (polled at 1 Hz): from camera, from Earth, from the Sun, and light-travel time from Earth. */
function useDistances(entity: Entity | undefined) {
  const registry = useRegistry();
  const ext = useUiExtensions();
  const focusId = useCosmos(s => s.camera.focusId);
  const focusDistance = useCosmos(s => s.view.focusDistanceM);
  const tick = useInterval(1000, !!entity);
  const simMs = useCosmos(s => s.time.simTimeMs);
  return useMemo(() => {
    if (!entity) return null;
    const earth = safeGetEntity(registry, 'sol:earth');
    const sun = safeGetEntity(registry, 'sol:sun');
    const camera = ext.cameraDistanceM?.(entity.id) ?? (focusId === entity.id ? focusDistance : null);
    const fromEarth = distanceBetween(entity, earth, simMs);
    const fromSun = distanceBetween(entity, sun, simMs);
    return { camera, fromEarth, fromSun, lightFromEarthS: fromEarth != null ? fromEarth / C_M_PER_S : null };
    // `tick` re-polls the engine distance once per second.
  }, [entity, registry, ext, focusId, focusDistance, simMs, tick]);
}

function DistanceFacts({ entity }: { entity: Entity }) {
  const d = useDistances(entity);
  if (!d) return null;
  const rows: Array<{ label: string; node: ReactNode; prov?: boolean }> = [];
  rows.push({ label: 'From the camera', node: <QuantityView quantity={geometry(d.camera)} smart />, prov: true });
  if (entity.id !== 'sol:earth') rows.push({ label: 'From Earth', node: <QuantityView quantity={geometry(d.fromEarth)} smart />, prov: true });
  if (entity.id !== 'sol:sun') rows.push({ label: 'From the Sun', node: <QuantityView quantity={geometry(d.fromSun)} smart />, prov: true });
  if (d.lightFromEarthS != null) {
    rows.push({ label: 'Light from Earth takes', node: <span className="cx-num">{formatDuration(d.lightFromEarthS, { sigDigits: 3 })}</span>, prov: true });
  }
  return (
    <dl className="cx-facts">
      {rows.map(r => (
        <div key={r.label} className="cx-fact">
          <dt className="cx-fact__label">{r.label}</dt>
          <dd className="cx-fact__value">
            {r.prov && <ProvenanceBadge kind="derived" showLabel={false} detail="Computed from the ephemeris at the simulation time" />}
            {r.node}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ACTION_LABEL: Partial<Record<Capability, string>> = {
  follow: 'Follow',
  'show-orbit': 'Show orbit',
  bookmark: 'Bookmark',
  sources: 'Sources',
};

function Actions({ entity }: { entity: Entity }) {
  const commands = useCommands();
  const store = useStoreApi();
  const orbits = useCosmos(s => s.overlays.orbits);
  const caps = new Set(entity.capabilities);
  const labs = labsOf(entity);
  return (
    <div className="cx-actions">
      {(caps.has('focus') || caps.has('travel')) && (
        <Button variant="primary" onClick={() => void commands.focus(entity.id)}>
          Fly to {entity.name}
        </Button>
      )}
      {labs.map(l => (
        <Button key={l} onClick={() => commands.openLab(l as LabId, { entityId: entity.id })}>
          Open {LAB_NAMES[l] ?? `${l} lab`}
        </Button>
      ))}
      {caps.has('follow') && <Button variant="quiet" onClick={() => { void commands.focus(entity.id); commands.setCameraMode('follow'); }}>{ACTION_LABEL.follow}</Button>}
      {caps.has('show-orbit') && (
        <Button variant="quiet" pressed={orbits} onClick={() => commands.setOverlay('orbits', !orbits)}>
          {orbits ? 'Hide orbits' : 'Show orbit'}
        </Button>
      )}
      {caps.has('bookmark') && <Button variant="quiet" onClick={() => commands.addBookmark(entity.name)}>{ACTION_LABEL.bookmark}</Button>}
      {caps.has('sources') && <Button variant="quiet" onClick={() => setUi(store, { sourcesOpen: true })}>{ACTION_LABEL.sources}</Button>}
    </div>
  );
}

function KnowSection({ sheet }: { sheet: FactSheet }) {
  const manifest = useManifest();
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return sheet.sources.filter(s => (seen.has(s.datasetId) ? false : (seen.add(s.datasetId), true))).map(s => describeSource(manifest, s));
  }, [sheet, manifest]);
  return (
    <div className="cx-know">
      <div className="cx-know__rep">
        <ProvenanceGlyph kind={sheet.representation.provenance} />
        <p>
          <strong>{PROVENANCE_LABEL[sheet.representation.provenance]} visual.</strong> {sheet.representation.description}
        </p>
      </div>
      {sheet.epoch && (
        <p className="cx-know__epoch">
          Data epoch {sheet.epoch.label}
          {sheet.epoch.iso && <> (<span className="cx-id">{sheet.epoch.iso}</span>)</>}
        </p>
      )}
      {sources.length > 0 && (
        <ul className="cx-know__sources">
          {sources.map(s => (
            <li key={s.datasetId}>
              <span className="cx-know__src-name">{s.shortTitle}</span>
              <span className="cx-know__src-meta">
                {s.organization}, version {s.version}, retrieved {s.retrievedDate}
              </span>
              <span className="cx-know__src-meta">{s.licenseSummary}</span>
            </li>
          ))}
        </ul>
      )}
      {sheet.assumptions && sheet.assumptions.length > 0 && (
        <div className="cx-know__list">
          <h4>Assumptions</h4>
          <ul>{sheet.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {sheet.missing && sheet.missing.length > 0 && (
        <div className="cx-know__list">
          <h4>Not yet measured</h4>
          <ul>{sheet.missing.map(a => <li key={a}>{a}: <span className="cx-q--unknown">Unknown</span></li>)}</ul>
        </div>
      )}
      <ProvenanceLegend />
    </div>
  );
}

function SectionBody({ q, entity, sheet, shown }: { q: InspectorSectionId; entity: Entity; sheet: FactSheet | null; shown: ReadonlySet<string> }) {
  const sections = sectionsFor(sheet, q).map(s => ({ ...s, facts: s.facts.filter(f => !shown.has(f.key)) })).filter(s => s.facts.length > 0 || (s.paragraphs?.length ?? 0) > 0);
  const blocks = sections.map(s => (
    <section key={String(s.id)} className="cx-insp-block" aria-label={s.title}>
      {sections.length > 1 && <h3 className="cx-insp-block__title">{s.title}</h3>}
      {s.paragraphs?.map(p => <p key={p} className="cx-insp-block__p">{p}</p>)}
      <FactGrid facts={s.facts} sheet={sheet} />
    </section>
  ));
  if (q === 'far') return <>{<DistanceFacts entity={entity} />}{blocks}</>;
  if (q === 'know') return <>{sheet && <KnowSection sheet={sheet} />}{blocks}</>;
  if (q === 'do') return <><Actions entity={entity} />{blocks}</>;
  if (blocks.length === 0) return <p className="cx-insp-block__p cx-muted">No details in this section yet.</p>;
  return <>{blocks}</>;
}

const CRAFT_KINDS = new Set<string>(['spacecraft', 'satellite', 'space-station', 'rocket-body', 'debris']);

/** Disclaimer under the name of an illustrative entity: craft get a model note; others use the sheet's own description. */
function illustrativeNote(kind: string, description: string | undefined): string {
  if (CRAFT_KINDS.has(kind)) return 'Illustrative model at its real, tracked position (TLE/ephemeris); not to scale in detail.';
  if (description) return `Illustrative: ${description.replace(/^illustrative:\s*/i, '')}`;
  return 'Illustrative: no image of this object exists. Its look is generated from measured size and temperature.';
}

/**
 * The inspector plate (left reading column on the edge scrim): classification line led by a provenance-textured
 * rule, the name in Atlas, a lede, quick facts, then five sections: What, Where, How far, How do we know,
 * What can I do.
 */
export function Inspector() {
  const store = useStoreApi();
  const commands = useCommands();
  const selectedId = useCosmos(s => s.selection.id);
  const open = useCosmos(s => s.ui.inspectorOpen || s.selection.id != null);
  const entity = useEntity(selectedId);
  const [retry, setRetry] = useState(0);
  const state = useFactSheet(entity, retry);
  const [section, setSection] = useState<InspectorSectionId>('what');
  const registry = useRegistry();

  if (!open || !selectedId) return null;
  const sheet = state.status === 'ready' ? state.sheet : null;
  const close = (): void => {
    commands.select(null);
    setUi(store, { inspectorOpen: false });
  };

  if (!entity) {
    return (
      <aside className="cx-inspector" aria-label="Inspector">
        <EmptyState title="This object isn't loaded yet" action={<Button onClick={close}>Close</Button>}>
          Its catalogue may still be downloading. Try again in a moment, or search for it by name.
        </EmptyState>
      </aside>
    );
  }

  const parent = entity.parentId ? safeGetEntity(registry, entity.parentId) : undefined;
  const classification = classificationFrom(sheet) ?? (parent && ORBITING.has(entity.kind) ? `${kindLabel(entity.kind)} orbiting ${parent.name}` : kindLabel(entity.kind));
  const illustrative = entity.representation === 'illustrative' || sheet?.representation.provenance === 'illustrative';
  const lede = sheet?.summary ?? entity.tagline ?? '';
  const quick = quickFacts(sheet, 4);
  const size = nameSize(entity.name);
  const shownKeys = new Set(quick.map(f => f.key));
  const words = entity.name.split(' ');
  const longest = Math.max(...words.map(w => [...w].length));

  return (
    <aside className="cx-inspector" aria-labelledby="cx-insp-name" key={entity.id}>
      <div className="cx-inspector__top">
        <p className="cx-insp-class">
          <ProvenanceRule kind={entity.representation} width={40} />
          <span>{classification}</span>
        </p>
        <IconButton label="Close inspector" icon={X} shortcut="Escape" onClick={close} />
      </div>
      <h1 id="cx-insp-name" className={cx('cx-insp-name', `cx-insp-name--${size}`)} style={{ ['--name-chars' as string]: longest }}>
        {words.map((w, i) => (
          <span key={i}>{i > 0 && ' '}<span className="cx-insp-word">{w}</span></span>
        ))}
      </h1>
      {illustrative && (
        <p className="cx-insp-illus">
          <ProvenanceGlyph kind="illustrative" />
          {illustrativeNote(entity.kind, sheet?.representation.description)}
        </p>
      )}
      {lede ? <p className="cx-insp-lede">{lede}</p> : state.status === 'loading' ? <Skeleton lines={2} /> : null}
      {displayAliases(entity.name, entity.aliases).length > 0 && (
        <p className="cx-insp-ids">
          {displayAliases(entity.name, entity.aliases).map(a => <span key={a} className="cx-id">{a}</span>)}
        </p>
      )}

      {state.status === 'loading' && <Skeleton lines={4} className="cx-insp-skeleton" />}
      {state.status === 'error' && (
        <EmptyState title="Couldn't load the facts for this object" action={<Button size="sm" onClick={() => setRetry(r => r + 1)}>Try again</Button>}>
          {state.error}
        </EmptyState>
      )}
      {quick.length > 0 && <FactGrid facts={quick} sheet={sheet} />}

      <div className="cx-insp-tabs" role="tablist" aria-label="About this object">
        {INSPECTOR_SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`cx-insp-tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls="cx-insp-panel"
            tabIndex={section === s.id ? 0 : -1}
            className={cx('cx-insp-tab', section === s.id && 'is-on')}
            onClick={() => setSection(s.id)}
            onKeyDown={e => {
              const i = INSPECTOR_SECTIONS.findIndex(x => x.id === section);
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!d) return;
              const n = INSPECTOR_SECTIONS[(i + d + INSPECTOR_SECTIONS.length) % INSPECTOR_SECTIONS.length];
              setSection(n.id);
              (e.currentTarget.parentElement?.querySelector(`#cx-insp-tab-${n.id}`) as HTMLElement | null)?.focus();
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="cx-insp-panel" id="cx-insp-panel" role="tabpanel" aria-labelledby={`cx-insp-tab-${section}`} tabIndex={0}>
        <SectionBody q={section} entity={entity} sheet={sheet} shown={shownKeys} />
      </div>
    </aside>
  );
}


/** Aliases worth showing: drop the name itself and any alias contained in a longer one ("α Ori" inside "58 α Ori"). */
function displayAliases(name: string, aliases: readonly string[]): string[] {
  const norm = (x: string): string => x.trim().toLowerCase();
  const uniq = aliases.filter((a, i) => a && norm(a) !== norm(name) && aliases.findIndex(b => norm(b) === norm(a)) === i);
  return uniq.filter(a => !uniq.some(b => b !== a && b.length > a.length && norm(b).includes(norm(a)))).slice(0, 4);
}
