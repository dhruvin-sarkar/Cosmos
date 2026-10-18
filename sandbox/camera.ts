/**
 * Camera sandbox: a self-contained three.js loop over a small synthetic universe (astronomy-engine planet
 * positions, a procedural Milky Way disc and cosmic-web point cloud) driving the real camera rig.
 *
 * Mouse: drag orbit · right/Shift-drag look · wheel zoom · double-click focus. Keys: arrows, +/−, F (free), WASD/QE.
 * Headless hooks: window.__cam (rig, store, setTimeRate, sampleFrames).
 */
import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import type { Entity, EntityKind } from '../src/core/entity';
import type { CameraMode, EngineEvents } from '../src/core/types';
import { createRegistry } from '../src/core/registry';
import { createEventBus } from '../src/core/events';
import { createCosmosStore } from '../src/state/store';
import { applyProjectionShift, createCameraRig, type CameraFrameState } from '../src/core/camera/rig';
import { horizonView } from '../src/core/camera/shots';
import { contextCrumbs } from '../src/core/camera/focusChain';
import { GALACTIC_CENTER_DIRECTION_ICRS, galacticToIcrs, raDecDistToIcrs } from '../src/core/frames';
import { AU_M, DEG, KPC_M, MPC_M, PC_M } from '../src/core/units';
import { lengthInBestUnit } from '../src/core/scale';

const FOV_DEG = 50;
const FOV = FOV_DEG * DEG;

// ── Synthetic universe ──────────────────────────────────────────────────────────────────────

interface BodySpec {
  id: string; name: string; parent: string | null; kind: EntityKind; radius: number | null; color: number;
  pos: (t: number, out: THREE.Vector3) => THREE.Vector3; contextScaleMin?: number; importance?: number;
}

const helio = (body: Astronomy.Body) => (t: number, out: THREE.Vector3) => {
  const v = Astronomy.HelioVector(body, new Date(t));
  return out.set(v.x * AU_M, v.y * AU_M, v.z * AU_M);
};
const fixed = (x: number, y: number, z: number) => (_t: number, out: THREE.Vector3) => out.set(x, y, z);

const earthPos = helio(Astronomy.Body.Earth);
const scratchE = new THREE.Vector3();
const moonPos = (t: number, out: THREE.Vector3) => {
  const g = Astronomy.GeoVector(Astronomy.Body.Moon, new Date(t), false);
  earthPos(t, scratchE);
  return out.set(scratchE.x + g.x * AU_M, scratchE.y + g.y * AU_M, scratchE.z + g.z * AU_M);
};
// ISS-like circular orbit: 420 km, i = 51.6°, period 92.9 min.
const issPos = (t: number, out: THREE.Vector3) => {
  const a = 6.371e6 + 420e3, inc = 51.6 * DEG, n = (2 * Math.PI) / (92.9 * 60_000);
  const u = n * t;
  earthPos(t, scratchE);
  const x = a * Math.cos(u), y = a * Math.sin(u) * Math.cos(inc), z = a * Math.sin(u) * Math.sin(inc);
  return out.set(scratchE.x + x, scratchE.y + y, scratchE.z + z);
};
const gcDir = GALACTIC_CENTER_DIRECTION_ICRS;
const GC = new THREE.Vector3(gcDir.x, gcDir.y, gcDir.z).multiplyScalar(8.2 * KPC_M);
const proxima = raDecDistToIcrs(217.42895, -62.67949, 1.3020 * PC_M, new THREE.Vector3());
const M31 = raDecDistToIcrs(10.6847, 41.2690, 0.765 * MPC_M, new THREE.Vector3());
const LG = M31.clone().multiplyScalar(0.45);

const SPECS: BodySpec[] = [
  { id: 'cosmo:observable-universe', name: 'Observable universe', parent: null, kind: 'reference', radius: null, color: 0, pos: fixed(0, 0, 0), contextScaleMin: 24 },
  { id: 'struct:local-group', name: 'Local Group', parent: 'cosmo:observable-universe', kind: 'galaxy-group', radius: null, color: 0, pos: fixed(LG.x, LG.y, LG.z), contextScaleMin: 22.7 },
  { id: 'gal:m31', name: 'Andromeda', parent: 'struct:local-group', kind: 'galaxy', radius: null, color: 0, pos: fixed(M31.x, M31.y, M31.z) },
  { id: 'mw:galaxy', name: 'Milky Way', parent: 'struct:local-group', kind: 'galaxy', radius: null, color: 0, pos: fixed(GC.x, GC.y, GC.z), contextScaleMin: 21 },
  { id: 'star:proxima', name: 'Proxima Centauri', parent: 'mw:galaxy', kind: 'star', radius: 1.07e8, color: 0xff9a6a, pos: fixed(proxima.x, proxima.y, proxima.z) },
  { id: 'sol:sun', name: 'Sun', parent: 'mw:galaxy', kind: 'star', radius: 6.957e8, color: 0xfff4e0, pos: fixed(0, 0, 0), importance: 100 },
  { id: 'sol:mercury', name: 'Mercury', parent: 'sol:sun', kind: 'planet', radius: 2.4397e6, color: 0x9a948c, pos: helio(Astronomy.Body.Mercury) },
  { id: 'sol:venus', name: 'Venus', parent: 'sol:sun', kind: 'planet', radius: 6.0518e6, color: 0xe8d6a8, pos: helio(Astronomy.Body.Venus) },
  { id: 'sol:earth', name: 'Earth', parent: 'sol:sun', kind: 'planet', radius: 6.371e6, color: 0x4f7fbf, pos: earthPos, importance: 100 },
  { id: 'sol:moon', name: 'Moon', parent: 'sol:earth', kind: 'moon', radius: 1.7374e6, color: 0xb8b2a8, pos: moonPos },
  { id: 'sat:25544', name: 'ISS', parent: 'sol:earth', kind: 'space-station', radius: 55, color: 0xd0d0d0, pos: issPos },
  { id: 'sol:mars', name: 'Mars', parent: 'sol:sun', kind: 'planet', radius: 3.3895e6, color: 0xc1663f, pos: helio(Astronomy.Body.Mars) },
  { id: 'sol:jupiter', name: 'Jupiter', parent: 'sol:sun', kind: 'planet', radius: 6.9911e7, color: 0xd8b48a, pos: helio(Astronomy.Body.Jupiter) },
  { id: 'sol:saturn', name: 'Saturn', parent: 'sol:sun', kind: 'planet', radius: 5.8232e7, color: 0xe2cf9c, pos: helio(Astronomy.Body.Saturn) },
  { id: 'sol:neptune', name: 'Neptune', parent: 'sol:sun', kind: 'planet', radius: 2.4622e7, color: 0x5b7fd6, pos: helio(Astronomy.Body.Neptune) },
];

function toEntity(s: BodySpec): Entity {
  return {
    id: s.id, name: s.name, aliases: [], kind: s.kind, domain: 'solar', parentId: s.parent, radiusM: s.radius,
    position: s.pos, capabilities: ['focus', 'travel'], importance: s.importance ?? 60, representation: 'observed',
    contextScaleMin: s.contextScaleMin, facts: () => ({}) as never,
  };
}

const registry = createRegistry();
for (const s of SPECS) registry.register(toEntity(s));
const store = createCosmosStore();
store.setState(st => ({ time: { ...st.time, simTimeMs: Date.UTC(2026, 9, 17, 18) } }));
const events = createEventBus<EngineEvents>();

// ── Renderer & scene ────────────────────────────────────────────────────────────────────────

const host = document.getElementById('view') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1e-4, 1e13);
scene.add(new THREE.AmbientLight(0xffffff, 0.015));
const sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0);
scene.add(sunLight);

const sphereGeo = new THREE.SphereGeometry(1, 96, 48);
interface BodyView { spec: BodySpec; entity: Entity; mesh: THREE.Mesh | null; world: THREE.Vector3; label: HTMLDivElement }
const bodies: BodyView[] = [];
const labelsHost = document.getElementById('labels') as HTMLDivElement;
for (const s of SPECS) {
  const entity = registry.get(s.id)!;
  let mesh: THREE.Mesh | null = null;
  if (s.radius && s.radius > 1e3) {
    const mat = s.kind === 'star'
      ? new THREE.MeshBasicMaterial({ color: s.color })
      : new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.95, metalness: 0 });
    mesh = new THREE.Mesh(sphereGeo, mat);
    scene.add(mesh);
  }
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = s.name;
  labelsHost.appendChild(label);
  bodies.push({ spec: s, entity, mesh, world: new THREE.Vector3(), label });
}

// Body markers (always ≥ 3 px so distant bodies stay findable).
const markerGeo = new THREE.BufferGeometry();
const markerPos = new Float32Array(bodies.length * 3);
markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPos, 3));
const markers = new THREE.Points(markerGeo, new THREE.PointsMaterial({ color: 0xd8d4cc, size: 3, sizeAttenuation: false }));
markers.frustumCulled = false;
scene.add(markers);

function makeCloud(n: number, gen: (i: number, out: THREE.Vector3) => void, size: number, color: number, opacity: number): THREE.Points {
  const arr = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { gen(i, v); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  return pts;
}
let seed = 12345;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Background stars: unit directions, re-centred on the camera every frame (at infinity).
const sky = makeCloud(6000, (_i, v) => v.set(gauss(), gauss(), gauss()).normalize(), 1.4, 0xbfc6d6, 0.7);
scene.add(sky);
// Milky Way disc (kpc units, galactic frame → ICRS), positioned at the Galactic Centre.
const KPC_UNITS = KPC_M;
const mw = makeCloud(40000, (i, v) => {
  const arm = i % 2, r = 0.5 + Math.abs(gauss()) * 4.5, th = r * 0.55 + arm * Math.PI + gauss() * 0.35;
  const g = { x: r * Math.cos(th), y: r * Math.sin(th), z: gauss() * 0.15 };
  if (i % 7 === 0) { g.x = gauss() * 1.2; g.y = gauss() * 0.6; g.z = gauss() * 0.5; }
  galacticToIcrs(g, v);
}, 1.6, 0xf0e2c8, 0.55);
scene.add(mw);
// Cosmic web: filament-ish clustered points within ±300 Mpc of the observer (Mpc units).
const web = makeCloud(40000, (i, v) => {
  const c = Math.floor(i / 400);
  seed = 9999 + c * 7919; const cx = (rand() - 0.5) * 600, cy = (rand() - 0.5) * 600, cz = (rand() - 0.5) * 600;
  seed = 31337 + i * 104729; v.set(cx + gauss() * 12, cy + gauss() * 12, cz + gauss() * 12);
}, 1.3, 0xc8d0ff, 0.6);
scene.add(web);

// ── Camera rig ──────────────────────────────────────────────────────────────────────────────

const viewport = { width: 1, height: 1, pixelRatio: 1 };
let selectedId: string | null = null;
const screen = new THREE.Vector3();
function pickAt(x: number, y: number): string | null {
  let best: string | null = null, bestD = 24;
  for (const b of bodies) {
    if (!projectToScreen(b.world, screen)) continue;
    const d = Math.hypot(screen.x - x, screen.y - y);
    if (d < bestD) { bestD = d; best = b.spec.id; }
  }
  return best;
}
const rig = createCameraRig({
  registry, store, events, inputElement: host, getViewport: () => viewport, fovYRad: FOV,
  onPointerClick: (x, y, dbl) => {
    const id = pickAt(x, y);
    if (dbl && id) void rig.focus(id);
    else selectedId = id;
  },
  onPointerHover: () => {},
  initialFocusId: 'sol:earth',
});

function resize(): void {
  viewport.width = host.clientWidth;
  viewport.height = host.clientHeight;
  viewport.pixelRatio = renderer.getPixelRatio();
  renderer.setSize(viewport.width, viewport.height, false);
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Frame loop ──────────────────────────────────────────────────────────────────────────────

let rate = 1;
let simMs = store.getState().time.simTimeMs;
let lastReal = performance.now();
let frameState: CameraFrameState | null = null;
const tmp = new THREE.Vector3();
const camPos = new THREE.Vector3();
let mpu = 1;

function toRender(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.subVectors(world, camPos).multiplyScalar(1 / mpu);
}
function projectToScreen(world: THREE.Vector3, out: THREE.Vector3): boolean {
  toRender(world, out);
  out.applyMatrix4(camera.matrixWorldInverse);
  if (out.z >= 0) return false;
  out.applyMatrix4(camera.projectionMatrix);
  out.set((out.x * 0.5 + 0.5) * viewport.width, (-out.y * 0.5 + 0.5) * viewport.height, 0);
  return out.x > -50 && out.y > -50 && out.x < viewport.width + 50 && out.y < viewport.height + 50;
}

function step(dtReal: number): CameraFrameState {
  simMs += dtReal * 1000 * rate;
  const st = rig.update(dtReal, simMs);
  frameState = st;
  camPos.copy(st.position);
  mpu = st.metersPerUnit;
  camera.position.set(0, 0, 0);
  camera.quaternion.copy(st.quaternion);
  camera.updateMatrixWorld();
  applyProjectionShift(camera, viewport, st.projectionShiftX);

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.entity.position(simMs, b.world);
    toRender(b.world, tmp);
    markerPos[i * 3] = tmp.x; markerPos[i * 3 + 1] = tmp.y; markerPos[i * 3 + 2] = tmp.z;
    if (b.mesh) {
      b.mesh.position.copy(tmp);
      b.mesh.scale.setScalar((b.spec.radius ?? 1) / mpu);
    }
    if (b.spec.id === 'sol:sun') sunLight.position.copy(tmp);
  }
  markerGeo.attributes.position.needsUpdate = true;
  sky.position.set(0, 0, 0);
  sky.scale.setScalar(1e9);
  const gc = registry.get('mw:galaxy')!.position(simMs, tmp);
  toRender(gc, mw.position);
  mw.scale.setScalar(KPC_UNITS / mpu);
  mw.visible = st.scaleLog10 > 18.5;
  web.position.copy(toRender(new THREE.Vector3(0, 0, 0), tmp));
  web.scale.setScalar(MPC_M / mpu);
  web.visible = st.scaleLog10 > 22.5;
  return st;
}

function updateHud(st: CameraFrameState, fps: number): void {
  const L = lengthInBestUnit(10 ** st.scaleLog10);
  const crumbs = st.focusId ? contextCrumbs(registry, st.focusId).map(c => c.name).join(' › ') : '';
  const hud = document.getElementById('hud')!;
  hud.innerHTML =
    `<div class="mono">${crumbs}</div>` +
    `<div class="scale">10<sup>${st.scaleLog10.toFixed(2)}</sup> m · ${L.value.toPrecision(3)} ${L.unit.label}</div>` +
    `<div>${st.frameLabel}</div>` +
    `<div class="mono">mode ${rig.mode} · focus ${st.focusId ?? '—'} · anchor ${st.anchorId}${rig.traveling ? ' · traveling' : ''}` +
    `${selectedId ? ` · selected ${selectedId}` : ''} · rate ×${rate} · ${fps.toFixed(0)} fps</div>`;
  for (const b of bodies) {
    const vis = projectToScreen(b.world, screen) && b.spec.kind !== 'reference';
    b.label.style.display = vis ? 'block' : 'none';
    if (vis) { b.label.style.left = `${screen.x}px`; b.label.style.top = `${screen.y}px`; }
  }
}

let fpsAvg = 60;
let paused = false;
function frame(): void {
  const now = performance.now();
  const dt = Math.min((now - lastReal) / 1000, 0.1);
  lastReal = now;
  if (!paused) {
    const st = step(dt);
    renderer.render(scene, camera);
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
    updateHud(st, fpsAvg);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Controls UI ─────────────────────────────────────────────────────────────────────────────

const controls = document.getElementById('controls')!;
function button(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  b.addEventListener('pointerdown', e => e.stopPropagation());
  controls.appendChild(b);
}
const sep = () => { const s = document.createElement('span'); s.className = 'sep'; controls.appendChild(s); };
for (const id of ['sol:earth', 'sol:moon', 'sat:25544', 'sol:mars', 'sol:jupiter', 'sol:saturn', 'sol:sun', 'star:proxima', 'mw:galaxy', 'gal:m31']) {
  button(registry.get(id)!.name, () => void rig.focus(id));
}
sep();
for (const s of [7, 9, 12, 14, 17, 21, 24]) button(`10^${s}`, () => rig.setScale(s, { animate: true }));
sep();
for (const m of ['orbit', 'follow', 'free'] as CameraMode[]) button(m, () => rig.setMode(m));
button('horizon', () => { const v = horizonView(registry, 'sol:earth', simMs, FOV); if (v) void rig.setView(v); });
button('inspector', () => store.setState(s => ({ ui: { ...s.ui, inspectorOpen: !s.ui.inspectorOpen } })));
button('back', () => rig.back());
button('rate ×10⁴', () => { rate = rate === 1 ? 1e4 : 1; });
window.addEventListener('keydown', e => {
  if (e.code === 'KeyF') rig.setMode(rig.mode === 'free' ? 'orbit' : 'free');
  if (e.code === 'Backspace') rig.back();
});

// ── Headless hooks ──────────────────────────────────────────────────────────────────────────

/** Deterministic stepping for headless runs: pause the rAF loop and advance N frames of `dt` seconds. */
function sampleFrames(n: number, dt = 1 / 60, refId?: string): { pos: number[][]; fwd: number[][]; scale: number[]; rel: number[][] } {
  paused = true;
  const out = { pos: [] as number[][], fwd: [] as number[][], scale: [] as number[], rel: [] as number[][] };
  for (let i = 0; i < n; i++) {
    const st = step(dt);
    out.pos.push([st.position.x, st.position.y, st.position.z]);
    out.fwd.push([st.forward.x, st.forward.y, st.forward.z]);
    out.scale.push(st.scaleLog10);
    const ref = refId ?? st.focusId;
    const focus = ref ? registry.get(ref) : undefined;
    const f = focus ? focus.position(simMs, new THREE.Vector3()) : new THREE.Vector3();
    out.rel.push([st.position.x - f.x, st.position.y - f.y, st.position.z - f.z]);
  }
  renderer.render(scene, camera);
  if (frameState) updateHud(frameState, 60);
  return out;
}
function renderNow(): void {
  renderer.render(scene, camera);
  if (frameState) updateHud(frameState, 60);
}

Object.assign(window, {
  __cam: {
    rig, store, registry, sampleFrames, renderNow,
    setTimeRate: (r: number) => { rate = r; },
    pause: (p: boolean) => { paused = p; lastReal = performance.now(); },
    state: () => frameState,
    time: () => simMs,
    horizon: () => horizonView(registry, 'sol:earth', simMs, FOV),
  },
});
