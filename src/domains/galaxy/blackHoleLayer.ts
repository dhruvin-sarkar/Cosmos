/**
 * Sagittarius A* close up: a ray-traced Schwarzschild black hole. Inside a lensing sphere of 80 r_s around the hole each
 * pixel's photon is integrated backwards along its null geodesic (Binet form in Cartesian coordinates:
 * d²x/dλ² = −(3/2) h² x / r⁵ with r_s = 1), so the shadow (critical curve, diameter √27 r_s ≈ 5.2 r_s), the photon ring
 * and the lensed background all come out of the physics. The background is the real scene captured into a cube map from
 * Sgr A*'s position (services.captureEnvironment): the nuclear star cluster, the S-stars and the Galaxy's glow.
 *
 * The accretion flow is ILLUSTRATIVE: Sgr A* actually has a hot, faint, geometrically thick flow (the EHT 2022 ring is
 * 1.3 mm synchrotron light). We draw a thin Novikov–Thorne-like disc (T ∝ r^−3/4 (1 − √(r_in/r))^1/4, inner edge at the
 * ISCO, 3 r_s) with relativistic Doppler beaming and gravitational redshift (intensity ∝ g⁴), tilted 30° from our line of
 * sight as the EHT analysis favours (inclination < 50°). Linear HDR out; no tone mapping here.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { BLACKBODY_GLSL } from '../../render/glsl/blackbody';
import { NOISE_GLSL } from '../../render/glsl/noise';
import { SGRA_RS_M } from './model';
import { galaxyRuntime } from './runtime';

/**
 * Lensing sphere radius (r_s). Rays are bent only inside it; the image stays continuous across its edge (a grazing ray
 * spends no path inside), the far-field bending 2 r_s / b < 0.08 rad outside it is left out.
 */
export const LENS_RADIUS_RS = 26;
/** Visible while the camera is within this many r_s of Sgr A* (≈ 25,000 AU). */
const SHOW_WITHIN_RS = 3e5;
const DISC_INNER_RS = 3;
const DISC_OUTER_RS = 16;
export const DISC_TILT_DEG = 30;

const VERT = /* glsl */ `
${VERTEX_PRELUDE}
uniform float uRL;
varying vec3 vP;
void main() {
  vP = position * uRL;           // sphere point, r_s units, BH-centred world axes
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}`;

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
${BLACKBODY_GLSL}
${NOISE_GLSL}
uniform samplerCube uEnv;
uniform float uHasEnv;
uniform vec3 uCam;           // camera, r_s units relative to the hole
uniform float uRL;
uniform vec3 uN;             // disc normal (unit)
uniform vec3 uE1;            // disc in-plane basis
uniform vec3 uE2;
uniform float uSteps;
uniform float uTime;         // seconds (disc pattern rotation)
uniform float uDiscGain;
uniform float uDisc;         // 0..1 disc visibility
varying vec3 vP;

vec3 discEmission(vec3 x, vec3 v, float r) {
  // Temperature profile (thin disc, zero-torque inner edge) and the Keplerian flow direction.
  float rin = ${DISC_INNER_RS.toFixed(1)};
  float prof = pow(rin / r, 0.75) * pow(max(1.0 - sqrt(rin / r), 0.0), 0.25);
  float T = 6500.0 * prof / 0.488;                   // peak ≈ 6,500 K (illustrative visual temperature)
  vec3 phi = normalize(cross(uN, x));
  float beta = sqrt(1.0 / (2.0 * (r - 1.0)));        // local orbital speed (v/c) of a circular orbit, r_s = 1
  float gam = inversesqrt(1.0 - beta * beta);
  float mu = dot(phi, -normalize(v));                // cos angle between flow and the photon towards the camera
  float g = sqrt(1.0 - 1.0 / r) / (gam * (1.0 - beta * mu));
  // Swirling streaks: noise in (log r, angle − Ω t) so the pattern shears with the differential rotation.
  float ang = atan(dot(x, uE2), dot(x, uE1));
  float omega = 0.35 * pow(r / rin, -1.5);
  float a2 = ang - omega * uTime;
  float tex = fbm3(vec3(log(r) * 18.0, cos(a2) * 4.0, sin(a2) * 4.0), 5);
  float fine = simplexNoise3(vec3(log(r) * 55.0, cos(a2) * 9.0, sin(a2) * 9.0));
  float streak = 0.25 + 0.75 * smoothstep(-0.55, 0.75, tex + 0.25 * fine);
  float edge = smoothstep(rin, rin + 0.6, r) * (1.0 - smoothstep(${(DISC_OUTER_RS * 0.6).toFixed(1)}, ${DISC_OUTER_RS.toFixed(1)}, r));
  float I = pow(prof, 1.5) * streak * edge * pow(g, 4.0);
  return blackbodyChroma(clamp(T * g, 1500.0, 40000.0)) * I * uDiscGain;
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 d = normalize(vP - uCam);
  // Entry into the lensing sphere (the camera may be inside).
  float b = dot(uCam, d);
  float c = dot(uCam, uCam) - uRL * uRL;
  float t0 = 0.0;
  if (c > 0.0) {
    float disc = b * b - c;
    if (disc < 0.0) discard;
    t0 = -b - sqrt(disc);
  }
  vec3 x = uCam + d * max(t0, 0.0);
  vec3 v = d;
  vec3 hv = cross(x, v);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  float side = dot(x, uN);
  for (int i = 0; i < 400; i++) {
    if (float(i) >= uSteps) break;
    float r = length(x);
    if (r < 1.0) { captured = true; break; }
    if (r > uRL * 1.001 && dot(x, v) > 0.0) break;
    // Step ∝ r (fine near the photon sphere), leapfrog (symplectic: keeps h conserved well).
    float dl = clamp((r < 5.0 ? 0.035 : 0.075) * r, 0.01, 4.0);
    float r2 = r * r;
    vec3 a = -1.5 * h2 * x / (r2 * r2 * r);
    vec3 vh = v + 0.5 * dl * a;
    vec3 xn = x + dl * vh;
    float rn = max(length(xn), 0.5);
    float rn2 = rn * rn;
    vec3 an = -1.5 * h2 * xn / (rn2 * rn2 * rn);
    v = vh + 0.5 * dl * an;
    // Disc crossing.
    float sn = dot(xn, uN);
    if (uDisc > 0.0 && sign(sn) != sign(side)) {
      float f = side / (side - sn);
      vec3 xc = mix(x, xn, f);
      float rc = length(xc);
      if (rc > ${DISC_INNER_RS.toFixed(1)} && rc < ${DISC_OUTER_RS.toFixed(1)}) {
        vec3 e = discEmission(xc, v, rc) * uDisc;
        float alpha = 0.92 * smoothstep(${DISC_INNER_RS.toFixed(1)}, ${(DISC_INNER_RS + 0.6).toFixed(1)}, rc) * (1.0 - smoothstep(${(DISC_OUTER_RS * 0.6).toFixed(1)}, ${DISC_OUTER_RS.toFixed(1)}, rc));
        col += T * e;
        T *= 1.0 - alpha * uDisc;
      }
    }
    side = sn;
    x = xn;
    if (T < 0.01) break;
  }
  if (!captured && T > 0.01) {
    vec3 bg = uHasEnv > 0.5 ? textureLod(uEnv, normalize(v), 0.0).rgb : vec3(0.0);
    col += T * bg;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** The (illustrative) disc frame in ICRS world axes: normal tilted DISC_TILT_DEG from the line of sight towards Earth. */
export function discBasis(): { n: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; toEarth: THREE.Vector3; north: THREE.Vector3 } {
  const rt = galaxyRuntime();
  const toEarth = new THREE.Vector3(-rt.sky.los.x, -rt.sky.los.y, -rt.sky.los.z);
  const north = new THREE.Vector3(rt.sky.north.x, rt.sky.north.y, rt.sky.north.z);
  const tilt = (DISC_TILT_DEG * Math.PI) / 180;
  const n = toEarth.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(north, Math.sin(tilt)).normalize();
  const e1 = new THREE.Vector3().crossVectors(n, north).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  return { n, e1, e2, toEarth, north };
}

/** Multiply the uPixelRatio uniform of every visible point-sprite shader in the scene (render-kit convention). */
function scalePoints(root: THREE.Object3D, f: number): void {
  root.traverseVisible((o) => {
    if (!(o as THREE.Points).isPoints) return;
    const m = (o as THREE.Points).material as THREE.ShaderMaterial;
    const u = m.uniforms?.uPixelRatio;
    if (u && typeof u.value === 'number') u.value *= f;
  });
}

export interface BlackHoleHandle {
  readonly visible: boolean;
  /** Force a background re-capture on the next frame. */
  recapture(): void;
}

export function createBlackHoleLayer(): Layer & BlackHoleHandle {
  const rt = galaxyRuntime();
  const o = rt.frame.origin;
  let mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  let svcRef: EngineServices | null = null;
  let env: THREE.CubeTexture | null = null;
  let lastCapture = -Infinity;
  let elapsed = 0;
  let wantCapture = true;
  const camRs = new THREE.Vector3();
  const capturePos = new THREE.Vector3();

  // Disc normal: tilted 30° from the line of sight towards Earth, about the sky-plane east axis.
  const { n, e1, e2 } = discBasis();

  return {
    id: 'galaxy-blackhole',
    get visible() { return !!mesh?.visible; },
    recapture() { wantCapture = true; },

    init(svc: EngineServices): void {
      svcRef = svc;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uEnv: { value: null },
          uHasEnv: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uRL: { value: LENS_RADIUS_RS },
          uN: { value: n },
          uE1: { value: e1 },
          uE2: { value: e2 },
          uSteps: { value: 160 },
          uTime: { value: 0 },
          uDiscGain: { value: 4.0 },
          uDisc: { value: 1 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        transparent: true,
        blending: THREE.NoBlending,
      });
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
      mesh.name = 'galaxy-blackhole';
      mesh.frustumCulled = false;
      mesh.renderOrder = 50;
      mesh.visible = false;
      svc.groups.transparent.add(mesh);
    },

    update(ctx: FrameContext): void {
      if (!mesh || !svcRef) return;
      const cam = ctx.cameraPosition;
      camRs.set((cam.x - o.x) / SGRA_RS_M, (cam.y - o.y) / SGRA_RS_M, (cam.z - o.z) / SGRA_RS_M);
      const dRs = camRs.length();
      mesh.visible = dRs < SHOW_WITHIN_RS;
      if (!mesh.visible) { wantCapture = true; return; }
      elapsed += ctx.dtRealSec;
      // (Re)capture the background from Sgr A*'s position: on approach, then every 8 s (the S-stars move).
      if (wantCapture || elapsed - lastCapture > 8) {
        mesh.visible = false;
        capturePos.set(o.x, o.y, o.z);
        // Point sprites are sized in framebuffer pixels; a cube face has far fewer pixels per degree than the screen, so
        // shrink every point material (uPixelRatio convention) by the texel/pixel ratio for the capture.
        const size = ctx.quality.blackHoleQuality === 'high' ? 1024 : 512;
        const screenPxPerRad = (ctx.viewport.height * ctx.viewport.pixelRatio) / ctx.fovYRad;
        const f = Math.min(1, size / (Math.PI / 2) / screenPxPerRad);
        scalePoints(svcRef.scene, f);
        try {
          env = svcRef.captureEnvironment(capturePos, size, [mesh]);
        } catch {
          env = null;
        }
        scalePoints(svcRef.scene, 1 / f);
        mesh.visible = true;
        lastCapture = elapsed;
        wantCapture = false;
      }
      const inv = 1 / ctx.metersPerUnit;
      mesh.position.set((o.x - cam.x) * inv, (o.y - cam.y) * inv, (o.z - cam.z) * inv);
      mesh.scale.setScalar(LENS_RADIUS_RS * SGRA_RS_M * inv);
      const u = mesh.material.uniforms;
      (u.uCam.value as THREE.Vector3).copy(camRs);
      u.uEnv.value = env;
      u.uHasEnv.value = env ? 1 : 0;
      u.uSteps.value = ctx.quality.blackHoleQuality === 'high' ? 320 : 200;
      u.uTime.value = elapsed;
    },

    dispose(): void {
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      mesh = null;
      svcRef = null;
      env = null;
    },
  };
}
