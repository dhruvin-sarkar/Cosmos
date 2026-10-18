import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../lib/dom';

export type SurfaceVariant = 'panel' | 'sheet' | 'raised';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'aside' | 'nav' | 'header' | 'footer';
  /** panel: HUD clusters · sheet: reading surfaces (inspector, labs) · raised: popovers and menus. */
  variant?: SurfaceVariant;
  padding?: 'none' | 'sm' | 'md';
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/** Smoked-glass instrument surface: translucent neutral fill, hairline border, top bevel, soft shadow. */
export function Surface({ as: Tag = 'div', variant = 'panel', padding = 'none', className, children, ref, ...rest }: SurfaceProps) {
  return (
    <Tag
      ref={ref as Ref<HTMLDivElement>}
      className={cx('cx-surface', `cx-surface--${variant}`, padding !== 'none' && `cx-surface--pad-${padding}`, className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
