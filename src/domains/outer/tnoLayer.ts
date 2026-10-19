/**
 * Trans-Neptunian object cloud: every catalogued TNO (≈ 7,300, SBDB / Minor Planet Center orbits) propagated on the GPU from its
 * osculating elements (render-kit kepler solver) and coloured by dynamical class — cold/hot classical belt, plutinos (3:2),
 * twotinos (2:1), other resonances, scattered disk, detached. The ~45 named objects that no other domain draws get brighter
 * markers, labels and picking; named objects owned by other domains (Pluto, Eris, Haumea, Makemake, Sedna, Arrokoth) are left to them.
 * Positions are float32 relative to the Sun's centre; the cloud object is placed with ctx.toRender(sun).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer, LabelCandidate, PickHit } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { KEPLER_GLSL } from '../../render/glsl/kepler';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { heliocentricIcrsM, jdTdbFromMs } from '../smallbodies/orbits';
import { LINKED_TNOS, cleanName, loadTnos, newElements, tnoElements, tnoEntityId, type NamedTno, type TnoData } from './data';
import { TNO_CLASSES, TNO_CLASS_COLOR } from './model';
import { sunSource } from './sources';

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
${KEPLER_GLSL}
attribute vec4 aEl0;   // a [au], e, inc [rad], node [rad]
attribute vec4 aEl1;   // argPeri [rad], M0 [rad], epoch offset [d], H
attribute float aClass;
uniform float uDays;
uniform mat3 uEclToIcrs;
uniform float uUnitsPerAu;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uSize;
uniform float uGain;
uniform vec3 uPalette[8];
varying vec3 vColor;

void main() {
  float a = aEl0.x;
  float n = 0.01720209895 / (a * sqrt(a));
  float M = keplerMeanAnomaly(aEl1.y, n, uDays - aEl1.z);
  vec3 p = keplerPosition(a, aEl0.y, aEl0.z, aEl0.w, aEl1.x, M);
  vec4 mv = modelViewMatrix * vec4(uEclToIcrs * p * uUnitsPerAu, 1.0);
  gl_Position = projectionMatrix * mv;
  float bright = clamp((9.0 - aEl1.w) * 0.22, 0.0, 1.0); // H ≈ 4 (bright dwarf planets) → 1, H ≥ 9 → 0
  gl_PointSize = (uSize + 2.2 * bright) * uPixelRatio;
  vColor = uPalette[int(aClass)] * (0.34 + 0.66 * bright) * uGain * uOpacity;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 3.0) * step(r2, 1.0);
  gl_FragColor = vec4(vColor * a, a);
}`;

const ECL_TO_ICRS = new THREE.Matrix3();
{
  const eps = 23.4392911 * DEG;
  const c = Math.cos(eps), s = Math.sin(eps);
  ECL_TO_ICRS.set(1, 0, 0, 0, c, -s, 0, s, c);
}

function paletteUniform(): THREE.Vector3[] {
  return TNO_CLASSES.map((c) => new THREE.Vector3(...TNO_CLASS_COLOR[c]));
}

function makeMaterial(size: number, gain: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uDays: { value: 0 },
      uEclToIcrs: { value: ECL_TO_ICRS },
      uUnitsPerAu: { value: 1 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 0 },
      uSize: { value: size },
      uGain: { value: gain },
      uPalette: { value: paletteUniform() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

function buildGeometry(f: Float32Array, rows: ArrayLike<number>, stride: number, epochBase: number): THREE.BufferGeometry {
  const count = rows.length;
  const el0 = new Float32Array(count * 4);
  const el1 = new Float32Array(count * 4);
  const cls = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const o = rows[k] * stride;
    el0[4 * k] = f[o];
    el0[4 * k + 1] = Math.min(f[o + 1], 0.97);
    el0[4 * k + 2] = f[o + 2] * DEG;
    el0[4 * k + 3] = f[o + 3] * DEG;
    el1[4 * k] = f[o + 4] * DEG;
    el1[4 * k + 1] = f[o + 5] * DEG;
    el1[4 * k + 2] = f[o + 6];
    el1[4 * k + 3] = f[o + 7];
    cls[k] = f[o + 8];
  }
  void epochBase;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aEl0', new THREE.BufferAttribute(el0, 4));
  g.setAttribute('aEl1', new THREE.BufferAttribute(el1, 4));
  g.setAttribute('aClass', new THREE.BufferAttribute(cls, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

export interface TnoLayer extends Layer {
  /** Number of TNOs drawn (0 until the catalogue arrives). */
  readonly drawn: number;
}

export function createTnoLayer(registry: Pick<EntityRegistry, 'get'>): TnoLayer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const el = newElements();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let data: TnoData | null = null;
  let cloud: THREE.Points | null = null;
  let named: THREE.Points | null = null;
  let cloudMat: THREE.ShaderMaterial | null = null;
  let namedMat: THREE.ShaderMaterial | null = null;
  let markers: NamedTno[] = [];
  let namedWorld: THREE.Vector3[] = [];
  let namedFrame = -1;
  let opacity = 0;
  let disposed = false;

  const refreshNamed = (ctx: FrameContext): void => {
    if (!data || namedFrame === ctx.frame) return;
    namedFrame = ctx.frame;
    sun(ctx.timeMs, sunWorld);
    const jd = jdTdbFromMs(ctx.timeMs);
    for (let k = 0; k < markers.length; k++) {
      tnoElements(data, markers[k].i, el);
      heliocentricIcrsM(el, jd, namedWorld[k]).add(sunWorld);
    }
  };

  const layer: TnoLayer = {
    id: 'outer-tnos',
    get drawn() { return data?.count ?? 0; },

    async init(svc: EngineServices): Promise<void> {
      const d = await loadTnos();
      if (disposed) return;
      data = d;
      const stride = d.header.stride;
      const all = Array.from({ length: d.count }, (_v, i) => i);
      cloudMat = makeMaterial(1.9, 1.2);
      cloud = new THREE.Points(buildGeometry(d.f, all, stride, d.header.epochBaseJD), cloudMat);
      cloud.name = 'outer-tno-cloud';
      cloud.frustumCulled = false;
      cloud.visible = false;
      cloud.renderOrder = 2;
      svc.groups.far.add(cloud);

      markers = d.header.named.filter((n) => !(cleanName(n.name).toLowerCase() in LINKED_TNOS));
      namedWorld = markers.map(() => new THREE.Vector3());
      namedMat = makeMaterial(4.2, 1.5);
      named = new THREE.Points(buildGeometry(d.f, markers.map((n) => n.i), stride, d.header.epochBaseJD), namedMat);
      named.name = 'outer-tno-named';
      named.frustumCulled = false;
      named.visible = false;
      named.renderOrder = 3;
      svc.groups.far.add(named);
    },

    update(ctx: FrameContext): void {
      if (!cloud || !data) return;
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      const near = THREE.MathUtils.smoothstep(dSunAu, 15, 45);
      const far = 1 - THREE.MathUtils.smoothstep(dSunAu, 4000, 30000);
      const focusOuter = ctx.focusEntityId?.startsWith('outer:') === true || ctx.selectedId?.startsWith('outer:') === true;
      const target = Math.max(near, focusOuter ? 0.9 : 0) * far;
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 5);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      const show = opacity > 0.003;
      cloud.visible = show;
      if (named) named.visible = show;
      if (!show) return;
      const jd = jdTdbFromMs(ctx.timeMs) - data.header.epochBaseJD;
      const draw = Math.min(data.count, Math.max(1500, Math.floor(ctx.quality.particleBudget * 0.5)));
      cloud.geometry.setDrawRange(0, draw);
      const unitsPerAu = AU_M / ctx.metersPerUnit;
      ctx.toRender(sunWorld, cloud.position);
      for (const [pts, mat] of [[cloud, cloudMat], [named, namedMat]] as const) {
        if (!pts || !mat) continue;
        if (pts !== cloud) pts.position.copy(cloud.position);
        mat.uniforms.uDays.value = jd;
        mat.uniforms.uUnitsPerAu.value = unitsPerAu;
        mat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
        mat.uniforms.uOpacity.value = opacity;
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (!data || opacity < 0.4) return [];
      refreshNamed(ctx);
      let best: PickHit | null = null;
      for (let k = 0; k < markers.length; k++) {
        ctx.project(namedWorld[k], screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y);
        if (d > Math.min(radiusPx, 14)) continue;
        if (!best || d < best.distancePx) best = { entityId: tnoEntityId(markers[k].name), distancePx: d, depthM: screen.depthM, priority: 8 };
      }
      return best ? [best] : [];
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!data || !ctx.overlays.labels || opacity < 0.5) return;
      refreshNamed(ctx);
      const fieldM = Math.pow(10, ctx.scaleLog10);
      // Wide views label only the brightest few; closer in, all named objects in view compete via the label budget.
      // A planetary-system overview (no outer region focused) keeps only the brightest few, so the planets read first.
      const regionFocus = ctx.focusEntityId !== null && (ctx.focusEntityId.startsWith('outer:') || ctx.focusEntityId.startsWith('sb:'));
      const limit = regionFocus
        ? (fieldM > 3e14 ? 6 : fieldM > 8e13 ? 12 : fieldM > 2e13 ? 22 : markers.length)
        : (fieldM > 3e14 ? 4 : fieldM > 8e13 ? 8 : 6);
      for (let k = 0; k < Math.min(limit, markers.length); k++) {
        ctx.project(namedWorld[k], screen);
        if (!screen.visible) continue;
        out.push({
          entityId: tnoEntityId(markers[k].name),
          text: cleanName(markers[k].name),
          x: screen.x,
          y: screen.y,
          priority: 30 - Math.min(12, markers[k].H),
          kind: 'body',
          offsetPx: 8,
          opacity: Math.min(1, opacity),
        });
      }
    },

    dispose(): void {
      disposed = true;
      for (const o of [cloud, named]) {
        if (!o) continue;
        o.removeFromParent();
        o.geometry.dispose();
      }
      cloudMat?.dispose();
      namedMat?.dispose();
      cloud = null;
      named = null;
      void tmp;
    },
  };
  return layer;
}
