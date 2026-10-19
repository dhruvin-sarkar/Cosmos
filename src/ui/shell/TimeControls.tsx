import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCommands, useCosmosShallow } from '../hooks';
import { formatSimDate } from '../format';
import { Popover } from '../components/Popover';
import { Button, IconButton } from '../components/Button';
import { Tooltip } from '../components/Tooltip';
import { rateInWords, stepRate } from './timeRate';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function DateJump({ simTimeMs, onDone }: { simTimeMs: number; onDone(): void }) {
  const commands = useCommands();
  const d = new Date(simTimeMs);
  const valid = Number.isFinite(d.getTime());
  const [date, setDate] = useState(valid ? `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '');
  const [time, setTime] = useState(valid ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '00:00');
  const [error, setError] = useState<string | null>(null);
  const submit = (): void => {
    const ms = Date.parse(`${date}T${time || '00:00'}:00Z`);
    if (!Number.isFinite(ms)) {
      setError('Enter a date as YYYY-MM-DD and a time as HH:MM.');
      return;
    }
    commands.jumpToTime(ms);
    onDone();
  };
  return (
    <form
      className="cx-datejump"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="cx-pop-title">Go to a date</h2>
      <div className="cx-datejump__row">
        <label className="cx-field">
          <span className="cx-field__label">Date (UTC)</span>
          <input className="cx-input cx-num" type="date" value={date} onChange={e => setDate(e.target.value)} data-autofocus />
        </label>
        <label className="cx-field">
          <span className="cx-field__label">Time (UTC)</span>
          <input className="cx-input cx-num" type="time" value={time} onChange={e => setTime(e.target.value)} />
        </label>
      </div>
      {error && <p className="cx-field__error" role="alert">{error}</p>}
      <div className="cx-datejump__actions">
        <Button variant="quiet" onClick={() => { commands.timeToNow(); onDone(); }}>Now</Button>
        <Button variant="primary" type="submit">Go to date</Button>
      </div>
    </form>
  );
}

/** Bottom-left time instrument: circular play/pause, rate stepper (with reverse), UTC date readout, "Now". */
export function TimeControls() {
  const commands = useCommands();
  const t = useCosmosShallow(s => ({ ms: s.time.simTimeMs, rate: s.time.rate, paused: s.time.paused }));
  const [jumpOpen, setJumpOpen] = useState(false);
  const dateRef = useRef<HTMLButtonElement | null>(null);
  const words = rateInWords(t.rate, t.paused);
  const nearNow = Math.abs(t.ms - Date.now()) < 120_000 && t.rate === 1 && !t.paused;

  return (
    <div className="cx-time" role="group" aria-label="Time">
      <Tooltip content={t.paused ? 'Play' : 'Pause'} shortcut="Space" side="top">
        <button type="button" className="cx-time__play" aria-label={t.paused ? 'Play' : 'Pause'} aria-keyshortcuts="Space" onClick={() => commands.togglePause()}>
          {t.paused ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
        </button>
      </Tooltip>
      
      <button ref={dateRef} type="button" className="cx-time__date cx-num" aria-label={`Simulation time ${formatSimDate(t.ms, { style: 'long' })}. Change date`} aria-expanded={jumpOpen} aria-haspopup="dialog" onClick={() => setJumpOpen(o => !o)}>
        <span className="cx-time__day">{formatSimDate(t.ms, { style: 'date' })}</span>
        <span className="cx-time__clock">{formatSimDate(t.ms, { style: 'time', seconds: true })}</span>
      </button>
      <div className="cx-time__rate">
        <IconButton label="Slower or reverse" icon={ChevronLeft} shortcut="," tooltipSide="top" onClick={() => commands.setTimeRate(stepRate(t.rate, -1))} />
        <span className="cx-time__words" aria-live="polite">{words}</span>
        <IconButton label="Faster" icon={ChevronRight} shortcut="." tooltipSide="top" onClick={() => commands.setTimeRate(stepRate(t.rate, 1))} />
      </div>
      
      <Button variant="quiet" size="sm" className="cx-time__now" disabled={nearNow} onClick={() => commands.timeToNow()}>
        Now
      </Button>
      <Popover open={jumpOpen} onClose={() => setJumpOpen(false)} anchorRef={dateRef} label="Go to a date" side="top" align="start">
        <DateJump simTimeMs={t.ms} onDone={() => setJumpOpen(false)} />
      </Popover>
    </div>
  );
}
