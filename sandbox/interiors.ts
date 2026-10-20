// Interior cutaway sandbox: ?body=earth&compare=mars&mode=temperature&layer=0
import '../src/styles/index.css';
import { openInterior } from '../src/ui/interiors/open';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') === 'temperature' ? 'temperature' : 'material';
const layer = q.get('layer');
openInterior(q.get('body') ?? 'earth', {
  initialCompare: q.get('compare'),
  initialMode: mode,
  initialLayer: layer != null ? Number(layer) : null,
});
(window as unknown as { __cosmos?: { ready: Promise<void> } }).__cosmos = { ready: new Promise(r => setTimeout(r, 300)) } as never;
