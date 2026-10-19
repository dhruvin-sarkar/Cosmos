/**
 * Features sandbox: every auto-discovered domain (the real app scene, no React UI) with the surface-feature layer.
 * Query:
 *   ?site=feat:moon:apollo-11                    travel (instant) to a feature → the layer's sunlit view above the site
 *   ?body=sol:moon&lat=0&lon=0&dist=3.2          camera above (lat, lon) of a body at `dist` radii, north up
 *   &t=2026-10-18T12:00:00Z  &select=<id>  &true=1 (true scale)  &labels=0
 */
import * as THREE from 'three';
import { createCosmos } from '../src/app/createCosmos';
import { createCosmosStore, DEFAULT_OVERLAYS } from '../src/state/store';
import { installIdmSafeFetch } from '../src/core/idmSafeFetch';
import { discoverDomains } from '../src/domains';
import { bodyFrame, surfaceNormal } from '../src/domains/features/bodyFrames';
import { renderTransform, setVisualScaleMode } from '../src/core/visualScale';
installIdmSafeFetch();

const params = new URLSearchParams(location.search);
const t = params.get('t');
const timeMs = t ? Date.parse(t) : Date.parse('2026-10-18T12:00:00Z');

document.documentElement.style.cssText = 'height:100%;background:#000;';
document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000;';
const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0;';
document.body.appendChild(container);

const store = createCosmosStore({ overlays: { ...DEFAULT_OVERLAYS, labels: params.get('labels') !== '0' } });
const trueScale = params.get('true') === '1';
if (trueScale) {
  store.setState({ visualScale: 'true' } as never);
  setVisualScaleMode('true', true);
}
const site = params.get('site');
const body = params.get('body') ?? (site ? null : 'sol:moon');
const app = createCosmos({ container, store, initialFocusId: body ?? 'sol:earth', timeMs, domains: discoverDomains() });
store.setState({ time: { ...store.getState().time, paused: true } });

void app.ready.then(async () => {
  const rig = app.engine.services.cameraController;
  if (site) {
    await app.commands.focus(site, { instant: true });
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  if (!body) return;
  const e = app.registry.get(body);
  if (!e) return;
  const key = body.split(':')[1];
  const frame = bodyFrame(key);
  const lat = Number(params.get('lat') ?? 0), lon = Number(params.get('lon') ?? 0), dist = Number(params.get('dist') ?? 3.2);
  const q = new THREE.Quaternion();
  if (frame) frame.orient(timeMs, q);
  const n = surfaceNormal(lat, lon, new THREE.Vector3()).applyQuaternion(q);
  const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const R = e.radiusM ?? 1e6;
  const h = R * dist;
  const up = pole.clone().addScaledVector(n, -pole.dot(n)).normalize();
  const x = new THREE.Vector3().crossVectors(up, n).normalize();
  const m = new THREE.Matrix4().makeBasis(x, up, n);
  const qc = new THREE.Quaternion().setFromRotationMatrix(m);
  const p = new THREE.Vector3();
  renderTransform(e, timeMs, p);
  await rig.setView(
    { anchorId: body, offset: [n.x * h, n.y * h, n.z * h], quaternion: [qc.x, qc.y, qc.z, qc.w], mode: 'orbit', focusId: body, scaleLog10: Math.log10(h) },
    { instant: true },
  );
  const sel = params.get('select');
  if (sel) app.commands.select(sel);
});
