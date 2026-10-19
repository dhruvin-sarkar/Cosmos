// Baumgardt & Vasiliev 2021 (MNRAS 505, 5957) globular-cluster distances + kinematics from the authors' site (table of 162 clusters).
import { cached, log } from './lib.mjs';
export const BV_URL = 'https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt';
const r = await cached('baumgardt/orbits_table.txt', BV_URL);
log('orbits_table.txt', r.text.split('\n').length, 'lines');
