/**
 * Cosmic-web layer ('galaxies:web'): galaxy redshift surveys as 3-D point clouds in comoving space.
 *  - 2MRS (Huchra et al. 2012): 43.5k galaxies over the whole sky outside the Zone of Avoidance, to ~0.7 Gpc;
 *  - DESI DR1 BGS_BRIGHT: 1.8M galaxies (random 45.5% subsample) in two wedges to z = 0.5 (~2 Gpc), coloured by g−r;
 *  - DESI DR1 LRG: 0.4M luminous red galaxies, z 0.4–1.1 (to 3.6 Gpc).
 * Distances: comoving D_C(z_cmb), flat ΛCDM Planck 2018 (docs/data/galaxies.md). Positions are in redshift space:
 * clusters are stretched along the line of sight ("fingers of God"). Files are streamed; records are randomly
 * ordered, so every prefix is a uniform subsample and the web sharpens as data arrives.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import { MPC_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { deepWebOpacity, nearbyWebOpacity } from './fade';

const MAX_RENDER_DEPTH = 1e14;

interface CloudSpec {
  key: '2mrs' | 'bgs' | 'lrg';
  path: string;
  count: number;
  stride: number;
  /** 0 = Ks magnitude (2MRS, warm), 1 = g−r colour (BGS), 2 = none (LRG, red). */
  colorMode: number;
  /** Fraction of the per-quality budget this cloud may use. */
  budgetShare: number;
  gain: number;
}

const CLOUDS: CloudSpec[] = [
  { key: '2mrs', path: 'data/galaxies/cosmicweb-2mrs.bin', count: 43_508, stride: 5, colorMode: 0, budgetShare: 1, gain: 1.6 },
  { key: 'bgs', path: 'data/galaxies/cosmicweb-deep.bin', count: 1_800_000, stride: 5, colorMode: 1, budgetShare: 1, gain: 1.0 },
  { key: 'lrg', path: 'data/galaxies/cosmicweb-deep-lrg.bin', count: 400_000, stride: 4, colorMode: 2, budgetShare: 0.25, gain: 1.4 },
];

/**
 * Points per quality tier for the deep survey. The QualityProfile.galaxyBudget (40k/150k/400k) was sized before the
 * DESI data existed; one-pixel additive points are cheap, so the web uses 5× that (see contractChanges).
 */
const BUDGET_MULT = 5;

class WebPointsMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uCamMpc: { value: THREE.Vector3 };
    uScale: { value: number };
    uPxPerRad: { value: number };
    uPixelRatio: { value: number };
    uGain: { value: number };
    uOpacity: { value: number };
    uColorMode: { value: number };
    uNearFadeMpc: { value: number };
    uFocusMpc: { value: number };
  };

  constructor(colorMode: number) {
    super({
      uniforms: {
        uCamMpc: { value: new THREE.Vector3() },
        uScale: { value: 1 },
        uPxPerRad: { value: 1000 },
        uPixelRatio: { value: 1 },
        uGain: { value: 1 },
        uOpacity: { value: 1 },
        uColorMode: { value: colorMode },
        uNearFadeMpc: { value: 0.5 },
        uFocusMpc: { value: 1e9 },
      },
      vertexShader: /* glsl */ `
        ${VERTEX_PRELUDE}
        attribute float aZ;
        attribute float aC;
        uniform vec3 uCamMpc;
        uniform float uScale, uPxPerRad, uPixelRatio, uGain, uOpacity, uColorMode, uNearFadeMpc, uFocusMpc;
        varying vec3 vColor;
        varying float vSharp;
        // g−r → colour: blue star-forming galaxies (g−r ≲ 0.55) to gold/red passive ones (the red sequence, ≳ 0.75).
        vec3 colorGR(float gr) {
          float x = smoothstep(0.35, 0.95, gr);
          vec3 c = mix(vec3(0.50, 0.68, 1.0), vec3(1.0, 0.86, 0.66), smoothstep(0.0, 0.55, x));
          c = mix(c, vec3(1.0, 0.58, 0.32), smoothstep(0.55, 1.0, x));
          return c / max(c.r, max(c.g, c.b));
        }
        void main() {
          vec3 rel = position - uCamMpc;
          float d = max(length(rel), 1e-6);
          // A typical galaxy (~25 kpc) resolves into a small disc only within a few Mpc of the camera.
          float theta = 0.025 / d * uPxPerRad;
          float size = clamp(max(theta * 1.4, 1.7), 1.7, 24.0);
          vec3 col = uColorMode < 0.5 ? vec3(1.0, 0.86, 0.70) : (uColorMode < 1.5 ? colorGR(aC) : vec3(1.0, 0.66, 0.42));
          float near = smoothstep(uNearFadeMpc * 0.4, uNearFadeMpc, d);
          // Depth emphasis: galaxies far behind the focus are dimmed so the filaments around the focus read (a soft
          // slab, like the thin slices of survey maps), instead of 2 Gpc of survey piling up in projection.
          float behind = max(0.0, d - 1.3 * uFocusMpc) / (1.2 * uFocusMpc);
          near *= 1.0 / (1.0 + behind * behind);
          // Flux per point: constant while unresolved (a survey "dot"), spread over the disc once resolved.
          float amp = uGain * uOpacity * near * (1.7 * 1.7) / (size * size);
          vColor = col * amp;
          vSharp = size < 3.0 ? 1.0 : 0.0;
          gl_PointSize = size * uPixelRatio;
          gl_Position = projectionMatrix * (viewMatrix * vec4(rel * uScale, 1.0));
          if (amp < 1e-5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          ${LOGDEPTH_VERTEX}
        }`,
      fragmentShader: /* glsl */ `
        ${FRAGMENT_PRELUDE}
        varying vec3 vColor;
        varying float vSharp;
        void main() {
          ${LOGDEPTH_FRAGMENT}
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float f = vSharp > 0.5 ? exp(-r2 * 2.2) * 1.6 : exp(-r2 * 4.0) * 2.4;
          gl_FragColor = vec4(vColor * f, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }
}

interface Cloud {
  spec: CloudSpec;
  data: Float32Array;
  loaded: number;
  buffer: THREE.InterleavedBuffer;
  geo: THREE.BufferGeometry;
  mat: WebPointsMaterial;
  points: THREE.Points;
  started: boolean;
  done: boolean;
}

export interface CosmicWebLayer extends Layer {
  /** Records loaded per survey (debug / tests). */
  readonly loaded: Record<string, number>;
}

async function stream(url: string, onChunk: (bytes: Uint8Array) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(value);
  }
}

function baseUrl(): string {
  return (import.meta.env?.BASE_URL as string | undefined) ?? '/';
}

export function createCosmicWebLayer(): CosmicWebLayer {
  let svc: EngineServices | null = null;
  const clouds: Cloud[] = [];
  const camMpc = new THREE.Vector3();
  const loaded: Record<string, number> = {};

  function makeCloud(spec: CloudSpec, s: EngineServices): Cloud {
    const data = new Float32Array(spec.count * spec.stride);
    const buffer = new THREE.InterleavedBuffer(data, spec.stride);
    buffer.setUsage(THREE.StaticDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geo.setAttribute('aZ', new THREE.InterleavedBufferAttribute(buffer, 1, 3));
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(buffer, 1, spec.stride > 4 ? 4 : 3));
    geo.setDrawRange(0, 0);
    const mat = new WebPointsMaterial(spec.colorMode);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    s.groups.far.add(points);
    return { spec, data, loaded: 0, buffer, geo, mat, points, started: false, done: false };
  }

  function load(c: Cloud): void {
    c.started = true;
    const bytes = new Uint8Array(c.data.buffer);
    let filled = 0;
    let uploaded = 0;
    const recBytes = c.spec.stride * 4;
    void stream(baseUrl() + c.spec.path, (chunk) => {
      const n = Math.min(chunk.length, bytes.length - filled);
      bytes.set(chunk.subarray(0, n), filled);
      filled += n;
      const recs = Math.floor(filled / recBytes);
      // Upload in ~1 MB steps (fewer, larger bufferSubData calls).
      if (recs * recBytes - uploaded * recBytes > 1 << 20 || filled === bytes.length) {
        c.buffer.addUpdateRange(uploaded * c.spec.stride, (recs - uploaded) * c.spec.stride);
        c.buffer.needsUpdate = true;
        uploaded = recs;
        c.loaded = recs;
        loaded[c.spec.key] = recs;
      }
    }).then(() => {
      c.done = true;
      c.loaded = Math.floor(filled / recBytes);
      if (c.loaded > 0) {
        c.buffer.addUpdateRange(0, c.loaded * c.spec.stride);
        c.buffer.needsUpdate = true;
      }
      loaded[c.spec.key] = c.loaded;
    }).catch((err: unknown) => {
      console.warn(`[galaxies] ${c.spec.path} failed`, err);
      c.done = true;
    });
  }

  return {
    id: 'galaxies:web',
    get loaded() { return loaded; },

    init(s: EngineServices): void {
      svc = s;
      for (const spec of CLOUDS) clouds.push(makeCloud(spec, s));
    },

    update(ctx: FrameContext): void {
      if (!svc) return;
      const camR = ctx.cameraPosition.length();
      const opNear = nearbyWebOpacity(ctx.scaleLog10, camR);
      const opDeep = deepWebOpacity(ctx.scaleLog10, camR);
      if (import.meta.env.DEV) (globalThis as { __galaxiesWeb?: unknown }).__galaxiesWeb = { scale: ctx.scaleLog10, camMpc: camR / MPC_M, opNear, opDeep, focusMpc: ctx.focusDistanceM / MPC_M, vis: clouds.map((c) => c.points.visible) };
      camMpc.copy(ctx.cameraPosition).multiplyScalar(1 / MPC_M);
      const farM = camR + 4000 * MPC_M;
      const k = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / farM);
      const scale = (MPC_M / ctx.metersPerUnit) * k;
      const budget = ctx.quality.galaxyBudget * BUDGET_MULT;
      // Brightness per point falls as the field widens (more points per pixel), keeping the web unsaturated.
      const fieldGain = Math.pow(10, -0.38 * Math.max(0, ctx.scaleLog10 - 24.3));
      const focusMpc = ctx.focusDistanceM / MPC_M;
      const crowd = Math.max(0.06, Math.pow(10, -0.75 * Math.max(0, ctx.scaleLog10 - 25.1)));
      for (const c of clouds) {
        const op = c.spec.key === '2mrs' ? opNear : opDeep;
        // Start streaming a little before the band fades in (the 2MRS file is small: start at once).
        if (!c.started && (c.spec.key === '2mrs' || ctx.scaleLog10 > 22.8 || camR > 20 * MPC_M)) load(c);
        // Wide fields pile the surveys onto few pixels (additive overdraw: ~20 ms on an RTX 3050 at 2.5 Gpc with 1M
        // points), and the extra points only saturate: draw a shrinking random prefix there (uniform subsample).
        const n = Math.min(c.loaded, Math.floor(budget * c.spec.budgetShare * (c.spec.key === '2mrs' ? 1 : crowd)));
        c.geo.setDrawRange(0, n);
        c.points.visible = op > 0.003 && n > 0;
        if (!c.points.visible) continue;
        const u = c.mat.uniforms;
        u.uCamMpc.value.copy(camMpc);
        u.uScale.value = scale;
        u.uPxPerRad.value = ctx.pixelsPerRadian;
        u.uPixelRatio.value = ctx.viewport.pixelRatio;
        // Thinner subsamples (low budgets) get brighter points so the web reads the same.
        const thin = c.spec.key === '2mrs' ? 1 : Math.min(3, Math.sqrt(Math.min(c.spec.count, budget * c.spec.budgetShare) > 0 ? c.spec.count / Math.max(n, 1) : 1));
        u.uGain.value = c.spec.gain * 0.22 * fieldGain * thin;
        u.uOpacity.value = op;
        u.uNearFadeMpc.value = Math.max(0.3, 0.02 * focusMpc);
        u.uFocusMpc.value = Math.max(focusMpc, 5);
      }
    },

    collectLabels(_ctx: FrameContext, _out: LabelCandidate[]): void {
      // Survey labels are carried by the structures layer.
    },

    dispose(): void {
      for (const c of clouds) {
        c.points.removeFromParent();
        c.geo.dispose();
        c.mat.dispose();
      }
      clouds.length = 0;
    },
  };
}
