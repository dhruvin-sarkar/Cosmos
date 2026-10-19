/** Orbital debris lab (LabId 'debris'): registers its panel at import time (auto-loaded by src/labs/index.ts). */
import { registerLabPanel } from '../../ui/labs/registry';
import { DebrisPanel } from './DebrisPanel';

registerLabPanel('debris', DebrisPanel, {
  title: 'Orbital debris lab',
  subject: 'Low Earth orbit',
  summary: 'How crowded low Earth orbit is today, how policies change its future, and how one collision fills an orbit with fragments.',
});
