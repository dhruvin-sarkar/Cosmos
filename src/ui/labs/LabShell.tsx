import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { cx } from '../lib/dom';
import { useReducedMotion } from '../hooks';
import { Button, IconButton } from '../components/Button';

export interface LabCompareRow {
  label: string;
  /** Formatted values (the lab formats with its own units). */
  real: string;
  modified: string;
  difference: string;
}

export interface LabResult {
  /** What the number means, one line: "Chance of a catastrophic collision in 10 years". */
  caption: string;
  /** The headline value, numeric part only ("3.1"). */
  value: string;
  /** Unit or suffix ("%", "K", "years"). */
  unit?: string;
  /** Numeric value for the count-up animation (optional). */
  numeric?: number;
  /** Optional decimals used while counting up. */
  decimals?: number;
}

export interface LabShellProps {
  /** "Debris lab". */
  title: string;
  /** "Low Earth orbit" (Atlas voice). */
  subject?: string;
  /** True when any variable differs from real data: shows the Scenario banner. */
  modified: boolean;
  onReset(): void;
  onClose?(): void;
  /** Real catalogue values the scenario starts from. */
  realState?: ReactNode;
  /** Sliders and switches (use <Slider scale="log"> for decades). */
  variables?: ReactNode;
  /** A chart or canvas drawn in the bracketed viewport; omit to frame the live 3D view. */
  visualization?: ReactNode;
  result?: LabResult;
  compare?: LabCompareRow[];
  explanation?: ReactNode;
  assumptions?: ReactNode;
  className?: string;
}

function CountUp({ result }: { result: LabResult }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(result.value);
  const from = useRef<number | null>(null);
  useEffect(() => {
    const target = result.numeric;
    if (reduced || target == null || !Number.isFinite(target) || from.current == null) {
      setShown(result.value);
      from.current = target ?? null;
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / 400);
      const e = 1 - (1 - k) ** 3;
      setShown(k >= 1 ? result.value : (start + (target - start) * e).toFixed(result.decimals ?? 1));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    from.current = target;
    return () => cancelAnimationFrame(raf);
  }, [result.value, result.numeric, result.decimals, reduced]);
  return <>{shown}</>;
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="cx-lab-sec" open={defaultOpen}>
      <summary className="cx-lab-sec__title">{title}</summary>
      <div className="cx-lab-sec__body">{children}</div>
    </details>
  );
}

/**
 * Standard lab layout. Left column: Reality / Scenario banner, Real state, Variables, Result (Experiment voice)
 * with the Real / Modified / Difference row, Explanation and Assumptions. The visualization sits in a bracketed
 * viewport with réseau crosses in the scene area. "Reset to real data" is always visible.
 */
export function LabShell({
  title, subject, modified, onReset, onClose, realState, variables, visualization, result, compare, explanation, assumptions, className,
}: LabShellProps) {
  return (
    <>
      <section className={cx('cx-lab', modified && 'cx-lab--modified', className)} aria-label={title}>
        <header className="cx-lab__head">
          <p className="cx-lab__title">
            {title}
            {subject && <span className="cx-lab__crumb"> / {subject}</span>}
          </p>
          <div className="cx-lab__head-actions">
            <Button size="sm" variant={modified ? 'secondary' : 'quiet'} icon={RotateCcw} disabled={!modified} onClick={onReset}>
              Reset to real data
            </Button>
            {onClose && <IconButton label="Close lab" icon={X} shortcut="Escape" onClick={onClose} />}
          </div>
        </header>
        <div className={cx('cx-lab__banner', modified ? 'is-modified' : 'is-real')} role="status">
          <span className="cx-lab__banner-swatch" aria-hidden="true" />
          {modified ? 'Scenario: you changed real values. Results below are hypothetical.' : 'Reality: every value comes from catalogue data.'}
        </div>
        {subject && <h2 className="cx-lab__subject">{subject}</h2>}
        <div className="cx-lab__scroll">
          {realState && (
            <section className="cx-lab-block" aria-label="Real state">
              <h3 className="cx-lab-block__title">Real state</h3>
              {realState}
            </section>
          )}
          {variables && (
            <section className="cx-lab-block" aria-label="Variables">
              <h3 className="cx-lab-block__title">Variables</h3>
              <div className="cx-lab__vars">{variables}</div>
            </section>
          )}
          {result && (
            <section className="cx-lab-block cx-lab-result" aria-label="Result" aria-live="polite">
              <p className="cx-lab-result__caption">{result.caption}</p>
              <p className={cx('cx-lab-result__value', modified && 'is-modified')}>
                <CountUp result={result} />
                {result.unit && <span className="cx-lab-result__unit">{result.unit}</span>}
              </p>
              {compare && compare.length > 0 && (
                <table className="cx-lab-compare">
                  <thead>
                    <tr>
                      <th scope="col"><span className="cx-sr-only">Quantity</span></th>
                      <th scope="col" className="is-real">Real</th>
                      <th scope="col" className="is-modified">Modified</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map(r => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        <td className="is-real cx-num">{r.real}</td>
                        <td className="is-modified cx-num">{r.modified}</td>
                        <td className="cx-num">{r.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
          {explanation && <Section title="Explanation" defaultOpen>{explanation}</Section>}
          {assumptions && <Section title="Assumptions">{assumptions}</Section>}
        </div>
      </section>
      <div className={cx('cx-lab-viewport cx-brackets', visualization ? 'has-content' : 'is-live')} aria-hidden={visualization ? undefined : true}>
        <span className="cx-brackets__b" />
        <div className="cx-lab-viewport__reseau cx-reseau-grid" aria-hidden="true" />
        {visualization && <div className="cx-lab-viewport__content">{visualization}</div>}
      </div>
    </>
  );
}
