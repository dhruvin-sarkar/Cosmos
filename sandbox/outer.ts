/**
 * Outer-system sandbox: solar + small-bodies (Voyager craft) + outer domains (+ placeholder Earth/Moon) through the real engine.
 * Query: ?dist=<AU>&elev=<deg>&azim=<ecliptic lon deg>&at=<AU x>,<y>,<z>(ecliptic offset of the look-at point, default Sun)
 *        &focus=<entity id>&t=<ISO>&paused=1&labels=1&orbits=1&rings=1
 * The camera is anchored on the focus (default 'sol:sun'): place it `dist` AU away at ecliptic longitude `azim`, elevation `elev`.
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createSolarDomain } from '../src/domains/solar';
import { createPlaceholderEntities, createPlaceholderBodiesLayer } from '../src/domains/_placeholder';
import { domain as smallBodies } from '../src/domains/smallbodies/domain';
import { domain as outer } from '../src/domains/outer/domain';
import { createRegistry } from '../src/core/registry';
import { AU_M } from '../src/core/units';
import { eclipticToIcrs, sphericalToVector } from '../src/core/frames';

const params = new URLSearchParams(location.search);
const t = params.get('t');
const timeMs = t ? Date.parse(t) : Date.parse('2026-10-18T12:00:00Z');
let registryRef = createRegistry();
const lazyReg = new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] });
const solar = createSolarDomain({ registry: lazyReg, nowMs: () => app.store.getState().time.simTimeMs });
const ph = createPlaceholderEntities().filter((e) => e.id !== 'sol:sun');
const ctxArg = { registry: lazyReg, store: undefined as never, manifest: () => null };
const sb = smallBodies.create(ctxArg);
const out = outer.create(ctxArg);
await (sb.layers[2] as unknown as { ready: Promise<void> }).ready;
const focus = params.get('focus') ?? 'sol:sun';
const app = bootSandbox({
  layers: [...solar.layers, ...sb.layers, ...out.layers, createPlaceholderBodiesLayer(ph)],
  entities: [...solar.entities, ...(sb.entities ?? []), ...(out.entities ?? []), ...ph],
  focusId: focus,
  timeMs,
  overlays: {
    asteroids: params.get('asteroids') !== '0',
    orbits: params.get('orbits') !== '0',
    labels: params.get('labels') !== '0',
    'scale-markers': params.get('rings') !== '0',
  },
});
registryRef = app.registry as typeof registryRef;
if (params.get('paused') !== '0') app.store.setState({ time: { ...app.store.getState().time, paused: true } });
void app.ready.then(async () => {
  const dist = Number(params.get('dist') ?? '300') * AU_M;
  const elev = Number(params.get('elev') ?? '30');
  const azim = Number(params.get('azim') ?? '255');
  const cam = eclipticToIcrs(sphericalToVector(azim, elev, dist, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  const offset = new THREE.Vector3(cam.x, cam.y, cam.z);
  const [ax, ay, az] = (params.get('at') ?? '0,0,0').split(',').map(Number);
  const target = eclipticToIcrs({ x: ax * AU_M, y: ay * AU_M, z: az * AU_M }, { x: 0, y: 0, z: 0 });
  const look = new THREE.Vector3(target.x, target.y, target.z).sub(offset).normalize();
  const north = new THREE.Vector3(0, -Math.sin((23.4392911 * Math.PI) / 180), Math.cos((23.4392911 * Math.PI) / 180));
  const up = Math.abs(look.dot(north)) > 0.98 ? new THREE.Vector3(0, 1, 0) : north;
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), look, up));
  await app.engine.services.cameraController.setView(
    { anchorId: focus, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: focus, scaleLog10: Math.log10(offset.length()) },
    { instant: true },
  );
});
(window as unknown as { __outer: unknown }).__outer = out;
