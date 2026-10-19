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
import { registerScaledBody, renderTransform } from '../../core/visualScale';
import { SPIN_STATES, decodeShape, illustrativeSpin, loadShapeIndex, spinPole, spinQuaternion, type ShapeIndex, type SpinState } from './famousShapes';

const MIN_MESH_PX = 0.8;
const MARKER_HIDE_PX = 14;

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
  spin: SpinState;
  /** Mean radius the mesh is scaled to (the real shape model's when loaded, else the catalogue's). */
  meshRadiusM: number;
  shape: 'procedural' | 'loading' | 'real' | 'failed';
  unregister: (() => void) | null;
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

const spinFor = (m: SmallBodyModel): SpinState => SPIN_STATES[m.id] ?? illustrativeSpin(m.id, m.spinPeriodH);

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
  let shapeIndex: ShapeIndex | null = null;
  let visitorId: string | null = null;
  let meshBudget = 0;
  const cometState: CometState = { head: tmp, antiSun: tmp2, velocityDir: vel, rAU: 1, size: 1, metersPerUnit: 1, pxPerRad: 1, insolation: 1, opacity: 1, cameraDistM: 1, nucleusRadiusM: 1 };

  for (const e of entities) {
    const model = MODEL_BY_ENTITY_ID.get(e.id);
    if (!model) continue;
    const v: Visual = {
      entity: e, model, world: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1, mesh: null, material: null, orbit: null, comet: null, active: true,
      spin: spinFor(model), meshRadiusM: model.meanRadiusM, shape: 'procedural', unregister: null,
    };
    visuals.push(v);
    byEntity.set(e.id, v);
  }
  const didymos = byEntity.get('sb:didymos') ?? null;

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

  /** Real shape model (mission data) when one is published for this body: swap it in once loaded. */
  const tryRealShape = (v: Visual): void => {
    const entry = shapeIndex?.shapes[v.model.id];
    if (entry && svcRef && v.shape === 'procedural') {
      v.shape = 'loading';
      void svcRef.assets.binary(`data/smallbodies/${entry.file}`).then((buf) => {
        if (!v.mesh) return;
        const { geometry } = decodeShape(buf);
        geometry.scale(1 / entry.meanRadiusKm, 1 / entry.meanRadiusKm, 1 / entry.meanRadiusKm);
        v.mesh.geometry.dispose();
        v.mesh.geometry = geometry;
        v.meshRadiusM = entry.meanRadiusKm * 1000;
        v.shape = 'real';
        if (v.material) {
          // The real model carries the true relief: keep only subtle procedural detail.
          v.material.uniforms.uBump.value = 0.07;
          v.material.uniforms.uCraterAmp.value = v.model.isComet ? 0.08 : 0.22;
          v.material.uniforms.uBoulders.value = 0.85;
          // Skip the coarse octaves: the mission model already resolves everything larger than ~1/25 of the radius.
          v.material.uniforms.uCraterStart.value = 22;
        }
      }).catch(() => { v.shape = 'failed'; });
    }
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
    // Drawn position and exhibition-scale factor from the shared visual-scale runtime (identity in true scale).
    v.enlarge = renderTransform(v.entity, ctx.timeMs, v.world);
    v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
    v.px = ctx.pixelDiameter(v.model.meanRadiusM, v.distM);
    const shownPx = v.px * v.enlarge;
    const wantMesh = shownPx >= MIN_MESH_PX;
    if (wantMesh && !v.mesh && meshBudget > 0) {
      ensureMesh(v);
      meshBudget--;
    }
    if (v.mesh && v.material) {
      if (v.shape === 'procedural' && shapeIndex) tryRealShape(v);
      v.mesh.visible = wantMesh;
      if (wantMesh) {
        ctx.toRender(v.world, v.mesh.position);
        v.mesh.scale.setScalar((v.meshRadiusM * v.enlarge) / ctx.metersPerUnit);
        if (v.model.id === 'dimorphos' && didymos) {
          // Tidally locked: long axis toward Didymos, spin axis = Didymos' pole (the orbit is equatorial).
          renderTransform(didymos.entity, ctx.timeMs, tmp2);
          axis.subVectors(tmp2, v.world).normalize();
          spinPole(didymos.spin, tmp2);
          const y = vel.crossVectors(tmp2, axis).normalize();
          tmp2.crossVectors(axis, y);
          m4.makeBasis(axis, y, tmp2);
          quat.setFromRotationMatrix(m4);
        } else {
          // IAU-style spin state: published pole and rotation for the famous bodies, illustrative pole otherwise.
          spinQuaternion(v.spin, ctx.timeMs, quat);
        }
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
        cometState.opacity = Math.max(0.5, near);
        cometState.cameraDistM = v.distM;
        cometState.nucleusRadiusM = v.meshRadiusM * v.enlarge;
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
    // Unfocused orbits are faint (≈ 13 % of the minor-orbit style, well under the planet orbits) and the huge comet/TNO ellipses fainter still, so the
    // overview is not a tangle of lines; the focused orbit keeps full strength.
    const el0 = v.model.elements!;
    const big = el0.e > 0.8 || el0.aAU > 6;
    line.material.setFade(focusedLike ? 1 : fade * (big ? 0.06 : 0.13));
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
    return {
      entity, model, world: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1, mesh: null, material: null, orbit: null, comet: null, active: true,
      spin: illustrativeSpin(model.id, model.spinPeriodH), meshRadiusM: r, shape: 'procedural', unregister: null,
    };
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
    v.unregister?.();
    v.unregister = null;
  };

  return {
    id: 'small-bodies',
    visuals,

    init(svc: EngineServices): void {
      svcRef = svc;
      void loadShapeIndex((p) => svc.assets.json(p)).then((ix) => { shapeIndex = ix; });
      for (const v of visuals) v.unregister = registerScaledBody(v.entity, { kind: v.entity.kind, radiusM: v.model.meanRadiusM });
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
      const markerFieldM = Math.pow(10, ctx.scaleLog10);
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
          let fade = 1 - THREE.MathUtils.smoothstep(shownPx, MARKER_HIDE_PX * 0.5, MARKER_HIDE_PX);
          // Same rule as the labels: at planet-scale views distant unlabelled markers are just clutter.
          if (markerFieldM < 3e9 && !focusedLike) fade *= 1 - THREE.MathUtils.smoothstep(v.distM, 100 * markerFieldM, 200 * markerFieldM);
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
