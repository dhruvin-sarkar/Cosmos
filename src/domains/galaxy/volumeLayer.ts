/**
 * The Milky Way's diffuse light: a full-screen ray-marched emission/absorption volume of the reconstructed Galaxy
 * (thin + thick exponential discs, box/peanut bulge, long bar, nuclear disc, young-star arms, HII knots and a dust disc
 * concentrated on the inner edges of the arms). The arm structure is baked once on the GPU into a face-on map
 * (R young stars, G HII, B dust lanes, A old-star arm modulation) from the Reid et al. (2019) log-spirals.
 *
 * Works from any viewpoint: from above (face-on spiral), edge-on (dust lane), and from inside (the Milky Way band),
 * cross-fading with the sky domain's all-sky survey maps (which fade out 50 → 500 pc from the Sun).
 * Lighting is linear HDR; never tone-mapped here. Colours: old stars ≈ 4300–5200 K, young ≈ 15,000 K, HII Hα+Hβ pink,
 * dust reddening κ_R:κ_G:κ_B ≈ 0.72 : 1 : 1.38 (R_V ≈ 3.1 extinction curve, Cardelli et al. 1989).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT_AT_INFINITY, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOISE_GLSL } from '../../render/glsl/noise';
import { PC_M, KPC_M, MPC_M } from '../../core/units';
import { ARMS, BAR_ANGLE_DEG, DEG, armRadiusKpc, type GalacticFrame } from './model';
import { galaxyRuntime } from './runtime';

/** Half-size of the baked face-on map (kpc). */
export const MAP_EXTENT_KPC = 20;
const SKY_FADE_START_M = 50 * PC_M;
const SKY_FADE_END_M = 500 * PC_M;

// ── Bake ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const N_ARMS = ARMS.length;

const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BAKE_FRAG = /* glsl */ `
#include <common>
${NOISE_GLSL}
#define N_ARMS ${N_ARMS}
uniform vec4 uArmA[N_ARMS]; // rKink, betaKink, tan(psi in), tan(psi out)
uniform vec4 uArmB[N_ARMS]; // betaMin, betaMax, extMin, extMax (rad)
uniform vec4 uArmC[N_ARMS]; // R(betaMin), R(betaMax), tan ext low, tan ext high
uniform vec4 uArmD[N_ARMS]; // width, stellar, gas, major
uniform float uExtent;
varying vec2 vUv;

float armR(int i, float b) {
  vec4 A = uArmA[i]; vec4 B = uArmB[i]; vec4 C = uArmC[i];
  if (b < B.x) return C.x * exp(-(b - B.x) * C.z);
  if (b > B.y) return C.y * exp(-(b - B.y) * C.w);
  return A.x * exp(-(b - A.y) * (b <= A.y ? A.z : A.w));
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uExtent;
  float R = length(p);
  float beta0 = atan(p.y, -p.x);
  // Large-scale warp so the arms wiggle and break into segments like real spirals.
  float wob = fbm3(vec3(p * 0.35, 1.7), 3);
  float young = 0.0, gas = 0.0, dust = 0.0, old = 0.0;
  for (int i = 0; i < N_ARMS; i++) {
    vec4 B = uArmB[i]; vec4 D = uArmD[i];
    for (int k = -2; k <= 2; k++) {
      float b = beta0 + float(k) * 6.28318530718;
      if (b < B.z || b > B.w) continue;
      float ra = armR(i, b);
      float w = max(0.12, D.x + 0.036 * (ra - uArmA[i].x));
      float fade = clamp(min((b - B.z) / 0.6, (B.w - b) / 0.6), 0.0, 1.0) * ((b >= B.x && b <= B.y) ? 1.0 : 0.8);
      float d = (R - ra - wob * 0.35 * w) / w;
      if (abs(d) > 6.0) continue;
      float g = exp(-0.5 * d * d) * fade;
      young += g * D.y;
      gas += g * D.z;
      float dd = (d + 0.75) / 0.6;               // dust lane on the inner (concave) edge
      dust += exp(-0.5 * dd * dd) * fade * D.z;
      float dO = d / 2.4;                        // broad old-star density wave
      old += exp(-0.5 * dO * dO) * fade * D.y;
    }
  }
  vec3 q = vec3(p, 0.0);
  float clump = 0.5 + 0.5 * fbm3(q * 2.2 + vec3(3.1, 0.0, 0.0), 4);           // 0..1
  float knot = cellularNoise3(q * 3.2).x;                                    // F1 distance
  float knots = smoothstep(0.32, 0.0, knot) * smoothstep(0.45, 0.75, clump);
  float fil = 1.0 - abs(fbm3(q * 1.6 + vec3(0.0, 7.0, 0.0), 5));             // ridged filaments
  float feather = pow(max(fil, 0.0), 6.0);
  float discMask = smoothstep(19.5, 15.0, R);
  float seg = 0.5 + 0.5 * fbm3(q * 0.55 + vec3(0.0, 0.0, 4.2), 3);
  young *= (0.3 + 1.3 * clump * clump) * (0.35 + 1.3 * seg) * discMask;
  float hii = pow(gas, 1.5) * knots * (0.6 + seg) * 3.5 * discMask;
  dust = (dust * (0.45 + 0.9 * clump) + feather * 0.55 * exp(-R / 7.0) * (0.3 + gas)) * discMask;
  old = old * discMask;
  gl_FragColor = vec4(young, hii, dust, old);
}`;

const bakers = new WeakMap<THREE.WebGLRenderer, { scene: THREE.Scene; cam: THREE.OrthographicCamera }>();

function bakeArmMap(renderer: THREE.WebGLRenderer, size: number): THREE.WebGLRenderTarget {
  const A: THREE.Vector4[] = [], B: THREE.Vector4[] = [], C: THREE.Vector4[] = [], D: THREE.Vector4[] = [];
  const clampTan = (deg: number): number => Math.tan(Math.min(14, Math.max(7, deg)) * DEG);
  for (const a of ARMS) {
    A.push(new THREE.Vector4(a.rKinkKpc, a.betaKinkDeg * DEG, Math.tan(a.pitchInDeg * DEG), Math.tan(a.pitchOutDeg * DEG)));
    B.push(new THREE.Vector4(a.betaMinDeg * DEG, a.betaMaxDeg * DEG, a.extMinDeg * DEG, a.extMaxDeg * DEG));
    C.push(new THREE.Vector4(armRadiusKpc(a, a.betaMinDeg * DEG), armRadiusKpc(a, a.betaMaxDeg * DEG), clampTan(a.pitchInDeg), clampTan(a.pitchOutDeg)));
    D.push(new THREE.Vector4(a.widthKpc, a.stellar, a.gas, a.major ? 1 : 0));
  }
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  // The bake quad is kept for the renderer's lifetime: disposing its material released the program, so the quality
  // re-bake (Ultra 4K map, first shown on approach) re-linked it synchronously: a 300-700 ms freeze mid-travel (perf).
  let baker = bakers.get(renderer);
  if (!baker) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG,
      uniforms: { uArmA: { value: A }, uArmB: { value: B }, uArmC: { value: C }, uArmD: { value: D }, uExtent: { value: MAP_EXTENT_KPC } },
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const bakeScene = new THREE.Scene();
    bakeScene.add(quad);
    baker = { scene: bakeScene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    bakers.set(renderer, baker);
  }
  const { scene, cam } = baker;
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  rt.texture.colorSpace = THREE.NoColorSpace;
  rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return rt;
}

// ── Volume ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const VOL_VERT = /* glsl */ `
${VERTEX_PRELUDE}
uniform mat4 uInvProjection;
uniform mat3 uCameraRotation;
uniform mat3 uWorldToGal;
varying vec3 vDir;
void main() {
  vec4 view = uInvProjection * vec4(position.xy, -1.0, 1.0);
  vDir = uWorldToGal * (uCameraRotation * (view.xyz / view.w));
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const VOL_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform sampler2D uMap;
uniform float uExtent;
uniform vec3 uCam;          // camera, Galactocentric kpc
uniform vec2 uBarAxis;      // unit vector of the bar major axis (near end)
uniform float uIntensity;
uniform float uOpacity;
uniform float uBgDim;       // 0..1: how much the dust dims what is behind (off near the Sun: no depth)
uniform float uMaxSteps;
uniform float uCoreSoft;
uniform float uPixelAngle; // radians per drawing-buffer pixel
uniform float uTexel;      // kpc per map texel    // kpc: softening of the central cusp (raised when the camera is deep in the bulge)
varying vec3 vDir;

const vec3 C_OLD = vec3(1.0, 0.80, 0.60);
const vec3 C_BULGE = vec3(1.0, 0.68, 0.40);
const vec3 C_YOUNG = vec3(0.55, 0.70, 1.0);
const vec3 C_HII = vec3(1.0, 0.30, 0.48);
const vec3 K_DUST = vec3(0.72, 1.0, 1.38);

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float sech2(float x) { float e = exp(-2.0 * abs(x)); return 4.0 * e / ((1.0 + e) * (1.0 + e)); }

void sampleGalaxy(vec3 p, float lod, out vec3 emis, out vec3 kap) {
  float R = length(p.xy);
  float az = abs(p.z);
  vec2 uv = p.xy / (2.0 * uExtent) + 0.5;
  vec4 m = (R < uExtent) ? textureLod(uMap, uv, lod) : vec4(0.0);
  // Thin and thick discs (ρ = Σ/2h · e^(−|z|/h)), arm-modulated; the inner disc is depleted inside the bar.
  float inner = 0.3 + 0.7 * smoothstep(1.5, 4.0, R);
  float flare = 1.0 + 0.08 * max(R - 10.0, 0.0);
  float thin = exp(-R / 2.6) * exp(-az / (0.3 * flare)) / (0.6 * flare) * (0.5 + 0.9 * m.a) * inner;
  float thick = 0.2 * exp(-R / 2.0) * exp(-az / 0.9) / 1.8;
  // Bulge + bar in the bar frame.
  float u = dot(p.xy, uBarAxis);
  float v = dot(p.xy, vec2(-uBarAxis.y, uBarAxis.x));
  float zb = p.z / (0.28 + 0.12 * min(abs(u) / 1.5, 1.0));
  float bulge = 2.2 * exp(-0.5 * ((u / 1.1) * (u / 1.1) + (v / 0.45) * (v / 0.45) + zb * zb));
  float bar = 0.55 * exp(-pow(abs(u) / 4.6, 4.0)) * exp(-0.5 * (v / 0.33) * (v / 0.33)) * exp(-az / 0.18) * exp(-abs(u) / 3.2);
  float rc = sqrt(R * R + (p.z / 0.5) * (p.z / 0.5) + uCoreSoft * uCoreSoft);
  float core = 0.9 * exp(-rc / 0.12) + 0.25 * exp(-rc / 0.35);
  float young = m.r * exp(-az / 0.09) / 0.18 * (0.45 + 0.75 * exp(-max(R - 5.0, 0.0) / 6.0));
  // HII knots are baked at ~100 pc texels: from within a few kpc they read as large soft pink blobs, so the diffuse
  // knots give way to the (sharp) HII particles close to the camera.
  float hii = m.g * exp(-az / 0.06) / 0.12 * mix(0.1, 1.0, smoothstep(6.0, 20.0, length(p - uCam)));
  emis = C_OLD * (thin + thick) * 1.4 + C_BULGE * (bulge + bar + core) + C_YOUNG * young * 0.2 + C_HII * hii * 1.6;
  // Dust: exponential disc with an inner hole (except the Central Molecular Zone) and sech² profile.
  float hd = 0.1344 * (1.0 + 0.0148 / 0.1344 * max(R - 4.4, 0.0));
  float dDisc = exp(-R / 2.26) * (0.2 + 0.8 * smoothstep(2.0, 4.5, R)) + 1.2 * exp(-R / 0.18);
  float dust = dDisc * sech2(p.z / hd) * (0.3 + 4.0 * m.b);
  kap = K_DUST * dust * 10.0;
}

void main() {
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
  vec3 dir = normalize(vDir);
  const float H = 6.0;
  float RMAX = uExtent - 0.5;
  // Slab |z| < H.
  float t0 = 0.0, t1 = 1e9;
  if (abs(dir.z) > 1e-6) {
    float ta = (H - uCam.z) / dir.z, tb = (-H - uCam.z) / dir.z;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(uCam.z) > H) discard;
  // Cylinder R < RMAX.
  vec2 o = uCam.xy, d2 = dir.xy;
  float a = dot(d2, d2), b = dot(o, d2), c = dot(o, o) - RMAX * RMAX;
  if (a > 1e-12) {
    float disc = b * b - a * c;
    if (disc < 0.0) discard;
    float s = sqrt(disc);
    t0 = max(t0, (-b - s) / a); t1 = min(t1, (-b + s) / a);
  } else if (c > 0.0) discard;
  if (t1 <= t0) discard;

  vec3 col = vec3(0.0);
  vec3 T = vec3(1.0);
  float t = t0;
  float jit = ign(gl_FragCoord.xy);
  float first = 1.0;
  for (int i = 0; i < 320; i++) {
    if (float(i) >= uMaxSteps || t >= t1) break;
    vec3 p = uCam + dir * t;
    float R = length(p.xy);
    float ds = 0.35 * max(abs(p.z), 0.06) / max(abs(dir.z), 0.03);
    // Fine steps near the axis only close to the plane (the halo above the bulge is empty: don't burn the budget there).
    ds = min(ds, 0.07 + 0.045 * R + 0.3 * max(abs(p.z) - 0.6, 0.0));
    ds = min(ds, 0.004 + 0.2 * (t - t0));
    ds = clamp(ds, 0.003, 1.6);
    float dsj = ds * mix(1.0, jit, first);
    first = 0.0;
    vec3 sp = p + dir * (0.5 * dsj);
    vec3 e, k;
    // Explicit LOD from the pixel footprint (implicit derivatives are undefined inside the loop).
    float lod = log2(max(t + 0.5 * dsj, 1e-4) * uPixelAngle / uTexel + 1e-6);
    sampleGalaxy(sp, lod, e, k);
    vec3 att = exp(-k * dsj);
    // Exact integral of constant emission over a slab of constant extinction.
    vec3 w = mix(vec3(dsj), (1.0 - att) / max(k, vec3(1e-6)), step(vec3(1e-4), k * dsj));
    col += T * e * w;
    T *= att;
    t += dsj;
    if (max(T.r, max(T.g, T.b)) < 0.004) break;
  }
  float trans = dot(T, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(col * uIntensity * uOpacity, 1.0 - uOpacity * uBgDim * (1.0 - trans));
}`;

export interface GalaxyVolumeHandle {
  /** Current 0..1 visibility (used by the other galaxy layers to stay in step). */
  readonly opacity: number;
}

const STEPS: Record<string, number> = { performance: 64, balanced: 96, ultra: 176 };
/** The march renders off-screen at this fraction of the drawing buffer and is upsampled (the glow is smooth). */
const MARCH_SCALE: Record<string, number> = { performance: 0.5, balanced: 0.5, ultra: 0.75 };

const COMP_VERT = /* glsl */ `
${VERTEX_PRELUDE}
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const COMP_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform sampler2D uVol;
varying vec2 vUv;
void main() {
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
  gl_FragColor = texture2D(uVol, vUv);
}`;
const MAP_SIZE: Record<string, number> = { low: 1024, high: 2048, ultra: 2048 };

/** Volume visibility from the camera position: complement of the sky maps' 50 → 500 pc fade; off beyond ~4 Mpc. */
export function galaxyVolumeVisibility(cameraFromSsbM: number, cameraFromGcM: number): number {
  const d = cameraFromSsbM;
  let near = 1;
  if (d <= SKY_FADE_START_M) near = 0;
  else if (d < SKY_FADE_END_M) {
    const x = Math.log(d / SKY_FADE_START_M) / Math.log(SKY_FADE_END_M / SKY_FADE_START_M);
    near = x * x * (3 - 2 * x);
  }
  const far = 1 - THREE.MathUtils.smoothstep(Math.log10(cameraFromGcM / MPC_M), Math.log10(1.5), Math.log10(5));
  return near * far;
}

export function createGalaxyVolumeLayer(): Layer & GalaxyVolumeHandle {
  const rt = galaxyRuntime();
  const frame: GalacticFrame = rt.frame;
  let map: THREE.WebGLRenderTarget | null = null;
  let mesh: THREE.Mesh | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  // Off-screen march (reduced resolution) + full-screen composite in the transparent group.
  let marchRt: THREE.WebGLRenderTarget | null = null;
  let marchScene: THREE.Scene | null = null;
  let compMat: THREE.ShaderMaterial | null = null;
  const marchCam = new THREE.Camera();
  const bufSize = new THREE.Vector2();
  const savedClear = new THREE.Color();
  let opacity = 0;
  const camGal = { x: 0, y: 0, z: 0 };
  const w2g = new THREE.Matrix3().set(
    frame.ex.x, frame.ex.y, frame.ex.z,
    frame.ey.x, frame.ey.y, frame.ey.z,
    frame.ez.x, frame.ez.y, frame.ez.z,
  );
  const barA = BAR_ANGLE_DEG * DEG;
  let mapQuality = '';
  let svcRef: EngineServices | null = null;

  const layer: Layer & GalaxyVolumeHandle = {
    id: 'galaxy-volume',
    get opacity() { return opacity; },

    init(svc: EngineServices): void {
      svcRef = svc;
      mapQuality = 'high';
      map = bakeArmMap(svc.renderer, MAP_SIZE[mapQuality] ?? 2048);
      mat = new THREE.ShaderMaterial({
        vertexShader: VOL_VERT,
        fragmentShader: VOL_FRAG,
        uniforms: {
          uInvProjection: { value: new THREE.Matrix4() },
          uCameraRotation: { value: new THREE.Matrix3() },
          uWorldToGal: { value: w2g },
          uMap: { value: map.texture },
          uExtent: { value: MAP_EXTENT_KPC },
          uCam: { value: new THREE.Vector3() },
          uBarAxis: { value: new THREE.Vector2(-Math.cos(barA), Math.sin(barA)) },
          uIntensity: { value: 1 },
          uOpacity: { value: 0 },
          uBgDim: { value: 0 },
          uMaxSteps: { value: 112 },
          uCoreSoft: { value: 0.01 },
          uPixelAngle: { value: 1e-3 },
          uTexel: { value: (2 * MAP_EXTENT_KPC) / 2048 },
        },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      const march = new THREE.Mesh(geo, mat);
      march.frustumCulled = false;
      marchScene = new THREE.Scene();
      marchScene.add(march);
      marchRt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      // Composite: (glow, transmittance) from the march → dst · alpha + glow.
      compMat = new THREE.ShaderMaterial({
        vertexShader: COMP_VERT,
        fragmentShader: COMP_FRAG,
        uniforms: { uVol: { value: marchRt.texture } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.SrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      mesh = new THREE.Mesh(geo, compMat);
      mesh.name = 'galaxy-volume';
      mesh.frustumCulled = false;
      mesh.renderOrder = -50;
      mesh.visible = false;
      svc.groups.transparent.add(mesh);
    },

    update(ctx: FrameContext): void {
      if (!mesh || !mat) return;
      const cam = ctx.cameraPosition;
      const o = frame.origin;
      const dGc = Math.hypot(cam.x - o.x, cam.y - o.y, cam.z - o.z);
      const target = galaxyVolumeVisibility(cam.length(), dGc);
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 4);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      // Inside the nuclear cluster (≲ 2 pc → gone by 0.1 pc) the diffuse glow fades out: the S-star and black-hole
      // close-ups read against the resolved cluster stars instead of a smooth wash - and the costly march is skipped.
      const lgc = Math.log10(Math.max(dGc, 1) / KPC_M);
      const deepFade = THREE.MathUtils.smoothstep(lgc, -4.0, -2.7);
      mesh.visible = opacity * deepFade > 0.002;
      if (!mesh.visible) return;
      const tq = ctx.quality.textureQuality;
      if (tq !== mapQuality && svcRef && map && (MAP_SIZE[tq] ?? 2048) !== map.width) {
        mapQuality = tq;
        const old = map;
        map = bakeArmMap(svcRef.renderer, MAP_SIZE[tq] ?? 2048);
        mat.uniforms.uMap.value = map.texture;
        old.dispose();
      }
      const g = (cam.x - o.x) * frame.ex.x + (cam.y - o.y) * frame.ex.y + (cam.z - o.z) * frame.ex.z;
      camGal.x = g / KPC_M;
      camGal.y = ((cam.x - o.x) * frame.ey.x + (cam.y - o.y) * frame.ey.y + (cam.z - o.z) * frame.ey.z) / KPC_M;
      camGal.z = ((cam.x - o.x) * frame.ez.x + (cam.y - o.y) * frame.ez.y + (cam.z - o.z) * frame.ez.z) / KPC_M;
      const u = mat.uniforms;
      (u.uCam.value as THREE.Vector3).set(camGal.x, camGal.y, camGal.z);
      u.uOpacity.value = opacity;
      // Deep in the bulge the structure seen is smooth and distant: fewer steps suffice.
      const steps = STEPS[ctx.quality.preset] ?? 96;
      u.uMaxSteps.value = Math.round(steps * (0.5 + 0.5 * THREE.MathUtils.smoothstep(lgc, -2.5, -0.5)));
      // Dust dims the background only once the catalogue stars (no depth here) have faded (view ≳ 30 kpc).
      u.uBgDim.value = THREE.MathUtils.smoothstep(ctx.scaleLog10, 20.6, 21.3);
      // Deep in the bulge, soften the cusp so the view from the Galactic Centre is not a white-out.
      u.uCoreSoft.value = THREE.MathUtils.clamp(0.06 - 0.05 * THREE.MathUtils.smoothstep(Math.log10(dGc / KPC_M), -1.5, 0), 0.01, 0.06);
      // Eye adaptation inside the bulge: the diffuse glow dims so the nuclear cluster, the S-stars and Sgr A* read
      // against it (a deep-sky exposure, not a white-out). 1 beyond 2 kpc → 0.05 within 1 pc of Sgr A*.
      u.uIntensity.value = Math.pow(10, -1.3 * (1 - THREE.MathUtils.smoothstep(lgc, -3, 0.3))) * deepFade;
      u.uTexel.value = (2 * MAP_EXTENT_KPC) / (map?.width ?? 2048);

      // March off-screen at reduced resolution (the dominant cost of galactic views), upsampled by the composite.
      if (!svcRef || !marchRt || !marchScene) return;
      const r = svcRef.renderer;
      const scale = (MARCH_SCALE[ctx.quality.preset] ?? 0.5) * (ctx.quality.renderScale || 1);
      r.getDrawingBufferSize(bufSize);
      const w = Math.max(16, Math.round(bufSize.x * scale)), h = Math.max(16, Math.round(bufSize.y * scale));
      if (marchRt.width !== w || marchRt.height !== h) marchRt.setSize(w, h);
      u.uPixelAngle.value = ctx.fovYRad / h;
      const camera = svcRef.camera;
      camera.updateMatrixWorld();
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
      u.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
      const prevTarget = r.getRenderTarget();
      const prevAlpha = r.getClearAlpha();
      r.getClearColor(savedClear);
      const prevAutoClear = r.autoClear;
      r.setRenderTarget(marchRt);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      r.autoClear = false;
      r.render(marchScene, marchCam);
      r.autoClear = prevAutoClear;
      r.setClearColor(savedClear, prevAlpha);
      r.setRenderTarget(prevTarget);
    },

    dispose(): void {
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      mat?.dispose();
      compMat?.dispose();
      marchRt?.dispose();
      marchRt = null; marchScene = null; compMat = null;
      map?.dispose();
      mesh = null; mat = null; map = null;
    },
  };
  return layer;
}
