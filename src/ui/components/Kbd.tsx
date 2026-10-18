import { Fragment } from 'react';
import { cx } from '../lib/dom';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_LABEL: Record<string, string> = {
  Ctrl: IS_MAC ? '⌘' : 'Ctrl',
  Mod: IS_MAC ? '⌘' : 'Ctrl',
  Alt: IS_MAC ? '⌥' : 'Alt',
  Shift: IS_MAC ? '⇧' : 'Shift',
  Enter: '↵',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Space: 'Space',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Backspace: 'Backspace',
};

const KEY_SPOKEN: Record<string, string> = {
  '`': 'backquote',
  '/': 'slash',
  '?': 'question mark',
  '[': 'left bracket',
  ']': 'right bracket',
  '↵': 'Enter',
  '↑': 'up arrow',
  '↓': 'down arrow',
  '←': 'left arrow',
  '→': 'right arrow',
};

/** "Ctrl+K" → ["Ctrl", "K"]; a lone "+" stays a key. */
export function parseShortcut(shortcut: string): string[] {
  if (shortcut === '+') return ['+'];
  return shortcut.split('+').map(k => k.trim()).filter(Boolean);
}

export function keyLabel(key: string): string {
  return KEY_LABEL[key] ?? key;
}

export function spokenShortcut(shortcut: string): string {
  return parseShortcut(shortcut)
    .map(k => keyLabel(k))
    .map(k => KEY_SPOKEN[k] ?? k)
    .join(' ');
}

export interface KbdProps {
  /** "Ctrl+K", "L", "Space"… Several alternatives may be passed as an array (rendered "Ctrl K or /"). */
  keys: string | string[];
  className?: string;
  /** Visual size: default inline caps, or 'sm' inside tooltips. */
  size?: 'sm' | 'md';
}

/** Keyboard key caps. Purely visual: the accessible text is provided by the surrounding control. */
export function Kbd({ keys, className, size = 'md' }: KbdProps) {
  const alternatives = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={cx('cx-kbd-group', size === 'sm' && 'cx-kbd-group--sm', className)}>
      {alternatives.map((alt, i) => (
        <Fragment key={alt}>
          {i > 0 && <span className="cx-kbd-or">or</span>}
          {parseShortcut(alt).map(k => (
            <kbd key={k} className="cx-kbd">
              {keyLabel(k)}
            </kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
