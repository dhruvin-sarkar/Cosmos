/**
 * Debris lab 3D overlay (layer id 'lab-debris'), added to the engine only while the lab is open.
 *  - Shell field: the population per altitude shell (200–2000 km) as a glowing density volume around Earth: one
 *    back-faced sphere whose fragment shader integrates the piecewise-constant shell density along each view ray
 *    (analytic chord lengths through nested spheres, clipped at Earth's drawn surface). Magma ramp, additive.
 *  - Breakup cloud: every fragment as a GPU point on its own Kepler orbit with secular J2 drift, evaluated in the
 *    vertex shader at the lab's playhead (seconds after the breakup); parent orbits as hairline loops.
 * Positions follow the orbital domain's visual-scale map (src/domains/orbital/scene.ts) so the overlay sits exactly on
 * the drawn (possibly enlarged) Earth. The cloud is rotated about the pole so the breakup point sits over the real
 * place on today's globe (dynamics are unchanged: a rigid rotation of an inertial cloud).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { POST_EXPOSURE_UNIFORM } from '../../core/post';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { R_EARTH_M, earthPosition, offsetScale, orbitalScale, sunPosition, updateOrbitalScale } from '../../domains/orbital/scene';
import { FRAG_STRIDE, R_EARTH_ALT_REF_M, SHELL_COUNT, SHELL_EDGES_M, gmstRad, type BreakupCloud } from './model';

export const DEBRIS_OVERLAY_LAYER_ID = 'lab-debris';

export interface DebrisOverlayState {
  /** What to draw. */
  mode: 'off' | 'shells' | 'breakup';
  /** Glow level per shell, 0…1 (shellGlowLevel of the density relative to today's densest shell); length SHELL_COUNT. */
  shellLevel: Float32Array;
  /** Fragment cloud (null = none). Replace the object to upload a new cloud. */
  cloud: BreakupCloud | null;
  /** Seconds since the breakup. */
  tS: number;
}

export function createOverlayState(): DebrisOverlayState {
  return { mode: 'off', shellLevel: new Float32Array(SHELL_COUNT), cloud: null, tS: 0 };
}

/** Okabe–Ito sky blue and orange (parents 0 and 1). */
const PARENT_COLORS = [new THREE.Color('#56B4E9'), new THREE.Color('#E69F00')];

const SHELL_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VERTEX}
}`;

const SHELL_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
#define NSHELL ${SHELL_COUNT}
uniform vec3 uCenter;                 // Earth's drawn centre, render units (camera at origin)
uniform float uRadii[NSHELL + 1];     // drawn shell boundary radii, render units
uniform float uLevel[NSHELL];         // relative density per shell
uniform float uEarthR;                // Earth's drawn radius, render units
uniform float uGain;
uniform float uExposure;
varying vec3 vWorld;

// Length of the part of the ray [0, tMax] inside a ball of radius R centred at uCenter.
float chord(vec3 d, float b, float c0, float R, float tMax) {
  float h = b * b - (c0 - R * R);
  if (h <= 0.0) return 0.0;
  h = sqrt(h);
  float t0 = max(-b - h, 0.0);
  float t1 = min(-b + h, tMax);
  return max(t1 - t0, 0.0);
}

vec3 magma(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.10, 0.03, 0.22), c1 = vec3(0.55, 0.12, 0.45), c2 = vec3(0.95, 0.38, 0.30), c3 = vec3(1.0, 0.78, 0.50);
  return t < 0.4 ? mix(c0, c1, t / 0.4) : t < 0.75 ? mix(c1, c2, (t - 0.4) / 0.35) : mix(c2, c3, (t - 0.75) / 0.25);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 d = normalize(vWorld);
  vec3 oc = -uCenter;
  float b = dot(oc, d);
  float c0 = dot(oc, oc);
  // Stop at Earth's drawn surface.
  float tMax = 1e30;
  float he = b * b - (c0 - uEarthR * uEarthR);
  if (he > 0.0) { float te = -b - sqrt(he); if (te > 0.0) tMax = te; }
  float acc = 0.0;
  float wsum = 0.0;
  float prev = chord(d, b, c0, uRadii[0], tMax);
  for (int i = 0; i < NSHELL; i++) {
    float cur = chord(d, b, c0, uRadii[i + 1], tMax);
    float seg = cur - prev;
    acc += uLevel[i] * seg;
    wsum += uLevel[i] * seg * float(i);
    prev = cur;
  }
  float thick = max(uRadii[NSHELL] - uRadii[0], 1e-20);
  float x = acc / thick;               // ≈ relative density × path length in shell-thicknesses
  if (x <= 1e-5) discard;
  float I = 1.0 - exp(-uGain * x);   // optically thin glow, bounded: Earth always shows through
  float tone = clamp(0.15 + 0.85 * (1.0 - exp(-1.4 * x)), 0.0, 1.0);
  gl_FragColor = vec4(magma(tone) * I * 0.16 / uExposure, 1.0);
}`;

const FRAG_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aEl0;    // a (m), e, i
attribute vec3 aEl1;    // Ω0, ω0, M0
attribute vec3 aRate;   // dΩ/dt, dω/dt, dM/dt (rad/s)
attribute vec2 aInfo;   // size (m), parent index
uniform float uT;
uniform vec3 uMap;      // Earth factor f, core radius c (m), gap growth g
uniform vec3 uSunDir;   // unit, from Earth, in the cloud's rotated frame
uniform float uEarthR;
uniform float uPixelRatio;
uniform float uExposure;
uniform float uFade;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec3 vColor;

float solveE(float M, float e) {
  float E = M + e * sin(M);
  for (int k = 0; k < 10; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}

void main() {
  float a = aEl0.x, e = aEl0.y, inc = aEl0.z;
  float O = aEl1.x + aRate.x * uT;
  float w = aEl1.y + aRate.y * uT;
  float M = mod(aEl1.z + aRate.z * uT, 6.2831853);
  float E = solveE(M, e);
  float xp = a * (cos(E) - e);
  float yp = a * sqrt(max(1.0 - e * e, 0.0)) * sin(E);
  float cO = cos(O), sO = sin(O), ci = cos(inc), si = sin(inc), cw = cos(w), sw = sin(w);
  vec3 P = vec3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si);
  vec3 Q = vec3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si);
  vec3 p = xp * P + yp * Q;
  float along = dot(p, uSunDir);
  float perp = length(p - along * uSunDir);
  float lit = (along < 0.0 && perp < uEarthR) ? 0.22 : 1.0;
  float ra = length(p);
  vec3 pd = uMap.x > 1.0 && ra > 0.0 ? p * ((uMap.x * min(ra, uMap.y) + max(ra - uMap.y, 0.0) * uMap.z) / ra) : p;
  vec3 col = aInfo.y > 0.5 ? uColB : uColA;
  float s = clamp(log(aInfo.x / 0.1) / log(10.0), 0.0, 1.0);
  vColor = col * (lit * uFade * (0.9 + 0.8 * s) / uExposure);
  vec4 mv = modelViewMatrix * vec4(pd, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.2 + 1.6 * s) * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const FRAG_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = 1.0 - smoothstep(0.3, 1.0, r2);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

const LOOP_SEGMENTS = 256;

/** Drawn radius of a true Earth-centred distance (visual-scale map). */
const drawnR = (rM: number): number => rM * offsetScale(rM);

export function createDebrisOverlayLayer(state: DebrisOverlayState): Layer {
  let svc: EngineServices | null = null;
  // Shell field.
  const shellUniforms = {
    uCenter: { value: new THREE.Vector3() },
    uRadii: { value: new Array<number>(SHELL_COUNT + 1).fill(1) },
    uLevel: { value: new Array<number>(SHELL_COUNT).fill(0) },
    uEarthR: { value: 1 },
    uGain: { value: 1.6 },
    uExposure: POST_EXPOSURE_UNIFORM,
  };
  const shellMat = new THREE.ShaderMaterial({
    vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT, uniforms: shellUniforms,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const shellGeo = new THREE.SphereGeometry(1, 64, 32);
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.frustumCulled = false;
  shellMesh.renderOrder = 3;
  shellMesh.visible = false;
  // Fragment cloud.
  let cloudRef: BreakupCloud | null = null;
  let fragGeo: THREE.BufferGeometry | null = null;
  const fragUniforms = {
    uT: { value: 0 },
    uMap: { value: new THREE.Vector3(1, R_EARTH_M, 1) },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEarthR: { value: R_EARTH_M },
    uPixelRatio: { value: 1 },
    uExposure: POST_EXPOSURE_UNIFORM,
    uFade: { value: 1 },
    uColA: { value: PARENT_COLORS[0].clone() },
    uColB: { value: PARENT_COLORS[1].clone() },
  };
  const fragMat = new THREE.ShaderMaterial({
    vertexShader: FRAG_VERTEX, fragmentShader: FRAG_FRAGMENT, uniforms: fragUniforms,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const cloudGroup = new THREE.Group();
  cloudGroup.visible = false;
  let points: THREE.Points | null = null;
  // Parent orbit loops (unit circles in the orbital plane; oriented per frame).
  const loopGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array((LOOP_SEGMENTS + 1) * 3);
    for (let k = 0; k <= LOOP_SEGMENTS; k++) {
      const u = (k / LOOP_SEGMENTS) * Math.PI * 2;
      pos[k * 3] = Math.cos(u);
      pos[k * 3 + 1] = Math.sin(u);
    }
    loopGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }
  const loops = PARENT_COLORS.map(c => {
    const m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false });
    const l = new THREE.Line(loopGeo, m);
    l.frustumCulled = false;
    l.visible = false;
    return l;
  });

  const earthW = new THREE.Vector3();
  const sunW = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  let fade = 0;

  const uploadCloud = (c: BreakupCloud | null): void => {
    cloudRef = c;
    if (points) { cloudGroup.remove(points); points = null; }
    fragGeo?.dispose();
    fragGeo = null;
    if (!c || c.count === 0) return;
    const n = c.count;
    const el0 = new Float32Array(n * 3), el1 = new Float32Array(n * 3), rate = new Float32Array(n * 3), info = new Float32Array(n * 2);
    const E = c.elements;
    for (let i = 0; i < n; i++) {
      const o = i * FRAG_STRIDE;
      el0[i * 3] = E[o]; el0[i * 3 + 1] = E[o + 1]; el0[i * 3 + 2] = E[o + 2];
      el1[i * 3] = E[o + 3]; el1[i * 3 + 1] = E[o + 4]; el1[i * 3 + 2] = E[o + 5];
      rate[i * 3] = E[o + 6]; rate[i * 3 + 1] = E[o + 7]; rate[i * 3 + 2] = E[o + 8];
      info[i * 2] = c.sizeM[i]; info[i * 2 + 1] = E[o + 9];
    }
    fragGeo = new THREE.BufferGeometry();
    fragGeo.setAttribute('aEl0', new THREE.BufferAttribute(el0, 3));
    fragGeo.setAttribute('aEl1', new THREE.BufferAttribute(el1, 3));
    fragGeo.setAttribute('aRate', new THREE.BufferAttribute(rate, 3));
    fragGeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    fragGeo.setAttribute('position', new THREE.BufferAttribute(el0, 3));
    fragGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    points = new THREE.Points(fragGeo, fragMat);
    points.frustumCulled = false;
    points.renderOrder = 4;
    cloudGroup.add(points);
  };

  return {
    id: DEBRIS_OVERLAY_LAYER_ID,
    init(s) {
      svc = s;
      s.groups.transparent.add(shellMesh);
      s.groups.far.add(cloudGroup);
      for (const l of loops) s.groups.overlay.add(l);
    },
    update(ctx: FrameContext) {
      if (!svc) return;
      earthPosition(ctx.timeMs, earthW);
      updateOrbitalScale(ctx, null, earthW);
      const target = state.mode === 'off' ? 0 : 1;
      const k = ctx.reducedMotion ? 1 : Math.min(1, ctx.dtRealSec * 4);
      fade += (target - fade) * k;
      if (Math.abs(target - fade) < 0.002) fade = target;
      const mpu = ctx.metersPerUnit;
      const f = orbitalScale.earthFactor;
      // Shells.
      const showShells = state.mode === 'shells' && fade > 0.001;
      shellMesh.visible = showShells;
      if (showShells) {
        ctx.toRender(orbitalScale.earthDraw, shellUniforms.uCenter.value);
        shellMesh.position.copy(shellUniforms.uCenter.value);
        const radii = shellUniforms.uRadii.value;
        for (let i = 0; i <= SHELL_COUNT; i++) radii[i] = drawnR(R_EARTH_ALT_REF_M + SHELL_EDGES_M[i]) / mpu;
        shellMesh.scale.setScalar(radii[SHELL_COUNT] * 1.01);
        shellUniforms.uEarthR.value = (R_EARTH_M * f) / mpu;
        const lv = shellUniforms.uLevel.value;
        for (let i = 0; i < SHELL_COUNT; i++) lv[i] = state.shellLevel[i] * fade;
      }
      // Breakup cloud.
      if (state.cloud !== cloudRef) uploadCloud(state.cloud);
      const showCloud = state.mode === 'breakup' && !!cloudRef && fade > 0.001;
      cloudGroup.visible = showCloud;
      for (const l of loops) l.visible = false;
      if (showCloud && cloudRef) {
        const rot = gmstRad(ctx.timeMs) - gmstRad(cloudRef.eventTimeMs);
        ctx.toRender(orbitalScale.earthDraw, cloudGroup.position);
        cloudGroup.scale.setScalar(1 / mpu);
        cloudGroup.rotation.set(0, 0, rot);
        const u = fragUniforms;
        u.uT.value = state.tS;
        u.uMap.value.set(f, orbitalScale.core, orbitalScale.gap);
        u.uPixelRatio.value = svc.renderer.getPixelRatio();
        u.uFade.value = fade;
        sunPosition(ctx.timeMs, sunW);
        tmp.copy(sunW).sub(earthW).normalize().applyAxisAngle(zAxis, -rot);
        u.uSunDir.value.copy(tmp);
        cloudRef.parentElements.forEach((el, i) => {
          const l = loops[i];
          if (!l) return;
          // Orientation Rz(Ω + rot)·Rx(i) (ω is irrelevant for a circle). Drawn at the breakup-time plane: the parents'
          // J2 nodal drift over the 10-day playhead is a few degrees.
          q.setFromAxisAngle(zAxis, el.raanRad + rot);
          q2.setFromAxisAngle(xAxis, el.inclinationRad);
          l.quaternion.copy(q).multiply(q2);
          ctx.toRender(orbitalScale.earthDraw, l.position);
          l.scale.setScalar(drawnR(el.semiMajorAxisM) / mpu);
          (l.material as THREE.LineBasicMaterial).opacity = 0.32 * fade;
          l.visible = true;
        });
      }
    },
    dispose() {
      if (svc) {
        svc.groups.transparent.remove(shellMesh);
        svc.groups.far.remove(cloudGroup);
        for (const l of loops) svc.groups.overlay.remove(l);
      }
      shellGeo.dispose();
      shellMat.dispose();
      fragGeo?.dispose();
      fragMat.dispose();
      loopGeo.dispose();
      for (const l of loops) (l.material as THREE.Material).dispose();
      svc = null;
    },
  };
}
