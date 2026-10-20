/**
 * DART replay: a small self-contained three.js scene drawn in the lab viewport (its own renderer, so the lab never touches
 * the main engine's layers). Real Didymos and Dimorphos shape models (DART SPC v003 / v004, NASA PDS, shipped in
 * public/data/smallbodies/shapes/), DART approaching at the published impact speed, the impact flash, a ballistic ejecta
 * plume (hollow cone ≈ 140°, filamentary rays as LICIACube saw them) and the change of Dimorphos's orbit computed from the
 * lab model (binary-period-change@1), next to a "without DART" ghost on the old orbit.
 *
 * Geometry is a reconstruction for illustration: the approach direction, Sun direction and plume axis are chosen to match the
 * published geometry qualitatively (DART hit against Dimorphos's orbital motion, lit side facing the spacecraft).
 * Units: metres, seconds; origin = Didymos centre; the mutual orbit lies in the XY plane, prograde about +Z.
 * Lighting: the Sun only (lunar-Lambert regolith, no ambient), linear HDR into AgX.
 */
import * as THREE from 'three';
import { decodeShape } from '../../domains/smallbodies/famousShapes';

export interface DartOrbitParams {
  periodBeforeS: number;
  separationM: number;
  periodAfterS: number;
  semiMajorAxisAfterM: number;
  eccentricityAfter: number;
  impactSpeedMS: number;
  /** Ejecta amount relative to real DART, from (β − 1) m U; 1 = DART. */
  ejectaScale: number;
}

export interface DartFrameInfo {
  /** Simulated seconds from impact (negative before). */
  ts: number;
  /** DART–Dimorphos distance (m), NaN after impact. */
  dartDistanceM: number;
  /** Angle (deg) Dimorphos is ahead of its no-impact ghost. */
  leadDeg: number;
  chapter: 0 | 1 | 2;
}

export type LabelKey = 'didymos' | 'dimorphos' | 'dart' | 'ghost';

/** Replay chapters on the normalised timeline u ∈ [0, 1]. */
export const CHAPTER_START = [0, 0.36, 0.64] as const;
export const REPLAY_DURATION_S = 26;
const APPROACH_S = 150;
const EJECTA_S = 900;
const ORBIT_S = 4 * 86400;
const FREEZE_M = 2600;
/** Replay framing: widen the view ~1.4x so Didymos and the plume stay inside the viewport frame. */
const ZOOM_OUT = 1.4;
const DIMORPHOS_R = 75;
const DIDYMOS_SPIN_S = 2.26 * 3600;

/** Simulated time from impact for the normalised replay position u. */
export function timeAt(u: number): number {
  const [, c1, c2] = CHAPTER_START;
  if (u < c1) {
    const k = u / c1;
    return -APPROACH_S * (1 - k) ** 3;
  }
  if (u < c2) {
    const k = (u - c1) / (c2 - c1);
    return EJECTA_S * k * k;
  }
  const k = Math.min(1, (u - c2) / (1 - c2));
  return EJECTA_S + ORBIT_S * k ** 1.25;
}

export function chapterAt(u: number): 0 | 1 | 2 {
  return u < CHAPTER_START[1] ? 0 : u < CHAPTER_START[2] ? 1 : 2;
}

// ── Shaders ───────────────────────────────────────────────────────────────────────────────────────

const NOISE = /* glsl */ `
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3); }
`;

const ROCK_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec3 vObj;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ROCK_FRAG = /* glsl */ `
uniform mat4 modelMatrix;
uniform vec3 uSun; uniform vec3 uAlbedo; uniform float uSunI; uniform float uDetailFreq; uniform float uDetailAmp;
varying vec3 vN; varying vec3 vW; varying vec3 vObj;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  if (uDetailAmp > 0.0) {
    vec3 p = vObj * uDetailFreq;
    float fw = length(fwidth(p));
    float fade = 1.0 - smoothstep(0.15, 0.5, fw);
    if (fade > 0.0) {
      float e = 0.15;
      float c = fbm(p);
      vec3 g = vec3(fbm(p + vec3(e,0,0)) - c, fbm(p + vec3(0,e,0)) - c, fbm(p + vec3(0,0,e)) - c) / e;
      g = mat3(modelMatrix) * g;
      n = normalize(n - uDetailAmp * fade * (g - dot(g, n) * n));
    }
  }
  vec3 V = normalize(cameraPosition - vW);
  float mu0 = max(dot(n, uSun), 0.0);
  float mu = max(dot(n, V), 1e-3);
  float cosA = clamp(dot(uSun, V), -1.0, 1.0);
  float alpha = acos(cosA);
  // McEwen (1991) lunar-Lambert weight L(α) and a small opposition surge.
  float L = clamp(1.0 - 0.019 * degrees(alpha) + 0.000242 * pow(degrees(alpha), 2.0) - 1.46e-6 * pow(degrees(alpha), 3.0), 0.0, 1.0);
  float f = (1.0 - L) * mu0 + 2.0 * L * mu0 / (mu0 + mu);
  float surge = 1.0 + 0.4 * exp(-degrees(alpha) / 6.0);
  vec3 col = uAlbedo * uSunI * f * surge;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EJECTA_VERT = /* glsl */ `
attribute vec3 aDir; attribute float aSpeed; attribute float aRand;
uniform float uT; uniform vec3 uOrigin; uniform float uAmount; uniform vec3 uSun; uniform float uPx; uniform float uFade;
varying float vI;
void main() {
  vec3 p = uOrigin + aDir * aSpeed * uT;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 toCam = normalize(cameraPosition - p);
  float c = dot(-uSun, toCam);
  float g = 0.55;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
  float spread = 1.0 + aSpeed * uT / 600.0;
  float on = step(aRand, uAmount) * smoothstep(0.0, 1.5, uT);
  vI = on * uFade * (0.3 + 0.7 * fract(aRand * 91.7)) * hg * 0.2 / spread;
  gl_PointSize = uPx * (1.2 + 1.6 * fract(aRand * 37.3));
}`;

const EJECTA_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vI;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0 || vI <= 0.0) discard;
  gl_FragColor = vec4(uColor * vI * (1.0 - r2), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLASH_VERT = /* glsl */ `
uniform float uSize;
void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`;
const FLASH_FRAG = /* glsl */ `
uniform float uI;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float k = exp(-r * r * 9.0) + 0.08 * exp(-r * 3.0);
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * uI * k, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DOT_VERT = /* glsl */ `
attribute float aI;
uniform float uPx;
varying float vI;
void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); vI = aI; gl_PointSize = 4.0 * uPx; }`;
const DOT_FRAG = /* glsl */ `
varying float vI;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0 || vI <= 0.0) discard;
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * vI * exp(-r2 * 4.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ── Scene ─────────────────────────────────────────────────────────────────────────────────────────

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

function rock(albedo: THREE.Color, detailFreq: number, detailAmp: number, sun: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ROCK_VERT,
    fragmentShader: ROCK_FRAG,
    uniforms: {
      uSun: { value: sun },
      uAlbedo: { value: albedo },
      uSunI: { value: 1 },
      uDetailFreq: { value: detailFreq },
      uDetailAmp: { value: detailAmp },
    },
  });
}

export class DartScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 1e6);
  private readonly sun: THREE.Vector3;
  private readonly dir: THREE.Vector3;
  private readonly axis: THREE.Vector3;
  private readonly impact = new THREE.Vector3();
  private readonly didymos = new THREE.Group();
  private readonly dimorphos = new THREE.Group();
  private readonly dart = new THREE.Group();
  private readonly ejectaMat: THREE.ShaderMaterial;
  private readonly flashMat: THREE.ShaderMaterial;
  private readonly flash: THREE.Points;
  private readonly dots: THREE.Points;
  private readonly dotPos: THREE.BufferAttribute;
  private readonly dotI: THREE.BufferAttribute;
  private readonly dotMat: THREE.ShaderMaterial;
  private readonly sunPerp = new THREE.Vector3();
  private readonly orbitBefore: THREE.LineLoop;
  private readonly orbitAfter: THREE.LineLoop;
  private readonly ghostRing: THREE.LineLoop;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly freezeCam = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly ghost = new THREE.Vector3();
  private readonly labels: Partial<Record<LabelKey, HTMLElement>> = {};
  private params: DartOrbitParams;
  private width = 1;
  private height = 1;
  private disposed = false;
  /** True when the real shape models loaded (false: procedural stand-ins, labelled illustrative by the panel). */
  realShapes = false;

  constructor(canvas: HTMLCanvasElement, params: DartOrbitParams, onShapes?: (real: boolean) => void) {
    this.params = params;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 2.6;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.dir = new THREE.Vector3(-0.2, -0.9, -0.36).normalize();
    // Sun at ≈ 60° phase from DART's point of view: the spacecraft sees a lit, gibbous Dimorphos.
    this.sun = this.dir.clone().negate().applyAxisAngle(Z, (60 * Math.PI) / 180).normalize();
    // Plume axis: back towards the incoming spacecraft, tilted towards the local surface normal.
    this.axis = this.dir.clone().negate().multiplyScalar(0.8).add(new THREE.Vector3(0.35, 0, 0.1)).normalize();
    this.impact.set(params.separationM, 0, 0).addScaledVector(this.dir, -DIMORPHOS_R * 0.92);

    // Stand-in geometry first; replaced by the mission shape models when they load.
    const didymosMat = rock(new THREE.Color(0.155, 0.148, 0.138), 0.06, 0.5, this.sun);
    const dimorphosMat = rock(new THREE.Color(0.15, 0.143, 0.133), 0.16, 0.65, this.sun);
    this.disposables.push(didymosMat, dimorphosMat);
    const standIn = (r: number, m: THREE.Material, seed: number): THREE.Mesh => {
      const g = new THREE.IcosahedronGeometry(r, 5);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i);
        const k = 1 + 0.06 * Math.sin(_v.x * 0.02 + seed) * Math.cos(_v.y * 0.017 + seed * 2);
        p.setXYZ(i, _v.x * k, _v.y * k, _v.z * k * 0.82);
      }
      g.computeVertexNormals();
      this.disposables.push(g);
      return new THREE.Mesh(g, m);
    };
    this.didymos.add(standIn(365, didymosMat, 1));
    this.dimorphos.add(standIn(DIMORPHOS_R, dimorphosMat, 2));
    this.scene.add(this.didymos, this.dimorphos);
    void this.loadShapes(didymosMat, dimorphosMat, onShapes);

    // DART: bus ≈ 1.2 × 1.3 × 1.3 m, two ROSA arrays ≈ 8.5 × 2.4 m (Rivkin et al. 2021).
    const busG = new THREE.BoxGeometry(1.3, 1.3, 1.2);
    const panelG = new THREE.BoxGeometry(8.5, 0.05, 2.4);
    const busM = rock(new THREE.Color(0.55, 0.45, 0.22), 0, 0, this.sun);
    const panelM = rock(new THREE.Color(0.05, 0.06, 0.09), 0, 0, this.sun);
    this.disposables.push(busG, panelG, busM, panelM);
    const bus = new THREE.Mesh(busG, busM);
    const p1 = new THREE.Mesh(panelG, panelM);
    const p2 = new THREE.Mesh(panelG, panelM);
    p1.position.x = 5.0;
    p2.position.x = -5.0;
    this.dart.add(bus, p1, p2);
    this.dart.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    this.scene.add(this.dart);

    // Orbits: pre-impact circle (dashed after the impact: "without DART") and the post-impact ellipse.
    this.orbitBefore = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xbebebe, transparent: true, opacity: 0.4, dashSize: 40, gapSize: 26, toneMapped: false, depthWrite: false }));
    this.orbitAfter = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe9ca80, transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false }));
    this.disposables.push(this.orbitBefore.geometry, this.orbitBefore.material as THREE.Material, this.orbitAfter.geometry, this.orbitAfter.material as THREE.Material);
    const ring = new Float32Array(64 * 3);
    for (let i = 0; i < 64; i++) {
      ring[i * 3] = 110 * Math.cos((i / 64) * Math.PI * 2);
      ring[i * 3 + 1] = 110 * Math.sin((i / 64) * Math.PI * 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(ring, 3));
    this.ghostRing = new THREE.LineLoop(rg, new THREE.LineDashedMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.7, dashSize: 22, gapSize: 16, toneMapped: false, depthWrite: false }));
    this.ghostRing.computeLineDistances();
    this.disposables.push(rg, this.ghostRing.material as THREE.Material);
    this.scene.add(this.orbitBefore, this.orbitAfter, this.ghostRing);

    // Ejecta: 7000 particles; 70% in ~48 filaments on a hollow cone (half-angle 62–74°), 30% diffuse inside it.
    const N = 7000;
    const dirs = new Float32Array(N * 3);
    const speeds = new Float32Array(N);
    const rands = new Float32Array(N);
    let s = 12345;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const u1 = new THREE.Vector3().crossVectors(this.axis, Z).normalize();
    const u2 = new THREE.Vector3().crossVectors(this.axis, u1).normalize();
    const rays: Array<[number, number]> = [];
    for (let j = 0; j < 48; j++) rays.push([(62 + 12 * rnd()) * (Math.PI / 180), rnd() * Math.PI * 2]);
    for (let i = 0; i < N; i++) {
      let th: number, ph: number;
      if (rnd() < 0.7) {
        const r = rays[Math.floor(rnd() * rays.length)];
        th = r[0] + (rnd() - 0.5) * 0.06;
        ph = r[1] + (rnd() - 0.5) * 0.09;
      } else {
        th = Math.acos(1 - rnd() * (1 - Math.cos(70 * Math.PI / 180)));
        ph = rnd() * Math.PI * 2;
      }
      _v.copy(this.axis).multiplyScalar(Math.cos(th)).addScaledVector(u1, Math.sin(th) * Math.cos(ph)).addScaledVector(u2, Math.sin(th) * Math.sin(ph));
      dirs[i * 3] = _v.x;
      dirs[i * 3 + 1] = _v.y;
      dirs[i * 3 + 2] = _v.z;
      // Power-law ejecta speeds (cumulative N(>v) ∝ v^−1.2), 0.8–500 m/s.
      speeds[i] = Math.min(500, 0.8 * Math.pow(1 - rnd() * 0.9999, -1 / 1.2));
      rands[i] = rnd();
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    eg.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    eg.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    eg.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));
    this.ejectaMat = new THREE.ShaderMaterial({
      vertexShader: EJECTA_VERT,
      fragmentShader: EJECTA_FRAG,
      uniforms: {
        uT: { value: 0 }, uOrigin: { value: this.impact }, uAmount: { value: 0.5 }, uSun: { value: this.sun },
        uPx: { value: 1 }, uFade: { value: 1 }, uColor: { value: new THREE.Color(0.4, 0.37, 0.33) },
      },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const ejecta = new THREE.Points(eg, this.ejectaMat);
    ejecta.frustumCulled = false;
    this.scene.add(ejecta);
    this.disposables.push(eg, this.ejectaMat);

    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([this.impact.x, this.impact.y, this.impact.z]), 3));
    this.flashMat = new THREE.ShaderMaterial({
      vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, uniforms: { uI: { value: 0 }, uSize: { value: 60 } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false,
    });
    this.flash = new THREE.Points(fg, this.flashMat);
    this.flash.frustumCulled = false;
    this.scene.add(this.flash);
    this.disposables.push(fg, this.flashMat);

    // Unresolved bodies: a point source carrying the disc's reflected flux (so Didymos is a dot long before it is a disc).
    const dg = new THREE.BufferGeometry();
    this.dotPos = new THREE.BufferAttribute(new Float32Array(6), 3);
    this.dotI = new THREE.BufferAttribute(new Float32Array(2), 1);
    dg.setAttribute('position', this.dotPos);
    dg.setAttribute('aI', this.dotI);
    this.dotMat = new THREE.ShaderMaterial({
      vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: { uPx: { value: 1 } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.dots = new THREE.Points(dg, this.dotMat);
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
    this.disposables.push(dg, this.dotMat);
    this.sunPerp.copy(this.sun).addScaledVector(this.dir, -this.sun.dot(this.dir)).normalize();

    this.setParams(params);
  }

  /** Point-source intensity for a body of radius r at `pos`, fading out once it spans more than ~2 px. */
  private dotIntensity(pos: THREE.Vector3, radiusM: number, albedo: number): number {
    const d = this.camera.position.distanceTo(pos);
    const rPx = (radiusM / Math.max(1, d)) / Math.tan((this.camera.fov * Math.PI) / 360) * (this.height / 2);
    const cosA = _w.copy(this.camera.position).sub(pos).normalize().dot(this.sun);
    const disc = albedo * 1.4 * (0.5 + 0.5 * cosA);
    const k = Math.max(0.15, Math.min(1, (rPx * rPx) / (1.5 * 1.5)));
    const fade = 1 - Math.min(1, Math.max(0, (rPx - 1.2) / 1.6));
    return disc * k * fade;
  }

  private async loadShapes(mA: THREE.Material, mB: THREE.Material, onShapes?: (real: boolean) => void): Promise<void> {
    const base = import.meta.env.BASE_URL;
    try {
      const [a, b] = await Promise.all(['didymos', 'dimorphos'].map(async (id) => {
        const r = await fetch(`${base}data/smallbodies/shapes/${id}.bin`);
        if (!r.ok) throw new Error(`${id} ${r.status}`);
        return decodeShape(await r.arrayBuffer()).geometry;
      }));
      if (this.disposed) {
        a.dispose();
        b.dispose();
        return;
      }
      a.scale(1000, 1000, 1000);
      b.scale(1000, 1000, 1000);
      this.disposables.push(a, b);
      this.didymos.clear();
      this.dimorphos.clear();
      this.didymos.add(new THREE.Mesh(a, mA));
      this.dimorphos.add(new THREE.Mesh(b, mB));
      this.realShapes = true;
      onShapes?.(true);
    } catch {
      onShapes?.(false);
    }
  }

  setParams(p: DartOrbitParams): void {
    this.params = p;
    const circle = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      circle[i * 3] = p.separationM * Math.cos(a);
      circle[i * 3 + 1] = p.separationM * Math.sin(a);
    }
    this.orbitBefore.geometry.setAttribute('position', new THREE.BufferAttribute(circle, 3));
    this.orbitBefore.computeLineDistances();
    const ell = new Float32Array(256 * 3);
    const a = p.semiMajorAxisAfterM, e = p.eccentricityAfter;
    const valid = a > 0 && e < 1;
    for (let i = 0; i < 256; i++) {
      const nu = (i / 256) * Math.PI * 2;
      const r = valid ? (a * (1 - e * e)) / (1 + e * Math.cos(nu)) : p.separationM;
      ell[i * 3] = r * Math.cos(nu + Math.PI);
      ell[i * 3 + 1] = r * Math.sin(nu + Math.PI);
    }
    this.orbitAfter.geometry.setAttribute('position', new THREE.BufferAttribute(ell, 3));
    this.ejectaMat.uniforms.uAmount.value = Math.min(1, 0.5 * Math.max(0.05, p.ejectaScale));
    // Approach speed sets the freeze point timing only; the frozen camera sits FREEZE_M short of the impact point.
    this.freezeCam.copy(this.impact).addScaledVector(this.dir, -FREEZE_M);
    this.chaseOffset(this.freezeCam, this.freezeCam);
  }

  setLabels(map: Partial<Record<LabelKey, HTMLElement | null>>): void {
    for (const k of Object.keys(map) as LabelKey[]) {
      const el = map[k];
      if (el) this.labels[k] = el;
      else delete this.labels[k];
    }
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.ejectaMat.uniforms.uPx.value = this.renderer.getPixelRatio();
    this.flashMat.uniforms.uSize.value = 90 * this.renderer.getPixelRatio();
    this.dotMat.uniforms.uPx.value = this.renderer.getPixelRatio();
  }

  /** Camera offset behind/above the spacecraft. */
  private chaseOffset(dartPos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    // Behind the spacecraft and to its sunlit side, so both DART and the target are seen lit.
    return out.copy(dartPos).addScaledVector(this.dir, -55).addScaledVector(this.sunPerp, 8).addScaledVector(Z, 3);
  }

  /** Dimorphos position at ts (after the impact on the new orbit, before on the old one). */
  private dimorphosAt(ts: number, out: THREE.Vector3): void {
    const p = this.params;
    if (ts <= 0 || !(p.semiMajorAxisAfterM > 0)) {
      const a = (2 * Math.PI * ts) / p.periodBeforeS;
      out.set(p.separationM * Math.cos(a), p.separationM * Math.sin(a), 0);
      return;
    }
    const e = p.eccentricityAfter, a = p.semiMajorAxisAfterM;
    const M = Math.PI + (2 * Math.PI * ts) / p.periodAfterS;
    let E = M;
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = a * (1 - e * Math.cos(E));
    const ang = nu + Math.PI;
    out.set(r * Math.cos(ang), r * Math.sin(ang), 0);
  }

  /** Plume-view camera pose for chapter-1 progress e ∈ [0, 1]. */
  private plumePose(e: number, out: THREE.Vector3): THREE.Vector3 {
    // Side-on to the plume with the Sun to one side and slightly behind (phase ≈ 105°): a lit crescent on the bodies and
    // forward-scattering ejecta, as LICIACube saw it.
    _w.crossVectors(this.axis, this.sun).normalize();
    const d = 2400 + 9600 * e;
    out.copy(_w).addScaledVector(this.sun, -0.3).addScaledVector(Z, 0.25).normalize().multiplyScalar(d).add(this.impact);
    return out;
  }

  render(u: number, info: DartFrameInfo): DartFrameInfo {
    const ts = timeAt(u);
    const ch = chapterAt(u);
    const p = this.params;

    // Bodies.
    this.didymos.rotation.z = (2 * Math.PI * ts) / DIDYMOS_SPIN_S;
    this.dimorphosAt(ts, this.dimorphos.position);
    this.dimorphos.rotation.z = Math.atan2(this.dimorphos.position.y, this.dimorphos.position.x) + Math.PI;
    const ghostAng = (2 * Math.PI * ts) / p.periodBeforeS;
    this.ghost.set(p.separationM * Math.cos(ghostAng), p.separationM * Math.sin(ghostAng), 0);
    // Mean-motion lead accumulated since the impact.
    const lead = ts > 0 && p.periodAfterS > 0 ? (((360 * ts * (1 / p.periodAfterS - 1 / p.periodBeforeS)) % 360) + 360) % 360 : 0;

    const before = ts < 0;
    this.dart.visible = before;
    let dist = NaN;
    if (before) {
      this.dart.position.copy(this.impact).addScaledVector(this.dir, p.impactSpeedMS * ts);
      dist = this.dart.position.distanceTo(this.dimorphos.position) - DIMORPHOS_R;
    }

    // Camera.
    if (ch === 0) {
      if (dist > FREEZE_M) this.chaseOffset(this.dart.position, this.camPos);
      else this.camPos.copy(this.freezeCam);
      this.camTarget.copy(this.dimorphos.position);
      this.camera.fov = 30;
    } else if (ch === 1) {
      const k = (u - CHAPTER_START[1]) / (CHAPTER_START[2] - CHAPTER_START[1]);
      const e = k * k * (3 - 2 * k);
      this.plumePose(e, _v);
      this.camPos.lerpVectors(this.freezeCam, _v, Math.min(1, e * 1.4));
      _v.copy(this.impact).addScaledVector(this.axis, Math.min(ts * 2.5, 5000) * e);
      this.camTarget.lerpVectors(this.dimorphos.position, _v, Math.min(1, e * 1.6));
      this.camera.fov = 30 + 8 * e;
    } else {
      const k = Math.min(1, (u - CHAPTER_START[2]) / (1 - CHAPTER_START[2]));
      const blend = Math.min(1, k / 0.22);
      const b = blend * blend * (3 - 2 * blend);
      const az = (-75 + 35 * k) * (Math.PI / 180);
      const el = 58 * (Math.PI / 180);
      const d = 6600;
      _v.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).multiplyScalar(d);
      this.plumePose(1, _w);
      this.camPos.lerpVectors(_w, _v, b);
      this.camTarget.copy(this.impact).addScaledVector(this.axis, Math.min(EJECTA_S * 2.5, 5000)).multiplyScalar(1 - b).addScaledVector(Z, 420 * b);
      this.camera.fov = 38 - 6 * b;
    }
    this.camera.fov = (2 * Math.atan(ZOOM_OUT * Math.tan((this.camera.fov * Math.PI) / 360)) * 180) / Math.PI;
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(Z);
    this.camera.lookAt(this.camTarget);
    const focusD = Math.min(this.camPos.distanceTo(this.dimorphos.position), this.camPos.length());
    this.camera.near = Math.max(0.3, Math.min(this.dart.visible ? 5 : 500, focusD * 0.02));
    this.camera.far = focusD * 40 + 2e5;
    this.camera.updateProjectionMatrix();

    // Ejecta and flash.
    const t = Math.max(0, ts);
    this.ejectaMat.uniforms.uT.value = t;
    this.ejectaMat.uniforms.uFade.value = before ? 0 : ch === 2 ? Math.max(0, 1 - (ts - EJECTA_S) / 2400) : 1;
    this.flashMat.uniforms.uI.value = before ? 0 : 55 * Math.exp(-ts / 0.7);
    this.flash.visible = !before && ts < 20;

    // Orbits.
    (this.orbitBefore.material as THREE.LineDashedMaterial).opacity = ch === 2 ? 0.42 : 0.18;
    this.orbitAfter.visible = ch === 2;
    this.ghostRing.visible = ch === 2 && lead > 4;
    this.ghostRing.position.copy(this.ghost);

    this.dotPos.setXYZ(0, 0, 0, 0);
    this.dotPos.setXYZ(1, this.dimorphos.position.x, this.dimorphos.position.y, this.dimorphos.position.z);
    this.dotPos.needsUpdate = true;
    this.dotI.setX(0, this.dotIntensity(_v.set(0, 0, 0), 365, 0.15));
    this.dotI.setX(1, this.dotIntensity(this.dimorphos.position, DIMORPHOS_R, 0.15));
    this.dotI.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
    // Merge the two body labels while the pair is closer than ~70 px on screen.
    _v.copy(this.dimorphos.position).project(this.camera);
    _w.set(0, 0, 0).project(this.camera);
    const merged = Math.hypot((_v.x - _w.x) * this.width, (_v.y - _w.y) * this.height) / 2 < 70;
    const dl = this.labels.didymos;
    const want = merged ? 'Didymos and Dimorphos' : 'Didymos';
    if (dl && dl.textContent !== want) dl.textContent = want;
    this.placeLabel('didymos', _v.set(0, 0, 0), 420, true);
    this.placeLabel('dimorphos', this.dimorphos.position, 95, !merged);
    this.placeLabel('dart', this.dart.position, 6, before && ch === 0, true);
    this.placeLabel('ghost', this.ghost, 120, ch === 2 && lead > 4);

    info.ts = ts;
    info.dartDistanceM = dist;
    info.leadDeg = ts > 0 ? lead : 0;
    info.chapter = ch;
    return info;
  }

  private placeLabel(key: LabelKey, pos: THREE.Vector3, radiusM: number, show: boolean, below = false): void {
    const el = this.labels[key];
    if (!el) return;
    _w.copy(pos).project(this.camera);
    // The clock and caption occupy the top-left of the stage: a label that would land on them is dropped instead.
    const sy = (-_w.y * 0.5 + 0.5) * this.height, sx = (_w.x * 0.5 + 0.5) * this.width;
    const underHud = sy < 110 && sx < this.width * 0.8;
    const vis = show && !underHud && _w.z < 1 && Math.abs(_w.x) < 1.05 && Math.abs(_w.y) < 1.05;
    if (!vis) {
      if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
      return;
    }
    // Offset the label above the body by its projected radius.
    const dist = this.camera.position.distanceTo(pos);
    const rPx = (radiusM / Math.max(1, dist)) / Math.tan((this.camera.fov * Math.PI) / 360) * (this.height / 2);
    const x = (_w.x * 0.5 + 0.5) * this.width;
    const cy = (-_w.y * 0.5 + 0.5) * this.height;
    // `below` keeps the DART tag under the spacecraft, clear of the Dimorphos label that sits above the pair.
    const y = below ? cy + 22 : cy - Math.max(10, rPx + 8);
    el.style.visibility = 'visible';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${below ? '0' : '-100%'})`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
