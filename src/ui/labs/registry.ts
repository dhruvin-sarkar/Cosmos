/**
 * Lab panel registry. Each lab module (src/labs/<id>/) registers its React panel once at import time:
 *
 *   registerLabPanel('debris', DebrisPanel, { title: 'Orbital debris lab', subject: 'Low Earth orbit' });
 *
 * The LabDrawer renders the panel for store.lab.active. Panels usually compose <LabShell> for the standard
 * Real state / Variables / Visualization / Result / Explanation / Assumptions / Compare layout.
 */
import { useSyncExternalStore, type ComponentType } from 'react';
import type { LabId } from '../../core/entity';

export interface LabPanelProps {
  labId: LabId;
  /** Parameters passed to commands.openLab (e.g. { entityId }). */
  params: Record<string, unknown> | null;
  /** Close the lab (commands.closeLab). */
  onClose(): void;
}

export interface LabPanelMeta {
  /** "Orbital debris lab". */
  title: string;
  /** The lab's subject, set in Atlas ("Low Earth orbit", "Apophis"). */
  subject?: string;
  /** One-line plain description for menus. */
  summary?: string;
}

export interface LabPanelEntry {
  labId: LabId;
  Component: ComponentType<LabPanelProps>;
  meta: LabPanelMeta;
}

const panels = new Map<LabId, LabPanelEntry>();
const listeners = new Set<() => void>();
let version = 0;

/** Register (or replace) the panel for a lab. Returns an unregister function. */
export function registerLabPanel(labId: LabId, Component: ComponentType<LabPanelProps>, meta: LabPanelMeta): () => void {
  const entry: LabPanelEntry = { labId, Component, meta };
  panels.set(labId, entry);
  version++;
  listeners.forEach(l => l());
  return () => {
    if (panels.get(labId) !== entry) return;
    panels.delete(labId);
    version++;
    listeners.forEach(l => l());
  };
}

export function getLabPanel(labId: LabId): LabPanelEntry | undefined {
  return panels.get(labId);
}

export function listLabPanels(): LabPanelEntry[] {
  return [...panels.values()];
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook: the registered panel for a lab (re-renders when panels register late). */
export function useLabPanel(labId: LabId | null): LabPanelEntry | undefined {
  useSyncExternalStore(subscribe, () => version, () => version);
  return labId ? panels.get(labId) : undefined;
}

export const DEFAULT_LAB_TITLES: Record<LabId, string> = {
  debris: 'Orbital debris lab',
  defense: 'Asteroid deflection lab',
  habitability: 'Habitability lab',
  relativity: 'Black hole lab',
};
