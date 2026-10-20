import { useRef, useState, type ReactNode } from 'react';
import { BookOpen, CircleHelp, Layers, Route, Search, SlidersHorizontal, Waves } from 'lucide-react';
import { useCommands, useCosmos, useCosmosShallow, setUi, useStoreApi } from '../hooks';
import { cx } from '../lib/dom';
import type { IconComponent } from '../icons';
import { Kbd } from '../components/Kbd';
import { Popover } from '../components/Popover';
import { Tooltip } from '../components/Tooltip';
import { LayersPanel, LightPanel } from './ViewPanels';
import { bandInfo } from './spectral';
import { NavigatorButton, NavigatorHost } from '../navigator/Navigator';
import { useFocusFramed } from '../navigator/framing';
import { SkyEvents } from '../events/SkyEvents';
import { TimeStatusChip } from './TimeControls';

/** Default guided tour started by the Tour button (the tours module registers it under this id). */
export const DEFAULT_TOUR_ID = 'golden-journey';

/**
 * The focus chain, zooming out to the left. Long chains collapse their middle segments (CSS container query on
 * .cx-topbar__lead) behind an ellipsis; the Planets navigator and the ruler still reach every level.
 */
function Breadcrumb() {
  const crumbs = useCosmos(s => s.view.breadcrumb);
  const focus = useFocusFramed();
  if (crumbs.length === 0) return <nav className="cx-crumbs" aria-label="Where you are" />;
  return (
    <nav className="cx-crumbs" aria-label="Where you are">
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const middle = i > 0 && i < crumbs.length - 2;
          return (
            <li key={c.id} className={cx(i === 0 && 'is-root', middle && 'is-middle', last && 'is-here')}>
              {i > 0 && <span className="cx-crumbs__sep" aria-hidden="true">/</span>}
              {last ? (
                <span className="cx-crumbs__here" aria-current="location">{c.name}</span>
              ) : (
                <button
                  type="button"
                  className="cx-crumbs__link cursor-target"
                  data-cursor-label={`Zoom out to ${c.name}`}
                  onClick={() => void focus(c.id)}
                >
                  {c.name}
                </button>
              )}
              {i === 0 && crumbs.length > 3 && (
                <span className="cx-crumbs__more" aria-hidden="true">
                  <span className="cx-crumbs__sep">/</span>…
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function BarButton({
  label, tooltip, shortcut, icon: Icon, iconOnly, pressed, expanded, onClick, buttonRef, children, className,
}: {
  label: string;
  /** Longer tooltip text (defaults to the label). */
  tooltip?: ReactNode;
  shortcut?: string;
  icon?: IconComponent;
  /** Utility buttons show only their icon; the label stays the accessible name and the tooltip. */
  iconOnly?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  onClick(): void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip content={tooltip ?? label} shortcut={shortcut} side="bottom">
      <button
        ref={buttonRef}
        type="button"
        className={cx('cx-bar-btn', 'cursor-target', iconOnly && 'cx-bar-btn--icon', (pressed || expanded) && 'is-on', className)}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-haspopup={expanded != null ? 'dialog' : undefined}
        aria-label={iconOnly ? label : undefined}
        onClick={onClick}
      >
        {Icon && <Icon size={18} aria-hidden className="cx-bar-btn__icon" />}
        {!iconOnly && <span className="cx-bar-btn__label">{children ?? label}</span>}
      </button>
    </Tooltip>
  );
}

/**
 * Top band. Left: where you are (breadcrumb) and, only while the sky is not "now", one time status chip beneath it
 * (time and view scale live in Settings). Centre: search. Right: one toolbar grouped as travel (Planets, What's up), view (Layers, Light, Tour)
 * and utilities (Sources, Settings, Help as icons with tooltips).
 */
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
      <div className="cx-topbar__lead">
        <Breadcrumb />
        <TimeStatusChip />
      </div>
      <button
        type="button"
        className="cx-search-trigger cursor-target"
        data-cursor-label="Search"
        onClick={() => setUi(store, { searchOpen: true })}
        aria-keyshortcuts="Control+K /"
      >
        <Search size={18} aria-hidden />
        <span className="cx-search-trigger__text">Search planets, moons and stars</span>
        <Kbd keys="Ctrl+K" size="sm" />
      </button>
      <div className="cx-topbar__right">
        <div className="cx-toolbar" role="group" aria-label="Explore and view">
          <NavigatorButton />
          <SkyEvents />
          <span className="cx-toolbar__sep" aria-hidden="true" />
          <BarButton
            label="Layers"
            tooltip="Layers: orbits, labels and overlays"
            icon={Layers}
            shortcut="Shift+L"
            expanded={menu === 'layers'}
            buttonRef={layersRef}
            onClick={() => setMenu(m => (m === 'layers' ? null : 'layers'))}
          />
          <BarButton
            label="Light"
            tooltip="Light: see the sky in other wavelengths"
            icon={Waves}
            expanded={menu === 'light'}
            buttonRef={lightRef}
            onClick={() => setMenu(m => (m === 'light' ? null : 'light'))}
          >
            Light{band !== 'visible' && <span className="cx-bar-btn__value">{bandInfo(band).short}</span>}
          </BarButton>
          <BarButton
            label={tourActive ? 'Exit tour' : 'Tour'}
            tooltip={tourActive ? 'Exit the guided tour' : 'Start the guided tour'}
            icon={Route}
            shortcut="T"
            pressed={tourActive}
            onClick={() => (tourActive ? commands.exitTour() : commands.startTour(tourId))}
          />
          <span className="cx-toolbar__sep" aria-hidden="true" />
          <BarButton
            label="Sources"
            tooltip="Sources and credits"
            icon={BookOpen}
            iconOnly
            pressed={ui.sources}
            onClick={() => setUi(store, { sourcesOpen: !ui.sources, settingsOpen: false, helpOpen: false })}
          />
          <BarButton
            label="Settings"
            icon={SlidersHorizontal}
            iconOnly
            pressed={ui.settings}
            onClick={() => setUi(store, { settingsOpen: !ui.settings, sourcesOpen: false, helpOpen: false })}
          />
          <BarButton
            label="Help"
            tooltip="Help and keyboard shortcuts"
            icon={CircleHelp}
            iconOnly
            shortcut="?"
            pressed={ui.help}
            onClick={() => setUi(store, { helpOpen: !ui.help, sourcesOpen: false, settingsOpen: false })}
          />
        </div>
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
