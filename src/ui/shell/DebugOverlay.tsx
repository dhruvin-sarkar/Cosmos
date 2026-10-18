import type { PerfSnapshot } from '../../core/types';
import { useCosmos, useCosmosShallow, useInterval } from '../hooks';
import { useUiExtensions } from '../context';
import { formatDistance, formatSimDate } from '../format';

/** The engine's debug handle (window.__cosmos) is typed by core; the overlay only needs perf(). */
function debugPerf(): PerfSnapshot | null {
  const handle = (window as unknown as { __cosmos?: { perf?: () => PerfSnapshot | null } }).__cosmos;
  return handle?.perf?.() ?? null;
}

function readPerf(get?: () => PerfSnapshot | null): PerfSnapshot | null {
  try {
    return get?.() ?? debugPerf();
  } catch {
    return null;
  }
}

const n = (v: number | null | undefined, d = 1): string => (v == null || !Number.isFinite(v) ? 'Unknown' : v.toFixed(d));

/** Developer readout (toggle with `): perf snapshot at 2 Hz plus view state. */
export function DebugOverlay() {
  const open = useCosmos(s => s.ui.debugOpen);
  const ext = useUiExtensions();
  useInterval(500, open);
  const v = useCosmosShallow(s => ({
    scale: s.view.scaleLog10, dist: s.view.focusDistanceM, frame: s.view.frameLabel, focus: s.camera.focusId, sel: s.selection.id,
    mode: s.camera.mode, t: s.time.simTimeMs, q: s.quality.effective, band: s.spectral.band,
  }));
  if (!open) return null;
  const p = readPerf(ext.perf);
  const rows: Array<[string, string]> = [
    ['FPS', n(p?.fps, 0)],
    ['CPU frame', `${n(p?.cpuFrameMs)} ms`],
    ['GPU frame', p?.gpuFrameMs == null ? 'Unknown' : `${n(p.gpuFrameMs)} ms`],
    ['Worst frame', `${n(p?.worstFrameMs)} ms`],
    ['Draw calls', n(p?.drawCalls, 0)],
    ['Triangles', n(p?.triangles, 0)],
    ['Points', n(p?.points, 0)],
    ['Textures', n(p?.textures, 0)],
    ['JS heap', p?.jsHeapMB == null ? 'Unknown' : `${n(p.jsHeapMB, 0)} MB`],
    ['Pixel ratio', `${n(p?.pixelRatio, 2)} × ${n(p?.renderScale, 2)}`],
    ['Quality', v.q],
    ['Scale', Number.isFinite(v.scale) ? `${v.scale.toFixed(2)} (log₁₀ m)` : 'Unknown'],
    ['Focus distance', formatDistance(v.dist, { secondary: 'none' })],
    ['Frame', v.frame || 'Unknown'],
    ['Focus', v.focus ?? 'None'],
    ['Selection', v.sel ?? 'None'],
    ['Camera', v.mode],
    ['Band', v.band],
    ['Sim time', formatSimDate(v.t, { style: 'iso' })],
  ];
  return (
    <aside className="cx-debug" aria-label="Debug readout">
      <dl>
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="cx-id">{val}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
