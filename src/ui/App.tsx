import { useEffect, useState, type Ref } from 'react';
import type { AppContextValue } from '../app/commands';
import { AppContextProvider, type CosmosUiExtensions } from './context';
import { useCommands, useCosmos, useStoreApi } from './hooks';
import { cx } from './lib/dom';
import { TopBar, DEFAULT_TOUR_ID } from './shell/TopBar';
import { CommandPalette } from './shell/CommandPalette';
import { TimeControls } from './shell/TimeControls';
import { BodyStrip } from './shell/BodyStrip';
import { TourCard } from './shell/TourCard';
import { SelectionReticle } from './shell/SelectionReticle';
import { BootScreen } from './shell/BootScreen';
import { DebugOverlay } from './shell/DebugOverlay';
import { HelpOverlay, SettingsPanel, SourcesPanel } from './shell/Panels';
import { useGlobalShortcuts } from './shell/shortcuts';
import { CosmicRuler } from './ruler/CosmicRuler';
import { Inspector } from './inspector/Inspector';
import { LabDrawer } from './labs/LabDrawer';
import { NoticeToasts } from './components/Misc';
import { Button } from './components/Button';

export interface CosmosAppProps {
  ctx: AppContextValue;
  /** Optional engine queries (distances, screen bounds, tour content, perf). */
  extensions?: CosmosUiExtensions;
  /** Receives the full-bleed viewport element the engine canvas mounts into (null on unmount). */
  viewportRef?: Ref<HTMLDivElement>;
  /** Tour started by the Tour button and the T key. */
  tourId?: string;
  /** Extra layer rendered between the viewport and the HUD (sandboxes use it for a backdrop). */
  backdrop?: React.ReactNode;
}

type Density = 'low' | 'normal' | 'high';

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked; the preference just won't persist */
  }
}

function Hud({ tourId }: { tourId: string }) {
  const store = useStoreApi();
  const commands = useCommands();
  useGlobalShortcuts(store, commands, tourId);
  const hidden = useCosmos(s => s.ui.hudHidden);
  const lab = useCosmos(s => s.lab.active != null);
  const selected = useCosmos(s => s.selection.id != null);
  const touring = useCosmos(s => s.tour.activeId != null);
  const reduced = useCosmos(s => s.ui.reducedMotion);
  const [exhibition, setExhibition] = useState(() => readPref('cosmos.exhibition', 'false', ['true', 'false']) === 'true');
  const [density, setDensity] = useState<Density>(() => readPref<Density>('cosmos.labelDensity', 'normal', ['low', 'normal', 'high']));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion = String(reduced);
    root.dataset.exhibition = String(exhibition);
    root.dataset.labelDensity = density;
  }, [reduced, exhibition, density]);

  const column = lab ? 'lab' : selected ? 'inspector' : touring ? 'tour' : null;

  return (
    <div className={cx('cx-hud', hidden && 'is-hidden', column && 'has-column', lab && 'has-lab')} data-column={column ?? undefined}>
      <div className="cx-scrim cx-scrim--top" aria-hidden="true" />
      <div className="cx-scrim cx-scrim--right" aria-hidden="true" />
      <div className="cx-scrim cx-scrim--bottom" aria-hidden="true" />
      <div className="cx-scrim cx-scrim--left" aria-hidden="true" />
      <SelectionReticle />
      <TopBar tourId={tourId} />
      <div className="cx-column">
        {column === 'lab' && <LabDrawer />}
        {column === 'inspector' && <Inspector />}
        {column === 'tour' && <TourCard />}
      </div>
      <CosmicRuler className="cx-hud__ruler" />
      <footer className="cx-bottom">
        <TimeControls />
        <BodyStrip />
        {touring && column !== 'tour' && (
          <Button variant="secondary" className="cx-return-demo" onClick={() => { commands.select(null); commands.tourRestartStep(); }}>
            Return to demo
          </Button>
        )}
      </footer>
      <NoticeToasts />
      <CommandPalette />
      <HelpOverlay />
      <SourcesPanel />
      <SettingsPanel
        exhibition={exhibition}
        onExhibitionChange={on => {
          setExhibition(on);
          writePref('cosmos.exhibition', String(on));
        }}
        labelDensity={density}
        onLabelDensityChange={d => {
          setDensity(d);
          writePref('cosmos.labelDensity', d);
        }}
      />
      <DebugOverlay />
    </div>
  );
}

/** The whole Cosmos UI: full-bleed viewport host for the engine canvas plus every HUD layer. */
export function CosmosApp({ ctx, extensions, viewportRef, tourId = DEFAULT_TOUR_ID, backdrop }: CosmosAppProps) {
  return (
    <AppContextProvider value={ctx} extensions={extensions}>
      <div className="cx-app">
        <div ref={viewportRef} className="cx-viewport" />
        {backdrop}
        <Hud tourId={tourId} />
        <BootScreen />
      </div>
    </AppContextProvider>
  );
}
