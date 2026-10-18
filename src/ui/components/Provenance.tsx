import type { ReactNode } from 'react';
import { PROVENANCE_DESCRIPTION, PROVENANCE_LABEL, type ProvenanceClass } from '../../data/provenance';
import { cx } from '../lib/dom';
import { Tooltip } from './Tooltip';

/**
 * Provenance marks. Meaning is carried by shape and line texture, never by colour (geological-map convention):
 * observed = filled dot / solid line; derived = ring with centre dot / solid line with ring markers;
 * reconstructed = dashed ring / dashed 9-6 line; illustrative = dotted ring / dotted 1.5-5 line.
 */
export function ProvenanceGlyph({ kind, size = 12, className }: { kind: ProvenanceClass; size?: number; className?: string }) {
  const r = 4.25;
  return (
    <svg
      className={cx('cx-prov-glyph', className)}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      data-prov={kind}
    >
      {kind === 'observed' && <circle cx="6" cy="6" r="4" fill="currentColor" />}
      {kind === 'derived' && (
        <>
          <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
        </>
      )}
      {kind === 'reconstructed' && (
        <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="3.1 2.2" />
      )}
      {kind === 'illustrative' && (
        <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="0.1 2.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

export interface ProvenanceBadgeProps {
  kind: ProvenanceClass;
  /** Show the word next to the glyph (default true; dense grids pass false and keep the legend within reach). */
  showLabel?: boolean;
  /** Extra tooltip content, e.g. the source dataset, field and model. */
  detail?: ReactNode;
  className?: string;
}

/** Glyph + word + tooltip with the class definition. Focusable so keyboard users can read the tooltip. */
export function ProvenanceBadge({ kind, showLabel = true, detail, className }: ProvenanceBadgeProps) {
  const label = PROVENANCE_LABEL[kind];
  return (
    <Tooltip
      content={
        <span className="cx-prov-tip">
          <strong>{label}</strong>
          <span>{PROVENANCE_DESCRIPTION[kind]}</span>
          {detail != null && <span className="cx-prov-tip__detail">{detail}</span>}
        </span>
      }
    >
      <span className={cx('cx-prov', showLabel && 'cx-prov--labelled', className)} tabIndex={0} role="img" aria-label={`Provenance: ${label}`}>
        <ProvenanceGlyph kind={kind} />
        {showLabel && <span className="cx-prov__label" aria-hidden="true">{label}</span>}
      </span>
    </Tooltip>
  );
}

/** A horizontal rule drawn in a provenance texture (inspector classification lines, legends). */
export function ProvenanceRule({ kind, width = 40, className }: { kind: ProvenanceClass; width?: number; className?: string }) {
  const dash = kind === 'reconstructed' ? '9 6' : kind === 'illustrative' ? '1.5 5' : undefined;
  return (
    <svg className={cx('cx-prov-rule', className)} width={width} height="8" viewBox={`0 0 ${width} 8`} aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2={width - 1}
        y2="4"
        stroke="currentColor"
        strokeWidth={kind === 'illustrative' ? 1.6 : 1}
        strokeDasharray={dash}
        strokeLinecap={kind === 'illustrative' ? 'round' : 'butt'}
      />
      {kind === 'derived' && (
        <>
          <circle cx={width * 0.33} cy="4" r="2.2" fill="var(--ink-space)" stroke="currentColor" strokeWidth="1" />
          <circle cx={width * 0.72} cy="4" r="2.2" fill="var(--ink-space)" stroke="currentColor" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

const ORDER: ProvenanceClass[] = ['observed', 'derived', 'reconstructed', 'illustrative'];

/** Compact legend of all four classes (glyph + rule + word). */
export function ProvenanceLegend({ className }: { className?: string }) {
  return (
    <ul className={cx('cx-prov-legend', className)} aria-label="Provenance legend">
      {ORDER.map(k => (
        <li key={k}>
          <ProvenanceGlyph kind={k} />
          <ProvenanceRule kind={k} width={32} />
          <span>{PROVENANCE_LABEL[k]}</span>
        </li>
      ))}
    </ul>
  );
}
