import { useMemo, useState } from 'react';
import type { QualityPreset } from '../../core/types';
import { listDatasets } from '../../data/manifest';
import { useCommands, useCosmos, useManifest, setUi, useStoreApi } from '../hooks';
import { Sheet } from '../components/Sheet';
import { Kbd } from '../components/Kbd';
import { SegmentedControl } from '../components/SegmentedControl';
import { Toggle } from '../components/Toggle';
import { EmptyState } from '../components/Misc';
import { ProvenanceBadge, ProvenanceLegend } from '../components/Provenance';
import { formatIsoAge, formatIsoDate } from '../format';

const KEYS: ReadonlyArray<{ group: string; items: ReadonlyArray<[string | string[], string]> }> = [
  { group: 'Travel', items: [['B', 'Solar System navigator'], ['0', 'The Sun'], ['1–8', 'Mercury to Neptune (9: Pluto)'], [['[', ']'], 'Previous or next moon'], [['Shift+[', 'Shift+]'], 'Previous or next planet']] },
  { group: 'Explore', items: [[['Ctrl+K', '/'], 'Search'], ['Escape', 'Close panel or clear selection'], ['H', 'Return home to Earth'], ['Backspace', 'Go back'], ['F', 'Follow the selected object']] },
  { group: 'Scale and time', items: [[['ArrowUp', 'ArrowDown'], 'Cosmic Ruler: step a decade (when focused)'], ['Space', 'Play or pause time'], [[',', '.'], 'Slower or faster time'], ['N', 'Time to now']] },
  { group: 'View', items: [['L', 'Labels'], ['O', 'Orbits'], ['C', 'Constellations'], ['Shift+H', 'Hide the interface'], ['`', 'Debug readout'], ['?', 'This help']] },
  { group: 'Tour', items: [['T', 'Start or exit the tour'], [['ArrowLeft', 'ArrowRight'], 'Previous or next chapter'], ['R', 'Return to demo']] },
];

const POINTER: ReadonlyArray<[string, string]> = [
  ['Drag', 'Orbit around the focus'],
  ['Scroll or pinch', 'Zoom across scales'],
  ['Click', 'Select an object'],
  ['Click a label', 'Fly to that object'],
  ['Double-click', 'Fly to an object'],
  ['Right-drag or two-finger drag', 'Pan'],
  ['Drag the ruler', 'Scrub through scale'],
];

/** Keyboard and pointer map. */
export function HelpOverlay() {
  const open = useCosmos(s => s.ui.helpOpen);
  const store = useStoreApi();
  return (
    <Sheet open={open} onClose={() => setUi(store, { helpOpen: false })} title="Help" side="center" modal>
      <div className="cx-help">
        {KEYS.map(g => (
          <section key={g.group} className="cx-help__group">
            <h3 className="cx-help__title">{g.group}</h3>
            <dl>
              {g.items.map(([k, label]) => (
                <div key={label} className="cx-help__row">
                  <dt><Kbd keys={k} /></dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="cx-help__group">
          <h3 className="cx-help__title">Mouse and touch</h3>
          <dl>
            {POINTER.map(([k, label]) => (
              <div key={k} className="cx-help__row">
                <dt className="cx-help__gesture">{k}</dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="cx-help__group cx-help__group--wide">
          <h3 className="cx-help__title">Reading provenance</h3>
          <p className="cx-help__p">Every value and visual says where it came from. The line texture and glyph carry the meaning:</p>
          <ProvenanceLegend />
        </section>
      </div>
    </Sheet>
  );
}

/** Searchable data-source registry from the manifest. */
export function SourcesPanel() {
  const open = useCosmos(s => s.ui.sourcesOpen);
  const store = useStoreApi();
  const manifest = useManifest();
  const [q, setQ] = useState('');
  const all = useMemo(() => listDatasets(manifest), [manifest]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter(d => `${d.name} ${d.organization} ${d.domain} ${d.license}`.toLowerCase().includes(t));
  }, [all, q]);

  return (
    <Sheet open={open} onClose={() => setUi(store, { sourcesOpen: false })} title="Sources" side="right" width="min(620px, calc(100vw - 32px))">
      <div className="cx-sources">
        <p className="cx-sources__intro">
          {manifest ? `${all.length} datasets, snapshot generated ${formatIsoDate(manifest.generated)}. Cosmos works offline from this snapshot.` : 'The data registry has not loaded.'}
        </p>
        <input className="cx-input" type="search" placeholder="Filter by name, organisation or licence" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter sources" />
        {manifest && list.length === 0 && <EmptyState title={`No source matches “${q}”`}>Try an organisation such as NASA or ESA.</EmptyState>}
        {!manifest && <EmptyState title="Source details unavailable">The manifest file is missing or still loading. Values still show their provenance glyphs.</EmptyState>}
        <ul className="cx-sources__list">
          {list.map(d => (
            <li key={d.id} className="cx-source">
              <div className="cx-source__head">
                <h3 className="cx-source__name">{d.name}</h3>
                <ProvenanceBadge kind={d.provenanceClass} />
              </div>
              <p className="cx-source__org">{d.organization}</p>
              <dl className="cx-source__meta">
                <div><dt>Version</dt><dd className="cx-id">{d.version}</dd></div>
                <div><dt>Retrieved</dt><dd className="cx-num">{formatIsoDate(d.retrieved)} ({formatIsoAge(d.retrieved)})</dd></div>
                <div><dt>Licence</dt><dd>{d.licenseUrl ? <a href={d.licenseUrl} target="_blank" rel="noreferrer">{d.license}</a> : d.license}</dd></div>
                <div><dt>Dataset id</dt><dd className="cx-id">{d.id}</dd></div>
              </dl>
              <p className="cx-source__cite"><span className="cx-source__k">Cite as</span> {d.citation}</p>
              {d.limitations && <p className="cx-source__lim"><span className="cx-source__k">Limitations</span> {d.limitations}</p>}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/** Quality, motion, sound and label density. */
export function SettingsPanel({ exhibition, onExhibitionChange, labelDensity, onLabelDensityChange }: {
  exhibition: boolean;
  onExhibitionChange(on: boolean): void;
  labelDensity: 'low' | 'normal' | 'high';
  onLabelDensityChange(d: 'low' | 'normal' | 'high'): void;
}) {
  const open = useCosmos(s => s.ui.settingsOpen);
  const preset = useCosmos(s => s.quality.preset);
  const effective = useCosmos(s => s.quality.effective);
  const reduced = useCosmos(s => s.ui.reducedMotion);
  const sound = useCosmos(s => s.ui.sound);
  const store = useStoreApi();
  const commands = useCommands();
  return (
    <Sheet open={open} onClose={() => setUi(store, { settingsOpen: false })} title="Settings" side="right" width="min(460px, calc(100vw - 32px))">
      <div className="cx-settings">
        <section className="cx-settings__group">
          <h3 className="cx-settings__title">Graphics quality</h3>
          <SegmentedControl<QualityPreset>
            label="Graphics quality"
            value={preset}
            onChange={v => commands.setQuality(v)}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'performance', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'ultra', label: 'Ultra' },
            ]}
          />
          <p className="cx-settings__note">{preset === 'auto' ? `Auto is using ${effective} to hold 60 frames per second.` : 'Auto adjusts detail to keep motion smooth.'}</p>
        </section>
        <section className="cx-settings__group">
          <h3 className="cx-settings__title">Labels on the sky</h3>
          <SegmentedControl
            label="Label density"
            value={labelDensity}
            onChange={onLabelDensityChange}
            options={[
              { value: 'low', label: 'Fewer' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'More' },
            ]}
          />
        </section>
        <section className="cx-settings__group">
          <Toggle checked={reduced} onCheckedChange={on => setUi(store, { reducedMotion: on })} label="Reduce motion" description="Camera travel becomes a short crossfade; no animated counters." />
          <Toggle checked={sound} onCheckedChange={on => setUi(store, { sound: on })} label="Sound" description="Quiet interface sounds." />
          <Toggle checked={exhibition} onCheckedChange={onExhibitionChange} label="Exhibition mode" description="Larger type and touch targets for a standing audience." />
        </section>
      </div>
    </Sheet>
  );
}
