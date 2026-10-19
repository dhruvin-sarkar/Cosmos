/**
 * Sky sandbox: sky + stars domains through the real engine.
 * Query: ?ra=266&dec=-29   look direction (deg, ICRS) from 1 AU behind the Sun
 *        &scale=11         Cosmic Ruler scale (field width proxy)
 *        &band=visible     spectral band (SpectralBandId)
 *        &grid=eq,ecl,gal  coordinate grids
 *        &from=pc,ra,dec   camera at that heliocentric position instead
 *        &stars=0          hide catalogue stars;  &quality=ultra|high|low
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createSkyDomain } from '../src/domains/sky';
import { createStarsDomain } from '../src/domains/stars';
import { AU_M, PC_M } from '../src/core/units';
import { createPlaceholderEntities } from '../src/domains/_placeholder/entities';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const timeMs = params.get('t') ? Date.parse(params.get('t')!) : Date.parse('2026-10-18T22:00:00Z');
const sky = createSkyDomain();
if (params.get('style')) sky.runtime.style = params.get('style') as never;
const stars = params.get('stars') === '0' ? null : createStarsDomain();
const grids = (params.get('grid') ?? '').split(',');
const app = bootSandbox({
  layers: [...sky.layers, ...(stars ? stars.layers : [])],
  entities: createPlaceholderEntities(),
  focusId: 'sol:sun',
  timeMs,
  overlays: {
    labels: params.get('labels') !== '0',
    orbits: false,
    'grid-equatorial': grids.includes('eq'),
    'grid-ecliptic': grids.includes('ecl'),
    'grid-galactic': grids.includes('gal'),
  },
});
const quality = params.get('quality');
if (quality) app.store.setState({ quality: { ...app.store.getState().quality, preset: quality as never } });
const band = params.get('band');
if (band) app.store.setState({ spectral: { band: band as never } });
app.store.setState({ time: { ...app.store.getState().time, paused: true } });

const DEG = Math.PI / 180;
const dirOf = (ra: number, dec: number): THREE.Vector3 =>
  new THREE.Vector3(Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG));

void app.ready.then(async () => {
  const look = dirOf(num('ra', 266), num('dec', -29));
  let offset: THREE.Vector3;
  if (params.has('from')) {
    const [pc, ra, dec] = params.get('from')!.split(',').map(Number);
    offset = dirOf(ra, dec).multiplyScalar(pc * PC_M);
  } else offset = look.clone().multiplyScalar(-AU_M);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, new THREE.Vector3(0, 0, 1));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  await app.engine.services.cameraController.setView(
    { anchorId: 'sol:sun', offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'free', focusId: null, scaleLog10: num('scale', 11) },
    { instant: true },
  );
});
(window as unknown as { __app: unknown }).__app = app;
