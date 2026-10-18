import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { SearchResult } from '../../core/entity';
import { useCommands, useRegistry, useRegistryVersion, setUi, useStoreApi, useCosmos } from '../hooks';
import { useUiExtensions } from '../context';
import { cx, useDebouncedValue, useFocusTrap } from '../lib/dom';
import { kindLabel } from '../icons';
import { formatDistance } from '../format';
import { Kbd } from '../components/Kbd';

const IDENTIFIER = /^(HIP|HD|HR|NGC|IC|M|NORAD|Gaia|GJ|Gliese|NAIF|TOI|KOI|Kepler|2MASS|WISE|TIC|COSPAR)\b|\d{3,}/i;

interface Group {
  kind: string;
  items: SearchResult[];
}

function groupResults(results: SearchResult[]): Group[] {
  const groups: Group[] = [];
  for (const r of results) {
    const label = kindLabel(r.record.kind);
    let g = groups.find(x => x.kind === label);
    if (!g) {
      g = { kind: label, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }
  return groups;
}

function safeSearch(fn: () => SearchResult[]): SearchResult[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/**
 * Search faceplate at top centre (Ctrl+K or /). Debounced registry search, results grouped by kind with the
 * name in Instrument, classification and distance in secondary ink, identifiers and aliases in Catalogue.
 */
export function CommandPalette() {
  const open = useCosmos(s => s.ui.searchOpen);
  const store = useStoreApi();
  const registry = useRegistry();
  const version = useRegistryVersion();
  const commands = useCommands();
  const ext = useUiExtensions();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebouncedValue(text.trim(), 90);
  const listId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useFocusTrap(panelRef, open, inputRef);

  const results = useMemo(() => (query ? safeSearch(() => registry.search(query, 24)) : []), [registry, query, version]);
  const groups = useMemo(() => groupResults(results), [results]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) setText('');
  }, [open]);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const close = (): void => setUi(store, { searchOpen: false });
  const choose = (r: SearchResult | undefined): void => {
    if (!r) return;
    close();
    void commands.focus(r.record.id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Home' && flat.length) {
      setActive(0);
    } else if (e.key === 'End' && flat.length) {
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  let index = -1;
  return (
    <>
      <div className="cx-palette-scrim" onPointerDown={close} aria-hidden="true" />
      <div ref={panelRef} className="cx-palette" role="dialog" aria-modal="true" aria-label="Search the universe" onKeyDown={onKeyDown}>
        <div className="cx-palette__field">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            className="cx-palette__input"
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={flat.length ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Search planets, stars, galaxies, spacecraft or catalogue numbers"
            value={text}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <Kbd keys="Escape" size="sm" />
        </div>
        <div className="cx-palette__results" id={listId} role="listbox" aria-label="Results">
          {query && flat.length === 0 && (
            <p className="cx-palette__empty">
              Nothing matches “{query}”. Try a name such as Jupiter or a catalogue number such as HIP 70890.
            </p>
          )}
          {!query && (
            <p className="cx-palette__hint">
              Type a name, an alias such as <span className="cx-id">α Centauri</span>, or an identifier such as{' '}
              <span className="cx-id">NORAD 25544</span>.
            </p>
          )}
          {groups.map(g => (
            <div key={g.kind} role="group" aria-label={g.kind} className="cx-palette__group">
              <div className="cx-palette__group-title" aria-hidden="true">{g.kind}</div>
              {g.items.map(r => {
                index++;
                const i = index;
                const dist = ext.cameraDistanceM?.(r.record.id) ?? null;
                const ids = [r.matched !== 'name' ? r.matchedText : null, ...r.record.aliases].filter((x, k, arr): x is string => !!x && x !== r.record.name && arr.indexOf(x) === k).slice(0, 3);
                return (
                  <div
                    key={r.record.id}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={cx('cx-palette__item', i === active && 'is-active')}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(r)}
                  >
                    <span className="cx-palette__name">{r.record.name}</span>
                    <span className="cx-palette__meta">
                      {r.record.tagline ?? kindLabel(r.record.kind)}
                      {dist != null && <span className="cx-num">, {formatDistance(dist, { secondary: 'none', sigDigits: 3 })} away</span>}
                    </span>
                    {ids.length > 0 && (
                      <span className="cx-palette__ids">
                        {ids.map(a => (
                          <span key={a} className={IDENTIFIER.test(a) ? 'cx-id' : 'cx-palette__alias'}>{a}</span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cx-palette__foot" aria-hidden="true">
          <span><Kbd keys={['ArrowUp', 'ArrowDown']} size="sm" /> move</span>
          <span><Kbd keys="Enter" size="sm" /> fly there</span>
        </div>
      </div>
    </>
  );
}
