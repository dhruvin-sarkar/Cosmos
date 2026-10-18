/** Pure helpers that map a FactSheet onto the inspector's five questions. */
import type { Entity } from '../../core/entity';
import type { Fact, FactSection, FactSheet } from '../../data/provenance';

export type InspectorSectionId = 'what' | 'where' | 'far' | 'know' | 'do';

export const INSPECTOR_SECTIONS: ReadonlyArray<{ id: InspectorSectionId; label: string }> = [
  { id: 'what', label: 'What' },
  { id: 'where', label: 'Where' },
  { id: 'far', label: 'How far' },
  { id: 'know', label: 'How do we know' },
  { id: 'do', label: 'What can I do' },
];

const SECTION_MAP: Record<string, InspectorSectionId> = {
  overview: 'what',
  properties: 'what',
  science: 'what',
  orbit: 'where',
  position: 'where',
  location: 'where',
  distance: 'far',
  observations: 'know',
  sources: 'know',
  discovery: 'know',
  experiment: 'do',
};

/** Which inspector question a fact-sheet section answers (unknown ids go to "What"). */
export function questionFor(section: Pick<FactSection, 'id'>): InspectorSectionId {
  return SECTION_MAP[String(section.id)] ?? 'what';
}

export function sectionsFor(sheet: FactSheet | null, q: InspectorSectionId): FactSection[] {
  if (!sheet) return [];
  return sheet.sections.filter(s => questionFor(s) === q);
}

const CLASSIFICATION_KEYS = ['classification', 'class', 'type', 'morphology', 'spectralType', 'spectral-type'];

/** Real taxonomy line ("Terrestrial planet", "M5.5 V red dwarf"), when the sheet carries one as text. */
export function classificationFrom(sheet: FactSheet | null): string | null {
  if (!sheet) return null;
  for (const s of sheet.sections) {
    for (const f of s.facts) if (CLASSIFICATION_KEYS.includes(f.key) && f.text?.trim()) return f.text.trim();
  }
  return null;
}

/** First few facts for the two-column quick-facts grid (overview first, then properties). */
export function quickFacts(sheet: FactSheet | null, max = 4): Fact[] {
  if (!sheet) return [];
  const ordered = [...sheet.sections].sort((a, b) => rank(a) - rank(b));
  const out: Fact[] = [];
  for (const s of ordered) {
    for (const f of s.facts) {
      if (CLASSIFICATION_KEYS.includes(f.key)) continue;
      out.push(f);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function rank(s: FactSection): number {
  return s.id === 'overview' ? 0 : s.id === 'properties' ? 1 : 2;
}

/** Atlas size step: names up to 10 characters use atlas-xl, longer names atlas-l. */
export function nameSize(name: string): 'xl' | 'l' {
  return [...name].length <= 10 ? 'xl' : 'l';
}

/** Entities sharing a lab capability → the lab ids they open. */
export function labsOf(entity: Entity): string[] {
  return entity.capabilities.filter(c => c.startsWith('experiment:')).map(c => c.slice('experiment:'.length));
}
