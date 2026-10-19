import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Entity, EntityKind } from './entity';
import {
  bodyScale, clearScaledBodies, FULL_EXHIBITION_RADII, mapSatelliteOffset, maxFactorForClearance, registerScaledBody,
  renderFactor, renderTransform, satelliteMaxFactor, satelliteOffsetScale, setVisualScaleMode, stepVisualScale, SUN_MAX_RADIUS_M,
  targetDiameterPx, TRUE_SCALE_RADII, trueDiameterPx, updateScaleView, MERCURY_PERIHELION_M, CORE_RADIUS_M, SYSTEM_EXTENT_M,
  PRIMARY_CLEARANCE_FRACTION, renderRadius, CONTEXT_NEAR_M, CONTEXT_FAR_M, PLANET_ORDER_MIN_RATIO, systemRootId,
  BACKGROUND_MAX_FRACTION, SUN_BACKGROUND_MAX_FRACTION, BACKGROUND_RING_MULT, SUN_TRUE_NEAR_M, BACKGROUND_ORDER_MIN_RATIO,
} from './visualScale';

const AU = 1.495978707e11;
const H = 1080;
const FOV = (50 * Math.PI) / 180;
// Mean radii, m (NASA planetary fact sheets).
const R_EARTH = 6.371e6, R_JUP = 6.9911e7, R_MERC = 2.4397e6, R_SUN = 6.957e8, R_MOON = 1.7374e6, R_IO = 1.8216e6, R_MARS = 3.3895e6, R_PHOBOS = 1.108e4;

function fakeEntity(id: string, kind: EntityKind, radiusM: number, parentId: string | null, pos: THREE.Vector3): Entity {
  return {
    id, name: id, aliases: [], kind, domain: 'solar', parentId, radiusM, capabilities: [], importance: 50, representation: 'observed',
    position: (_t, out) => out.copy(pos), facts: () => ({}) as never,
  };
}

afterEach(() => {
  clearScaledBodies();
  setVisualScaleMode('exhibition', true);
});

describe('bodyScale (pure law)', () => {
  it('is exactly 1 within TRUE_SCALE_RADII and for never-enlarged kinds', () => {
    expect(bodyScale(R_EARTH, 'planet', R_EARTH * TRUE_SCALE_RADII, H, FOV)).toBe(1);
    expect(bodyScale(R_EARTH, 'planet', R_EARTH * 3, H, FOV)).toBe(1);
    expect(bodyScale(1e9, 'galaxy', 1e20, H, FOV)).toBe(1);
  });

  it('makes planets clearly visible discs from an inner-system overview (3 AU)', () => {
    for (const [r, minPx] of [[R_EARTH, 12], [R_MERC, 7], [R_JUP, 40]] as const) {
      const f = bodyScale(r, 'planet', 3 * AU, H, FOV);
      const px = trueDiameterPx(r * f, 3 * AU, H, FOV);
      expect(px).toBeGreaterThan(minPx);
    }
  });

  it('keeps sizes ordered (square-root compression)', () => {
    const d = 4 * AU;
    const pxE = trueDiameterPx(R_EARTH * bodyScale(R_EARTH, 'planet', d, H, FOV), d, H, FOV);
    const pxJ = trueDiameterPx(R_JUP * bodyScale(R_JUP, 'planet', d, H, FOV), d, H, FOV);
    expect(pxJ / pxE).toBeGreaterThan(2.5);
    expect(pxJ / pxE).toBeLessThan(4);
    expect(targetDiameterPx(R_MERC, 'planet', H)).toBeLessThan(targetDiameterPx(R_EARTH, 'planet', H));
  });

  it('shrinks smoothly to true size on approach (monotonic drawn size, no jump)', () => {
    let prevDrawn = Infinity;
    let prevF = Infinity;
    for (let x = 20000; x >= 2; x *= 0.97) {
      const d = x * R_EARTH;
      const f = bodyScale(R_EARTH, 'planet', d, H, FOV);
      expect(f).toBeLessThanOrEqual(prevF + 1e-9); // factor never increases as we approach
      // relative change per 3 % step stays small (no pop)
      if (Number.isFinite(prevF)) expect(Math.abs(f - prevF) / prevF).toBeLessThan(0.05);
      const drawnR = R_EARTH * f;
      expect(drawnR).toBeLessThanOrEqual(prevDrawn * 1.0001);
      prevDrawn = drawnR;
      prevF = f;
    }
    expect(bodyScale(R_EARTH, "planet", 60 * R_EARTH, H, FOV)).toBeLessThan(1.01);
    expect(bodyScale(R_EARTH, "planet", FULL_EXHIBITION_RADII * R_EARTH, H, FOV)).toBeLessThan(2.0);
  });

  it('respects maxFactor', () => {
    expect(bodyScale(R_EARTH, 'planet', 30 * AU, H, FOV, { maxFactor: 50 })).toBe(50);
  });
});

describe('satellite offsets', () => {
  it('is identity at factor 1 and uniform inside the core', () => {
    expect(mapSatelliteOffset(1, R_JUP, 4.2e8)).toBe(4.2e8);
    expect(mapSatelliteOffset(10, 1.36775e8, 1.3e8)).toBeCloseTo(1.3e9, -1);
    expect(satelliteOffsetScale(10, 1.36775e8, 1.0e8)).toBeCloseTo(10, 9);
  });

  it('is continuous and monotonic in the offset', () => {
    const c = CORE_RADIUS_M['sol:saturn'];
    let prev = 0;
    for (let a = 0.5 * c; a < 50 * c; a *= 1.01) {
      const m = mapSatelliteOffset(300, c, a);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    expect(mapSatelliteOffset(300, c, c * (1 + 1e-9))).toBeCloseTo(mapSatelliteOffset(300, c, c), -2);
  });

  it('keeps every satellite outside the enlarged parent', () => {
    for (const f of [1, 1.5, 3, 30, 300, 3000]) {
      const io = mapSatelliteOffset(f, R_JUP, 4.217e8);
      const cap = satelliteMaxFactor(f, R_JUP, R_JUP, 4.217e8, R_IO);
      expect(io - cap * R_IO).toBeGreaterThan(f * R_JUP);
      const phobos = mapSatelliteOffset(f, R_MARS, 9.376e6);
      expect(phobos).toBeGreaterThan(f * R_MARS);
    }
  });

  it('solves the clearance cap exactly', () => {
    const core = R_EARTH, A = SYSTEM_EXTENT_M['sol:earth'], C = PRIMARY_CLEARANCE_FRACTION * AU;
    const f = maxFactorForClearance(core, A, C);
    expect(mapSatelliteOffset(f, core, A)).toBeCloseTo(C, -3);
    expect(maxFactorForClearance(R_MERC, 0, 5.8e9)).toBeCloseTo(5.8e9 / R_MERC, 6);
  });
});

describe('runtime render transforms', () => {
  it('scales a registered planet, magnifies its moon around it and keeps the Sun clear of Mercury', () => {
    const sunPos = new THREE.Vector3(0, 0, 0);
    const earthPos = new THREE.Vector3(AU, 0, 0);
    const moonPos = new THREE.Vector3(AU + 3.844e8, 0, 0);
    const sun = fakeEntity('sol:sun', 'star', R_SUN, null, sunPos);
    const earth = fakeEntity('sol:earth', 'planet', R_EARTH, 'sol:sun', earthPos);
    const moon = fakeEntity('sol:moon', 'moon', R_MOON, 'sol:earth', moonPos);
    registerScaledBody(sun); registerScaledBody(earth); registerScaledBody(moon);
    updateScaleView(new THREE.Vector3(AU, 0, 3 * AU), H, FOV);
    const out = new THREE.Vector3();
    const fE = renderTransform(earth, 0, out);
    expect(out.distanceTo(earthPos)).toBe(0); // planets never move
    expect(fE).toBeGreaterThan(100);
    const fM = renderTransform(moon, 0, out);
    const moonDrawnOffset = out.distanceTo(earthPos);
    expect(moonDrawnOffset - fM * R_MOON).toBeGreaterThan(fE * R_EARTH);
    expect(moonDrawnOffset).toBeLessThan(0.15 * AU);
    const fS = renderFactor(sun, 0);
    expect(fS * R_SUN).toBeLessThanOrEqual(SUN_MAX_RADIUS_M + 1);
    expect(fS * R_SUN).toBeLessThan(MERCURY_PERIHELION_M / 2.4);
    expect(renderRadius(earth, 0)).toBeCloseTo(fE * R_EARTH, 0);
  });

  it('lands at true scale near the body (Phobos travel) and identity in true mode', () => {
    const marsPos = new THREE.Vector3(1.5 * AU, 0, 0);
    const phobosPos = new THREE.Vector3(1.5 * AU + 9.376e6, 0, 0);
    const mars = fakeEntity('sol:mars', 'planet', R_MARS, 'sol:sun', marsPos);
    const phobos = fakeEntity('sol:phobos', 'moon', R_PHOBOS, 'sol:mars', phobosPos);
    registerScaledBody(mars); registerScaledBody(phobos);
    const out = new THREE.Vector3();
    // Camera 30 Phobos radii from Phobos (inspect distance): everything true.
    updateScaleView(new THREE.Vector3(1.5 * AU + 9.376e6, 30 * R_PHOBOS, 0), H, FOV);
    expect(renderTransform(phobos, 0, out)).toBe(1);
    expect(out.distanceTo(phobosPos)).toBeLessThan(1e-6);
    // Far away, then true mode: back to identity after the transition.
    updateScaleView(new THREE.Vector3(1.5 * AU, 0, 2 * AU), H, FOV);
    expect(renderFactor(mars, 1)).toBeGreaterThan(10);
    stepVisualScale(0.5, 'true');
    const mid = renderFactor(mars, 2);
    expect(mid).toBeGreaterThan(1);
    stepVisualScale(5, 'true');
    expect(renderTransform(phobos, 3, out)).toBe(1);
    expect(renderFactor(mars, 3)).toBe(1);
    expect(out.distanceTo(phobosPos)).toBeLessThan(1e-6);
  });

  it('treats unregistered entities as identity', () => {
    const p = new THREE.Vector3(1, 2, 3);
    const e = fakeEntity('sol:x', 'planet', R_EARTH, null, p);
    const out = new THREE.Vector3();
    expect(renderTransform(e, 0, out)).toBe(1);
    expect(out.equals(p)).toBe(true);
  });
});

describe('context gate and size order', () => {
  const R_SAT = 5.8232e7, R_URA = 2.5362e7, R_NEP = 2.4622e7;
  function system() {
    const sun = fakeEntity('sol:sun', 'star', R_SUN, null, new THREE.Vector3(0, 0, 0));
    const merc = fakeEntity('sol:mercury', 'planet', R_MERC, 'sol:sun', new THREE.Vector3(0.39 * AU, 0, 0));
    const earth = fakeEntity('sol:earth', 'planet', R_EARTH, 'sol:sun', new THREE.Vector3(AU, 0, 0));
    const moon = fakeEntity('sol:moon', 'moon', R_MOON, 'sol:earth', new THREE.Vector3(AU + 3.844e8, 0, 0));
    const jup = fakeEntity('sol:jupiter', 'planet', R_JUP, 'sol:sun', new THREE.Vector3(-5.2 * AU, 0, 0));
    const sat = fakeEntity('sol:saturn', 'planet', R_SAT, 'sol:sun', new THREE.Vector3(0, 9.5 * AU, 0));
    const ura = fakeEntity('sol:uranus', 'planet', R_URA, 'sol:sun', new THREE.Vector3(0, -19.2 * AU, 0));
    const nep = fakeEntity('sol:neptune', 'planet', R_NEP, 'sol:sun', new THREE.Vector3(30 * AU, 0, 0));
    for (const e of [sun, merc, earth, moon, jup, sat, ura, nep]) registerScaledBody(e);
    return { sun, merc, earth, moon, jup, sat, ura, nep };
  }
  const apparent = (e: Entity, cam: THREE.Vector3, t: number) => {
    const out = new THREE.Vector3();
    const f = renderTransform(e, t, out);
    return (f * (e.radiusM ?? 0)) / out.distanceTo(cam);
  };

  it('resolves system roots (moon -> planet, planet -> itself)', () => {
    system();
    expect(systemRootId('sol:moon')).toBe('sol:earth');
    expect(systemRootId('sol:earth')).toBe('sol:earth');
    expect(systemRootId('sol:sun')).toBe('sol:sun');
  });

  it('drops distant planets and the Sun to true size in a planet close-up but keeps the focused system enlarged', () => {
    const b = system();
    // Mercury close-up: camera 1.2e7 m from Mercury, focus Mercury.
    const cam = new THREE.Vector3(0.39 * AU, 1.2e7, 0);
    updateScaleView(cam, H, FOV, { focusId: 'sol:mercury', focusDistanceM: 1.2e7, dtSec: 0 });
    expect(renderFactor(b.nep, 0)).toBe(1);
    expect(renderFactor(b.sat, 0)).toBe(1);
    expect(renderFactor(b.earth, 0)).toBe(1);
    expect(renderFactor(b.sun, 0)).toBe(1);
    // Earth close-up keeps the Moon (same system) enlarged.
    const camE = new THREE.Vector3(AU, 2.2e7, 0);
    updateScaleView(camE, H, FOV, { focusId: 'sol:earth', focusDistanceM: 2.2e7, dtSec: 0 });
    expect(renderFactor(b.moon, 1)).toBeGreaterThan(1);
    expect(renderFactor(b.jup, 1)).toBe(1);
    // Beyond CONTEXT_FAR_M from the focus everything is enlarged again.
    const camFar = new THREE.Vector3(AU, 0, 3 * AU);
    updateScaleView(camFar, H, FOV, { focusId: 'sol:earth', focusDistanceM: 3 * AU, dtSec: 0 });
    expect(renderFactor(b.jup, 2)).toBeGreaterThan(10);
  });

  it('eases the context weight (no pop) and is monotonic in the focus distance', () => {
    const b = system();
    const cam = new THREE.Vector3(AU, 2.2e7, 0);
    updateScaleView(cam, H, FOV, { focusId: 'sol:earth', focusDistanceM: 3 * AU, dtSec: 0 });
    const full = renderFactor(b.jup, 0);
    updateScaleView(cam, H, FOV, { focusId: 'sol:earth', focusDistanceM: 2.2e7, dtSec: 1 / 60 });
    const step = renderFactor(b.jup, 1);
    expect(step).toBeLessThan(full);
    expect(step).toBeGreaterThan(1 + (full - 1) * 0.9);
    let prev = Infinity;
    for (const d of [CONTEXT_FAR_M, 1e10, 6e9, CONTEXT_NEAR_M]) {
      updateScaleView(cam, H, FOV, { focusId: 'sol:earth', focusDistanceM: d, dtSec: 0 });
      const f = renderFactor(b.jup, 10 + d);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
    expect(prev).toBe(1);
  });

  const px = (e: Entity, cam: THREE.Vector3, t: number) => (2 * apparent(e, cam, t) * H) / FOV;

  it('caps background bodies at BACKGROUND_MAX_FRACTION (belt view: Saturn never dominates)', () => {
    const b = system();
    const ceres = fakeEntity('sb:ceres', 'asteroid', 4.73e5, 'sol:sun', new THREE.Vector3(2.77 * AU, 0, 0));
    registerScaledBody(ceres);
    const cam = new THREE.Vector3(2.77 * AU, 0, 6.7 * AU);
    updateScaleView(cam, H, FOV, { focusId: 'sb:ceres', focusDistanceM: 6.7 * AU, dtSec: 0 });
    for (const e of [b.merc, b.earth, b.jup, b.sat, b.ura, b.nep]) {
      expect(px(e, cam, 0)).toBeLessThanOrEqual(BACKGROUND_MAX_FRACTION * H * 1.001);
      expect(renderFactor(e, 0)).toBeGreaterThan(1);
    }
    const out = new THREE.Vector3();
    const fs = renderTransform(b.sat, 0, out);
    expect((2 * fs * CORE_RADIUS_M['sol:saturn']! / out.distanceTo(cam)) * H / FOV).toBeLessThanOrEqual(BACKGROUND_RING_MULT * BACKGROUND_MAX_FRACTION * H * 1.001);
    expect(px(b.sun, cam, 0)).toBeLessThanOrEqual(SUN_BACKGROUND_MAX_FRACTION * H * 1.001);
    // Order survives the cap.
    expect(px(b.earth, cam, 0)).toBeLessThan(px(b.jup, cam, 0));
    expect(px(b.merc, cam, 0)).toBeLessThan(px(b.earth, cam, 0));
  });

  it('never caps the focused planet, caps everything when nothing is focused', () => {
    const b = system();
    const cam = new THREE.Vector3(-5.2 * AU, 0, 3 * AU);
    updateScaleView(cam, H, FOV, { focusId: 'sol:jupiter', focusDistanceM: 3 * AU, dtSec: 0 });
    expect(px(b.jup, cam, 0)).toBeGreaterThan(0.06 * H);
    expect(px(b.sat, cam, 0)).toBeLessThanOrEqual(BACKGROUND_MAX_FRACTION * H * 1.001);
    updateScaleView(cam, H, FOV, { focusId: null, focusDistanceM: Infinity, dtSec: 0 });
    expect(px(b.jup, cam, 1)).toBeLessThanOrEqual(BACKGROUND_MAX_FRACTION * H * 1.001);
  });

  it('draws the Sun at true size from near a focused planet and eases the background cap', () => {
    const b = system();
    const cam = new THREE.Vector3(AU, 2e7, 0);
    updateScaleView(cam, H, FOV, { focusId: 'sol:earth', focusDistanceM: 2e7, dtSec: 0 });
    expect(renderFactor(b.sun, 0)).toBe(1);
    updateScaleView(cam, H, FOV, { focusId: 'sol:earth', focusDistanceM: SUN_TRUE_NEAR_M * 0.99, dtSec: 0 });
    expect(renderFactor(b.sun, 1)).toBe(1);
    // Switching focus away from Jupiter eases its cap in (no pop).
    const camJ = new THREE.Vector3(-5.2 * AU, 0, 3 * AU);
    updateScaleView(camJ, H, FOV, { focusId: 'sol:jupiter', focusDistanceM: 3 * AU, dtSec: 0 });
    const big = px(b.jup, camJ, 2);
    updateScaleView(camJ, H, FOV, { focusId: 'sol:earth', focusDistanceM: 3 * AU, dtSec: 1 / 60 });
    const step = px(b.jup, camJ, 3);
    expect(step).toBeLessThan(big);
    expect(step).toBeGreaterThan(big * 0.9);
  });

  it('keeps the planets in size order in a far outer-system overview', () => {
    const b = system();
    for (const dist of [40 * AU, 80 * AU, 150 * AU]) {
      const cam = new THREE.Vector3(0, 0, dist);
      updateScaleView(cam, H, FOV, { focusId: 'sol:sun', focusDistanceM: dist, dtSec: 0 });
      const t = dist;
      const j = apparent(b.jup, cam, t), s = apparent(b.sat, cam, t), u = apparent(b.ura, cam, t), n = apparent(b.nep, cam, t);
      const e = apparent(b.earth, cam, t);
      expect(s).toBeLessThanOrEqual(j * 1.0001);
      // Sun focus: every planet is background-capped, so the looser background order floor applies.
      expect(u).toBeLessThanOrEqual(s * Math.max(PLANET_ORDER_MIN_RATIO, BACKGROUND_ORDER_MIN_RATIO) * 1.0001);
      expect(n).toBeLessThanOrEqual(u * 1.0001);
      expect(e).toBeLessThanOrEqual(n * 1.0001);
    }
  });
});
