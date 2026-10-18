/**
 * Core runtime sandbox: the TEMPORARY placeholder domain (Sun, Earth, Moon, illustrative stars) through the
 * real engine, without the React UI. Query params: ?focus=sol:moon&scale=9&t=2026-10-17T12:00:00Z
 */
import { bootSandbox } from './harness';
import { createPlaceholderDomain } from '../src/domains/_placeholder';

const params = new URLSearchParams(location.search);
const domain = createPlaceholderDomain();
const t = params.get('t');
const app = bootSandbox({
  layers: domain.layers,
  entities: domain.entities,
  focusId: params.get('focus') ?? 'sol:earth',
  timeMs: t ? Date.parse(t) : undefined,
});
const scale = Number(params.get('scale'));
if (params.has('scale') && Number.isFinite(scale)) void app.ready.then(() => app.commands.setScale(scale, { animate: false }));
