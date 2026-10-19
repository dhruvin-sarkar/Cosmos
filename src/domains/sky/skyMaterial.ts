/**
 * Sky backdrop at infinity (copy-and-extend of src/render/skySphere.ts): one full-screen triangle, each pixel's view
 * ray → (RA, Dec) → the equirectangular ICRS map (u = RA/360°, v = (Dec+90°)/180°, flipY-style orientation), with
 * seam-free analytic gradients at RA = 0h. Extension: two maps with their own exposures cross-fade, and a global
 * fade (distance validity). Output is scene-linear HDR (no clamping, no tone mapping).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_FRAGMENT_AT_INFINITY, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
uniform mat4 uInvProjection;
uniform mat3 uCameraRotation;
varying vec3 vDir;
void main() {
  vec4 view = uInvProjection * vec4(position.xy, -1.0, 1.0);
  vDir = uCameraRotation * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform float uWeightA;
uniform float uWeightB;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float ra = atan(d.y, d.x);
  float dec = asin(clamp(d.z, -1.0, 1.0));
  float u = ra * RECIPROCAL_PI2;
  vec2 uv = vec2(fract(u), dec * RECIPROCAL_PI + 0.5);
  float du1 = fwidth(fract(u));
  float du2 = fwidth(u);
  vec2 dx = vec2(du1 < du2 ? dFdx(fract(u)) : dFdx(u), dFdx(uv.y));
  vec2 dy = vec2(du1 < du2 ? dFdy(fract(u)) : dFdy(u), dFdy(uv.y));
  vec3 c = vec3(0.0);
  if (uWeightA > 0.0) c += textureGrad(uMapA, uv, dx, dy).rgb * uWeightA;
  if (uWeightB > 0.0) c += textureGrad(uMapB, uv, dx, dy).rgb * uWeightB;
  gl_FragColor = vec4(c, 1.0);
  ${LOGDEPTH_FRAGMENT}
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
}
`;

export class SkyBackdropMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uMapA: { value: THREE.Texture | null };
    uMapB: { value: THREE.Texture | null };
    uWeightA: { value: number };
    uWeightB: { value: number };
    uInvProjection: { value: THREE.Matrix4 };
    uCameraRotation: { value: THREE.Matrix3 };
  };
  constructor() {
    super({
      uniforms: {
        uMapA: { value: null },
        uMapB: { value: null },
        uWeightA: { value: 0 },
        uWeightB: { value: 0 },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraRotation: { value: new THREE.Matrix3() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
  }
}

let triangle: THREE.BufferGeometry | null = null;
export function fullScreenTriangle(): THREE.BufferGeometry {
  if (!triangle) {
    triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  }
  return triangle;
}

/** Full-screen-triangle mesh that refreshes the camera uniforms before it draws. */
export function makeSkyQuad<M extends THREE.ShaderMaterial & { uniforms: { uInvProjection: { value: THREE.Matrix4 }; uCameraRotation: { value: THREE.Matrix3 } } }>(
  material: M,
  renderOrder: number,
): THREE.Mesh<THREE.BufferGeometry, M> {
  const mesh = new THREE.Mesh(fullScreenTriangle(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.onBeforeRender = (_r, _s, camera) => {
    material.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    material.uniforms.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
  };
  return mesh;
}
