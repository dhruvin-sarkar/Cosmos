import type { OverlayId, SpectralBandId } from '../../core/types';
import { useCommands, useCosmos, useStoreApi } from '../hooks';
import { setVisualScale } from '../../state/store';
import { Toggle } from '../components/Toggle';
import { cx } from '../lib/dom';
import { SPECTRAL_BANDS, bandInfo } from './spectral';

const LAYERS: ReadonlyArray<{ id: OverlayId; label: string; description?: string; key?: string }> = [
  { id: 'labels', label: 'Labels', key: 'L' },
  { id: 'orbits', label: 'Orbits', key: 'O' },
  { id: 'satellites', label: 'Satellites', description: 'Active payloads from the public catalogue' },
  { id: 'debris', label: 'Debris', description: 'Tracked fragments and rocket bodies' },
  { id: 'spacecraft', label: 'Spacecraft' },
  { id: 'asteroids', label: 'Asteroids' },
  { id: 'constellations', label: 'Constellations', key: 'C' },
  { id: 'grid-equatorial', label: 'Equatorial grid' },
  { id: 'grid-ecliptic', label: 'Ecliptic grid' },
  { id: 'grid-galactic', label: 'Galactic grid' },
  { id: 'habitable-zones', label: 'Habitable zones' },
  { id: 'milkyway-procedural', label: 'Milky Way reconstruction', description: 'A model built from survey data, not a photograph' },
];

/** Layers popover body: one switch per scientific overlay. */
export function LayersPanel() {
  const overlays = useCosmos(s => s.overlays);
  const exhibition = useCosmos(s => s.visualScale === 'exhibition');
  const store = useStoreApi();
  const commands = useCommands();
  return (
    <div className="cx-layers">
      <h2 className="cx-pop-title">Layers</h2>
      <Toggle
        checked={exhibition}
        onCheckedChange={on => setVisualScale(store, on ? 'exhibition' : 'true')}
        label="Exhibition scale"
        description="Bodies enlarged for visibility, true size up close; distances unchanged"
      />
      <div className="cx-layers__list">
        {LAYERS.map(l => (
          <Toggle
            key={l.id}
            checked={overlays[l.id]}
            onCheckedChange={on => commands.setOverlay(l.id, on)}
            label={l.label}
            description={l.description}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Light popover body: the spectral switcher as segments in wavelength order on a log-wavelength axis, with the
 * survey name and "what you are detecting".
 */
export function LightPanel() {
  const band = useCosmos(s => s.spectral.band);
  const commands = useCommands();
  const info = bandInfo(band);
  const lo = SPECTRAL_BANDS[SPECTRAL_BANDS.length - 1].log10Wavelength;
  const hi = SPECTRAL_BANDS[0].log10Wavelength;
  const choose = (id: SpectralBandId): void => commands.setSpectralBand(id);

  return (
    <div className="cx-light">
      <h2 className="cx-pop-title">Light</h2>
      <div
        className="cx-light__bands"
        role="radiogroup"
        aria-label="Wavelength band"
        onKeyDown={e => {
          const i = SPECTRAL_BANDS.findIndex(b => b.id === band);
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const next = SPECTRAL_BANDS[(i + d + SPECTRAL_BANDS.length) % SPECTRAL_BANDS.length];
          choose(next.id);
          (e.currentTarget.querySelector(`[data-band="${next.id}"]`) as HTMLElement | null)?.focus();
        }}
      >
        {SPECTRAL_BANDS.map(b => (
          <button
            key={b.id}
            type="button"
            role="radio"
            data-band={b.id}
            aria-checked={b.id === band}
            tabIndex={b.id === band ? 0 : -1}
            className={cx('cx-light__band', b.id === band && 'is-on')}
            onClick={() => choose(b.id)}
          >
            {b.short}
          </button>
        ))}
      </div>
      <div className="cx-light__axis" aria-hidden="true">
        {SPECTRAL_BANDS.map(b => (
          <span
            key={b.id}
            className={cx('cx-light__mark', b.id === band && 'is-on')}
            style={{ left: `${((hi - b.log10Wavelength) / (hi - lo)) * 100}%` }}
          />
        ))}
        <span className="cx-light__axis-end cx-light__axis-end--l">1 m</span>
        <span className="cx-light__axis-end cx-light__axis-end--r">10⁻¹⁵ m</span>
      </div>
      <div className="cx-light__caption" aria-live="polite">
        <p className="cx-light__name">
          {info.label} <span className="cx-light__wl cx-num">{info.wavelength}</span>
        </p>
        <p className="cx-light__survey">{info.survey}</p>
        <p className="cx-light__detect">{info.detecting}</p>
      </div>
    </div>
  );
}
