/**
 * Spacecraft sandbox: verification presets for the craft models (src/domains/smallbodies/craft*). Each preset opens the
 * small-bodies sandbox (solar + small-bodies domains through the real engine) framed on one craft.
 * ?preset=<key> jumps straight to it; otherwise a list of links is shown.
 */
const PRESETS: Record<string, string> = {
  jwst: 'focus=sc:jwst&dist=3&phase=70&elev=18',
  'jwst-halo': 'focus=sc:jwst&dist=1.5e8&phase=90&elev=60',
  'voyager-1': 'focus=sc:voyager-1&dist=3&phase=60&elev=20',
  'voyager-2': 'focus=sc:voyager-2&dist=3&phase=60&elev=20',
  'new-horizons': 'focus=sc:new-horizons&dist=3.5&phase=60&elev=20',
  juno: 'focus=sc:juno&dist=3&phase=60&elev=20',
  parker: 'focus=sc:parker-solar-probe&dist=3.2&phase=70&elev=15&t=2026-12-02T01:00:00Z',
  'europa-clipper': 'focus=sc:europa-clipper&dist=3&phase=60&elev=20',
  psyche: 'focus=sc:psyche&dist=3&phase=60&elev=20',
  lucy: 'focus=sc:lucy&dist=3&phase=60&elev=20',
  hera: 'focus=sc:hera&dist=3&phase=60&elev=20',
  juice: 'focus=sc:juice&dist=3&phase=60&elev=20',
  bepicolombo: 'focus=sc:bepicolombo&dist=3&phase=60&elev=20',
  'solar-orbiter': 'focus=sc:solar-orbiter&dist=3&phase=60&elev=20',
  cassini: 'focus=sc:cassini&dist=3.2&phase=60&elev=15&t=2010-06-01T00:00:00Z',
  dart: 'focus=sc:dart&dist=3.2&phase=60&elev=15&t=2022-09-26T23:13:00Z',
};

const preset = new URLSearchParams(location.search).get('preset');
if (preset && PRESETS[preset]) location.replace(`./small-bodies.html?${PRESETS[preset]}&asteroids=0`);
else {
  document.body.insertAdjacentHTML('beforeend', '<h1>Spacecraft presets</h1>');
  for (const [k, q] of Object.entries(PRESETS)) document.body.insertAdjacentHTML('beforeend', `<a href="./small-bodies.html?${q}&asteroids=0">${k}</a>`);
}
export {};
