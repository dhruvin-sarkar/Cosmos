import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { agxToneMap } from '../tonemap';
import { AGX_GLSL } from './shaders';
import {
  ADAPT_TAU_DOWN,
  ExposureController,
  HIGHLIGHT_TARGET,
  METER_EV_MAX,
  meterCorrection,
  regimeEv,
  type MeterReading,
} from './exposure';
import { SUN_ANG_RADIUS_1AU, computeSunScreen, createSunScreen, glareGain } from './glare';

const AU = 1.495978707e11;
const R_SUN = 695_700e3;
const srgb = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const reading = (p: Partial<MeterReading>): MeterReading => ({
  meanLog2: Number.NaN,
  coverage: 0,
  highLog2: Number.NaN,
  highCoverage: 0,
  ...p,
});

describe('AgX', () => {
  it('uses exactly the constants of three.js r186 AgXToneMapping (Filament/Blender AgX)', () => {
    const numbers = AGX_GLSL.slice(AGX_GLSL.indexOf('vec3 agxContrastApprox'), AGX_GLSL.indexOf('vec3 linearToSrgb'))
      .match(/\d+\.\d+/g)!
      .filter(n => n !== '1.0' && n !== '0.0' && n !== '2.2');
    const reference = THREE.ShaderChunk.tonemapping_pars_fragment.replace(/\s+/g, ' ');
    expect(numbers.length).toBeGreaterThan(30);
    for (const n of numbers) expect(reference, n).toContain(n);
  });

  it('maps black to black and middle grey to about half display value', () => {
    expect(agxToneMap({ r: 0, g: 0, b: 0 }).g).toBe(0);
    // AgX base (Sobotka): 0.18 scene grey lands near the middle of the display range (~0.5 sRGB-encoded).
    const grey = srgb(agxToneMap({ r: 0.18, g: 0.18, b: 0.18 }).g);
    expect(grey).toBeGreaterThan(0.45);
    expect(grey).toBeLessThan(0.6);
    // Monotonic and saturating: +4 EV above grey is near white, never above 1.
    const hi = srgb(agxToneMap({ r: 2.88, g: 2.88, b: 2.88 }).g);
    expect(hi).toBeGreaterThan(0.9);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe('exposure model', () => {
  it('interpolates the regime EV smoothly between anchors', () => {
    expect(regimeEv(6)).toBe(0);
    expect(regimeEv(11.5)).toBeCloseTo(0.25, 6);
    expect(regimeEv(16.5)).toBeCloseTo(0.6, 6);
    expect(regimeEv(26)).toBeCloseTo(0.8, 6);
    let prev = -Infinity;
    for (let s = 5; s <= 27; s += 0.25) {
      const ev = regimeEv(s);
      expect(ev).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = ev;
    }
  });

  it('leaves well-exposed bodies alone (dead zone) and corrects gross under-exposure partially', () => {
    // Earth at EV 0: dark oceans + bright clouds, lit-pixel log-mean ≈ 0.067.
    expect(meterCorrection(reading({ meanLog2: Math.log2(0.067), coverage: 0.4 }), 0)).toBe(0);
    // A body lit by 1/900 of the sunlight with no domain-side gain: pushed up, but capped.
    const neptune = meterCorrection(reading({ meanLog2: Math.log2(0.15 / 900), coverage: 0.4 }), 0);
    expect(neptune).toBeGreaterThan(4);
    expect(neptune).toBeLessThanOrEqual(METER_EV_MAX);
    // A sparse star field (tiny coverage) never drives exposure.
    expect(meterCorrection(reading({ meanLog2: -6, coverage: 0.01 }), 0)).toBe(0);
  });

  it('pulls exposure down for a large emissive disc so it stays textured', () => {
    const sun = meterCorrection(reading({ meanLog2: Math.log2(3), coverage: 1, highLog2: Math.log2(6), highCoverage: 0.2 }), 0.25);
    expect(sun).toBeCloseTo(Math.log2(HIGHLIGHT_TARGET / 6) - 0.25, 6);
    // Small highlights (a specular glint) do not.
    expect(meterCorrection(reading({ meanLog2: Math.log2(0.067), coverage: 0.4, highLog2: 3, highCoverage: 0.002 }), 0)).toBe(0);
  });

  it('adapts with the asymmetric time constants, snaps on the first frame, honours manual override', () => {
    const c = new ExposureController();
    expect(c.update(7, 1 / 60)).toBe(0);
    c.setBias(-2);
    const ev = c.update(7, ADAPT_TAU_DOWN);
    expect(ev).toBeCloseTo(-2 * (1 - Math.exp(-1)), 6);
    c.setManual(1.5);
    for (let i = 0; i < 1200; i++) c.update(7, 1 / 60);
    expect(c.state.ev).toBeCloseTo(1.5, 3);
    expect(c.state.mode).toBe('manual');
    c.setManual(null);
    expect(c.state.mode).toBe('auto');
  });
});

describe('Sun glare geometry', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  it('places a Sun straight ahead at the screen centre with the right angular size and gain', () => {
    const s = computeSunScreen(new THREE.Vector3(0, 0, -AU), R_SUN, camera, 1080, createSunScreen());
    expect(s.inFront).toBe(true);
    expect(s.u).toBeCloseTo(0.5, 9);
    expect(s.v).toBeCloseTo(0.5, 9);
    expect(s.angRadius).toBeCloseTo(SUN_ANG_RADIUS_1AU, 7);
    // 0.2666° radius in a 50° vertical field at 1080 px ≈ 5.4 px.
    expect(s.radiusPx).toBeGreaterThan(5);
    expect(s.radiusPx).toBeLessThan(6);
    expect(s.brightness).toBeCloseTo(1, 4);
    expect(s.gain).toBeCloseTo(1, 4);
  });

  it('is behind the camera when the Sun is behind', () => {
    const s = computeSunScreen(new THREE.Vector3(0, 0, AU), R_SUN, camera, 1080, createSunScreen());
    expect(s.inFront).toBe(false);
  });

  it('dims with distance and vanishes beyond ~1000 AU', () => {
    expect(glareGain(1 / 900)).toBeCloseTo(Math.pow(1 / 900, 0.35), 6);
    expect(glareGain(1e-6)).toBe(0);
    expect(glareGain(1e4)).toBe(3);
    expect(glareGain(0.5)).toBeLessThan(glareGain(1));
  });
});
