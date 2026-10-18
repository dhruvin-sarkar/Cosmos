/**
 * Domain discovery. Every folder under src/domains/ with a domain.ts exporting `domain` registers itself,
 * so a domain lands in the app without anyone editing a shared file. domain.ts must not import runtime
 * values from src/app/** (createCosmos imports this module; type-only imports are fine).
 */
import type { DomainDefinition } from '../app/createCosmos';
import { createPlaceholderDomain } from './_placeholder';

export interface DiscoveredDomain extends DomainDefinition {
  /** Render/registration order, lowest first: sky 0-9, stars 10-19, galaxy 20-29, solar 30-39, earth 40-49, orbital 50-59. */
  order?: number;
  /** Entity ids this domain owns. The placeholder retires as soon as a real domain provides any of its ids. */
  provides?: string[];
}

const PLACEHOLDER_IDS = ['sol:sun', 'sol:earth', 'sol:moon'];

const modules = import.meta.glob<{ domain?: DiscoveredDomain }>('./*/domain.ts', { eager: true });

export function discoverDomains(): DiscoveredDomain[] {
  const found = Object.values(modules)
    .map((m) => m.domain)
    .filter((d): d is DiscoveredDomain => d !== undefined);
  found.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
  const provided = new Set(found.flatMap((d) => d.provides ?? []));
  if (!PLACEHOLDER_IDS.some((id) => provided.has(id))) {
    found.unshift({ id: 'placeholder', order: 0, create: () => createPlaceholderDomain() });
  }
  return found;
}
