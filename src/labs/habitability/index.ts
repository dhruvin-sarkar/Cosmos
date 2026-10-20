/** Habitability lab + exoplanet explorer (LabId 'habitability'): registers its panel at import time (auto-loaded by src/labs/index.ts). */
import { registerLabPanel } from '../../ui/labs/registry';
import { lazy } from 'react';

// Code-split: the panel (charts, catalogue bindings) loads the first time the lab opens.
const HabitabilityPanel = lazy(() => import('./HabitabilityPanel').then(m => ({ default: m.HabitabilityPanel })));

registerLabPanel('habitability', HabitabilityPanel, {
  title: 'Habitability lab',
  subject: 'Exoplanets',
  summary: 'Could a planet keep liquid water? Change its star, orbit, size and climate, or explore the 6,000 known exoplanets.',
});
