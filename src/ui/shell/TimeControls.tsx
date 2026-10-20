import { useState } from 'react';
import { ChevronLeft, ChevronRight, FastForward, History, Pause, Play, Rewind, RotateCcw } from 'lucide-react';
import { cx } from '../lib/dom';
import { useCommands, useCosmosShallow, useStoreApi } from '../hooks';
import { formatSimDate } from '../format';
import { Button, IconButton } from '../components/Button';
import { Kbd } from '../components/Kbd';
import { compactRate, isLive, rateInWords, stepRate } from './timeRate';
import { openSettingsAt } from './settingsNav';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function DateJump({ simTimeMs }: { simTimeMs: number }) {
  const commands = useCommands();
  const d = new Date(simTimeMs);
  const valid = Number.isFinite(d.getTime());
  const simDate = valid ? `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
  const simTime = valid ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '00:00';
  // The fields follow the simulation clock until the visitor edits one; Go hands them back to the clock.
  const [draft, setDraft] = useState<{ date: string; time: string } | null>(null);
  const date = draft?.date ?? simDate;
  const time = draft?.time ?? simTime;
  const setDate = (v: string): void => setDraft({ date: v, time });
  const setTime = (v: string): void => setDraft({ date, time: v });
  const [error, setError] = useState<string | null>(null);
  const submit = (): void => {
    const ms = Date.parse(`${date}T${time || '00:00'}:00Z`);
    if (!Number.isFinite(ms)) {
      setError('Enter a date as YYYY-MM-DD and a time as HH:MM.');
      return;
    }
    setError(null);
    setDraft(null);
    commands.jumpToTime(ms);
  };
  return (
    <form
      className="cx-datejump"
      aria-label="Go to a date"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="cx-datejump__row">
        <label className="cx-field">
          <span className="cx-field__label">Date (UTC)</span>
          <input className="cx-input cx-num" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        <label className="cx-field">
          <span className="cx-field__label">Time (UTC)</span>
          <input className="cx-input cx-num" type="time" value={time} onChange={e => setTime(e.target.value)} />
        </label>
        <Button variant="secondary" type="submit" className="cx-datejump__go">Go</Button>
      </div>
      {error && <p className="cx-field__error" role="alert">{error}</p>}
    </form>
  );
}

/**
 * The "Time" section of the Settings panel: play / pause, the UTC date and time, the rate stepper in words with
 * reverse, Now, and "Go to a date". The keyboard map (Space, comma, full stop, N) works everywhere.
 */
export function TimeSettings() {
  const commands = useCommands();
  const t = useCosmosShallow(s => ({ ms: s.time.simTimeMs, rate: s.time.rate, paused: s.time.paused }));
  const live = isLive(t.ms, t.rate, t.paused);

  return (
    <div className={cx('cx-time', t.paused && 'is-paused')} role="group" aria-label="Time controls">
      <div className="cx-time__row">
        <button
          type="button"
          className="cx-time__play cursor-target"
          data-cursor-label={t.paused ? 'Play' : 'Pause'}
          aria-label={t.paused ? 'Play' : 'Pause'}
          aria-keyshortcuts="Space"
          onClick={() => commands.togglePause()}
        >
          {t.paused ? <Play size={16} aria-hidden className="cx-time__play-icon" /> : <Pause size={16} aria-hidden />}
        </button>
        <p className="cx-time__date cx-num" aria-label={`Simulation time ${formatSimDate(t.ms, { style: 'long' })}`}>
          <span className="cx-time__day">{formatSimDate(t.ms, { style: 'date' })}</span>
          <span className="cx-time__clock">{formatSimDate(t.ms, { style: 'time', seconds: true })}</span>
        </p>
        {live ? (
          <span className="cx-time__live" title="The clock shows the present moment">
            <span className="cx-time__live-dot" aria-hidden="true" />
            Live
          </span>
        ) : (
          <Button variant="quiet" size="sm" className="cx-time__now" icon={RotateCcw} onClick={() => commands.timeToNow()}>
            Now
          </Button>
        )}
      </div>
      <div className="cx-time__rate" role="group" aria-label="Speed">
        <IconButton
          label="Slower or reverse"
          icon={ChevronLeft}
          shortcut=","
          size="sm"
          className="cx-time__step"
          onClick={() => commands.setTimeRate(stepRate(t.rate, -1))}
        />
        <span className={cx('cx-time__words', t.rate < 0 && 'is-reverse')} aria-live="polite">{rateInWords(t.rate, t.paused)}</span>
        <IconButton
          label="Faster"
          icon={ChevronRight}
          shortcut="."
          size="sm"
          className="cx-time__step"
          onClick={() => commands.setTimeRate(stepRate(t.rate, 1))}
        />
      </div>
      <DateJump simTimeMs={t.ms} />
      <p className="cx-settings__note">
        <Kbd keys="Space" size="sm" /> play or pause, <Kbd keys={[',', '.']} size="sm" /> slower or faster, <Kbd keys="N" size="sm" /> now.
      </p>
    </div>
  );
}

/**
 * One discreet chip under the breadcrumb, shown only while the sky on screen is not "now" (paused, sped up, reversed
 * or jumped to another date). Clicking it opens Settings at Time. When the clock is live nothing time-related shows.
 */
export function TimeStatusChip() {
  const store = useStoreApi();
  // Coarse resolution so the chip does not re-render every store tick: minutes at slow rates, days when time races.
  const t = useCosmosShallow(s => ({
    minute: Math.abs(s.time.rate) >= 3_600 && !s.time.paused ? Math.floor(s.time.simTimeMs / 86_400_000) * 1440 : Math.floor(s.time.simTimeMs / 60_000),
    rate: s.time.rate,
    paused: s.time.paused,
    live: isLive(s.time.simTimeMs, s.time.rate, s.time.paused),
  }));
  if (t.live) return null;
  const ms = t.minute * 60_000;
  const fast = Math.abs(t.rate) >= 3_600 && !t.paused;
  const when = fast ? formatSimDate(ms, { style: 'date' }) : `${formatSimDate(ms, { style: 'date' })} ${formatSimDate(ms, { style: 'time', seconds: false })}`;
  const state = t.paused ? 'Paused' : t.rate !== 1 ? compactRate(t.rate) : null;
  const Icon = t.paused ? Pause : t.rate < 0 ? Rewind : t.rate !== 1 ? FastForward : History;
  const spoken = `${state ? `${t.paused ? 'Time paused' : `Time running at ${rateInWords(t.rate)}`}, ` : 'Not the present: '}${formatSimDate(ms, { style: 'long' })}. Open time settings`;
  return (
    <button
      type="button"
      className={cx('cx-timechip cursor-target', t.paused && 'is-paused')}
      data-cursor-label="Time settings"
      aria-label={spoken}
      onClick={() => openSettingsAt(store, 'time')}
    >
      <Icon size={13} aria-hidden className="cx-timechip__icon" />
      {state && <span className="cx-timechip__state">{state}</span>}
      {state && <span className="cx-timechip__sep" aria-hidden="true">·</span>}
      <span className="cx-timechip__when cx-num">{when}</span>
    </button>
  );
}
