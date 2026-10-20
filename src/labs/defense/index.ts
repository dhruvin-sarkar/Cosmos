/**
 * Asteroid deflection lab (LabId 'defense'): Part 1 replays the DART impact on Dimorphos (26 Sep 2022), Part 2 lets the
 * visitor defend Earth from a hypothetical impactor. Registered at import time (auto-discovered by src/labs/index.ts).
 */
import { registerLabPanel } from '../../ui/labs/registry';
import { lazy } from 'react';

// Code-split: the panel (charts, KaTeX, simulations) loads the first time the lab opens.
const DefensePanel = lazy(() => import('./DefensePanel').then(m => ({ default: m.DefensePanel })));

registerLabPanel('defense', DefensePanel, {
  title: 'Asteroid deflection lab',
  subject: 'Didymos and Dimorphos',
  summary: 'Replay NASA\'s DART impact, then try to push a hypothetical asteroid off a collision course with Earth.',
});
