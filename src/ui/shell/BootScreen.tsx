import { useCosmosShallow, useManifest } from '../hooks';
import { cx, usePresence } from '../lib/dom';
import { formatIsoDateLong } from '../format';
import { Progress } from '../components/Spinner';
import { Button } from '../components/Button';

/** Boot: wordmark, progress, data snapshot date. Fades out on boot.phase 'ready'; explains WebGL failures. */
export function BootScreen() {
  const boot = useCosmosShallow(s => ({ phase: s.boot.phase, progress: s.boot.progress, message: s.boot.message, error: s.boot.error, webgl: s.boot.webgl }));
  const manifest = useManifest();
  const show = boot.phase !== 'ready' || boot.webgl === 'unsupported';
  const { mounted, visible } = usePresence(show, 700);
  if (!mounted) return null;
  const unsupported = boot.webgl === 'unsupported';
  const failed = boot.phase === 'error';

  return (
    <div className={cx('cx-boot', visible && 'is-visible')} role={failed || unsupported ? 'alert' : 'status'} aria-live="polite" aria-busy={!failed && !unsupported}>
      <div className="cx-boot__mark">
        <h1 className="cx-boot__word">Cosmos</h1>
        <p className="cx-boot__sub">AstroNexus</p>
      </div>
      {unsupported ? (
        <div className="cx-boot__msg">
          <p className="cx-boot__line">This browser can't draw 3D graphics (WebGL 2 is unavailable).</p>
          <p className="cx-boot__detail">Open Cosmos in a current version of Chrome, Edge or Firefox with hardware acceleration turned on.</p>
        </div>
      ) : failed ? (
        <div className="cx-boot__msg">
          <p className="cx-boot__line">Cosmos couldn't start.</p>
          <p className="cx-boot__detail">{boot.error ?? 'An unknown error stopped the engine.'}</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      ) : (
        <div className="cx-boot__msg">
          <Progress value={boot.progress} label="Loading Cosmos" className="cx-boot__progress" />
          <p className="cx-boot__detail">{boot.message}</p>
        </div>
      )}
      {manifest && <p className="cx-boot__snapshot">Data snapshot {formatIsoDateLong(manifest.generated)}</p>}
    </div>
  );
}
