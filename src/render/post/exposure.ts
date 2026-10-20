/**
 * Cinematic exposure: a base EV per scale regime, a metered correction from the lit part of the frame, user
 * bias / manual override, and smooth (asymmetric) adaptation.
 *
 * EV convention: linear exposure = 2^EV, applied to scene-linear radiance before bloom and AgX. EV 0 is the
 * render-kit calibration (a Lambertian albedo-0.3 surface under the default sun intensity reads as a bright
 * mid-tone, the star field is tuned by its own photometric zero point).
 *
 * Regimes (Cosmic Ruler scale = log10 of the visible field width in metres):
 *   planetary close-up   ≤ 1e8 m     EV 0     (expose for the sunlit body)
 *   interplanetary       1e10–1e13   EV +0.25 (the Sun dominates; planets are points)
 *   stellar              1e15–1e18   EV +0.6  (expose for the star field)
 *   galactic+            ≥ 1e20      EV +0.8  (diffuse galaxy light)
 * Between anchors the EV is smoothly interpolated.
 *
 * Metering (spot/centre-weighted, lit pixels only): the meter reports the log2-mean luminance of pixels above
 * a black floor and the fraction of the frame they cover. With a resolved lit body (coverage ≳ 2 %) the target
 * moves toward KEY_TARGET by `METER_COMPENSATION` of the error (partial, like an eye: Neptune stays dimmer
 * than Earth, but readable), clamped to [−4, +6] EV. A black frame or a sparse star field leaves the base EV.
 * Highlights: the meter also reports the log-mean and coverage of pixels above HIGHLIGHT_LEVEL (emissive: the
 * Sun's photosphere, hot gas). When they cover more than ~0.5 % of the frame the exposure is pulled down so they
 * land near HIGHLIGHT_TARGET (bright but textured: granulation and limb darkening stay visible), never up.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT, LUMA_GLSL, NAN_GLSL } from './shaders';

export type ExposureMode = 'auto' | 'manual';

export interface ExposureState {
  mode: ExposureMode;
  /** Exposure in effect, EV (linear = 2^ev). */
  ev: number;
  /** Where adaptation is heading, EV. */
  targetEv: number;
  /** Regime base EV for the current scale. */
  baseEv: number;
  /** Metered correction currently applied (EV), 0 without a usable meter reading. */
  meterEv: number;
  /** User bias added in auto mode, EV. */
  biasEv: number;
  /** Fraction of the frame the meter counted as lit (0..1); null before the first reading. */
  coverage: number | null;
}

/** (scaleLog10, EV) anchors. */
export const REGIME_EV: readonly (readonly [number, number])[] = [
  [8, 0],
  [10, 0.25],
  [13, 0.25],
  [15, 0.6],
  [18, 0.6],
  [20, 0.8],
];

/** Scene-linear key the meter aims lit pixels at (after exposure). */
export const KEY_TARGET = 0.11;
/** Metered errors within ±this many EV are left alone. */
export const METER_DEAD_ZONE_EV = 1.25;
export const METER_COMPENSATION = 0.75;
export const METER_EV_MIN = -4;
/** Floor for the highlight pull-down (the resolved Sun needs about −4.7 EV to keep its limb darkening). */
export const HIGHLIGHT_EV_MIN = -7;
/** Scene-linear luminance above which the meter counts a pixel as an emissive highlight (sunlit white ≈ 1.6). */
export const HIGHLIGHT_LEVEL = 3;
/** Exposure-scaled level large highlights are brought down to. */
export const HIGHLIGHT_TARGET = 0.8;
export const METER_EV_MAX = 6;
/** Adaptation time constants, seconds: toward darker exposure (bright scene) is faster, like the eye. */
export const ADAPT_TAU_DOWN = 0.45;
export const ADAPT_TAU_UP = 1.1;
export const EV_LIMIT = 12;

const smooth = (x: number): number => x * x * (3 - 2 * x);

export function regimeEv(scaleLog10: number): number {
  if (!Number.isFinite(scaleLog10)) return 0;
  const a = REGIME_EV;
  if (scaleLog10 <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (scaleLog10 <= a[i][0]) {
      const t = (scaleLog10 - a[i - 1][0]) / (a[i][0] - a[i - 1][0]);
      return a[i - 1][1] + (a[i][1] - a[i - 1][1]) * smooth(t);
    }
  }
  return a[a.length - 1][1];
}

export interface MeterReading {
  /** log2-mean scene-linear luminance of lit pixels (centre weighted). */
  meanLog2: number;
  /** Fraction of the (centre-weighted) frame that is lit, 0..1. */
  coverage: number;
  /** log2-mean luminance of highlight pixels (> HIGHLIGHT_LEVEL). */
  highLog2: number;
  /** Fraction of the frame covered by highlights, 0..1. */
  highCoverage: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** EV correction (relative to the regime base) for a meter reading. */
export function meterCorrection(r: MeterReading, baseEv: number): number {
  let corr = litCorrection(r.meanLog2, r.coverage, baseEv);
  if (Number.isFinite(r.highLog2) && r.highCoverage > 0) {
    const hw = smooth(clamp01((r.highCoverage - 0.005) / (0.05 - 0.005)));
    const need = Math.max(HIGHLIGHT_EV_MIN, Math.log2(HIGHLIGHT_TARGET) - r.highLog2 - baseEv);
    if (need < corr) corr += (need - corr) * hw;
  }
  return corr;
}

function litCorrection(meanLog2: number, coverage: number, baseEv: number): number {
  if (!Number.isFinite(meanLog2) || !(coverage > 0)) return 0;
  const weight = smooth(clamp01((coverage - 0.02) / (0.2 - 0.02)));
  if (weight <= 0) return 0;
  // meanLog2 is scene-linear (pre-exposure): the EV error that would map it to KEY_TARGET, relative to the
  // regime base. Inside the dead zone nothing moves (Earth's dark oceans, the Moon's grey regolith and bright
  // Venus keep their true relative brightness); beyond it, a gross mis-exposure is partially corrected.
  const err = Math.log2(KEY_TARGET) - meanLog2 - baseEv;
  const excess = Math.sign(err) * Math.max(0, Math.abs(err) - METER_DEAD_ZONE_EV);
  const corr = Math.min(METER_EV_MAX, Math.max(METER_EV_MIN, excess * METER_COMPENSATION));
  return corr * weight;
}

export class ExposureController {
  readonly state: ExposureState = {
    mode: 'auto',
    ev: 0,
    targetEv: 0,
    baseEv: 0,
    meterEv: 0,
    biasEv: 0,
    coverage: null,
  };
  private manualEv = 0;
  private reading: MeterReading = { meanLog2: Number.NaN, coverage: 0, highLog2: Number.NaN, highCoverage: 0 };
  private initialized = false;

  get linear(): number {
    return Math.pow(2, this.state.ev);
  }

  setManual(ev: number | null): void {
    if (ev === null || !Number.isFinite(ev)) {
      this.state.mode = 'auto';
      return;
    }
    this.state.mode = 'manual';
    this.manualEv = Math.max(-EV_LIMIT, Math.min(EV_LIMIT, ev));
  }

  setBias(ev: number): void {
    if (Number.isFinite(ev)) this.state.biasEv = Math.max(-EV_LIMIT, Math.min(EV_LIMIT, ev));
  }

  /** Latest meter reading (scene-linear, pre-exposure). */
  meter(reading: MeterReading): void {
    this.reading = reading;
    this.state.coverage = reading.coverage;
  }

  /** Advance adaptation. `snap` jumps straight to the target (first frame, reduced-motion cuts). */
  update(scaleLog10: number, dtSec: number, snap = false): number {
    const s = this.state;
    s.baseEv = regimeEv(scaleLog10);
    s.meterEv = s.coverage === null ? 0 : meterCorrection(this.reading, s.baseEv);
    s.targetEv = s.mode === 'manual' ? this.manualEv : s.baseEv + s.meterEv + s.biasEv;
    if (!this.initialized || snap) {
      s.ev = s.targetEv;
      this.initialized = true;
    } else {
      const tau = s.targetEv < s.ev ? ADAPT_TAU_DOWN : ADAPT_TAU_UP;
      const k = 1 - Math.exp(-Math.max(0, dtSec) / tau);
      s.ev += (s.targetEv - s.ev) * k;
    }
    return s.ev;
  }
}

// ── GPU meter ──────────────────────────────────────────────────────────────────────────────────

/** log2 range the meter encodes. */
const LOG_MIN = -16;
const LOG_MAX = 8;
const GRID = 64;
const TILE = 8;

const METER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uFloor;
uniform float uHigh;
varying vec2 vUv;
${LUMA_GLSL}
${NAN_GLSL}
void main() {
  // 4 bilinear taps per meter cell (each covers ~1/64 of the frame per axis).
  vec2 o = vec2(0.25 / ${GRID}.0);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 off = vec2(i == 0 || i == 2 ? -o.x : o.x, i < 2 ? -o.y : o.y);
    float l = lumaRec709(texture2D(tSrc, vUv + off).rgb);
    if (nanBits(l)) l = 0.0; // a stray NaN texel must not poison the meter
    float lg = clamp(log2(max(l, 1e-8)), ${LOG_MIN}.0, ${LOG_MAX}.0);
    float w = step(uFloor, l);
    float h = step(uHigh, l);
    acc += vec4(w * lg, w, h * lg, h);
  }
  gl_FragColor = acc * 0.25 * centreWeight(vUv);
}`;

const REDUCE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform bool uFinal;
uniform float uWeightSum;
varying vec2 vUv;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * ${TILE};
  vec4 acc = vec4(0.0);
  for (int y = 0; y < ${TILE}; y++) {
    for (int x = 0; x < ${TILE}; x++) {
      acc += texelFetch(tSrc, base + ivec2(x, y), 0);
    }
  }
  if (!uFinal) {
    gl_FragColor = acc;
    return;
  }
  const float LMIN = ${LOG_MIN}.0;
  const float LSPAN = ${LOG_MAX - LOG_MIN}.0;
  float meanLog = acc.g > 1e-4 ? acc.r / acc.g : LMIN;
  float highLog = acc.a > 1e-4 ? acc.b / acc.a : LMIN;
  gl_FragColor = clamp(vec4((meanLog - LMIN) / LSPAN, acc.g / uWeightSum, (highLog - LMIN) / LSPAN, acc.a / uWeightSum), 0.0, 1.0);
}`;

/** Centre weighting (the subject is usually framed near the centre); GLSL and JS must match. */
const CENTRE_WEIGHT_GLSL = /* glsl */ `
float centreWeight(vec2 uv) {
  vec2 d = uv - 0.5;
  return mix(1.0, 0.35, clamp(dot(d, d) * 4.0, 0.0, 1.0));
}`;

function centreWeightSum(): number {
  let sum = 0;
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const dx = (x + 0.5) / GRID - 0.5;
      const dy = (y + 0.5) / GRID - 0.5;
      const t = Math.min(1, Math.max(0, (dx * dx + dy * dy) * 4));
      sum += 1 + (0.35 - 1) * t;
    }
  return sum;
}

function mat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

/**
 * Downsamples the HDR frame to a 64×64 lit-pixel log-luminance grid, reduces it to one RGBA8 texel on the GPU
 * and reads that back asynchronously (PBO + fence), so the CPU never stalls.
 *
 * The readback is polled with poll() at the start of a frame (before its draw calls are queued): Chrome's
 * getBufferSubData is a synchronous round trip that waits for every command queued ahead of it, so reading before the
 * frame's work keeps it short. When it is slow anyway (the GPU process is busy with uploads or shader links during a
 * travel) the meter rests for READ_COOLDOWN_MS so it cannot add a hitch every reading (perf).
 */
const SLOW_READ_MS = 4;
const READ_COOLDOWN_MS = 2000;
/** Give up on a readback whose fence never signals (context trouble) after this many polls. */
const MAX_POLLS = 240;

export class ExposureMeter {
  private readonly grid: THREE.WebGLRenderTarget;
  private readonly tiles: THREE.WebGLRenderTarget;
  private readonly result: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly meterMat = mat(CENTRE_WEIGHT_GLSL + METER_FRAG, { tSrc: { value: null }, uFloor: { value: 0.004 }, uHigh: { value: HIGHLIGHT_LEVEL } });
  private readonly reduceMat = mat(REDUCE_FRAG, { tSrc: { value: null }, uFinal: { value: false }, uWeightSum: { value: centreWeightSum() } });
  private readonly pixel = new Uint8Array(4);
  private pending = false;
  private disposed = false;
  private failed = false;
  private gl: WebGL2RenderingContext | null = null;
  private pbo: WebGLBuffer | null = null;
  private sync: WebGLSync | null = null;
  private polls = 0;
  private restUntil = 0;
  private onResult: ((reading: MeterReading) => void) | null = null;

  constructor(halfFloat: boolean) {
    const opts = {
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    } as const;
    this.grid = new THREE.WebGLRenderTarget(GRID, GRID, opts);
    this.tiles = new THREE.WebGLRenderTarget(GRID / TILE, GRID / TILE, opts);
    this.result = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.UnsignedByteType });
  }

  get busy(): boolean {
    return this.pending || performance.now() < this.restUntil;
  }

  /** Collect a finished readback (call once per frame, before rendering). */
  poll(): void {
    const gl = this.gl;
    if (!this.pending || gl === null || this.sync === null) return;
    // A zero-timeout wait only queries the client-side fence state: it never blocks.
    const st = gl.clientWaitSync(this.sync, 0, 0);
    if (st === gl.WAIT_FAILED) {
      gl.deleteSync(this.sync);
      this.sync = null;
      this.pending = false;
      this.failed = true;
      return;
    }
    if (st === gl.TIMEOUT_EXPIRED) {
      if (++this.polls > MAX_POLLS) {
        gl.deleteSync(this.sync);
        gl.deleteBuffer(this.pbo);
        this.sync = null;
        this.pbo = null;
        this.pending = false;
      }
      return;
    }
    const t0 = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixel);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const t1 = performance.now();
    gl.deleteSync(this.sync);
    gl.deleteBuffer(this.pbo);
    this.sync = null;
    this.pbo = null;
    this.pending = false;
    if (t1 - t0 > SLOW_READ_MS) this.restUntil = t1 + READ_COOLDOWN_MS;
    if (this.disposed || this.onResult === null) return;
    const p = this.pixel;
    const span = LOG_MAX - LOG_MIN;
    this.onResult({
      meanLog2: LOG_MIN + (p[0] / 255) * span,
      coverage: p[1] / 255,
      highLog2: LOG_MIN + (p[2] / 255) * span,
      highCoverage: p[3] / 255,
    });
  }

  /** Measure `src` (scene-linear). `onResult` fires a frame or two later. */
  measure(renderer: THREE.WebGLRenderer, src: THREE.Texture, onResult: (reading: MeterReading) => void): void {
    if (this.pending || this.failed || this.disposed) return;
    this.meterMat.uniforms.tSrc.value = src;
    this.quad.material = this.meterMat;
    renderer.setRenderTarget(this.grid);
    this.quad.render(renderer);

    const ru = this.reduceMat.uniforms;
    this.quad.material = this.reduceMat;
    ru.tSrc.value = this.grid.texture;
    ru.uFinal.value = false;
    renderer.setRenderTarget(this.tiles);
    this.quad.render(renderer);
    ru.tSrc.value = this.tiles.texture;
    ru.uFinal.value = true;
    renderer.setRenderTarget(this.result);
    this.quad.render(renderer);

    // The result target is bound (read framebuffer too): queue the 1x1 read into a PBO behind a fence.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync !== 'function') {
      this.failed = true;
      return;
    }
    this.gl = gl;
    // A fresh 4-byte buffer per reading: Chrome serves the read from a shadow copy taken at the fence (no round trip),
    // and rewriting a buffer whose shadow was taken discards it.
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (this.sync === null) {
      this.failed = true;
      return;
    }
    this.onResult = onResult;
    this.polls = 0;
    this.pending = true;
  }

  dispose(): void {
    this.disposed = true;
    if (this.gl) {
      if (this.sync) this.gl.deleteSync(this.sync);
      if (this.pbo) this.gl.deleteBuffer(this.pbo);
    }
    this.sync = null;
    this.pbo = null;
    this.grid.dispose();
    this.tiles.dispose();
    this.result.dispose();
    this.meterMat.dispose();
    this.reduceMat.dispose();
    this.quad.dispose();
  }
}
