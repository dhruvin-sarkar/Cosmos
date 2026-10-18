import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { cx } from '../lib/dom';

export interface EquationProps {
  /** TeX source, e.g. "T_{eq} = T_\\star \\sqrt{R_\\star / 2a}\\,(1-A)^{1/4}". */
  tex: string;
  display?: boolean;
  /** Plain-language reading for assistive technology. */
  label?: string;
  className?: string;
}

/** KaTeX equation. Invalid TeX renders as the source in mono rather than throwing. */
export function Equation({ tex, display = false, label, className }: EquationProps) {
  const html = useMemo(() => {
    try {
      // KaTeX escapes its input and trust:false blocks href/html commands, so the output is safe to inject.
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', trust: false });
    } catch {
      return null;
    }
  }, [tex, display]);
  if (html == null) return <code className={cx('cx-eq', 'cx-id', className)}>{tex}</code>;
  return (
    <span
      className={cx('cx-eq', display && 'cx-eq--display', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
