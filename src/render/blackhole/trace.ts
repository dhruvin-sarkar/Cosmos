/**
 * CPU reference of the lens shader's photon integrator (glsl.ts): same Binet-form force, the same gravitomagnetic spin
 * term and the same leapfrog stepping, in r_s units with the hole at the origin. Used by tests to check the shadow
 * size, the spin asymmetry and the far-field deflection, and handy for tools.
 */

export interface TraceResult {
  captured: boolean;
  /** Final direction (unit) for escaping rays. */
  dir: [number, number, number];
  /** Total deflection angle (rad) between the initial and final direction. */
  deflection: number;
  steps: number;
}

type V = [number, number, number];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.sqrt(dot(a, a));

function accel(x: V, v: V, J: V): V {
  const r = Math.max(len(x), 0.45);
  const h = cross(x, v);
  const h2 = dot(h, h);
  const r5 = r ** 5;
  const n: V = [x[0] / r, x[1] / r, x[2] / r];
  const nj = dot(n, J);
  const r3 = r ** 3;
  const B: V = [(2 * (3 * n[0] * nj - J[0])) / r3, (2 * (3 * n[1] * nj - J[1])) / r3, (2 * (3 * n[2] * nj - J[2])) / r3];
  const vb = cross(v, B);
  return [(-1.5 * h2 * x[0]) / r5 - 2 * vb[0], (-1.5 * h2 * x[1]) / r5 - 2 * vb[1], (-1.5 * h2 * x[2]) / r5 - 2 * vb[2]];
}

/**
 * Integrate a photon from `origin` along unit `dir` (r_s units). `spin` is a* along `axis` (unit). The ray is
 * integrated until it falls below the horizon or leaves `rMax` moving outwards.
 */
export function traceRay(origin: V, dir: V, spin = 0, axis: V = [0, 0, 1], rMax = 400, maxSteps = 20000, stepScale = 1): TraceResult {
  const a = Math.max(-0.9999, Math.min(0.9999, spin));
  const horizon = (1 + Math.sqrt(1 - a * a)) / 2;
  const J: V = [0.25 * a * axis[0], 0.25 * a * axis[1], 0.25 * a * axis[2]];
  let x: V = [...origin] as V;
  let v: V = [...dir] as V;
  let i = 0;
  for (; i < maxSteps; i++) {
    const r = len(x);
    if (r < horizon) return { captured: true, dir: [0, 0, 0], deflection: NaN, steps: i };
    if (r > rMax && dot(x, v) > 0) break;
    const dl = Math.min(Math.max((r < 5 ? 0.035 : 0.075) * stepScale * r, 0.008), 4);
    const a0 = accel(x, v, J);
    const vh: V = [v[0] + 0.5 * dl * a0[0], v[1] + 0.5 * dl * a0[1], v[2] + 0.5 * dl * a0[2]];
    const xn: V = [x[0] + dl * vh[0], x[1] + dl * vh[1], x[2] + dl * vh[2]];
    const a1 = accel(xn, vh, J);
    v = [vh[0] + 0.5 * dl * a1[0], vh[1] + 0.5 * dl * a1[1], vh[2] + 0.5 * dl * a1[2]];
    x = xn;
  }
  const l = len(v);
  const d: V = [v[0] / l, v[1] / l, v[2] / l];
  return { captured: false, dir: d, deflection: Math.acos(Math.max(-1, Math.min(1, dot(d, dir)))), steps: i };
}

/** Critical impact parameter (r_s) found by bisection for a ray passing the hole in the plane ⟂ `axis`, offset along +y (side = 1) or −y. */
export function criticalImpactParameter(spin: number, side: 1 | -1, start = 300): number {
  let lo = 1;
  let hi = 6;
  for (let k = 0; k < 40; k++) {
    const b = 0.5 * (lo + hi);
    const res = traceRay([-start, side * b, 0], [1, 0, 0], spin, [0, 0, 1], start * 1.2);
    if (res.captured) lo = b;
    else hi = b;
  }
  return 0.5 * (lo + hi);
}
