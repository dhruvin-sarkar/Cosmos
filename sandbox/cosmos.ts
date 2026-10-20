/**
 * Galaxies + cosmology sandbox (plus the Milky Way 'galaxy' domain when ?mw=1).
 * Query: ?focus=<entity id> (default gal:m31) &dist=<Mpc from the focus>
 *        &from=earth|side|<x>,<y>,<z>  (camera direction from the focus: 'earth' = towards the Sun, 'side' = perpendicular,
 *        or an ICRS vector) &elev=<deg> (tilt the 'side' direction towards ICRS +Z)
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { domain as galaxies } from '../src/domains/galaxies/domain';
import { domain as cosmology } from '../src/domains/cosmology/domain';
import { domain as galaxy } from '../src/domains/galaxy/domain';
import { MPC_M } from '../src/core/units';

const params = new URLSearchParams(location.search);
const ctxArg = { registry: undefined as never, store: undefined as never, manifest: () => null };
const parts = [galaxies.create(ctxArg), cosmology.create(ctxArg)];
if (params.get('mw') === '1') parts.push(galaxy.create(ctxArg));
const focus = params.get('focus') ?? 'gal:m31';
const app = bootSandbox({
  layers: parts.flatMap((p) => p.layers),
  entities: parts.flatMap((p) => p.entities ?? []),
  providers: parts.flatMap((p) => p.providers ?? []),
  timeMs: Date.parse('2026-10-18T12:00:00Z'),
  overlays: { labels: params.get('labels') !== '0' },
});

async function place(): Promise<void> {
  let e = app.registry.get(focus);
  for (let i = 0; !e && i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); e = app.registry.get(focus); }
  if (!e) { console.error('no entity', focus); return; }
  const p = e.position(0, new THREE.Vector3());
  const toSun = p.lengthSq() > 0 ? p.clone().negate().normalize() : new THREE.Vector3(1, 0, 0);
  const from = params.get('from') ?? 'earth';
  let dir: THREE.Vector3;
  if (from === 'earth') dir = toSun;
  else if (from === 'side') {
    const side = new THREE.Vector3().crossVectors(toSun, new THREE.Vector3(0, 0, 1)).normalize();
    const el = (Number(params.get('elev') ?? '25') * Math.PI) / 180;
    dir = side.multiplyScalar(Math.cos(el)).addScaledVector(new THREE.Vector3(0, 0, 1), Math.sin(el)).normalize();
  } else {
    const [x, y, z] = from.split(',').map(Number);
    dir = new THREE.Vector3(x, y, z).normalize();
  }
  const dist = Number(params.get('dist') ?? '1') * MPC_M;
  const offset = dir.clone().multiplyScalar(dist);
  const look = dir.clone().negate();
  const up = Math.abs(look.z) > 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), look, up));
  await app.engine.services.cameraController.setView(
    { anchorId: focus, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: focus, scaleLog10: Math.log10(dist) },
    { instant: true },
  );
  (window as unknown as { __placed: boolean }).__placed = true;
}
void app.ready.then(place);
(window as unknown as { __parts: unknown }).__parts = parts;
const qp = params.get('q');
if (qp) app.store.setState({ quality: { ...app.store.getState().quality, preset: qp as never, effective: qp as never } });
