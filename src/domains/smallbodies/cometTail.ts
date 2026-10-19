/**
 * Comet coma and tails — ILLUSTRATIVE but physically oriented.
 *
 * Heuristic (stated in every comet FactSheet):
 *  - activity f(r) = smoothstep(4.0 → 2.2 au) · min(1, 1.2 / r²): nothing beyond ~4 au (water ice does not sublimate),
 *    rising as the insolation (∝ r⁻²) inside, saturating inside ~1 au;
 *  - ion (plasma) tail: straight, pointing exactly away from the Sun (solar-wind-driven), blue (CO⁺ emission), length
 *    L_ion = 0.9 au · size · f;
 *  - dust tail: broader, pale yellow-white (reflected sunlight), 0.45 · L_ion long, curved away from the Sun and bent toward
 *    the trailing side of the orbit (radiation pressure vs. the comet's orbital velocity: synchrone-like bend);
 *  - coma: an HDR-limited glow whose radius scales with size · f (up to ~6·10⁴ km);
 *  - near the nucleus (within a few thousand nucleus radii, where the tails and the big coma vanish): an inner dust coma a
 *    few tens of radii across and faint dayside dust jets (sunward cones, as in Rosetta/Deep Impact images; directions illustrative).
 * Particles are billboard Gaussian puffs on the GPU: positions are computed in the vertex shader from per-particle
 * parameters, so a tail costs one draw call and no CPU work.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { GlowSprite } from '../../render/materials/GlowSpriteMaterial';
import { AU_M } from '../../core/units';

const SEGMENTS = 120;

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec2 aUV;      // x = s along the tail (0 head .. 1 tip), y = side (-1 .. 1)
uniform vec3 uDir;       // unit, away from the Sun
uniform vec3 uBendDir;   // unit, ⟂ uDir, toward the trailing side of the orbit
uniform float uLen;      // tail length, render units
uniform float uBend;     // bend as a fraction of length at the tail tip
uniform vec2 uWidth;     // half-width fraction of the length at s = 0 and s = 1
varying vec2 vUV;

void main() {
  float s = aUV.x;
  vec3 p = uDir * (s * uLen) + uBendDir * (uBend * s * s * uLen);
  vec3 t = normalize(uDir + uBendDir * (2.0 * uBend * s));
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 view = normalize(cameraPosition - wp);
  vec3 side = cross(t, view);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : cross(t, vec3(0.0, 0.0, 1.0));
  float w = mix(uWidth.x, uWidth.y, pow(s, 0.8)) * uLen;
  vec3 pos = p + side * (aUV.y * w);
  vUV = aUV;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uBrightness;
uniform float uOpacity;
uniform float uFall;
uniform float uStreak;
uniform float uSeed;
varying vec2 vUV;

float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  float s = vUV.x, y = vUV.y;
  float lateral = exp(-y * y * 3.2) * (1.0 - smoothstep(0.82, 1.0, abs(y)));
  float along = exp(-uFall * s) * smoothstep(0.0, 0.012, s) * (1.0 - smoothstep(0.78, 1.0, s));
  // Fine streaks (rays) along the axis, coarser clumps across it.
  float streaks = mix(1.0, 0.45 + 1.1 * vn(vec2(s * 5.0 + uSeed, y * uStreak)), 0.75);
  float a = uBrightness * uOpacity * lateral * along * streaks;
  gl_FragColor = vec4(uColor * a, a);
}`;

function makeRibbon(): THREE.BufferGeometry {
  const uv = new Float32Array((SEGMENTS + 1) * 2 * 2);
  const pos = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const s = i / SEGMENTS;
    uv.set([s, -1, s, 1], i * 4);
    if (i < SEGMENTS) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
  return g;
}

function makeMaterial(color: [number, number, number], width: [number, number], bend: number, fall: number, streak: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uDir: { value: new THREE.Vector3(1, 0, 0) },
      uBendDir: { value: new THREE.Vector3(0, 1, 0) },
      uLen: { value: 1 },
      uBend: { value: bend },
      uWidth: { value: new THREE.Vector2(width[0], width[1]) },
      uBrightness: { value: 0.1 },
      uOpacity: { value: 1 },
      uFall: { value: fall },
      uStreak: { value: streak },
      uSeed: { value: seed },
      uColor: { value: new THREE.Vector3(...color) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

/** Activity 0..1 at heliocentric distance r (au) before the per-comet size factor. */
export function cometActivity(rAU: number): number {
  const t = Math.min(1, Math.max(0, (4.0 - rAU) / (4.0 - 2.2)));
  const smooth = t * t * (3 - 2 * t);
  return smooth * Math.min(1, 1.2 / (rAU * rAU));
}

export interface CometState {
  /** Render-space position of the nucleus. */
  head: THREE.Vector3;
  /** Unit vector from the Sun to the comet (ICRS). */
  antiSun: THREE.Vector3;
  /** Heliocentric velocity direction (unit, ICRS). */
  velocityDir: THREE.Vector3;
  rAU: number;
  size: number;
  metersPerUnit: number;
  pxPerRad: number;
  /** Scene sunlight scaling (E/E₁au incl. exposure), typically 0.2–6. */
  insolation: number;
  opacity: number;
  /** Camera distance to the nucleus, m (fades the coma when the camera is inside it). */
  cameraDistM: number;
  /** Nucleus mean radius, m (sizes the inner coma and jets). */
  nucleusRadiusM: number;
}

/** Dayside jet directions in the (sunward, bend, normal) frame — illustrative. */
const JETS: [number, number, number, number][] = [
  // sunward weight, bend weight, normal weight, relative strength
  [1.0, 0.55, 0.2, 1.0],
  [1.0, -0.35, 0.65, 0.7],
  [1.0, 0.1, -0.75, 0.85],
  [1.0, -0.7, -0.25, 0.55],
  [0.6, 0.9, 0.7, 0.4],
];

export class CometSystem {
  readonly group = new THREE.Group();
  private readonly coma: GlowSprite;
  private readonly core: GlowSprite;
  private readonly ion: THREE.Mesh;
  private readonly dust: THREE.Mesh;
  private readonly ionMat: THREE.ShaderMaterial;
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly bend = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly inner: GlowSprite;
  private readonly jets: THREE.Mesh[] = [];
  private readonly jetMats: THREE.ShaderMaterial[] = [];

  constructor(seed: number) {
    this.group.name = 'comet-system';
    const sd = (seed % 997) * 0.173;
    this.ionMat = makeMaterial([0.32, 0.55, 1.0], [0.004, 0.03], 0.0, 1.6, 9, sd);
    this.dustMat = makeMaterial([1.0, 0.86, 0.62], [0.03, 0.17], 0.34, 2.2, 3, sd + 3.1);
    this.ion = new THREE.Mesh(makeRibbon(), this.ionMat);
    this.dust = new THREE.Mesh(makeRibbon(), this.dustMat);
    this.ion.frustumCulled = false;
    this.dust.frustumCulled = false;
    this.coma = new GlowSprite({ color: new THREE.Color(0.55, 0.78, 1.0), intensity: 0.45, coreFraction: 0.1, minRadiusPx: 7 });
    this.core = new GlowSprite({ color: new THREE.Color(1.0, 0.97, 0.9), intensity: 1.1, coreFraction: 0.05, minRadiusPx: 2.5 });
    this.inner = new GlowSprite({ color: new THREE.Color(1.0, 0.93, 0.8), intensity: 0.5, coreFraction: 0.18, minRadiusPx: 0 });
    this.group.add(this.dust, this.ion, this.coma, this.core, this.inner);
    for (let j = 0; j < JETS.length; j++) {
      const m = makeMaterial([1.0, 0.94, 0.84], [0.035, 0.32], 0.0, 2.6, 5, sd + 7.7 * (j + 1));
      const mesh = new THREE.Mesh(makeRibbon(), m);
      mesh.frustumCulled = false;
      this.jetMats.push(m);
      this.jets.push(mesh);
      this.group.add(mesh);
    }
    this.group.visible = false;
  }

  /** Position and scale everything for this frame. Returns false (and hides) when the comet is inactive. */
  update(s: CometState, viewportHeightPx: number): boolean {
    const f = cometActivity(s.rAU) * s.size;
    if (f < 0.012 || s.opacity < 0.01) {
      this.group.visible = false;
      return false;
    }
    this.group.visible = true;
    this.group.position.copy(s.head);
    const inv = 1 / s.metersPerUnit;
    const lenIon = 0.9 * AU_M * f * inv;
    const lenDust = lenIon * 0.45;
    // Bend direction: component of -velocity perpendicular to the anti-sunward axis.
    this.bend.copy(s.velocityDir).multiplyScalar(-1);
    this.bend.addScaledVector(s.antiSun, -this.bend.dot(s.antiSun));
    if (this.bend.lengthSq() < 1e-8) this.bend.set(0, 0, 1).addScaledVector(s.antiSun, -s.antiSun.z);
    this.bend.normalize();
    // Dust is brighter than plasma to the eye; both scale with insolation.
    const bright = Math.min(2.5, s.insolation);
    const um = this.ionMat.uniforms, dm = this.dustMat.uniforms;
    um.uDir.value.copy(s.antiSun);
    um.uLen.value = lenIon;
    // Inside the near field of the nucleus the tail is invisible: nothing but the nucleus and faint dust.
    const tailFade = THREE.MathUtils.smoothstep(s.cameraDistM, 6e-4 * lenIon * s.metersPerUnit, 8e-3 * lenIon * s.metersPerUnit);
    um.uBrightness.value = 0.55 * (0.5 + 0.5 * bright);
    um.uOpacity.value = Math.max(s.opacity, 0.0) * tailFade;
    dm.uDir.value.copy(s.antiSun);
    dm.uBendDir.value.copy(this.bend);
    dm.uLen.value = lenDust;
    dm.uBrightness.value = 0.45 * (0.5 + 0.5 * bright);
    dm.uOpacity.value = Math.max(s.opacity, 0.0) * tailFade;
    const comaR = 6e7 * f * inv;
    // Inside the coma the sprites would paint the whole screen: fade them out as the camera approaches the nucleus.
    const comaFade = THREE.MathUtils.smoothstep(s.cameraDistM, 0.04 * 6e7 * f, 0.7 * 6e7 * f);
    this.coma.material.setRadius(comaR);
    this.coma.material.setViewportHeight(viewportHeightPx);
    this.coma.material.uniforms.uOpacity.value = s.opacity * comaFade * Math.min(1, 0.4 + f);
    this.core.material.setRadius(comaR * 0.16);
    this.core.material.setViewportHeight(viewportHeightPx);
    this.core.material.uniforms.uOpacity.value = s.opacity * comaFade * Math.min(1, 0.3 + f);
    // Near field: inner dust coma + dayside jets, fading in as the big coma/tails fade out.
    const R = s.nucleusRadiusM;
    const near = 1 - THREE.MathUtils.smoothstep(s.cameraDistM, 400 * R, 4000 * R);
    const nearVis = near * Math.min(1, f * 3) * Math.min(1.6, 0.4 + 0.6 * bright);
    this.inner.visible = nearVis > 0.004;
    if (this.inner.visible) {
      this.inner.material.setRadius(26 * R * inv);
      this.inner.material.setViewportHeight(viewportHeightPx);
      // Far fainter than the sunlit nucleus (NAVCAM: jets only show against the black sky).
      this.inner.material.uniforms.uOpacity.value = 0.035 * nearVis * THREE.MathUtils.smoothstep(s.cameraDistM, 8 * R, 60 * R);
    }
    this.normal.crossVectors(s.antiSun, this.bend).normalize();
    for (let j = 0; j < this.jets.length; j++) {
      const mesh = this.jets[j];
      mesh.visible = nearVis > 0.004;
      if (!mesh.visible) continue;
      const [a, b, c, k] = JETS[j];
      const ju = this.jetMats[j].uniforms;
      this.tmp.copy(s.antiSun).multiplyScalar(-a).addScaledVector(this.bend, b).addScaledVector(this.normal, c).normalize();
      ju.uDir.value.copy(this.tmp);
      ju.uLen.value = (7 + 4 * k) * R * inv;
      ju.uBrightness.value = 0.09 * k;
      ju.uOpacity.value = nearVis;
    }
    return true;
  }

  dispose(): void {
    this.ion.geometry.dispose();
    this.dust.geometry.dispose();
    this.ionMat.dispose();
    this.dustMat.dispose();
    this.coma.dispose();
    this.core.dispose();
    this.inner.dispose();
    for (const j of this.jets) j.geometry.dispose();
    for (const m of this.jetMats) m.dispose();
    this.group.removeFromParent();
  }
}
