/**
 * Named small bodies: lit procedural meshes (asteroids, comet nuclei, interstellar objects), ring markers while unresolved,
 * comet coma + tails, orbit lines (overlay 'orbits': all named; the focused/selected one always), labels and picking.
 * Any other sb:* entity that is focused or selected (a NEO picked from the cloud) is shown through one reusable "visitor" slot.
 * Lighting comes from the solar domain's helpers (single Sun, exposure-adaptive irradiance).
 */
import * as THREE from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { AU_M, DEG } from '../../core/units';
import { OrbitLine } from '../../render/orbitBuilder';
import { solarSceneIrradianceAt, sunDirectionAt } from '../solar/ephemeris';
import type { SmallBodyModel } from './bodies';
import { MODEL_BY_ENTITY_ID, diameterFromHKm } from './bodies';
import { cometActivity, CometSystem, type CometState } from './cometTail';
import { heliocentricVelocityIcrs, jdTdbFromMs, meanMotionRadPerDay, sampleOrbitIcrsM, type HelioElements } from './orbits';
import { buildSmallBodyGeometry, hashString } from './shape';
import { SmallBodyMaterial } from './smallBodyMaterial';
import { lookupNeoRow } from './neoProvider';
import { neoElements } from './neoApi';
import { sunSource } from './sources';

const MIN_MESH_PX = 0.8;
const MARKER_HIDE_PX = 14;
const ENLARGE_TARGET_PX = 9;
const MAX_ENLARGE = 2e6;

interface Visual {
  entity: Entity;
  model: SmallBodyModel;
  world: THREE.Vector3;
  distM: number;
  px: number;
  enlarge: number;
  mesh: THREE.Mesh | null;
  material: SmallBodyMaterial | null;
  orbit: OrbitLine | null;
  comet: CometSystem | null;
  active: boolean;
}

const MARKER_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec4 aColor;
uniform float uPixelRatio;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
  #include <logdepthbuf_vertex>
}`;

const MARKER_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float ring = smoothstep(0.62, 0.74, r) * (1.0 - smoothstep(0.86, 0.98, r));
  float dotc = 1.0 - smoothstep(0.08, 0.2, r);
  float a = max(ring, dotc * 0.9) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

const MAX_MARKERS = 40;

const MARKER_COLOR = {
  asteroid: [0.95, 0.85, 0.7],
  comet: [0.6, 0.82, 1.0],
  interstellar: [1.0, 0.72, 0.35],
} as const;

function colorKey(m: SmallBodyModel): keyof typeof MARKER_COLOR {
  return m.isInterstellar ? 'interstellar' : m.isComet ? 'comet' : 'asteroid';
}

/** Spin pole (unit, ICRS) — illustrative, deterministic per body (the real poles of most of these are not in the dataset). */
function spinAxis(id: string, out: THREE.Vector3): THREE.Vector3 {
  const h = hashString(id);
  const lon = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const lat = (((h >>> 16) / 0xffff) * 2 - 1) * 1.1;
  return out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).normalize();
}

export interface SmallBodiesLayer extends Layer {
  readonly visuals: readonly Visual[];
}

export function createSmallBodiesLayer(
  entities: readonly Entity[],
  models: readonly SmallBodyModel[],
  registry: Pick<EntityRegistry, 'get'>,
): SmallBodiesLayer {
  const sun = sunSource(registry);
  const visuals: Visual[] = [];
  const byEntity = new Map<string, Visual>();
  const sunWorld = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const m3 = new THREE.Matrix3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let svcRef: EngineServices | null = null;
  let markerPoints: THREE.Points | null = null;
  let markerGeo: THREE.BufferGeometry | null = null;
  let markerMat: THREE.ShaderMaterial | null = null;
  let markerPos: Float32Array;
  let markerSize: Float32Array;
  let markerColor: Float32Array;
  let visitor: Visual | null = null;
  let visitorId: string | null = null;
  let meshBudget = 0;
  const cometState: CometState = { head: tmp, antiSun: tmp2, velocityDir: vel, rAU: 1, size: 1, metersPerUnit: 1, pxPerRad: 1, insolation: 1, opacity: 1, cameraDistM: 1 };

  for (const e of entities) {
    const model = MODEL_BY_ENTITY_ID.get(e.id);
    if (!model) continue;
    const v: Visual = { entity: e, model, world: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1, mesh: null, material: null, orbit: null, comet: null, active: true };
    visuals.push(v);
    byEntity.set(e.id, v);
  }

  const ensureMesh = (v: Visual): void => {
    if (v.mesh || !svcRef) return;
    const m = v.model;
    const geo = buildSmallBodyGeometry({
      id: m.id,
      recipe: m.recipe,
      axes: m.axesM,
      craters: m.isComet ? 8 : undefined,
      lumpiness: m.isComet ? 0.04 : undefined,
    });
    v.material = new SmallBodyMaterial(m.surface, hashString(m.id));
    v.mesh = new THREE.Mesh(geo, v.material);
    v.mesh.name = v.entity.id;
    v.mesh.frustumCulled = false;
    svcRef.groups.main.add(v.mesh);
  };

  const ensureOrbit = (v: Visual): void => {
    if (v.orbit || !svcRef || !v.model.elements) return;
    const el = v.model.elements;
    const line = new OrbitLine({ role: 'minor', provenance: 'observed', maxVertices: 520 });
    line.material.side = THREE.DoubleSide;
    const s = sampleOrbitIcrsM(el, 512, 250);
    line.setPolyline(s.points, s.count, s.closed, s.fractions);
    line.visible = false;
    svcRef.groups.overlay.add(line);
    v.orbit = line;
  };

  const updateVisual = (v: Visual, ctx: FrameContext, sunPosReady: boolean): void => {
    void sunPosReady;
    v.entity.position(ctx.timeMs, v.world);
    v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
    v.px = ctx.pixelDiameter(v.model.meanRadiusM, v.distM);
    v.enlarge = ctx.overlays['enlarge-bodies'] && v.px < ENLARGE_TARGET_PX ? Math.min(ENLARGE_TARGET_PX / Math.max(v.px, 1e-9), MAX_ENLARGE) : 1;
    const shownPx = v.px * v.enlarge;
    const wantMesh = shownPx >= MIN_MESH_PX;
    if (wantMesh && !v.mesh && meshBudget > 0) {
      ensureMesh(v);
      meshBudget--;
    }
    if (v.mesh && v.material) {
      v.mesh.visible = wantMesh;
      if (wantMesh) {
        ctx.toRender(v.world, v.mesh.position);
        v.mesh.scale.setScalar((v.model.meanRadiusM * v.enlarge) / ctx.metersPerUnit);
        // Spin: illustrative pole, true period when known.
        const periodH = v.model.spinPeriodH ?? 12;
        const hoursSinceJ2000 = (ctx.timeMs - 946728000000) / 3.6e6;
        const phase = (((hoursSinceJ2000 / periodH) % 1) + 1) % 1;
        spinAxis(v.model.id, axis);
        quat.setFromAxisAngle(axis, phase * Math.PI * 2);
        v.mesh.quaternion.copy(quat);
        m4.makeRotationFromQuaternion(quat);
        v.material.uniforms.uObjToWorld.value.setFromMatrix4(m4);
        sunDirectionAt(v.world, ctx.timeMs, sunDir);
        v.material.uniforms.uSunDir.value.copy(sunDir);
        v.material.uniforms.uIrradiance.value = solarSceneIrradianceAt(v.world, ctx.timeMs);
      }
    }
    // Comet coma and tails.
    if (v.model.isComet && v.model.elements) {
      const rAU = tmp.subVectors(v.world, sunWorld).length() / AU_M;
      if (!v.comet && cometActivity(rAU) * v.model.activity > 0.012 && svcRef) {
        v.comet = new CometSystem(hashString(v.model.id));
        svcRef.groups.transparent.add(v.comet.group);
      }
      if (v.comet) {
        tmp2.copy(tmp).normalize(); // Sun → comet
        heliocentricVelocityIcrs(v.model.elements, jdTdbFromMs(ctx.timeMs), vel).normalize();
        ctx.toRender(v.world, tmp);
        const irr = solarSceneIrradianceAt(v.world, ctx.timeMs) / 5;
        // Fade the whole system when the camera is so close to the nucleus that the sprites would fill the view.
        const near = THREE.MathUtils.smoothstep(v.distM, v.model.meanRadiusM * 3, v.model.meanRadiusM * 40);
        cometState.head = tmp;
        cometState.antiSun = tmp2;
        cometState.velocityDir = vel;
        cometState.rAU = rAU;
        cometState.size = v.model.activity;
        cometState.metersPerUnit = ctx.metersPerUnit;
        cometState.pxPerRad = ctx.pixelsPerRadian;
        cometState.insolation = irr;
        cometState.opacity = Math.max(0.15, near);
        cometState.cameraDistM = v.distM;
        v.comet.update(cometState, ctx.viewport.height);
      }
    }
  };

  const updateOrbit = (v: Visual, ctx: FrameContext, focusedLike: boolean): void => {
    const want = focusedLike || (ctx.overlays.orbits && !v.model.id.startsWith('dimorphos'));
    if (!want) {
      if (v.orbit) v.orbit.visible = false;
      return;
    }
    ensureOrbit(v);
    const line = v.orbit;
    if (!line) return;
    // Hide the big heliocentric ellipses when the camera is inside a close-up of anything tiny.
    const dSun = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
    // Unfocused heliocentric ellipses also fade out at planet-scale views (stray straight strokes across the frame).
    const fade = focusedLike ? 1 : THREE.MathUtils.smoothstep(Math.pow(10, ctx.scaleLog10), 3e9, 3e10);
    const show = focusedLike || (dSun > 0.25 && dSun < 2500 && fade > 0.003);
    line.visible = show;
    if (!show) return;
    line.material.role = focusedLike ? 'focused' : 'minor';
    line.material.setFade(fade);
    line.parentPositionM.copy(sunWorld);
    const el = v.model.elements!;
    if (el.e < 1) {
      const M = el.meanAnomalyDeg * DEG + meanMotionRadPerDay(el.aAU) * (jdTdbFromMs(ctx.timeMs) - el.epochJD);
      line.setHead((((M / (2 * Math.PI)) % 1) + 1) % 1, 0.22);
    } else {
      line.setHead(-1);
    }
    line.update(ctx);
  };

  const makeVisitor = (id: string): Visual | null => {
    const entity = registry.get(id);
    const row = lookupNeoRow(id);
    if (!entity || !row) return null;
    const dKm = row.diameterKm ?? row.diameterEstKm ?? diameterFromHKm(row.H ?? 22);
    const r = (dKm * 1000) / 2;
    const el: HelioElements = neoElements(row);
    const model: SmallBodyModel = {
      id: id.slice(3),
      entityId: id,
      record: null as never,
      editorial: null as never,
      axesM: [r * 1.25, r * 0.95, r * 0.78],
      meanRadiusM: r,
      sizeFromH: row.diameterKm === null,
      recipe: 'shard',
      surface: (row.albedo ?? 0.14) < 0.09 ? 'C' : 'S',
      isComet: false,
      isInterstellar: false,
      spinPeriodH: row.rotationPeriodH,
      elements: el,
      activity: 0,
    };
    return { entity, model, world: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1, mesh: null, material: null, orbit: null, comet: null, active: true };
  };

  const disposeVisual = (v: Visual): void => {
    if (v.mesh) {
      v.mesh.removeFromParent();
      v.mesh.geometry.dispose();
    }
    v.material?.dispose();
    v.orbit?.removeFromParent();
    v.orbit?.dispose();
    v.comet?.dispose();
  };

  return {
    id: 'small-bodies',
    visuals,

    init(svc: EngineServices): void {
      svcRef = svc;
      markerPos = new Float32Array(MAX_MARKERS * 3);
      markerSize = new Float32Array(MAX_MARKERS);
      markerColor = new Float32Array(MAX_MARKERS * 4);
      markerGeo = new THREE.BufferGeometry();
      markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPos, 3).setUsage(THREE.DynamicDrawUsage));
      markerGeo.setAttribute('aSize', new THREE.BufferAttribute(markerSize, 1).setUsage(THREE.DynamicDrawUsage));
      markerGeo.setAttribute('aColor', new THREE.BufferAttribute(markerColor, 4).setUsage(THREE.DynamicDrawUsage));
      markerGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
      markerMat = new THREE.ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      markerPoints = new THREE.Points(markerGeo, markerMat);
      markerPoints.frustumCulled = false;
      markerPoints.name = 'small-body-markers';
      svc.groups.overlay.add(markerPoints);
    },

    update(ctx: FrameContext): void {
      sun(ctx.timeMs, sunWorld);
      meshBudget = 1;
      // Visitor slot: a focused/selected sb:* entity that has no hand-built visual (e.g. a NEO picked from the cloud).
      const isVisitorId = (id: string | null): id is string => id !== null && id.startsWith('sb:') && !byEntity.has(id);
      const want = isVisitorId(ctx.selectedId) ? ctx.selectedId : isVisitorId(ctx.focusEntityId) ? ctx.focusEntityId : null;
      if (want !== visitorId) {
        if (visitor) disposeVisual(visitor);
        visitor = want ? makeVisitor(want) : null;
        visitorId = want;
      }
      let nm = 0;
      for (let vi = 0; vi <= visuals.length; vi++) {
        const v = vi < visuals.length ? visuals[vi] : visitor;
        if (!v) continue;
        updateVisual(v, ctx, true);
        const focusedLike = v.entity.id === ctx.selectedId || v.entity.id === ctx.focusEntityId;
        updateOrbit(v, ctx, focusedLike);
        // Marker while the body is unresolved.
        const shownPx = v.px * v.enlarge;
        if (nm < MAX_MARKERS) {
          ctx.toRender(v.world, tmp);
          markerPos[3 * nm] = tmp.x;
          markerPos[3 * nm + 1] = tmp.y;
          markerPos[3 * nm + 2] = tmp.z;
          const fade = 1 - THREE.MathUtils.smoothstep(shownPx, MARKER_HIDE_PX * 0.5, MARKER_HIDE_PX);
          const c = MARKER_COLOR[colorKey(v.model)];
          markerColor[4 * nm] = c[0];
          markerColor[4 * nm + 1] = c[1];
          markerColor[4 * nm + 2] = c[2];
          markerColor[4 * nm + 3] = 0.8 * fade;
          markerSize[nm] = fade > 0.01 ? 11 : 0;
          nm++;
        }
      }
      if (markerGeo && markerMat) {
        markerGeo.setDrawRange(0, nm);
        (markerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (markerGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
        (markerGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
        markerMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      for (const v of visuals) {
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y) - Math.max((v.px * v.enlarge) / 2, 5);
        if (d > radiusPx) continue;
        hits.push({ entityId: v.entity.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: v.entity.importance });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      const fieldM = Math.pow(10, ctx.scaleLog10);
      for (let vi = 0; vi <= visuals.length; vi++) {
        const v = vi < visuals.length ? visuals[vi] : visitor;
        if (!v) continue;
        // At planet-scale views only nearby or selected small bodies are labelled (faint comets far along the line
        // of sight otherwise clutter the hero views), matching the orbit fade above.
        if (fieldM < 3e9 && v.distM > 200 * fieldM && v.entity.id !== ctx.selectedId && v.entity.id !== ctx.focusEntityId) continue;
        const shownPx = v.px * v.enlarge;
        if (shownPx > ctx.viewport.height * 0.9) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id,
          text: v.entity.name,
          x: screen.x,
          y: screen.y,
          priority: v.entity.importance,
          kind: 'body',
          offsetPx: Math.min(shownPx / 2, 4000) + 9,
        });
      }
    },

    dispose(): void {
      for (const v of visuals) disposeVisual(v);
      if (visitor) disposeVisual(visitor);
      markerPoints?.removeFromParent();
      markerGeo?.dispose();
      markerMat?.dispose();
      visuals.length = 0;
    },
  };
}
