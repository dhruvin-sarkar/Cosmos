/**
 * Constellations: Stellarium "modern IAU" figure lines drawn between the 3-D catalogue positions of their HIP
 * stars (so the figures distort as you leave the Sun — from 30 pc Orion is no longer Orion), the IAU boundaries
 * (VI/49; a construct of the sky as seen from Earth, drawn at infinity and faded out beyond ~0.3 pc), and
 * constellation names (Atlas italic via the label manager's 'constellation' kind).
 *
 * Lines are 1-device-pixel hairlines in ink at ~20 % (VISUAL_DIRECTION "Line and mark language"), pre-inverted
 * through AgX and divided by the live exposure so they stay on token. Each segment is shortened by a few pixels at
 * both ends so the line never runs through the star's PSF. Overlays: 'constellations', 'constellation-boundaries'.
 */
import * as THREE from 'three';
import { POST_EXPOSURE_UNIFORM } from '../../core/post';
import type { EngineServices, FrameContext, LabelCandidate, Layer, ScreenPoint } from '../../core/types';
import { PC_M } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_FRAGMENT_AT_INFINITY, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { OVERLAY_TOKENS, sceneLinearForOklch } from '../../render/tonemap';
import type { StarCatalog, StarDetails } from './catalog';
import type { StarsRuntime } from './runtime';

const DEG = Math.PI / 180;
const MAX_RENDER_DEPTH = 2e14;
const CATALOG_MAX_PC = 1100;
const LINE_OPACITY = 0.13;
const BOUNDARY_OPACITY = 0.07;
const GAP_PX = 5;

const LINE_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aOther;
uniform float uDepthScale;
uniform vec2 uViewport;
uniform float uGapPx;
varying float vAlpha;
void main() {
  vec3 a = (modelViewMatrix * vec4(position, 1.0)).xyz * uDepthScale;
  vec3 b = (modelViewMatrix * vec4(aOther, 1.0)).xyz * uDepthScale;
  vec4 ca = projectionMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * vec4(b, 1.0);
  // Segments that cross behind the camera, or span a huge angle (a star right beside the camera), are noise
  // rather than figure: fade them so the distorted figures far from the Sun stay readable.
  float cosAng = dot(normalize(a), normalize(b));
  vAlpha = (ca.w > 0.0 && cb.w > 0.0) ? smoothstep(0.5, 0.82, cosAng) : 0.0;
  if (vAlpha > 0.0) {
    vec2 sa = ca.xy / ca.w * 0.5 * uViewport;
    vec2 sb = cb.xy / cb.w * 0.5 * uViewport;
    vec2 d = sb - sa;
    float len = length(d);
    if (len < 2.0 * uGapPx + 2.0) vAlpha = 0.0;
    else ca.xy += (d / len) * uGapPx * 2.0 / uViewport * ca.w;
  }
  gl_Position = ca;
  ${LOGDEPTH_VERTEX}
}`;

const LINE_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uExposure;
varying float vAlpha;
void main() {
  if (vAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor * (uOpacity * vAlpha) / max(uExposure, 1e-4), 1.0);
  ${LOGDEPTH_FRAGMENT}
}`;

const SKY_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
void main() {
  vec3 dir = normalize(mat3(modelViewMatrix) * position);
  gl_Position = projectionMatrix * vec4(dir, 1.0);
  gl_Position.z = gl_Position.w;
  ${LOGDEPTH_VERTEX}
}`;

const SKY_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uExposure;
void main() {
  gl_FragColor = vec4(uColor * uOpacity / max(uExposure, 1e-4), 1.0);
  ${LOGDEPTH_FRAGMENT}
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
}`;

interface ConstellationLabel {
  abbr: string;
  name: string;
  /** Anchor, metres from the Sun. */
  world: THREE.Vector3;
}

function dirFromRaDec(raDeg: number, decDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}

export interface ConstellationsLayerDebug {
  segments: number;
  labels: number;
}

export function createConstellationsLayer(rt: StarsRuntime): Layer & { debug: ConstellationsLayerDebug } {
  const ink = OVERLAY_TOKENS.ink;
  const inkLinear = sceneLinearForOklch(ink[0], ink[1], ink[2], 1);
  const color = new THREE.Vector3(inkLinear.r, inkLinear.g, inkLinear.b);
  const lineMat = new THREE.ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: {
      uDepthScale: { value: 1 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uGapPx: { value: GAP_PX },
      uColor: { value: color },
      uOpacity: { value: 0 },
      uExposure: POST_EXPOSURE_UNIFORM,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: { uColor: { value: color }, uOpacity: { value: 0 }, uExposure: POST_EXPOSURE_UNIFORM },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  let lines: THREE.LineSegments | null = null;
  let bounds: THREE.LineSegments | null = null;
  const labels: ConstellationLabel[] = [];
  const pool: LabelCandidate[] = [];
  const screen: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  let lineFade = 0;
  let boundFade = 0;
  const debug: ConstellationsLayerDebug = { segments: 0, labels: 0 };
  let ready = false;

  function build(svc: EngineServices, cat: StarCatalog, d: StarDetails): void {
    const pos: number[] = [];
    const other: number[] = [];
    const p = cat.positionsM;
    const tmp = new THREE.Vector3();
    for (const k of d.constellations) {
      const dists: number[] = [];
      for (const [ha, hb] of k.lines) {
        const ia = d.hipToIndex.get(ha), ib = d.hipToIndex.get(hb);
        if (ia === undefined || ib === undefined) continue;
        const ax = p[3 * ia] / PC_M, ay = p[3 * ia + 1] / PC_M, az = p[3 * ia + 2] / PC_M;
        const bx = p[3 * ib] / PC_M, by = p[3 * ib + 1] / PC_M, bz = p[3 * ib + 2] / PC_M;
        pos.push(ax, ay, az, bx, by, bz);
        other.push(bx, by, bz, ax, ay, az);
        dists.push(cat.distPc[ia], cat.distPc[ib]);
      }
      dists.sort((a, b) => a - b);
      const med = dists.length ? dists[dists.length >> 1] : 100;
      dirFromRaDec(k.labelRaDeg, k.labelDecDeg, tmp);
      labels.push({ abbr: k.abbr, name: k.name, world: tmp.clone().multiplyScalar(med * PC_M) });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aOther', new THREE.BufferAttribute(new Float32Array(other), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CATALOG_MAX_PC);
    lines = new THREE.LineSegments(g, lineMat);
    lines.frustumCulled = false;
    lines.name = 'stars:constellation-lines';
    lines.visible = false;
    debug.segments = pos.length / 6;

    const bpos: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const k of d.constellations) {
      for (const ring of k.rings) {
        for (let i = 0; i < ring.length; i++) {
          const v0 = ring[i], v1 = ring[(i + 1) % ring.length];
          dirFromRaDec(v0[0], v0[1], a);
          dirFromRaDec(v1[0], v1[1], b);
          bpos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bpos), 3));
    bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    bounds = new THREE.LineSegments(bg, skyMat);
    bounds.frustumCulled = false;
    bounds.name = 'stars:constellation-boundaries';
    bounds.visible = false;
    svc.groups.overlay.add(lines, bounds);
    debug.labels = labels.length;
    ready = true;
  }

  const smooth = THREE.MathUtils.smoothstep;
  const approach = (cur: number, target: number, dt: number): number => cur + (target - cur) * Math.min(1, dt / 0.25);

  return {
    id: 'stars-constellations',
    debug,
    init(svc: EngineServices): void {
      // Resolve immediately (the layer becomes active); geometry appears when the detail tables land.
      void rt.loadDetails(svc.assets).then((d) => {
        if (rt.catalog) build(svc, rt.catalog, d);
      });
    },

    update(ctx: FrameContext): void {
      if (!ready || !lines || !bounds) return;
      const scaleFade = 1 - smooth(ctx.scaleLog10, 20, 21);
      const camPc = ctx.cameraPosition.length() / PC_M;
      lineFade = approach(lineFade, ctx.overlays.constellations ? scaleFade : 0, ctx.dtRealSec);
      // Boundaries are defined on Earth's sky: fade out once the view from the Sun no longer applies.
      boundFade = approach(boundFade, ctx.overlays['constellation-boundaries'] ? 1 - smooth(camPc, 0.05, 0.3) : 0, ctx.dtRealSec);
      lines.visible = lineFade > 0.002;
      bounds.visible = boundFade > 0.002;
      if (lines.visible) {
        const farM = ctx.cameraPosition.length() + CATALOG_MAX_PC * PC_M;
        lineMat.uniforms.uDepthScale.value = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / farM);
        (lineMat.uniforms.uViewport.value as THREE.Vector2).set(ctx.viewport.width, ctx.viewport.height);
        lineMat.uniforms.uOpacity.value = LINE_OPACITY * lineFade;
        // Catalogue origin (the Sun, ≈ SSB) in render space; vertices are in parsecs.
        lines.position.set(-ctx.cameraPosition.x, -ctx.cameraPosition.y, -ctx.cameraPosition.z).divideScalar(ctx.metersPerUnit);
        lines.scale.setScalar(PC_M / ctx.metersPerUnit);
      }
      if (bounds.visible) skyMat.uniforms.uOpacity.value = BOUNDARY_OPACITY * boundFade;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ready || lineFade < 0.05) return;
      let used = 0;
      for (const l of labels) {
        ctx.project(l.world, screen);
        if (!screen.visible) continue;
        let c = pool[used];
        if (!c) {
          c = { entityId: null, text: '', x: 0, y: 0, priority: 0, kind: 'constellation' };
          pool[used] = c;
        }
        used++;
        c.entityId = `const:${l.abbr}`;
        c.text = l.name;
        c.x = screen.x;
        c.y = screen.y;
        c.priority = 24;
        c.opacity = lineFade;
        out.push(c);
      }
    },

    dispose(): void {
      lines?.removeFromParent();
      bounds?.removeFromParent();
      lines?.geometry.dispose();
      bounds?.geometry.dispose();
      lineMat.dispose();
      skyMat.dispose();
    },
  };
}
