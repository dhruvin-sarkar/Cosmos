/**
 * Display-referred colour helpers for overlays drawn inside the HDR scene.
 *
 * Overlay colours (VISUAL_DIRECTION tokens such as brass `oklch(0.85 0.10 88)`) are specified as display
 * colours, but overlays render into the linear HDR buffer and pass through the engine's AgX tone mapping
 * (src/core/post.ts). To land exactly on the token after tone mapping we invert three.js r186's
 * `AgXToneMapping` numerically (Gauss–Newton on a TS port of the shader). Done once per colour, never per frame.
 */

export interface Rgb3 {
  r: number;
  g: number;
  b: number;
}

type M3 = readonly [number, number, number, number, number, number, number, number, number];

/** GLSL mat3 constructor order (column-major): [c0.x, c0.y, c0.z, c1.x, ...]. */
const SRGB_TO_REC2020: M3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956];
const REC2020_TO_SRGB: M3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const AGX_INSET: M3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591,
  0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859,
];
const AGX_OUTSET: M3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272,
  -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

function mul(m: M3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

function contrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** three.js AgXToneMapping: scene-linear sRGB → display-linear sRGB in [0, 1] (before the sRGB transfer). */
export function agxToneMap(c: Rgb3, exposure = 1): Rgb3 {
  let v = mul(SRGB_TO_REC2020, [c.r * exposure, c.g * exposure, c.b * exposure]);
  v = mul(AGX_INSET, v);
  v = v.map((x) => contrast(clamp01((Math.log2(Math.max(x, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)))) as [
    number,
    number,
    number,
  ];
  v = mul(AGX_OUTSET, v);
  v = v.map((x) => Math.pow(Math.max(0, x), 2.2)) as [number, number, number];
  v = mul(REC2020_TO_SRGB, v);
  return { r: clamp01(v[0]), g: clamp01(v[1]), b: clamp01(v[2]) };
}

/**
 * Scene-linear colour that AgX maps to the display-linear colour `target` (least squares, solved in log space
 * so the answer stays positive). Targets outside AgX's reachable gamut return the closest reachable colour.
 */
export function agxInverse(target: Rgb3, exposure = 1): Rgb3 {
  const t = [target.r, target.g, target.b];
  // Start from the luminance-matched grey, then refine per channel.
  let x = [Math.log(0.5), Math.log(0.5), Math.log(0.5)];
  const f = (lx: number[]): number[] => {
    const o = agxToneMap({ r: Math.exp(lx[0]), g: Math.exp(lx[1]), b: Math.exp(lx[2]) }, exposure);
    return [o.r - t[0], o.g - t[1], o.b - t[2]];
  };
  for (let iter = 0; iter < 60; iter++) {
    const r = f(x);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-7) break;
    const J: number[][] = [[], [], []];
    const h = 1e-5;
    for (let j = 0; j < 3; j++) {
      const xp = x.slice();
      xp[j] += h;
      const rp = f(xp);
      for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    // Solve (JᵀJ + λI) d = −Jᵀr  (Levenberg damping keeps clamped regions stable).
    const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const g = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += J[k][i] * J[k][j];
        A[i][j] = s + (i === j ? 1e-9 : 0);
      }
      g[i] = -(J[0][i] * r[0] + J[1][i] * r[1] + J[2][i] * r[2]);
    }
    const d = solve3(A, g);
    // Limit the step to keep the log-space walk well behaved.
    const len = Math.hypot(d[0], d[1], d[2]);
    const s = len > 2 ? 2 / len : 1;
    x = [x[0] + d[0] * s, x[1] + d[1] * s, x[2] + d[2] * s];
  }
  return { r: Math.exp(x[0]), g: Math.exp(x[1]), b: Math.exp(x[2]) };
}

function solve3(A: number[][], b: number[]): number[] {
  const [a, bb, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-30) return [0, 0, 0];
  const inv = 1 / det;
  return [
    inv * (b[0] * (e * i - f * h) - bb * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])),
    inv * (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)),
    inv * (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)),
  ];
}

/** OKLCH (L 0–1, C, hue degrees) → linear sRGB (Björn Ottosson's OKLab matrices). May fall outside [0, 1]. */
export function oklchToLinearSrgb(L: number, C: number, hDeg: number): Rgb3 {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/**
 * Scene-linear colour that, drawn additively over black, displays as the OKLCH token at `opacity` after AgX at
 * `exposure` (the token's display-linear value × opacity is the target). Bright saturated colours are outside
 * AgX's reachable gamut at full opacity (it desaturates highlights); at overlay opacities (≤ ~0.8) they are reachable.
 */
export function sceneLinearForOklch(L: number, C: number, hDeg: number, opacity = 1, exposure = 1): Rgb3 {
  const d = oklchToLinearSrgb(L, C, hDeg);
  const a = clamp01(opacity);
  return agxInverse({ r: clamp01(d.r) * a, g: clamp01(d.g) * a, b: clamp01(d.b) * a }, exposure);
}

/** VISUAL_DIRECTION colour tokens used by 3D overlays (OKLCH). */
export const OVERLAY_TOKENS = {
  ink: [0.93, 0, 0],
  brass: [0.85, 0.1, 88],
} as const;
