/**
 * GLSL for the shared black-hole renderer (see lens.ts). Units: Schwarzschild radii (r_s = 1), black hole at the origin,
 * ICRS world axes.
 *
 * Light paths. Inside the lensing sphere (uRL) each pixel's photon is integrated backwards along its null geodesic in
 * the Binet form d²x/dλ² = −(3/2) h² x / r⁵ (exact for Schwarzschild), leapfrog with steps ∝ r. Spin adds a
 * gravitomagnetic (Lense–Thirring) term −2 v × B, B = 2[3n(n·J) − J]/r³, J = a M² ŝ: an approximation to Kerr that
 * flattens and shifts the shadow towards the receding side; it is labelled "approximate Kerr" in the UI. Outside the
 * sphere rays are straight lines bent by the analytic weak-field kick (integral of the same force along the line), so
 * far-away Einstein rings come out right and the image stays continuous across the sphere's edge.
 *
 * Emission. A geometrically thin disc in the plane ⟂ uN with the Novikov–Thorne / Shakura–Sunyaev temperature profile
 * T ∝ r^{-3/4}(1 − √(r_in/r))^{1/4} from the ISCO outwards, redshift factor g = 1/(u^t (1 − Ω λ)) for Kerr circular
 * orbits (Doppler + gravitational), intensity ∝ g⁴, colour = blackbody(T_display × g). Temperatures and brightness are
 * compressed into the visible range (uTexp, uIexp) — the honest inner-disc temperatures (10⁵–10⁷ K) are in the fact
 * sheets. Optional relativistic jets (Doppler-boosted δ³, lensed near the hole) and one analytic companion star (so its
 * lensed images and Einstein rings stay sharp at any resolution). The background is a cube-map capture of the real
 * scene taken from the black hole's position. Linear HDR out, premultiplied alpha; no tone mapping here.
 */
import { BLACKBODY_GLSL } from '../glsl/blackbody';
import { NOISE_GLSL } from '../glsl/noise';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';

export const BLACKHOLE_VERT = /* glsl */ `
${VERTEX_PRELUDE}
uniform float uRP;
varying vec3 vP;
void main() {
  vP = position * uRP;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}`;

export const BLACKHOLE_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
${BLACKBODY_GLSL}
${NOISE_GLSL}
uniform samplerCube uEnv;
uniform float uHasEnv;
uniform vec3 uCam;
uniform float uRL;
uniform float uDeflMin;
uniform float uMarch;
uniform float uSteps;
uniform float uStepScale;
uniform float uSpin;
uniform float uHorizon;
uniform float uPhoton;
uniform vec3 uN;
uniform vec3 uE1;
uniform vec3 uE2;
uniform float uDisc;
uniform float uRin;
uniform float uRout;
uniform float uTpeak;
uniform float uTexp;
uniform float uIexp;
uniform float uDiscGain;
uniform float uDiscAlpha;
uniform float uOverview;
uniform float uFast;
uniform float uTime;
uniform float uJet;
uniform vec3 uJetAxis;
uniform float uJetBeta;
uniform float uJetGain;
uniform float uJetW;
uniform float uJetBase;
uniform vec4 uStar;
uniform vec3 uStarCol;
varying vec3 vP;

const float PROFILE_PEAK = 0.48795;

// Weak-field kick integral along a straight line: K(l) with s = l/√(b²+l²); K(±∞) = ±1/b.
float kickK(float s, float b) { return s * (3.0 - s * s) / (2.0 * b); }

// Bend unit direction d of a straight ray through x between line parameters la, lb (l = dot(position, d)).
vec3 bendRay(vec3 x, vec3 d, float la, float lb, bool toInfinity) {
  vec3 p = x - dot(x, d) * d;
  float b = max(length(p), 1e-4);
  float sa = la / sqrt(b * b + la * la);
  float sb = toInfinity ? 1.0 : lb / sqrt(b * b + lb * lb);
  float k = kickK(sb, b) - kickK(sa, b);
  return normalize(d - k * p / b);
}

float discProfile(float r) {
  float x = uRin / r;
  return pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25);
}

// Emission of the disc at xc (in the plane), photon heading to the camera along -dir.
vec3 discEmission(vec3 xc, vec3 dir, float r) {
  float prof = discProfile(r) / PROFILE_PEAK;
  if (prof <= 0.0) return vec3(0.0);
  // Kerr circular orbit (M units: rm = 2 r, a = uSpin): u^t and Ω; photon λ = L_z / E ≈ (x × k̂)·n̂ with k̂ = -dir.
  float rm = 2.0 * r;
  float a = uSpin;
  float r32 = rm * sqrt(rm);
  float den = r32 - 3.0 * sqrt(rm) + 2.0 * a;
  float g;
  if (den <= 0.0) g = 0.0;
  else {
    float ut = (r32 + a) / (pow(rm, 0.75) * sqrt(den));
    float omega = 1.0 / (r32 + a);
    float lam = 2.0 * dot(cross(xc, -dir), uN);
    g = 1.0 / (ut * max(1.0 - omega * lam, 0.05));
  }
  // Streaks sheared by differential rotation: noise in (log r, angle − Ω_vis t).
  float ang = atan(dot(xc, uE2), dot(xc, uE1));
  float lr = log(r / uRin);
  float om = 0.32 * pow(max(r / uRin, 1.0), -1.5);
  float a2 = ang - om * uTime;
  vec2 cs = vec2(cos(a2), sin(a2));
  // Long thin arcs: high radial, low angular frequency; a fine ring texture on top.
  float tex = fbm3(vec3(lr * 11.0, cs * 1.8), uFast > 0.5 ? 3 : 4);
  float fine = uFast > 0.5 ? 0.0 : simplexNoise3(vec3(lr * 38.0, cs * 3.0));
  float streak = 0.62 + 0.38 * smoothstep(-0.55, 0.65, tex + 0.25 * fine);
  float edge = smoothstep(uRin, uRin * 1.08, r) * (1.0 - smoothstep(uRout * 0.55, uRout, r));
  float I = pow(prof, uIexp) * streak * edge * pow(g, 4.0);
  float T = uTpeak * pow(prof, uTexp);
  vec3 col = blackbodyChroma(clamp(T * g, 1200.0, 40000.0)) * I * uDiscGain;
  // System-scale views: the X-ray-heated outer disc, which outshines the viscous profile far out (illustrative brightness).
  if (uOverview > 0.0) {
    float x = r / uRout;
    float irr = uOverview * 1.1 * pow(max(x, 1e-4), -0.75) * streak * smoothstep(uRin * 1.08, uRin * 3.0, r) * (1.0 - smoothstep(0.55, 1.0, x));
    col += blackbodyChroma(clamp(uTpeak * 0.75 * pow(max(x, 1e-4), -0.12), 1200.0, 40000.0)) * min(irr, 6.0) * uDiscGain;
  }
  return col;
}

// The cool outer disc is dark in visible light; it turns transparent with the emission profile so it never shows as a
// black occluder against the lensed sky (a display choice, not physics).
float discOpacity(float r) {
  float prof = discProfile(r) / PROFILE_PEAK;
  return uDiscAlpha * smoothstep(uRin, uRin * 1.08, r) * (1.0 - smoothstep(uRout * 0.55, uRout, r)) * clamp(prof * 2.2 + uOverview, 0.0, 1.0);
}

// Relativistic jets along ±uJetAxis: emissivity per unit length, Doppler boosted (δ³). Photon heads along -dir.
vec3 jetEmission(vec3 x, vec3 dir) {
  float z = dot(x, uJetAxis);
  float az = abs(z);
  if (az < 1.5) return vec3(0.0);
  float rho = length(x - z * uJetAxis);
  float w = uJetW * (0.6 + pow(az, 0.6));
  if (rho > 3.0 * w) return vec3(0.0);
  float prof = exp(-rho * rho / (w * w));
  float cosT = dot(sign(z) * uJetAxis, -dir);
  // Jets accelerate away from the hole (M87: apparent speeds < 0.5c → > 2c within ~10³ r_s; Walker et al. 2018).
  float beta = uJetBeta * mix(0.3, 1.0, smoothstep(uJetBase * 0.5, uJetBase * 4.0, az));
  float gam = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gam * (1.0 - beta * cosT));
  float knots = 0.55 + 0.45 * smoothstep(-0.3, 0.6, simplexNoise3(vec3(log(az) * 6.0 - uTime * 0.25, rho / w, sign(z))));
  // Launch and acceleration zone: faint within a few r_s so the shadow and photon ring stay visible behind the jet.
  float base = smoothstep(2.0, uJetBase, az);
  return vec3(0.55, 0.72, 1.0) * (uJetGain * prof * knots * base * dop * dop * dop / (w * (1.0 + 0.15 * az)));
}

// Disc crossing and the companion star on a straight segment x0 + t d, t ∈ [t0, t1], front to back.
void straightSegment(vec3 x0, vec3 d, float t0, float t1, float rMin, inout vec3 col, inout float T) {
  float tDisc = -1.0;
  if (uDisc > 0.0) {
    float dn = dot(d, uN);
    if (abs(dn) > 1e-6) {
      float t = -dot(x0, uN) / dn;
      if (t > t0 && t < t1) tDisc = t;
    }
  }
  float tStar = -1.0;
  vec3 sn = vec3(0.0);
  if (uStar.w > 0.0) {
    vec3 oc = x0 - uStar.xyz;
    float bb = dot(oc, d);
    float cc = dot(oc, oc) - uStar.w * uStar.w;
    float h = bb * bb - cc;
    if (h > 0.0) {
      float t = -bb - sqrt(h);
      if (t > t0 && t < t1) { tStar = t; sn = normalize(oc + d * t); }
    }
  }
  if (tDisc > 0.0 && (tStar < 0.0 || tDisc < tStar)) {
    vec3 xc = x0 + d * tDisc;
    float r = length(xc);
    if (r > rMin && r > uRin && r < uRout) {
      col += T * discEmission(xc, d, r) * uDisc;
      T *= 1.0 - discOpacity(r) * uDisc;
    }
  }
  if (tStar > 0.0) {
    float mu = max(dot(sn, -d), 0.0);
    float limb = 1.0 - 0.6 * (1.0 - mu) - 0.15 * (1.0 - mu) * (1.0 - mu);
    col += T * uStarCol * limb;
    T = 0.0;
  }
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 d = normalize(vP - uCam);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float lc = dot(uCam, d);
  vec3 pc = uCam - lc * d;
  float b0 = length(pc);
  float cq = dot(uCam, uCam) - uRL * uRL;
  float dq = lc * lc - cq;
  bool hit = uMarch > 0.5 && dq > 0.0 && (-lc + sqrt(max(dq, 0.0))) > 0.0;
  bool captured = false;
  vec3 dirOut = d;
  float envA = 1.0;

  if (!hit) {
    if (uMarch < 0.5 && b0 < 2.598 && lc < 0.0) {
      captured = true;
    } else {
      float tca = max(-lc, 0.0);
      float rMin = uMarch > 0.5 ? uRL : 0.0;
      straightSegment(uCam, d, 0.0, tca, rMin, col, T);
      vec3 xca = uCam + d * tca;
      float defl = 1.0 / max(b0, 1e-4) - kickK(lc / sqrt(b0 * b0 + lc * lc), b0);
      dirOut = bendRay(uCam, d, lc, 0.0, true);
      if (T > 0.0) straightSegment(xca, dirOut, 0.0, 1e30, rMin, col, T);
      envA = smoothstep(uDeflMin, 2.0 * uDeflMin, defl);
    }
  } else {
    float t0 = max(-lc - sqrt(dq), 0.0);
    straightSegment(uCam, d, 0.0, t0, uRL, col, T);
    vec3 x = uCam + d * t0;
    vec3 v = t0 > 0.0 ? bendRay(uCam, d, lc, lc + t0, false) : d;
    float side = dot(x, uN);
    // Rays run backwards in time; time-reversed Kerr is Kerr with −a, so the traced ray feels the opposite spin.
    vec3 J = -0.25 * uSpin * uN;
    // Kick-drift-kick leapfrog with the acceleration cached between steps: one force evaluation per step.
    vec3 acc;
    {
      float r0 = max(length(x), 0.45);
      vec3 n0 = x / r0;
      vec3 h0 = cross(x, v);
      vec3 B0 = 2.0 * (3.0 * n0 * dot(n0, J) - J) / (r0 * r0 * r0);
      acc = -1.5 * dot(h0, h0) * x / (r0 * r0 * r0 * r0 * r0) - 2.0 * cross(v, B0);
    }
    for (int i = 0; i < 420; i++) {
      if (float(i) >= uSteps || T < 0.03) break;
      float r = length(x);
      // Inside the photon sphere and heading inwards: no escape (Schwarzschild 1.5 r_s, shrinking with prograde spin).
      if (r < uHorizon || (r < uPhoton && dot(x, v) < 0.0)) { captured = true; break; }
      if (r > uRL * 1.001 && dot(x, v) > 0.0) break;
      float dl = clamp((r < 5.0 ? 0.035 : (r < 12.0 ? 0.075 : 0.11)) * uStepScale * r, 0.008, 4.0);
      vec3 vh = v + 0.5 * dl * acc;
      vec3 xn = x + dl * vh;
      float rn = max(length(xn), 0.45);
      float rn2 = rn * rn;
      vec3 nn = xn / rn;
      vec3 hn = cross(xn, vh);
      vec3 Bn = 2.0 * (3.0 * nn * dot(nn, J) - J) / (rn2 * rn);
      vec3 accn = -1.5 * dot(hn, hn) * xn / (rn2 * rn2 * rn) - 2.0 * cross(vh, Bn);
      v = vh + 0.5 * dl * accn;
      acc = accn;
      if (uJet > 0.0) col += T * jetEmission(xn, normalize(v)) * dl * uJet;
      float sn = dot(xn, uN);
      if (uDisc > 0.0 && sign(sn) != sign(side)) {
        float f = side / (side - sn);
        vec3 xc = mix(x, xn, f);
        float rcr = length(xc);
        if (rcr > uRin && rcr < uRout) {
          col += T * discEmission(xc, normalize(v), rcr) * uDisc;
          T *= 1.0 - discOpacity(rcr) * uDisc;
        }
      }
      side = sn;
      x = xn;
    }
    if (!captured && T > 0.01) {
      dirOut = normalize(v);
      float le = dot(x, dirOut);
      dirOut = bendRay(x, dirOut, le, 0.0, true);
      straightSegment(x, dirOut, 0.0, 1e30, uRL, col, T);
    }
  }

  if (captured) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  vec3 bg = uHasEnv > 0.5 ? textureLod(uEnv, dirOut, 0.0).rgb : vec3(0.0);
  float a = uHasEnv > 0.5 ? envA : 0.0;
  col += T * a * bg;
  gl_FragColor = vec4(col, 1.0 - T * (1.0 - a));
}`;
