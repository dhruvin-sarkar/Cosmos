import { useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useCommands, useCosmos, useCosmosShallow, setUi, useStoreApi } from '../hooks';
import { cx } from '../lib/dom';
import { Kbd } from '../components/Kbd';
import { Popover } from '../components/Popover';
import { Tooltip } from '../components/Tooltip';
import { LayersPanel, LightPanel } from './ViewPanels';
import { bandInfo } from './spectral';
import { NavigatorButton, NavigatorHost } from '../navigator/Navigator';
import { ScaleToggle } from './ScaleToggle';

/** Default guided tour started by the Tour button (the tours module registers it under this id). */
export const DEFAULT_TOUR_ID = 'golden-journey';

function Breadcrumb() {
  const crumbs = useCosmos(s => s.view.breadcrumb);
  const commands = useCommands();
  if (crumbs.length === 0) return <nav className="cx-crumbs" aria-label="Where you are" />;
  return (
    <nav className="cx-crumbs" aria-label="Where you are">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.id}>
              {i > 0 && <span className="cx-crumbs__sep" aria-hidden="true">/</span>}
              {last ? (
                <span className="cx-crumbs__here" aria-current="location">{c.name}</span>
              ) : (
                <button type="button" className="cx-crumbs__link" onClick={() => void commands.focus(c.id)}>
                  {c.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function BarButton({
  label, shortcut, pressed, expanded, onClick, buttonRef, children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  expanded?: boolean;
  onClick(): void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  children?: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="bottom">
      <button
        ref={buttonRef}
        type="button"
        className={cx('cx-bar-btn', (pressed || expanded) && 'is-on')}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-haspopup={expanded != null ? 'dialog' : undefined}
        onClick={onClick}
      >
        {children ?? label}
      </button>
    </Tooltip>
  );
}

/** Top band: focus-chain breadcrumb (left), search (centre), view menus (right). */
export function TopBar({ tourId = DEFAULT_TOUR_ID }: { tourId?: string }) {
  const store = useStoreApi();
  const commands = useCommands();
  const ui = useCosmosShallow(s => ({ sources: s.ui.sourcesOpen, settings: s.ui.settingsOpen, help: s.ui.helpOpen }));
  const tourActive = useCosmos(s => s.tour.activeId != null);
  const band = useCosmos(s => s.spectral.band);
  const [menu, setMenu] = useState<'layers' | 'light' | null>(null);
  const layersRef = useRef<HTMLButtonElement | null>(null);
  const lightRef = useRef<HTMLButtonElement | null>(null);

  return (
    <header className="cx-topbar">
      <Breadcrumb />
      <button type="button" className="cx-search-trigger" onClick={() => setUi(store, { searchOpen: true })} aria-keyshortcuts="Control+K /">
        <Search size={16} aria-hidden />
        <span className="cx-search-trigger__text">Search</span>
        <Kbd keys="Ctrl+K" size="sm" />
      </button>
      <div className="cx-topbar__right">
        <ScaleToggle />
        <NavigatorButton />
        <BarButton label="Layers" shortcut="Shift+L" expanded={menu === 'layers'} buttonRef={layersRef} onClick={() => setMenu(m => (m === 'layers' ? null : 'layers'))} />
        <BarButton label="Light" expanded={menu === 'light'} buttonRef={lightRef} onClick={() => setMenu(m => (m === 'light' ? null : 'light'))}>
          Light{band !== 'visible' && <span className="cx-bar-btn__value">{bandInfo(band).short}</span>}
        </BarButton>
        <BarButton label={tourActive ? 'Exit tour' : 'Tour'} shortcut="T" pressed={tourActive} onClick={() => (tourActive ? commands.exitTour() : commands.startTour(tourId))} />
        <BarButton label="Sources" pressed={ui.sources} onClick={() => setUi(store, { sourcesOpen: !ui.sources, settingsOpen: false, helpOpen: false })} />
        <BarButton label="Settings" pressed={ui.settings} onClick={() => setUi(store, { settingsOpen: !ui.settings, sourcesOpen: false, helpOpen: false })} />
        <BarButton label="Help" shortcut="?" pressed={ui.help} onClick={() => setUi(store, { helpOpen: !ui.help, sourcesOpen: false, settingsOpen: false })} />
      </div>
      <Popover open={menu === 'layers'} onClose={() => setMenu(null)} anchorRef={layersRef} label="Layers" className="cx-popover--layers">
        <LayersPanel />
      </Popover>
      <Popover open={menu === 'light'} onClose={() => setMenu(null)} anchorRef={lightRef} label="Light" className="cx-popover--light">
        <LightPanel />
      </Popover>
      <NavigatorHost />
    </header>
  );
}
