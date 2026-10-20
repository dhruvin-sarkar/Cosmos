/**
 * Planet class → procedural look (artist's impression, physically motivated). Colours are linear albedos chosen from
 * Solar System analogues and published exoplanet albedo/colour measurements:
 *  - hot Jupiters are very dark (geometric albedo ≲ 0.1, e.g. TrES-2 b ≈ 0.01, Kipping & Spiegel 2011);
 *  - a cloud-free warm giant scatters blue (HD 189733 b measured deep blue, Evans et al. 2013);
 *  - cold giants look Jupiter-like (ammonia clouds), temperate giants white (water clouds; Sudarsky et al. 2000);
 *  - ice giants cyan-blue (methane), Venus-like worlds a creamy featureless deck, lava worlds dark crust + glowing melt.
 * Thermal emission is a real blackbody ratio: radiance of the planet at its temperature relative to the reflected
 * light of a white Lambertian surface at the same distance from the star, per display channel.
 */
import * as THREE from 'three';
import type { PlanetLook } from './planetMaterial';
import type { PlanetModel, StarModel } from './physics';
import { hash01 } from './physics';

const H = 6.62607015e-34, C = 2.99792458e8, KB = 1.380649e-23;

/** Planck spectral radiance B_λ(T), W m⁻³ sr⁻¹. */
export function planckLambda(lambdaM: number, tK: number): number {
  if (!(tK > 0)) return 0;
  const x = (H * C) / (lambdaM * KB * tK);
  if (x > 700) return 0;
  return (2 * H * C * C) / Math.pow(lambdaM, 5) / Math.expm1(x);
}

/** Display wavelengths (R, G, B), m: visible, and a JHK-like false-colour set for the infrared view. */
export const VISIBLE_LAMBDA: readonly [number, number, number] = [0.61e-6, 0.55e-6, 0.465e-6];
export const INFRARED_LAMBDA: readonly [number, number, number] = [2.2e-6, 1.6e-6, 1.25e-6];

/**
 * Thermal radiance of a planet surface at `tK` relative to E/π (E = stellar irradiance at the planet) per channel:
 *   ratio(λ) = B_λ(T) / (B_λ(T★) · (R★/a)²).
 */
export function thermalRatio(tK: number, star: StarModel, aM: number, lambdas: readonly number[], out: THREE.Color): THREE.Color {
  const dil = (star.radiusM / aM) ** 2;
  const v = lambdas.map((l) => {
    const s = planckLambda(l, star.teffK) * dil;
    return s > 0 ? planckLambda(l, tK) / s : 0;
  });
  return out.setRGB(v[0], v[1], v[2]);
}

export interface PlanetThermal {
  dayK: number;
  nightK: number;
}

/** Day/night emission temperatures used for the glow. */
export function planetThermal(p: PlanetModel, star: StarModel): PlanetThermal {
  if (p.internalTeffK > 0) return { dayK: p.internalTeffK, nightK: p.internalTeffK };
  if (!(p.aM > 0)) return { dayK: 0, nightK: 0 };
  const tSub = star.teffK * Math.sqrt(star.radiusM / p.aM);
  const giant = p.type.includes('jupiter') || p.type.includes('giant') || p.type.includes('neptune');
  if (p.type === 'lava-world') return { dayK: Math.min(0.92 * tSub, 3000), nightK: 0 };
  if (p.type === 'hot-rocky') return { dayK: 0.9 * tSub * 0.82, nightK: 0 };
  // Giants: day side ~ no-redistribution limit (f = 2/3), night ~ 45 % of the day-side temperature for hot Jupiters.
  const day = tSub * Math.pow(2 / 3, 0.25) * Math.pow(1 - (p.type === 'hot-jupiter' || p.type === 'ultra-hot-jupiter' ? 0.05 : 0.3), 0.25);
  if (giant) return { dayK: day, nightK: p.type.includes('hot') ? 0.45 * day : 0.8 * day };
  return { dayK: 0, nightK: 0 };
}

const c3 = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);

/** Build the shader look for a planet. `lambdas` selects visible or infrared emission channels. */
export function planetLook(p: PlanetModel, star: StarModel, lambdas: readonly number[] = VISIBLE_LAMBDA): PlanetLook {
  const seed = hash01(p.name);
  const j = (k: number, amt = 0.12): number => 1 + amt * (hash01(`${p.name}:${k}`) - 0.5) * 2;
  const cl = p.climate;
  const base: PlanetLook = {
    kind: 0, colA: c3(0.14, 0.12, 0.1), colB: c3(0.22, 0.19, 0.15), colC: c3(0.3, 0.27, 0.22),
    ocean: 0, ice: 0, cloud: 0, haze: 0, hazeColor: c3(0.7, 0.65, 0.55),
    bandFreq: 10, bandContrast: 0.5, turbulence: 1, lava: 0, airless: 1, relief: 0.05, minnaertK: 0.85,
    seed, locked: p.tidallyLocked ? 1 : 0,
    emitDay: c3(0, 0, 0), emitNight: c3(0, 0, 0), limb: c3(0, 0, 0),
  };
  const tint = (c: THREE.Color): THREE.Color => c.setRGB(c.r * j(1), c.g * j(2), c.b * j(3));
  switch (p.type) {
    case 'lava-world':
      Object.assign(base, { colA: c3(0.035, 0.03, 0.028), colB: c3(0.07, 0.06, 0.055), colC: c3(0.1, 0.08, 0.07), lava: 1, relief: 0.06 });
      break;
    case 'hot-rocky':
      Object.assign(base, { colA: tint(c3(0.11, 0.095, 0.08)), colB: tint(c3(0.2, 0.17, 0.14)), colC: c3(0.26, 0.22, 0.18), relief: 0.07 });
      break;
    case 'venus-like':
      Object.assign(base, {
        kind: 1, colA: c3(0.78, 0.7, 0.52), colB: c3(0.7, 0.6, 0.42), colC: c3(0.82, 0.76, 0.6),
        bandFreq: 4, bandContrast: 0.15, turbulence: 0.6, haze: 0.55, hazeColor: c3(0.8, 0.72, 0.55), minnaertK: 0.6, airless: 0,
        limb: c3(0.9, 0.8, 0.6),
      });
      break;
    case 'temperate-rocky':
      Object.assign(base, {
        colA: tint(c3(0.16, 0.13, 0.095)), colB: tint(c3(0.26, 0.22, 0.17)), colC: c3(0.34, 0.3, 0.24),
        ocean: cl.oceanCover, ice: cl.iceCover, cloud: Math.min(0.75, cl.cloudCover), haze: 0.6 * cl.hazeAmount,
        hazeColor: c3(0.75, 0.75, 0.72), airless: 0, relief: 0.05, limb: c3(0.35, 0.55, 1.0),
      });
      break;
    case 'frozen-rocky':
      Object.assign(base, {
        colA: c3(0.45, 0.47, 0.5), colB: c3(0.7, 0.72, 0.75), colC: c3(0.55, 0.5, 0.45),
        ice: Math.max(0.5, cl.iceCover), cloud: 0.1, airless: 0.5, relief: 0.04, limb: c3(0.4, 0.5, 0.8),
      });
      break;
    case 'sub-neptune': {
      const hot = p.teq0K > 700;
      Object.assign(base, {
        kind: 1,
        colA: hot ? c3(0.42, 0.36, 0.3) : tint(c3(0.42, 0.52, 0.58)),
        colB: hot ? c3(0.34, 0.28, 0.23) : tint(c3(0.36, 0.45, 0.53)),
        colC: c3(0.5, 0.55, 0.58),
        bandFreq: 6, bandContrast: 0.25, turbulence: 0.8, haze: 0.45, hazeColor: hot ? c3(0.5, 0.42, 0.33) : c3(0.55, 0.62, 0.66),
        minnaertK: 0.8, airless: 0, limb: hot ? c3(0.6, 0.5, 0.4) : c3(0.45, 0.6, 0.85),
      });
      break;
    }
    case 'warm-neptune':
      Object.assign(base, {
        kind: 1, colA: tint(c3(0.48, 0.53, 0.58)), colB: tint(c3(0.4, 0.45, 0.52)), colC: c3(0.55, 0.58, 0.6),
        bandFreq: 7, bandContrast: 0.3, turbulence: 0.9, haze: 0.3, hazeColor: c3(0.55, 0.58, 0.62), airless: 0, limb: c3(0.45, 0.6, 0.9),
      });
      break;
    case 'ice-giant':
      Object.assign(base, {
        kind: 1, colA: tint(c3(0.3, 0.5, 0.68)), colB: tint(c3(0.22, 0.38, 0.62)), colC: c3(0.55, 0.7, 0.8),
        bandFreq: 8, bandContrast: 0.35, turbulence: 0.9, haze: 0.15, hazeColor: c3(0.45, 0.6, 0.75), airless: 0, limb: c3(0.4, 0.65, 1.0),
      });
      break;
    case 'cold-giant':
      Object.assign(base, {
        kind: 1, colA: tint(c3(0.72, 0.62, 0.47)), colB: tint(c3(0.5, 0.36, 0.25)), colC: c3(0.8, 0.76, 0.7),
        bandFreq: 13, bandContrast: 0.75, turbulence: 1.2, airless: 0,
      });
      break;
    case 'water-cloud-giant':
      Object.assign(base, {
        kind: 1, colA: c3(0.8, 0.8, 0.78), colB: c3(0.66, 0.66, 0.65), colC: c3(0.85, 0.85, 0.86),
        bandFreq: 11, bandContrast: 0.35, turbulence: 1.0, airless: 0,
      });
      break;
    case 'warm-giant':
      Object.assign(base, {
        kind: 1, colA: c3(0.13, 0.22, 0.45), colB: c3(0.08, 0.15, 0.36), colC: c3(0.25, 0.35, 0.55),
        bandFreq: 7, bandContrast: 0.4, turbulence: 1.0, airless: 0, limb: c3(0.3, 0.45, 1.0),
      });
      break;
    case 'hot-jupiter':
      Object.assign(base, {
        kind: 1, colA: c3(0.05, 0.045, 0.045), colB: c3(0.03, 0.026, 0.026), colC: c3(0.08, 0.06, 0.05),
        bandFreq: 4, bandContrast: 0.5, turbulence: 1.3, haze: 0.15, hazeColor: c3(0.08, 0.06, 0.05), airless: 0,
      });
      break;
    case 'ultra-hot-jupiter':
      Object.assign(base, {
        kind: 1, colA: c3(0.06, 0.05, 0.04), colB: c3(0.035, 0.03, 0.025), colC: c3(0.1, 0.07, 0.05),
        bandFreq: 3, bandContrast: 0.4, turbulence: 1.4, airless: 0,
      });
      break;
  }
  // Young self-luminous giants still show cloud bands in reflected light (illustrative), plus their own glow.
  const th = planetThermal(p, star);
  if (th.dayK > 600) thermalRatio(th.dayK, star, p.aM, lambdas, base.emitDay);
  if (th.nightK > 600) thermalRatio(th.nightK, star, p.aM, lambdas, base.emitNight);
  return base;
}
