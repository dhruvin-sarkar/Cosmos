/** Black hole lab (LabId 'relativity'): registers its panel at import time (auto-loaded by src/labs/index.ts). */
import { registerLabPanel } from '../../ui/labs/registry';
import { lazy } from 'react';

// Code-split: the panel loads the first time the lab opens.
const RelativityPanel = lazy(() => import('./RelativityPanel').then(m => ({ default: m.RelativityPanel })));

registerLabPanel('relativity', RelativityPanel, {
  title: 'Black hole lab',
  subject: 'Sagittarius A*',
  summary: 'How big a black hole is, how clocks slow near it, and how the star S2 tests Einstein at the Galactic Centre.',
});
