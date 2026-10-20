/**
 * Galaxy materials. All positions are float32 Mpc relative to the Solar System (the observer); the vertex shaders
 * subtract the camera position (Mpc) and scale to render units with a uniform depth compression `k` about the eye
 * (projected positions and angular sizes are unchanged; it keeps 14 Gpc inside the far plane at any render scale).
 *
 *  - GalaxyPointsMaterial: every catalogued galaxy as an elliptical exponential sprite. Integrated flux follows the
 *    galaxy's surface brightness × apparent area while resolved, and falls as 1/d (not 1/d²) once below ~3 px —
 *    an enhancement for visibility, disclosed in the layer's FactSheets.
 *  - ImpostorMaterial: instanced quads that sample observed images (DSS2 colour, TAN projection about the galaxy
 *    centre) by projecting each disc point onto the sky as seen from Earth — i.e. the image is deprojected onto the
 *    catalogued disc plane in the shader. Mode 0 = inclined disc, 1 = view-facing ellipse (spheroids, mergers),
 *    2 = face-on disc texture in disc coordinates (the reconstructed Milky Way).
 * Scene-linear HDR output, additive, no tone mapping here.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';

export class GalaxyPointsMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uCamMpc: { value: THREE.Vector3 };
    uScale: { value: number };
    uPxPerRad: { value: number };
    uPixelRatio: { value: number };
    uGain: { value: number };
    uOpacity: { value: number };
    uMaxSize: { value: number };
    uHandover: { value: THREE.Vector2 };
  };

  constructor() {
    super({
      uniforms: {
        uCamMpc: { value: new THREE.Vector3() },
        uScale: { value: 1 },
        uPxPerRad: { value: 1000 },
        uPixelRatio: { value: 1 },
        uGain: { value: 1 },
        uOpacity: { value: 1 },
        uMaxSize: { value: 512 },
        uHandover: { value: new THREE.Vector2(40, 90) },
      },
      vertexShader: /* glsl */ `
        ${VERTEX_PRELUDE}
        attribute vec3 aNormal;
        attribute vec4 aParams; // diameter kpc, surface brightness, spheroid (0/1), has impostor (0/1)
        attribute vec3 aColor;
        uniform vec3 uCamMpc;
        uniform float uScale, uPxPerRad, uPixelRatio, uGain, uOpacity, uMaxSize;
        uniform vec2 uHandover;
        varying vec3 vColor;
        varying vec2 vRot;
        varying float vQ, vFill;
        void main() {
          vec3 rel = position - uCamMpc;
          float d = max(length(rel), 1e-9);
          vec3 v = rel / d;
          float theta = aParams.x * 1e-3 / d * uPxPerRad;               // CSS px
          float q = aParams.z > 0.5 ? 0.82 : max(abs(dot(aNormal, v)), 0.22);
          float core = max(theta, 2.6);
          float size = min(core * 1.5, uMaxSize);
          // Disc normal on screen → the projected major axis is perpendicular to it.
          vec3 nv = (viewMatrix * vec4(aNormal, 0.0)).xyz;
          vec2 ns = nv.xy; float nl = length(ns);
          vRot = nl > 1e-4 ? vec2(-ns.y, ns.x) / nl : vec2(1.0, 0.0);
          vQ = q;
          float flux = uGain * aParams.y * (theta >= 2.6 ? theta * theta : 2.6 * theta) * 0.35;
          float hand = aParams.w > 0.5 ? 1.0 - smoothstep(uHandover.x, uHandover.y, theta) : 1.0;
          // Exponential profile exp(-r/h): D25 ≈ 6.4 h. Elliptical, so the area integral is 2π h² q.
          float half_ = size * 0.5;
          float h = (size / 1.5) / 6.4;
          float amp = flux / (6.2832 * h * h * q + 1e-6);
          vFill = h / half_;
          vColor = aColor * amp * hand * uOpacity;
          gl_PointSize = size * uPixelRatio;
          vec4 mv = viewMatrix * vec4(rel * uScale, 1.0);
          gl_Position = projectionMatrix * mv;
          if (amp * hand * uOpacity < 1e-5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          ${LOGDEPTH_VERTEX}
        }`,
      fragmentShader: /* glsl */ `
        ${FRAGMENT_PRELUDE}
        varying vec3 vColor;
        varying vec2 vRot;
        varying float vQ, vFill;
        void main() {
          ${LOGDEPTH_FRAGMENT}
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          p.y = -p.y;
          vec2 r = vec2(dot(p, vRot), dot(p, vec2(-vRot.y, vRot.x)) / vQ);
          float rr = length(r);
          if (rr > 1.0) discard;
          float f = exp(-rr / vFill) * (1.0 - smoothstep(0.7, 1.0, rr));
          gl_FragColor = vec4(vColor * f, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }
}

export class ImpostorMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uMap: { value: THREE.Texture | null };
    uGrid: { value: number };
    uCamMpc: { value: THREE.Vector3 };
    uScale: { value: number };
    uPxPerRad: { value: number };
    uGain: { value: number };
    uOpacity: { value: number };
    uHandover: { value: THREE.Vector2 };
    uNearFade: { value: THREE.Vector2 };
  };

  constructor(map: THREE.Texture | null, grid: number) {
    super({
      uniforms: {
        uMap: { value: map },
        uGrid: { value: grid },
        uCamMpc: { value: new THREE.Vector3() },
        uScale: { value: 1 },
        uPxPerRad: { value: 1000 },
        uGain: { value: 1 },
        uOpacity: { value: 1 },
        uHandover: { value: new THREE.Vector2(40, 90) },
        uNearFade: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: /* glsl */ `
        ${VERTEX_PRELUDE}
        attribute vec3 iCenter;   // Mpc from the Solar System
        attribute vec3 iAxisA;    // half-extent vectors, Mpc
        attribute vec3 iAxisB;
        attribute vec4 iParams;   // atlas slot, fov (rad, full width), gain, cos(inclination)
        attribute float iMode;
        uniform vec3 uCamMpc;
        uniform float uScale, uPxPerRad, uOpacity;
        uniform vec2 uHandover, uNearFade;
        varying vec3 vP;          // point, Mpc from the Solar System
        varying vec3 vView;       // camera → point direction (unnormalised)
        varying vec2 vLocal;
        varying float vFade;
        flat varying vec3 vC;
        flat varying vec3 vE;
        flat varying vec3 vN;
        flat varying vec3 vNormal;
        flat varying vec4 vParams;
        flat varying float vMode;
        void main() {
          vec3 c = normalize(iCenter);
          vec3 e = normalize(cross(vec3(0.0, 0.0, 1.0), c));
          vec3 n = cross(c, e);
          vec3 toC = iCenter - uCamMpc;
          float dC = max(length(toC), 1e-9);
          vec3 p;
          vec3 nrm = normalize(cross(iAxisA, iAxisB));
          if (iMode > 0.5 && iMode < 1.5) {
            // View-facing ellipse: the sky east/north axes made perpendicular to the view direction.
            vec3 w = toC / dC;
            vec3 r = normalize(e - dot(e, w) * w);
            vec3 u = cross(w, r);
            p = iCenter + (position.x * length(iAxisA)) * r + (position.y * length(iAxisB)) * u;
            nrm = w;
          } else {
            p = iCenter + position.x * iAxisA + position.y * iAxisB;
          }
          float theta = 2.0 * length(iAxisA) / dC * uPxPerRad;
          float near = uNearFade.y > 0.0 ? smoothstep(uNearFade.x, uNearFade.y, dC) : 1.0;
          vFade = smoothstep(uHandover.x * 0.6, uHandover.y * 0.8, theta) * uOpacity * near;
          vP = p; vView = p - uCamMpc; vLocal = position.xy;
          vC = c; vE = e; vN = n; vNormal = nrm; vParams = iParams; vMode = iMode;
          vec4 mv = viewMatrix * vec4((p - uCamMpc) * uScale, 1.0);
          gl_Position = projectionMatrix * mv;
          if (vFade < 1e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          ${LOGDEPTH_VERTEX}
        }`,
      fragmentShader: /* glsl */ `
        ${FRAGMENT_PRELUDE}
        uniform sampler2D uMap;
        uniform float uGrid, uGain;
        varying vec3 vP;
        varying vec3 vView;
        varying vec2 vLocal;
        varying float vFade;
        flat varying vec3 vC;
        flat varying vec3 vE;
        flat varying vec3 vN;
        flat varying vec3 vNormal;
        flat varying vec4 vParams;
        flat varying float vMode;
        void main() {
          ${LOGDEPTH_FRAGMENT}
          vec2 uv;
          float boost = 1.0;
          if (vMode > 1.5) {
            uv = vLocal * 0.5 + 0.5;
            boost = 1.0 / max(abs(dot(vNormal, normalize(vView))), 0.25);
          } else if (vMode > 0.5) {
            float k = 1.0;
            uv = vec2(0.5 - vLocal.x * 0.5 * k, 0.5 + vLocal.y * 0.5 * k);
          } else {
            float z = dot(vP, vC);
            vec2 tan_ = vec2(dot(vP, vE), dot(vP, vN)) / z;           // gnomonic (TAN) sky coordinates, rad
            uv = vec2(0.5 - tan_.x / vParams.y, 0.5 + tan_.y / vParams.y);
            boost = vParams.w / max(abs(dot(vNormal, normalize(vView))), 0.2);
          }
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
          if (uGrid > 1.5) {
            float slot = vParams.x;
            float gx = mod(slot, uGrid), gy = floor(slot / uGrid);
            vec2 inset = clamp(uv, vec2(0.004), vec2(0.996));
            uv = vec2((gx + inset.x) / uGrid, 1.0 - (gy + 1.0 - inset.y) / uGrid);
          }
          vec3 col = texture2D(uMap, uv).rgb;
          float edge = 1.0 - smoothstep(0.86, 1.0, max(abs(vLocal.x), abs(vLocal.y)));
          gl_FragColor = vec4(col * uGain * vParams.z * boost * vFade * edge, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }
}

/** Instanced unit quad (−1..1) for impostors. */
export function createImpostorGeometry(count: number): THREE.InstancedBufferGeometry & {
  attrs: { center: Float32Array; axisA: Float32Array; axisB: Float32Array; params: Float32Array; mode: Float32Array };
} {
  const g = new THREE.InstancedBufferGeometry() as THREE.InstancedBufferGeometry & {
    attrs: { center: Float32Array; axisA: Float32Array; axisB: Float32Array; params: Float32Array; mode: Float32Array };
  };
  const quad = new THREE.PlaneGeometry(2, 2, 1, 1);
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  quad.dispose();
  const center = new Float32Array(count * 3), axisA = new Float32Array(count * 3), axisB = new Float32Array(count * 3);
  const params = new Float32Array(count * 4), mode = new Float32Array(count);
  g.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
  g.setAttribute('iAxisA', new THREE.InstancedBufferAttribute(axisA, 3));
  g.setAttribute('iAxisB', new THREE.InstancedBufferAttribute(axisB, 3));
  g.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 4));
  g.setAttribute('iMode', new THREE.InstancedBufferAttribute(mode, 1));
  g.instanceCount = count;
  g.attrs = { center, axisA, axisB, params, mode };
  return g;
}
