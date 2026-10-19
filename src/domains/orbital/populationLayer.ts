/**
 * Tracked orbital population: every catalogued object (CelesTrak GP + SATCAT shapes, ~35k) as one GPU point cloud.
 * Positions: SGP4 in the worker at a reference instant → perifocal elements → Kepler's equation in the vertex shader
 * at the current sim time (allocation-free; one 1.3 MB upload per refresh). Coloured subtly by class (payload /
 * rocket body / debris / unknown), dimmed in Earth's shadow, honest density. Overlays: 'satellites' (payloads) and
 * 'debris' (rocket bodies, debris, unknown). The cloud is positioned at Earth's entity and scaled by the satellite
 * offset factor (visual-scale contract).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer, PickHit, ScreenPoint } from '../../core/types';
import { POST_EXPOSURE_UNIFORM } from '../../core/post';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { CLASS_MASK, CLASS_PAYLOAD, FLAG_NO_ORBIT, FLAG_STARLINK } from './catalogTypes';
import { ELEMENT_STRIDE } from './kepler';
import type { Population } from './population';
import { R_EARTH_M, earthPosition, mapRel, orbitalScale, sunPosition, updateOrbitalScale } from './scene';

/** Camera distance from Earth (m) where the cloud starts / finishes fading out (beyond the Moon it is gone). */
const FADE_NEAR_M = 6e8;
const FADE_FAR_M = 2.5e9;

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aPa;
attribute vec3 aQb;
attribute vec3 aEMN;   // e, M0 (rad), n (rad/s)
attribute float aFlags;
uniform float uDt;
uniform vec3 uSunDir;      // world axes, from Earth
uniform float uEarthR;     // m
uniform vec4 uClassVis;    // payload, rocket body, debris, unknown (0..1)
uniform float uStarlink;   // highlight Starlink (0..1)
uniform float uPixelRatio;
uniform float uFade;
uniform float uExposure;
uniform float uEarthRr;   // Earth's drawn radius, render units (its centre is this object's origin; the camera is at render-space origin)
uniform vec3 uMap;       // visual scale: Earth factor f, core radius c (m), gap growth g
uniform float uLeoCrowd;  // 0..1 dimming of the LEO swarm when Earth is small on screen (no additive haze)
varying vec3 vColor;

float solveE(float M, float e) {
  float E = M + e * sin(M);
  for (int k = 0; k < 8; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}

void main() {
  float n = aEMN.z;
  int f = int(aFlags + 0.5);
  int cls = f & 3;
  float vis = cls == 0 ? uClassVis.x : cls == 1 ? uClassVis.y : cls == 2 ? uClassVis.z : uClassVis.w;
  if (n <= 0.0 || vis <= 0.0 || uFade <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  float e = aEMN.x;
  float M = mod(aEMN.y + n * uDt, 6.2831853);
  float E = solveE(M, e);
  vec3 p = aPa * (cos(E) - e) + aQb * sin(E); // metres from Earth's centre
  // Earth's cylindrical shadow (umbra ≈ cylinder at these distances).
  float along = dot(p, uSunDir);
  float perp = length(p - along * uSunDir);
  float lit = (along < 0.0 && perp < uEarthR) ? 0.16 : 1.0;
  bool isActive = (f & 4) != 0;
  bool starlink = (f & 8) != 0;
  vec3 c;
  float size;
  if (cls == 0) { c = isActive ? vec3(0.42, 0.78, 1.0) : vec3(0.5, 0.56, 0.68); size = isActive ? 2.3 : 2.0; }
  else if (cls == 1) { c = vec3(1.0, 0.6, 0.24); size = 2.2; }
  else if (cls == 2) { c = vec3(1.0, 0.36, 0.3); size = 1.8; }
  else { c = vec3(0.62, 0.62, 0.62); size = 1.8; }
  if (starlink && uStarlink > 0.0) { c = mix(c, vec3(0.75, 1.0, 0.85), uStarlink); size += uStarlink; lit = max(lit, 0.5 * uStarlink); }
  float leo = 1.0 - smoothstep(1.3, 1.6, length(p) / uEarthR);
  float crowd = mix(1.0, uLeoCrowd, leo);
  size *= mix(1.0, 0.8, leo * (1.0 - uLeoCrowd));
  vColor = c * (lit * vis * uFade * crowd * 0.9 / uExposure);
  // VISUAL SCALE (src/core/visualScale.ts mapSatelliteOffset): a' = f·min(a,c) + max(a−c,0)·g about Earth's drawn centre.
  float ra = length(p);
  vec3 pd = uMap.x > 1.0 && ra > 0.0 ? p * ((uMap.x * min(ra, uMap.y) + max(ra - uMap.y, 0.0) * uMap.z) / ra) : p;
  vec4 mv = modelViewMatrix * vec4(pd, 1.0);
  // In front of the sunlit disc a sub-pixel satellite has almost no contrast: dim it so the disc does not look speckled.
  vec3 ev = modelMatrix[3].xyz;
  vec3 wp = (modelMatrix * vec4(pd, 1.0)).xyz;
  float ed = length(ev);
  float md = length(wp);
  if (md < ed && ed > uEarthRr) {
    float cosSep = dot(wp, ev) / max(md * ed, 1e-30);
    float cosDisc = sqrt(max(1.0 - (uEarthRr * uEarthRr) / (ed * ed), 0.0));
    vColor *= mix(1.0, 0.3, smoothstep(cosDisc - 0.002, cosDisc + 0.002, cosSep));
  }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = 1.0 - smoothstep(0.35, 1.0, r2);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export interface PopulationLayerOptions {
  population: Population;
  /** NORAD → entity id overrides (notable satellites have hero entities). */
  heroIds: ReadonlyMap<number, string>;
  /** Highlight state (Starlink group selected). */
  highlight: { starlink: number };
}

export function createPopulationLayer(opts: PopulationLayerOptions): Layer & { readonly points: THREE.Points | null } {
  const { population: pop, heroIds, highlight } = opts;
  let svc: EngineServices | null = null;
  let points: THREE.Points | null = null;
  let geo: THREE.BufferGeometry | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  let ibuf: THREE.InterleavedBuffer | null = null;
  let uploaded = -1;
  /** GPU slot → catalog index: a fixed pseudo-random order so a draw-range prefix is a uniform subset. */
  let perm: Uint32Array = new Uint32Array(0);
  let fade = 0;
  let starlinkK = 0;
  const vis = new THREE.Vector4();
  const earthW = new THREE.Vector3();
  const sunW = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  // Pick cache: screen positions of all objects, refreshed at most every few frames.
  let pickFrame = -100;
  let pickXY: Float32Array = new Float32Array(0);
  let pickDepth: Float32Array = new Float32Array(0);
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  let lastTimeMs = 0;

  function build(): void {
    if (!svc || !pop.meta || points) return;
    const n = pop.meta.count;
    geo = new THREE.BufferGeometry();
    ibuf = new THREE.InterleavedBuffer(new Float32Array(n * ELEMENT_STRIDE), ELEMENT_STRIDE);
    ibuf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPa', new THREE.InterleavedBufferAttribute(ibuf, 3, 0));
    geo.setAttribute('aQb', new THREE.InterleavedBufferAttribute(ibuf, 3, 3));
    geo.setAttribute('aEMN', new THREE.InterleavedBufferAttribute(ibuf, 3, 6));
    perm = new Uint32Array(n);
    for (let i = 0; i < n; i++) perm[i] = i;
    let seed = 0x9e3779b9;
    for (let i = n - 1; i > 0; i--) {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      const j = seed % (i + 1);
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    const flags = new Float32Array(n);
    for (let i = 0; i < n; i++) flags[i] = pop.meta.flags[perm[i]];
    geo.setAttribute('aFlags', new THREE.BufferAttribute(flags, 1));
    // three.js needs a 'position' attribute for draw ranges; reuse aPa (the shader ignores it).
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ibuf, 3, 0));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDt: { value: 0 },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uEarthR: { value: R_EARTH_M },
        uClassVis: { value: vis },
        uStarlink: { value: 0 },
        uPixelRatio: { value: 1 },
        uFade: { value: 0 },
        uExposure: POST_EXPOSURE_UNIFORM,
        uLeoCrowd: { value: 1 },
        uMap: { value: new THREE.Vector3(1, R_EARTH_M, 1) },
        uEarthRr: { value: 1 },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
    });
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 2;
    svc.groups.far.add(points);
  }

  function smooth(cur: number, target: number, dt: number, rate = 4): number {
    return cur + (target - cur) * Math.min(1, dt * rate);
  }

  return {
    id: 'orbital-population',
    get points() { return points; },
    init(s) {
      svc = s;
      pop.onChange(build);
      build();
    },
    update(ctx: FrameContext) {
      lastTimeMs = ctx.timeMs;
      pop.update(ctx.timeMs, ctx.dtRealSec > 0 ? ctx.dtSimSec / ctx.dtRealSec : 0);
      if (!points || !mat || !ibuf || !geo) return;
      earthPosition(ctx.timeMs, earthW);
      updateOrbitalScale(ctx, svc?.store ?? null, earthW);
      const sat = ctx.overlays.satellites ? 1 : 0;
      const deb = ctx.overlays.debris ? 1 : 0;
      vis.set(smooth(vis.x, sat, ctx.dtRealSec), smooth(vis.y, deb, ctx.dtRealSec), smooth(vis.z, deb, ctx.dtRealSec), smooth(vis.w, deb, ctx.dtRealSec));
      starlinkK = smooth(starlinkK, highlight.starlink, ctx.dtRealSec, 3);
      const d = orbitalScale.earthDistM;
      const scaleFade = d <= FADE_NEAR_M ? 1 : d >= FADE_FAR_M ? 0 : 1 - Math.log(d / FADE_NEAR_M) / Math.log(FADE_FAR_M / FADE_NEAR_M);
      fade = scaleFade;
      const any = vis.x + vis.y + vis.z + vis.w > 0.003 || starlinkK > 0.003;
      if (!pop.elements || fade <= 0 || !any) {
        points.visible = false;
        return;
      }
      if (uploaded !== pop.version) {
        const dst = ibuf.array as Float32Array, src = pop.elements;
        for (let k = 0; k < perm.length; k++) {
          const a = k * ELEMENT_STRIDE, b = perm[k] * ELEMENT_STRIDE;
          for (let c = 0; c < ELEMENT_STRIDE; c++) dst[a + c] = src[b + c];
        }
        ibuf.needsUpdate = true;
        uploaded = pop.version;
      }
      points.visible = true;
      ctx.toRender(orbitalScale.earthDraw, points.position);
      points.scale.setScalar(1 / ctx.metersPerUnit);
      points.updateMatrix();
      const u = mat.uniforms;
      u.uDt.value = (ctx.timeMs - pop.t0Ms) / 1000;
      sunPosition(ctx.timeMs, sunW);
      (u.uSunDir.value as THREE.Vector3).subVectors(sunW, earthW).normalize();
      u.uPixelRatio.value = ctx.viewport.pixelRatio * ctx.quality.renderScale;
      u.uFade.value = fade;
      u.uEarthRr.value = (R_EARTH_M * orbitalScale.earthFactor) / ctx.metersPerUnit;
      (u.uMap.value as THREE.Vector3).set(orbitalScale.earthFactor, orbitalScale.core, orbitalScale.gap);
      const earthRadiusPx = ctx.pixelDiameter(R_EARTH_M * orbitalScale.earthFactor, d) / 2;
      u.uLeoCrowd.value = THREE.MathUtils.clamp(earthRadiusPx / 260, 0.12, 1);
      // When only the Starlink highlight is on, show just the payload class.
      if (vis.x < starlinkK) vis.x = starlinkK;
      u.uStarlink.value = starlinkK;
      // Budget: draw a prefix of the shuffled order (a uniform random subset) on weaker presets.
      geo.setDrawRange(0, Math.min(pop.count, Math.max(2000, ctx.quality.satelliteBudget || pop.count)));
    },
    pick(ctx, x, y, radiusPx): PickHit[] {
      if (!points?.visible || fade < 0.3 || !pop.meta || !pop.elements) return [];
      const n = pop.count;
      const flags = pop.meta.flags;
      if (pickXY.length !== 2 * n) { pickXY = new Float32Array(2 * n); pickDepth = new Float32Array(n); }
      if (ctx.frame - pickFrame > 3) {
        pickFrame = ctx.frame;
        for (let i = 0; i < n; i++) {
          pickDepth[i] = -1;
          const f = flags[i];
          if (f & FLAG_NO_ORBIT) continue;
          const cls = f & CLASS_MASK;
          if ((cls === CLASS_PAYLOAD ? vis.x : vis.y) < 0.5 && !(f & FLAG_STARLINK && starlinkK > 0.5)) continue;
          if (!pop.position(i, lastTimeMs, tmp)) continue;
          mapRel(tmp).add(orbitalScale.earthDraw);
          ctx.project(tmp, sp);
          if (!sp.visible) continue;
          pickXY[2 * i] = sp.x;
          pickXY[2 * i + 1] = sp.y;
          pickDepth[i] = sp.depthM;
        }
      }
      let best = -1;
      let bestD = radiusPx;
      for (let i = 0; i < n; i++) {
        if (pickDepth[i] < 0) continue;
        const dx = pickXY[2 * i] - x, dy = pickXY[2 * i + 1] - y;
        const dd = Math.hypot(dx, dy);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best < 0) return [];
      const norad = pop.meta.norad[best];
      return [{ entityId: heroIds.get(norad) ?? `sat:${norad}`, distancePx: bestD, depthM: pickDepth[best], priority: 4 }];
    },
    dispose() {
      if (points) svc?.groups.far.remove(points);
      geo?.dispose();
      mat?.dispose();
      points = null;
    },
  };
}
