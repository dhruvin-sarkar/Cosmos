import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { dismissNotice, type Notice } from '../../state/store';
import { useCosmos, useStoreApi } from '../hooks';
import { cx } from '../lib/dom';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** An empty or failed region says what happened and what to do next. */
export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('cx-empty', className)} role="status">
      <p className="cx-empty__title">{title}</p>
      {children && <p className="cx-empty__body">{children}</p>}
      {action && <div className="cx-empty__action">{action}</div>}
    </div>
  );
}

export interface SectionHeaderProps {
  title: string;
  id?: string;
  /** Trailing content (a count, a toggle, a badge). */
  aside?: ReactNode;
  level?: 2 | 3;
  className?: string;
}

/** Section heading: a hairline above and the title in Instrument (sentence case, no eyebrow). */
export function SectionHeader({ title, id, aside, level = 3, className }: SectionHeaderProps) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('cx-section-head', className)}>
      <H id={id} className="cx-section-head__title">{title}</H>
      {aside && <div className="cx-section-head__aside">{aside}</div>}
    </div>
  );
}

function ToastItem({ notice }: { notice: Notice }) {
  const store = useStoreApi();
  useEffect(() => {
    if (notice.ttlMs == null) return;
    const id = window.setTimeout(() => dismissNotice(store, notice.id), notice.ttlMs);
    return () => window.clearTimeout(id);
  }, [store, notice.id, notice.ttlMs]);
  return (
    <li className={cx('cx-toast', `cx-toast--${notice.kind}`)} role={notice.kind === 'error' ? 'alert' : undefined}>
      <span className="cx-toast__mark" aria-hidden="true" />
      <p className="cx-toast__text">{notice.text}</p>
      <button type="button" className="cx-toast__close" aria-label="Dismiss notice" onClick={() => dismissNotice(store, notice.id)}>
        <X size={16} aria-hidden />
      </button>
    </li>
  );
}

/** store.notices as dismissible toasts in a polite live region (errors are assertive alerts). */
export function NoticeToasts() {
  const notices = useCosmos(s => s.notices);
  return (
    <ol className="cx-toasts" aria-live="polite" aria-label="Notices">
      {notices.slice(-4).map(n => (
        <ToastItem key={n.id} notice={n} />
      ))}
    </ol>
  );
}
