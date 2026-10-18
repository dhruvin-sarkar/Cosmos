import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { IconComponent } from '../icons';
import { cx } from '../lib/dom';

export interface TabItem {
  id: string;
  label: string;
  icon?: IconComponent;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange(id: string): void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab / panel element ids (must be unique on the page). */
  idPrefix: string;
  className?: string;
}

export const tabId = (prefix: string, id: string): string => `${prefix}-tab-${id.replace(/[^\w-]/g, '_')}`;
export const panelId = (prefix: string, id: string): string => `${prefix}-panel-${id.replace(/[^\w-]/g, '_')}`;

/** Tab strip with roving focus; scrolls horizontally when tabs overflow and keeps the active tab in view. */
export function Tabs({ items, value, onChange, label, idPrefix, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, value))}`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value, idPrefix]);

  const enabled = items.filter(i => !i.disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const idx = enabled.findIndex(i => i.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = enabled[next];
    onChange(item.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, item.id))}`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={cx('cx-tabs', className)} onKeyDown={onKeyDown}>
      {items.map(item => {
        const selected = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            id={tabId(idPrefix, item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={cx('cx-tabs__tab', selected && 'cx-tabs__tab--on')}
            onClick={() => onChange(item.id)}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix: string;
  id: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idPrefix, id, children, className }: TabPanelProps) {
  return (
    <div role="tabpanel" id={panelId(idPrefix, id)} aria-labelledby={tabId(idPrefix, id)} tabIndex={0} className={cx('cx-tabpanel', className)}>
      {children}
    </div>
  );
}
