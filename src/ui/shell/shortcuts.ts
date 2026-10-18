import { useEffect } from 'react';
import type { AppCommands } from '../../app/commands';
import type { CosmosStore } from '../../state/store';
import { setUi } from '../hooks';
import { isTypingTarget } from '../lib/dom';
import { stepRate } from './timeRate';
import { DEFAULT_TOUR_ID } from './TopBar';

/** Global keyboard map (documented in the Help overlay). Ignored while typing in a field. */
export function useGlobalShortcuts(store: CosmosStore, commands: AppCommands, tourId = DEFAULT_TOUR_ID): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = store.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setUi(store, { searchOpen: !s.ui.searchOpen });
        return;
      }
      if (e.defaultPrevented || mod || e.altKey || isTypingTarget(e.target)) return;
      const touring = s.tour.activeId != null;
      const inDialog = (e.target as HTMLElement | null)?.closest?.('[role="dialog"],[role="slider"],[role="radiogroup"],[role="tablist"]');
      switch (e.key) {
        case '/':
          e.preventDefault();
          setUi(store, { searchOpen: true });
          break;
        case 'Escape':
          if (s.ui.searchOpen) setUi(store, { searchOpen: false });
          else if (s.ui.helpOpen || s.ui.sourcesOpen || s.ui.settingsOpen) setUi(store, { helpOpen: false, sourcesOpen: false, settingsOpen: false });
          else if (s.lab.active) commands.closeLab();
          else if (s.selection.id) commands.select(null);
          break;
        case '`':
          setUi(store, { debugOpen: !s.ui.debugOpen });
          break;
        case '?':
          setUi(store, { helpOpen: !s.ui.helpOpen });
          break;
        case 'H':
          if (e.shiftKey) setUi(store, { hudHidden: !s.ui.hudHidden });
          break;
        case 'h':
          commands.home();
          break;
        case 'Backspace':
          commands.back();
          break;
        case ' ':
          if ((e.target as HTMLElement | null)?.closest?.('button')) return;
          e.preventDefault();
          commands.togglePause();
          break;
        case '[':
          commands.setTimeRate(stepRate(s.time.rate, -1));
          break;
        case ']':
          commands.setTimeRate(stepRate(s.time.rate, 1));
          break;
        case 'n':
          commands.timeToNow();
          break;
        case 'l':
          commands.toggleOverlay('labels');
          break;
        case 'o':
          commands.toggleOverlay('orbits');
          break;
        case 'c':
          commands.toggleOverlay('constellations');
          break;
        case 'f':
          if (s.selection.id) {
            void commands.focus(s.selection.id);
            commands.setCameraMode('follow');
          }
          break;
        case 't':
          if (touring) commands.exitTour();
          else commands.startTour(tourId);
          break;
        case 'r':
          if (!touring) return;
          commands.tourRestartStep();
          break;
        case 'ArrowRight':
          if (!touring || inDialog) return;
          commands.tourNext();
          break;
        case 'ArrowLeft':
          if (!touring || inDialog) return;
          commands.tourPrev();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, commands, tourId]);
}
