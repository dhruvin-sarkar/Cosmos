/**
 * Screen-space-width polylines (orbits, trajectories, grids) drawn as instanced segments, in the manner of
 * three's Line2/LineMaterial but trimmed to what Cosmos needs:
 *  - width in CSS px (1 px hairline by default), analytic coverage AA, identical at any DPR;
 *  - line texture by provenance (VISUAL_DIRECTION "Line and mark language"): observed/derived solid,
 *    reconstructed dashed 9/6 px, illustrative dotted 1.5/5 px with round dots;
 *  - colours are VISUAL_DIRECTION display tokens converted through the AgX inverse so the tone-mapped line lands
 *    exactly on the token (planet orbit ink 30 %, minor body 18 %, focused orbit brass 70 %) — and stays below
 *    the bloom threshold: no glow;
 *  - optional "age" fade behind a moving body (trail) and an overall opacity for distance fades.
 *
 * Instance attributes (see orbitBuilder.ts): instanceStart / instanceEnd (vec3, float32, model space),
 * instanceDist (vec2, cumulative length at both ends, model units) and instanceParam (vec2, orbit fraction 0–1).
 * Dashes are laid out along the cumulative length using `pxPerModelUnit` (set per frame at the orbit's distance),
 * so the pattern is continuous across segments and 9/6 px where the orbit is viewed.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { OVERLAY_TOKENS, sceneLinearForOklch, type Rgb3 } from '../tonemap';
import type { ProvenanceClass } from '../../data/provenance';

export type OrbitRole = 'planet' | 'minor' | 'focused';
export type LineTexture = 'solid' | 'dashed' | 'dotted';

/** VISUAL_DIRECTION: opacities of the orbit roles. */
export const ORBIT_ROLE_STYLE: Record<OrbitRole, { token: keyof typeof OVERLAY_TOKENS; opacity: number }> = {
  planet: { token: 'ink', opacity: 0.3 },
  minor: { token: 'ink', opacity: 0.18 },
  focused: { token: 'brass', opacity: 0.7 },
};

/** Provenance → line texture (geological-map convention). */
export function lineTextureForProvenance(p: ProvenanceClass): LineTexture {
  if (p === 'reconstructed') return 'dashed';
  if (p === 'illustrative') return 'dotted';
  return 'solid';
}

const DASH_PX: Record<LineTexture, [number, number, number]> = {
  solid: [0, 0, 0],
  dashed: [9, 6, 1],
  dotted: [1.5, 5, 2],
};

const roleColorCache = new Map<OrbitRole, Rgb3>();
/** Scene-linear colour (opacity folded in) of an orbit role. Cached; computed once per role. */
export function orbitRoleColor(role: OrbitRole): Rgb3 {
  let c = roleColorCache.get(role);
  if (!c) {
    const s = ORBIT_ROLE_STYLE[role];
    const [L, C, h] = OVERLAY_TOKENS[s.token];
    c = sceneLinearForOklch(L, C, h, s.opacity);
    roleColorCache.set(role, c);
  }
  return c;
}

export interface OrbitLineMaterialOptions {
  role?: OrbitRole;
  provenance?: ProvenanceClass;
  /** Line width, CSS px. Default 1 (dotted lines use the 1.5 px dot diameter). */
  widthPx?: number;
}

export class OrbitLineMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uResolution: { value: THREE.Vector2 };
    uPixelRatio: { value: number };
    uWidthPx: { value: number };
    uColor: { value: THREE.Vector3 };
    uOpacity: { value: number };
    uDash: { value: THREE.Vector3 };
    uPxPerUnit: { value: number };
    uTrail: { value: THREE.Vector2 };
  };
  private _role: OrbitRole = 'planet';
  private _texture: LineTexture = 'solid';

  constructor(opts: OrbitLineMaterialOptions = {}) {
    super({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uPixelRatio: { value: 1 },
        uWidthPx: { value: opts.widthPx ?? 1 },
        uColor: { value: new THREE.Vector3(1, 1, 1) },
        uOpacity: { value: 1 },
        uDash: { value: new THREE.Vector3() },
        uPxPerUnit: { value: 1 },
        uTrail: { value: new THREE.Vector2(-1, 0.15) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.role = opts.role ?? 'planet';
    this.lineTexture = lineTextureForProvenance(opts.provenance ?? 'observed');
  }

  get role(): OrbitRole {
    return this._role;
  }
  set role(r: OrbitRole) {
    this._role = r;
    const c = orbitRoleColor(r);
    this.uniforms.uColor.value.set(c.r, c.g, c.b);
  }

  get lineTexture(): LineTexture {
    return this._texture;
  }
  set lineTexture(t: LineTexture) {
    this._texture = t;
    const d = DASH_PX[t];
    this.uniforms.uDash.value.set(d[0], d[1], d[2]);
  }

  set provenance(p: ProvenanceClass) {
    this.lineTexture = lineTextureForProvenance(p);
  }

  /** Overall opacity multiplier (distance/scale fades). */
  setFade(opacity: number): void {
    this.uniforms.uOpacity.value = opacity;
  }

  /** Drawing-buffer size and DPR (call on resize). */
  setViewport(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    this.uniforms.uResolution.value.set(cssWidth * pixelRatio, cssHeight * pixelRatio);
    this.uniforms.uPixelRatio.value = pixelRatio;
  }

  /** CSS px per model unit at the orbit's distance (lays out dashes). */
  setPxPerUnit(pxPerUnit: number): void {
    this.uniforms.uPxPerUnit.value = pxPerUnit;
  }

  /** Fade the orbit behind a body at orbit fraction `head` (0–1) down to `minFade`; head < 0 disables. */
  setTrail(head: number, minFade = 0.15): void {
    this.uniforms.uTrail.value.set(head, minFade);
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute vec2 instanceDist;
attribute vec2 instanceParam;

uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uWidthPx;
uniform vec3 uDash;

varying float vAcross;
varying float vAlong;
varying float vT;
varying float vHalfQuad;

void main() {
  vec4 s = modelViewMatrix * vec4(instanceStart, 1.0);
  vec4 e = modelViewMatrix * vec4(instanceEnd, 1.0);
  float dS = instanceDist.x;
  float dE = instanceDist.y;

  // Trim the segment at the near plane so the projected direction stays valid (as in three's LineMaterial).
  float nearZ = -0.5 * projectionMatrix[3][2] / projectionMatrix[2][2];
  if (s.z > nearZ && e.z > nearZ) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (s.z > nearZ) { float a = (nearZ - s.z) / (e.z - s.z); s.xyz = mix(s.xyz, e.xyz, a); dS = mix(dS, dE, a); }
  else if (e.z > nearZ) { float a = (nearZ - e.z) / (s.z - e.z); e.xyz = mix(e.xyz, s.xyz, a); dE = mix(dE, dS, a); }

  vec4 cs = projectionMatrix * s;
  vec4 ce = projectionMatrix * e;
  vec2 ps = cs.xy / cs.w * 0.5 * uResolution;
  vec2 pe = ce.xy / ce.w * 0.5 * uResolution;
  vec2 dir = pe - ps;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  float halfWidth = 0.5 * uWidthPx * uPixelRatio;
  if (uDash.z > 1.5) halfWidth = max(halfWidth, 0.5 * uDash.x * uPixelRatio);
  vHalfQuad = halfWidth + 1.0;

  bool atEnd = position.y > 0.5;
  vec4 clip = atEnd ? ce : cs;
  vAcross = position.x * vHalfQuad;
  vAlong = atEnd ? dE : dS;
  vT = atEnd ? instanceParam.y : instanceParam.x;
  clip.xy += nrm * vAcross * 2.0 / uResolution * clip.w;
  gl_Position = clip;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform float uPixelRatio;
uniform float uWidthPx;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uDash;
uniform float uPxPerUnit;
uniform vec2 uTrail;

varying float vAcross;
varying float vAlong;
varying float vT;
varying float vHalfQuad;

void main() {
  float halfWidth = 0.5 * uWidthPx * uPixelRatio;
  float cov;
  float along = vAlong * uPxPerUnit * uPixelRatio;          // device px along the line
  if (uDash.z < 0.5) {
    cov = clamp(halfWidth + 0.5 - abs(vAcross), 0.0, 1.0);
  } else if (uDash.z < 1.5) {
    float period = (uDash.x + uDash.y) * uPixelRatio;
    float p = mod(along, period);
    float dashLen = uDash.x * uPixelRatio;
    float aa = max(fwidth(along), 1e-3);
    float inDash = clamp((dashLen - p) / aa + 0.5, 0.0, 1.0) * clamp(p / aa + 0.5, 0.0, 1.0);
    cov = clamp(halfWidth + 0.5 - abs(vAcross), 0.0, 1.0) * inDash;
  } else {
    float period = (uDash.x + uDash.y) * uPixelRatio;
    float radius = 0.5 * uDash.x * uPixelRatio;
    float p = mod(along, period) - radius;
    float r = length(vec2(p, vAcross));
    cov = clamp(radius + 0.5 - r, 0.0, 1.0);
  }
  float fade = uOpacity;
  if (uTrail.x >= 0.0) fade *= mix(1.0, uTrail.y, fract(uTrail.x - vT));
  if (cov * fade <= 0.0) discard;
  gl_FragColor = vec4(uColor * (cov * fade), 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
