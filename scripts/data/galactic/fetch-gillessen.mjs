import { cached, CDSARC, log } from './lib.mjs';
const t3 = await cached('vizier/J_ApJ_837_30/table3.dat', `${CDSARC}/J/ApJ/837/30/table3.dat`);
log('table3.dat bytes', t3.text.length);
console.log(t3.text.split('\n').slice(0, 4).join('\n'));
