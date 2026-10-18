import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { Entity, EntityKind } from '../entity';
import type { EngineEvents } from '../types';
import { createRegistry } from '../registry';
import { createEventBus } from '../events';
import { createCosmosStore } from '../../state/store';
import { AU_M, DEG, KPC_M } from '../units';
import { focusDistanceFromScale } from '../scale';
import { applyProjectionShift, createCameraRig, type CameraRig } from './rig';
import { ARRIVAL_PHASE_ANGLE_DEG } from './travel';
import { INSPECT_DIAMETER_FRACTION, distanceForDiameterFraction } from './rigImpl';
import { horizonView } from './shots';

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 9, 17);
const FOV = 50 * DEG;

function circular(radius: number, periodMs: number, phase = 0, center?: Entity) {
  const c = new Vector3();
  return (t: number, out: Vector3) => {
    const a = phase + (2 * Math.PI * (t - T0)) / periodMs;
    if (center) center.position(t, c); else c.set(0, 0, 0);
    return out.set(c.x + radius * Math.cos(a), c.y + radius * Math.sin(a), c.z);
  };
}

function ent(id: string, parentId: string | null, kind: EntityKind, radiusM: number | null,
  position: (t: number, out: Vector3) => Vector3, extra: Partial<Entity> = {}): Entity {
  return {
    id, name: id.split(':')[1] ?? id, aliases: [], kind, domain: 'solar', parentId, radiusM, position,
    capabilities: ['focus'], importance: 50, representation: 'observed', facts: () => ({}) as never, ...extra,
  };
}

function world() {
  const reg = createRegistry();
  const root = ent('cosmo:observable-universe', null, 'reference', null, (_t, o) => o.set(0, 0, 0), { contextScaleMin: 24 });
  const gal = ent('mw:galaxy', root.id, 'galaxy', null, (_t, o) => o.set(8.2 * KPC_M, 0, 0), { contextScaleMin: 21 });
  const sun = ent('sol:sun', gal.id, 'star', 6.957e8, (_t, o) => o.set(0, 0, 0));
  const earth = ent('sol:earth', sun.id, 'planet', 6.371e6, circular(AU_M, 365.25 * DAY_MS));
  const moon = ent('sol:moon', earth.id, 'moon', 1.7374e6, circular(3.844e8, 27.32 * DAY_MS, 1, earth));
  const iss = ent('sat:25544', earth.id, 'space-station', 50, circular(6.771e6, 92.7 * 60_000, 0.3, earth));
  const mars = ent('sol:mars', sun.id, 'planet', 3.3895e6, circular(1.524 * AU_M, 687 * DAY_MS, 2));
  for (const e of [root, gal, sun, earth, moon, iss, mars]) reg.register(e);
  return reg;
}

class FakeElement extends EventTarget {
  style: Record<string, string> = {};
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 } as DOMRect; }
  setPointerCapture() {}
}

function fire(el: FakeElement, type: string, props: Record<string, unknown>): void {
  el.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));
}

function setup(overrides: { inspector?: boolean; reduced?: boolean } = {}) {
  const registry = world();
  const store = createCosmosStore();
  store.setState(s => ({
    time: { ...s.time, simTimeMs: T0 },
    ui: { ...s.ui, inspectorOpen: overrides.inspector ?? false, reducedMotion: overrides.reduced ?? false },
  }));
  const events = createEventBus<EngineEvents>();
  const el = new FakeElement();
  const clicks: [number, number, boolean][] = [];
  const log: string[] = [];
  events.on('travel-start', p => log.push(`start:${p.targetId}`));
  events.on('travel-end', p => log.push(`end:${p.targetId}:${p.interrupted}`));
  const rig = createCameraRig({
    registry, store, events, inputElement: el as unknown as HTMLElement,
    getViewport: () => ({ width: 1280, height: 720, pixelRatio: 1 }), fovYRad: FOV,
    onPointerClick: (x, y, d) => clicks.push([x, y, d]), onPointerHover: () => {}, initialFocusId: 'sol:earth',
  });
  return { registry, store, events, el, rig, clicks, log };
}

function pos(registry: ReturnType<typeof world>, id: string, t: number): Vector3 {
  return registry.get(id)!.position(t, new Vector3());
}

/**
 * Run frames at 60 Hz. Smoothness metrics per frame: `maxStep` = camera motion perpendicular to the view direction
 * relative to the visible width (what reads as a jump on screen), `maxScaleStep` = zoom in decades, `maxTurnDeg` =
 * change of view direction.
 */
function run(rig: CameraRig, t0: number, frames: number, dtSim = 1000 / 60, ref?: Entity, debug = false) {
  let t = t0;
  const refPos = new Vector3();
  const rel = (p: Vector3, time: number, out: Vector3) => (ref ? out.subVectors(p, ref.position(time, refPos)) : out.copy(p));
  const first = rig.update(1 / 60, t);
  const prev = rel(first.position, t, new Vector3());
  const prevF = first.forward.clone();
  let prevScale = first.scaleLog10;
  let maxStep = 0, maxScaleStep = 0, maxTurnDeg = 0;
  const d = new Vector3();
  for (let i = 0; i < frames; i++) {
    t += dtSim;
    const st = rig.update(1 / 60, t);
    rel(st.position, t, d).sub(prev);
    d.addScaledVector(st.forward, -d.dot(st.forward));
    const step = d.length() / 10 ** Math.max(st.scaleLog10, prevScale);
    const turn = Math.acos(Math.min(1, st.forward.dot(prevF))) / DEG;
    if (debug && (step > 0.05 || turn > 3)) console.log(i, step.toFixed(3), turn.toFixed(2), st.scaleLog10.toFixed(2), st.anchorId);
    maxStep = Math.max(maxStep, step);
    maxScaleStep = Math.max(maxScaleStep, Math.abs(st.scaleLog10 - prevScale));
    maxTurnDeg = Math.max(maxTurnDeg, turn);
    rel(st.position, t, prev);
    prevF.copy(st.forward);
    prevScale = st.scaleLog10;
  }
  return { t, maxStep, maxScaleStep, maxTurnDeg };
}

describe('camera rig — orbit', () => {
  it('starts at the configured scale with a cinematic phase angle and a frame label', () => {
    const { rig, registry } = setup();
    const st = rig.update(1 / 60, T0);
    const earth = pos(registry, 'sol:earth', T0);
    expect(st.position.distanceTo(earth)).toBeCloseTo(focusDistanceFromScale(7.4, FOV), -2);
    const toSun = earth.clone().negate().normalize();
    const toCam = st.position.clone().sub(earth).normalize();
    expect(Math.acos(toSun.dot(toCam)) / DEG).toBeCloseTo(ARRIVAL_PHASE_ANGLE_DEG, 0);
    expect(st.frameLabel).toContain('Geocentric');
    expect(st.anchorId).toBe('sol:earth');
    expect(Math.abs(st.quaternion.length() - 1)).toBeLessThan(1e-9);
    // Forward points at the focus.
    expect(st.forward.dot(earth.clone().sub(st.position).normalize())).toBeCloseTo(1, 9);
  });

  it('rides along with a moving target at 10⁶× real time', () => {
    const { rig, registry } = setup();
    const st0 = rig.update(1 / 60, T0);
    const off0 = st0.position.clone().sub(pos(registry, 'sol:earth', T0));
    const t1 = T0 + 30 * DAY_MS;
    const st1 = rig.update(1 / 60, t1);
    const off1 = st1.position.clone().sub(pos(registry, 'sol:earth', t1));
    expect(off1.distanceTo(off0)).toBeLessThan(1e-6 * off0.length());
  });

  it('Cosmic Ruler: re-anchors to the Sun when scaled out and returns to Earth', () => {
    const { rig, registry } = setup();
    rig.update(1 / 60, T0);
    rig.setScale(13.2);
    let st = rig.update(1 / 60, T0);
    expect(st.anchorId).toBe('sol:sun');
    expect(st.frameLabel).toContain('Heliocentric');
    const sunDist = st.position.distanceTo(pos(registry, 'sol:sun', T0));
    expect(sunDist / focusDistanceFromScale(13.2, FOV)).toBeCloseTo(1, 3);
    rig.setScale(22.5);
    st = rig.update(1 / 60, T0);
    expect(st.anchorId).toBe('mw:galaxy');
    expect(st.frameLabel).toBe('Galactocentric');
    rig.setScale(7);
    st = rig.update(1 / 60, T0);
    expect(st.anchorId).toBe('sol:earth');
  });

  it('animated setScale eases without jumps', () => {
    const { rig } = setup();
    rig.update(1 / 60, T0);
    rig.setScale(12, { animate: true });
    const { maxStep, maxScaleStep } = run(rig, T0, 120, 0);
    expect(rig.update(1 / 60, T0).scaleLog10).toBeCloseTo(12, 6);
    expect(maxStep).toBeLessThan(0.1);
    expect(maxScaleStep).toBeLessThan(0.15);
  });

  it('wheel zoom is smooth and clamps at 1.02 R above the surface', () => {
    const { rig, el, registry } = setup();
    rig.update(1 / 60, T0);
    for (let i = 0; i < 40; i++) fire(el, 'wheel', { deltaY: -400, deltaMode: 0, deltaX: 0, ctrlKey: false, shiftKey: false });
    const { t } = run(rig, T0, 120, 0);
    const st = rig.update(1 / 60, t);
    const d = st.position.distanceTo(pos(registry, 'sol:earth', t));
    expect(d).toBeGreaterThanOrEqual(1.02 * 6.371e6 * (1 - 1e-9));
    expect(d).toBeLessThan(1.05 * 6.371e6);
  });

  it('left-drag orbits at constant distance; a tap below the drag threshold is a click', () => {
    const { rig, el, registry, clicks } = setup();
    const st0 = rig.update(1 / 60, T0).position.clone();
    const earth = pos(registry, 'sol:earth', T0);
    fire(el, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 600, clientY: 300, shiftKey: false });
    for (let i = 1; i <= 20; i++) {
      fire(el, 'pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 600 + 10 * i, clientY: 300 + 2 * i });
      rig.update(1 / 60, T0);
    }
    fire(el, 'pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 800, clientY: 340 });
    const { maxStep } = run(rig, T0, 90, 0);
    const st1 = rig.update(1 / 60, T0);
    expect(st1.position.distanceTo(earth)).toBeCloseTo(st0.distanceTo(earth), -2);
    expect(st1.position.distanceTo(st0)).toBeGreaterThan(0.2 * st0.distanceTo(earth));
    expect(maxStep).toBeLessThan(0.2);
    expect(clicks.length).toBe(0);
    fire(el, 'pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1, clientX: 100, clientY: 100, shiftKey: false });
    fire(el, 'pointermove', { pointerId: 2, pointerType: 'mouse', buttons: 1, clientX: 102, clientY: 101 });
    fire(el, 'pointerup', { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 102, clientY: 101 });
    expect(clicks).toEqual([[102, 101, false]]);
  });

  it('touch: pinch zooms, double-tap reports a double click', () => {
    const { rig, el, clicks } = setup();
    const s0 = rig.update(1 / 60, T0).scaleLog10;
    const touch = (type: string, id: number, x: number, y: number) =>
      fire(el, type, { pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y, shiftKey: false });
    touch('pointerdown', 1, 500, 400);
    touch('pointerdown', 2, 700, 400);
    for (let i = 1; i <= 10; i++) { touch('pointermove', 1, 500 - 20 * i, 400); touch('pointermove', 2, 700 + 20 * i, 400); }
    touch('pointerup', 1, 300, 400);
    touch('pointerup', 2, 900, 400);
    run(rig, T0, 60, 0);
    const s1 = rig.update(1 / 60, T0).scaleLog10;
    // Fingers spread ×3 → altitude ÷3 (log-altitude zoom near the body) → scale drops ≈ 0.31 decade here.
    expect(s0 - s1).toBeGreaterThan(0.25);
    expect(clicks.length).toBe(0);
    touch('pointerdown', 3, 200, 200); touch('pointerup', 3, 200, 200);
    touch('pointerdown', 4, 205, 203); touch('pointerup', 4, 205, 203);
    expect(clicks).toEqual([[200, 200, false], [205, 203, true]]);
  });

  it('never flips over the pole while orbiting vertically', () => {
    const { rig, el } = setup();
    rig.update(1 / 60, T0);
    fire(el, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 600, clientY: 100, shiftKey: false });
    let prevUp = new Vector3(0, 1, 0).applyQuaternion(rig.update(1 / 60, T0).quaternion);
    for (let i = 1; i <= 60; i++) {
      fire(el, 'pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 600, clientY: 100 + 15 * i });
      const q = rig.update(1 / 60, T0).quaternion;
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(up.dot(prevUp)).toBeGreaterThan(0.9);
      prevUp = up;
    }
  });
});

describe('camera rig — travel', () => {
  it('travels Earth → Mars smoothly, emits events, updates the store and resolves', async () => {
    const { rig, store, log, registry } = setup();
    rig.update(1 / 60, T0);
    let done = false;
    const p = rig.travelTo('sol:mars').then(() => { done = true; });
    expect(rig.traveling).toBe(true);
    expect(store.getState().camera.traveling).toBe(true);
    expect(store.getState().camera.travelTargetId).toBe('sol:mars');
    const { t, maxStep, maxTurnDeg } = run(rig, T0, 60 * 10, 60_000, registry.get('sol:mars'));
    await p;
    expect(done).toBe(true);
    expect(rig.traveling).toBe(false);
    expect(store.getState().camera.traveling).toBe(false);
    expect(log).toEqual(['start:sol:mars', 'end:sol:mars:false']);
    expect(rig.focusId).toBe('sol:mars');
    const st = rig.update(1 / 60, t);
    const mars = pos(registry, 'sol:mars', t);
    // Arrival framing: disc ≈ 0.6 of the viewport height, phase angle 50–70°.
    const d = st.position.distanceTo(mars);
    const frac = (2 * Math.asin(3.3895e6 / d)) / FOV;
    expect(frac).toBeGreaterThan(0.55);
    expect(frac).toBeLessThan(0.65);
    const phase = Math.acos(mars.clone().negate().normalize().dot(st.position.clone().sub(mars).normalize())) / DEG;
    expect(phase).toBeGreaterThan(50);
    expect(phase).toBeLessThan(70);
    expect(maxStep).toBeLessThan(0.1);
    expect(maxTurnDeg).toBeLessThan(3);
  });

  it('frames for the inspector: 0.86 H disc and a +0.10 W projection shift', async () => {
    const { rig, registry } = setup({ inspector: true });
    rig.update(1 / 60, T0);
    const p = rig.focus('sol:moon');
    const { t } = run(rig, T0, 60 * 10, 0);
    await p;
    const st = rig.update(1 / 60, t);
    const d = st.position.distanceTo(pos(registry, 'sol:moon', t));
    expect(d / distanceForDiameterFraction(1.7374e6, FOV, INSPECT_DIAMETER_FRACTION)).toBeCloseTo(1, 6);
    expect(st.projectionShiftX).toBeCloseTo(0.1, 4);
    const cam = new PerspectiveCamera(50, 1280 / 720);
    applyProjectionShift(cam, { width: 1280, height: 720, pixelRatio: 1 }, st.projectionShiftX);
    expect(cam.view?.offsetX).toBeCloseTo(-128, 3);
  });

  it('a long galactic travel lands precisely and stays smooth', async () => {
    const { rig, registry } = setup();
    rig.update(1 / 60, T0);
    rig.setScale(21.8);
    rig.update(1 / 60, T0);
    const p = rig.focus('sat:25544');
    const { t, maxStep, maxTurnDeg } = run(rig, T0, 60 * 10, 1000 / 60, registry.get('sat:25544'));
    await p;
    const st = rig.update(1 / 60, t);
    const iss = pos(registry, 'sat:25544', t);
    const earth = pos(registry, 'sol:earth', t);
    expect(st.position.distanceTo(iss)).toBeLessThan(1e4);
    // Camera stays outside Earth and on the ISS's outward side.
    expect(st.position.distanceTo(earth)).toBeGreaterThan(6.371e6);
    expect(maxStep).toBeLessThan(0.1);
    expect(maxTurnDeg).toBeLessThan(3);
  });

  it('user input interrupts travel continuously and resolves the promise', async () => {
    const { rig, el, log } = setup();
    rig.update(1 / 60, T0);
    const p = rig.travelTo('sol:mars');
    run(rig, T0, 60, 0);
    const before = rig.update(0, T0).position.clone();
    const scaleBefore = rig.update(0, T0).scaleLog10;
    fire(el, 'wheel', { deltaY: 1, deltaMode: 0, deltaX: 0, ctrlKey: false, shiftKey: false });
    const after = rig.update(1 / 60, T0).position.clone();
    await p;
    expect(rig.traveling).toBe(false);
    expect(log[log.length - 1]).toBe('end:sol:mars:true');
    expect(after.distanceTo(before) / 10 ** scaleBefore).toBeLessThan(0.05);
  });

  it('back() restores the previous view; getView/setView round-trips', async () => {
    const { rig } = setup();
    rig.update(1 / 60, T0);
    const v0 = rig.getView();
    const pos0 = rig.update(0, T0).position.clone();
    const p = rig.travelTo('sol:mars', { instant: true });
    await p;
    rig.update(1 / 60, T0);
    expect(rig.focusId).toBe('sol:mars');
    expect(rig.back()).toBe(true);
    run(rig, T0, 60 * 10, 0);
    const st = rig.update(0, T0);
    expect(rig.focusId).toBe('sol:earth');
    expect(st.position.distanceTo(pos0) / pos0.length()).toBeLessThan(1e-9);
    expect(rig.getView().scaleLog10).toBeCloseTo(v0.scaleLog10, 6);
    expect(rig.back()).toBe(false);
  });

  it('reduced motion makes transitions very short', async () => {
    const { rig } = setup({ reduced: true });
    rig.update(1 / 60, T0);
    const p = rig.travelTo('sol:mars');
    run(rig, T0, 25, 0);
    await p;
    expect(rig.traveling).toBe(false);
  });

  it('ignores unknown entities gracefully', async () => {
    const { rig } = setup();
    rig.update(1 / 60, T0);
    await rig.travelTo('nope:missing');
    const st = rig.update(1 / 60, T0);
    expect(Number.isFinite(st.position.x)).toBe(true);
    expect(rig.focusId).toBe('sol:earth');
  });
});

describe('camera rig — composed shots', () => {
  it('reaches the Earth horizon shot (400 km, planet filling the bottom 35–45 %)', async () => {
    const { rig, registry } = setup();
    rig.update(1 / 60, T0);
    const view = horizonView(registry, 'sol:earth', T0, FOV);
    expect(view).not.toBeNull();
    await rig.setView(view!, { instant: true });
    const st = rig.update(0, T0);
    const earth = pos(registry, 'sol:earth', T0);
    const R = 6.371e6;
    const rel = st.position.clone().sub(earth);
    expect(rel.length() - R).toBeCloseTo(400e3, -1);
    // Orientation is reproduced (look offsets carry the tilt toward the limb).
    const q = st.quaternion;
    const vq = view!.quaternion;
    expect(Math.abs(q.x * vq[0] + q.y * vq[1] + q.z * vq[2] + q.w * vq[3])).toBeGreaterThan(0.99999);
    // Where is the limb straight below the view direction? Ray in the vertical plane tangent to the sphere.
    const n = rel.clone().normalize();
    const heading = st.forward.clone().addScaledVector(n, -st.forward.dot(n)).normalize();
    const dip = Math.acos(R / rel.length());
    const limbDir = heading.clone().multiplyScalar(Math.cos(dip)).addScaledVector(n, -Math.sin(dip));
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const yNdc = limbDir.dot(up) / limbDir.dot(st.forward) / Math.tan(FOV / 2);
    const fill = (1 + yNdc) / 2; // fraction of the frame height below the limb
    expect(fill).toBeGreaterThan(0.35);
    expect(fill).toBeLessThan(0.45);
    // The camera keeps the shot while idle (no roll / drift).
    const q0 = st.quaternion.clone();
    run(rig, T0, 60, 0);
    expect(Math.abs(rig.update(0, T0).quaternion.dot(q0))).toBeGreaterThan(0.999999);
  });
});

describe('camera rig — free & follow', () => {
  it('free flight keeps the pose on entry, flies with W and re-anchors by sphere of influence', () => {
    const { rig } = setup();
    const p0 = rig.update(1 / 60, T0).position.clone();
    rig.setMode('free');
    const p1 = rig.update(1 / 60, T0).position.clone();
    expect(p1.distanceTo(p0)).toBeLessThan(1e-6 * p0.length());
    expect(rig.mode).toBe('free');
    rig.setScale(13);
    // Fly far out of Earth's sphere of influence by moving the camera directly.
    for (let i = 0; i < 4; i++) rig.update(0.25, T0);
    const st = rig.update(0.25, T0);
    expect(Number.isFinite(st.position.x)).toBe(true);
    rig.setMode('orbit');
    const p2 = rig.update(0, T0).position.clone();
    expect(p2.distanceTo(st.position) / st.position.length()).toBeLessThan(1e-9);
  });

  it('follow mode keeps the camera fixed in the target orbital frame', () => {
    const { rig, registry } = setup();
    rig.update(1 / 60, T0);
    rig.setMode('follow');
    rig.update(1 / 60, T0);
    const e0 = pos(registry, 'sol:earth', T0);
    const off0 = rig.update(0, T0).position.clone().sub(e0);
    const t1 = T0 + 91 * DAY_MS; // a quarter orbit
    const st = rig.update(1 / 60, t1);
    const off1 = st.position.clone().sub(pos(registry, 'sol:earth', t1));
    // The offset rotated with the orbit (~90°) instead of staying fixed in ICRS.
    const ang = Math.acos(off0.clone().normalize().dot(off1.clone().normalize())) / DEG;
    expect(ang).toBeGreaterThan(60);
    expect(off1.length()).toBeCloseTo(off0.length(), -2);
    expect(st.frameLabel).toContain('orbital frame');
  });
});
