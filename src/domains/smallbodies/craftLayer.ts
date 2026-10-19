/**
 * Spacecraft layer: loads spacecraft.json (Horizons samples, cubic Hermite in CraftTrack), draws stylised lit models when
 * close, a diamond marker otherwise, the trajectory over the delivered window (trail-faded toward the craft's position,
 * overlay 'orbits' or when focused/selected), labels and picking. Orientation is illustrative: antenna (+Z) toward Earth,
 * or the Sun shield toward the Sun for Parker Solar Probe and JWST; panels rolled to face the Sun.
 */
import * as THREE from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { OrbitLine } from '../../render/orbitBuilder';
import { solarSceneIrradianceAt, sunDirectionAt } from '../solar/ephemeris';
import { CraftMaterial, craftGeometry, disposeCraftGeometries } from './craftModels';
import { CRAFT_INFO, CraftTrack, TRACKS, loadCraftData, type CraftInfo } from './spacecraft';
import { jdTdbFromMs } from './orbits';
import { earthSource, sunSource } from './sources';

const MIN_MESH_PX = 2;
const MARKER_HIDE_PX = 22;
const ENLARGE_TARGET_PX = 10;
const MAX_ENLARGE = 1e7;
const MAX_MESHES = 6;

interface Visual {
  entity: Entity;
  info: CraftInfo;
  id: string;
  world: THREE.Vector3;
  distM: number;
  px: number;
  enlarge: number;
  mesh: THREE.Mesh | null;
  material: CraftMaterial | null;
  orbit: OrbitLine | null;
  centerId: 'sun' | 'earth';
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
  vec2 d = abs(gl_PointCoord - 0.5) * 2.0;
  float diamond = d.x + d.y; // L1 norm: a diamond outline
  float ring = smoothstep(0.55, 0.66, diamond) * (1.0 - smoothstep(0.78, 0.9, diamond));
  float dotc = 1.0 - smoothstep(0.08, 0.2, diamond);
  float a = max(ring, dotc * 0.9) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

const MARKER_RGB = [0.55, 0.9, 0.95] as const;

export interface CraftLayer extends Layer {
  readonly visuals: readonly Visual[];
  /** Resolves when the ephemeris samples are loaded. */
  readonly ready: Promise<void>;
}

export function createCraftLayer(entities: readonly Entity[], registry: Pick<EntityRegistry, 'get'>): CraftLayer {
  const sun = sunSource(registry);
  const earth = earthSource(registry);
  const sunWorld = new THREE.Vector3();
  const earthWorld = new THREE.Vector3();
  const centerWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const zAx = new THREE.Vector3();
  const yAx = new THREE.Vector3();
  const xAx = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const visuals: Visual[] = [];
  for (const e of entities) {
    const id = e.id.slice(3);
    const info = CRAFT_INFO[id];
    if (!info) continue;
    visuals.push({
      entity: e, info, id, world: new THREE.Vector3(), distM: 1, px: 0, enlarge: 1,
      mesh: null, material: null, orbit: null, centerId: e.parentId === 'sol:earth' ? 'earth' : 'sun',
    });
  }
  let svcRef: EngineServices | null = null;
  let markerPoints: THREE.Points | null = null;
  let markerGeo: THREE.BufferGeometry | null = null;
  let markerMat: THREE.ShaderMaterial | null = null;
  let markerPos: Float32Array;
  let markerSize: Float32Array;
  let markerColor: Float32Array;
  let meshBudget = 0;
  let disposed = false;
  const polylines = new Map<string, { pts: Float64Array; frac: Float64Array; n: number }>();

  const ready = loadCraftData()
    .then((all) => {
      if (disposed) return;
      for (const d of all) {
        if (!d.samples || d.samples.length < 6) continue;
        const tr = new CraftTrack(d);
        TRACKS.set(d.id, tr);
        const n = tr.count;
        const pts = new Float64Array(3 * n);
        const frac = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          pts[3 * i] = tr.samples[3 * i] * 1000;
          pts[3 * i + 1] = tr.samples[3 * i + 1] * 1000;
          pts[3 * i + 2] = tr.samples[3 * i + 2] * 1000;
          frac[i] = n > 1 ? i / (n - 1) : 0;
        }
        polylines.set(d.id, { pts, frac, n });
      }
    })
    .catch(() => {
      /* ephemeris unavailable: crafts stay at their parent body */
    });

  const ensureMesh = (v: Visual): void => {
    if (v.mesh || !svcRef) return;
    v.material = new CraftMaterial();
    v.mesh = new THREE.Mesh(craftGeometry(v.info.model), v.material);
    v.mesh.name = v.entity.id;
    v.mesh.frustumCulled = false;
    svcRef.groups.main.add(v.mesh);
  };

  const ensureOrbit = (v: Visual): void => {
    if (v.orbit || !svcRef) return;
    const poly = polylines.get(v.id);
    if (!poly) return;
    const line = new OrbitLine({ role: 'minor', provenance: 'observed', maxVertices: Math.min(poly.n, 2300) });
    line.material.side = THREE.DoubleSide;
    line.setPolyline(poly.pts, poly.n, false, poly.frac);
    line.visible = false;
    svcRef.groups.overlay.add(line);
    v.orbit = line;
  };

  const orient = (v: Visual, sunDirW: THREE.Vector3): void => {
    const sunward = v.info.model === 'parker' || v.info.model === 'jwst';
    if (sunward) zAx.copy(sunDirW);
    else zAx.subVectors(earthWorld, v.world).normalize();
    if (zAx.lengthSq() < 0.5) zAx.set(0, 0, 1);
    // Roll about Z so the panel normal (Y) faces the Sun as closely as possible.
    yAx.copy(sunDirW).addScaledVector(zAx, -sunDirW.dot(zAx));
    if (yAx.lengthSq() < 1e-6) yAx.set(0, 1, 0).addScaledVector(zAx, -zAx.y);
    yAx.normalize();
    xAx.crossVectors(yAx, zAx);
    basis.makeBasis(xAx, yAx, zAx);
    v.mesh!.quaternion.setFromRotationMatrix(basis);
  };

  return {
    id: 'spacecraft',
    visuals,
    ready,

    init(svc: EngineServices): void {
      svcRef = svc;
      const MAXM = Math.max(visuals.length, 1);
      markerPos = new Float32Array(MAXM * 3);
      markerSize = new Float32Array(MAXM);
      markerColor = new Float32Array(MAXM * 4);
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
      markerPoints.name = 'spacecraft-markers';
      svc.groups.overlay.add(markerPoints);
    },

    update(ctx: FrameContext): void {
      sun(ctx.timeMs, sunWorld);
      earth(ctx.timeMs, earthWorld);
      meshBudget = 1;
      const jd = jdTdbFromMs(ctx.timeMs);
      let nm = 0;
      let meshes = 0;
      for (const v of visuals) {
        v.entity.position(ctx.timeMs, v.world);
        v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
        v.px = ctx.pixelDiameter(v.info.radiusM * 2, v.distM);
        v.enlarge = ctx.overlays['enlarge-bodies'] && v.px < ENLARGE_TARGET_PX ? Math.min(ENLARGE_TARGET_PX / Math.max(v.px, 1e-9), MAX_ENLARGE) : 1;
        const shownPx = v.px * v.enlarge;
        const focusedLike = v.entity.id === ctx.selectedId || v.entity.id === ctx.focusEntityId;
        const shown = ctx.overlays.spacecraft || focusedLike;
        const wantMesh = shown && shownPx >= MIN_MESH_PX && meshes < MAX_MESHES;
        if (wantMesh && !v.mesh && meshBudget > 0) {
          ensureMesh(v);
          meshBudget--;
        }
        if (v.mesh && v.material) {
          v.mesh.visible = wantMesh;
          if (wantMesh) {
            meshes++;
            ctx.toRender(v.world, v.mesh.position);
            v.mesh.scale.setScalar((v.info.radiusM * v.enlarge) / ctx.metersPerUnit);
            sunDirectionAt(v.world, ctx.timeMs, sunDir);
            orient(v, sunDir);
            v.material.uniforms.uSunDir.value.copy(sunDir);
            v.material.uniforms.uIrradiance.value = solarSceneIrradianceAt(v.world, ctx.timeMs);
            v.mesh.updateMatrixWorld(true);
          }
        }
        // Trajectory.
        const track = TRACKS.get(v.id);
        // Unfocused trajectories fade out at planet-scale views: seen from close to a planet, a passing flyby track
        // degenerates into stray straight strokes across the frame.
        const fieldM = Math.pow(10, ctx.scaleLog10);
        const lineFade = focusedLike
          ? 1
          : v.centerId === 'earth'
            ? THREE.MathUtils.smoothstep(fieldM, 2e8, 1e9)
            : THREE.MathUtils.smoothstep(fieldM, 3e9, 3e10);
        const wantLine = track !== undefined && lineFade > 0.003 && (focusedLike || (shown && ctx.overlays.orbits));
        if (wantLine) ensureOrbit(v);
        if (v.orbit) {
          v.orbit.visible = wantLine;
          if (wantLine && track) {
            v.orbit.material.role = focusedLike ? 'focused' : 'minor';
            v.orbit.material.setFade(lineFade);
            v.orbit.parentPositionM.copy(v.centerId === 'earth' ? earthWorld : sunWorld);
            v.orbit.setHead(Math.min(Math.max((jd - track.startJD) / (track.endJD - track.startJD), 0), 1) || 1e-6, 0.3);
            v.orbit.update(ctx);
          }
        }
        // Marker while the craft is small on screen.
        ctx.toRender(v.world, tmp);
        markerPos[3 * nm] = tmp.x;
        markerPos[3 * nm + 1] = tmp.y;
        markerPos[3 * nm + 2] = tmp.z;
        const fade = shown ? 1 - THREE.MathUtils.smoothstep(shownPx, MARKER_HIDE_PX * 0.4, MARKER_HIDE_PX) : 0;
        markerColor[4 * nm] = MARKER_RGB[0];
        markerColor[4 * nm + 1] = MARKER_RGB[1];
        markerColor[4 * nm + 2] = MARKER_RGB[2];
        markerColor[4 * nm + 3] = 0.85 * fade;
        markerSize[nm] = fade > 0.01 ? 12 : 0;
        nm++;
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
        const d = Math.hypot(screen.x - x, screen.y - y) - Math.max((v.px * v.enlarge) / 2, 6);
        if (d > radiusPx) continue;
        hits.push({ entityId: v.entity.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: v.entity.importance });
      }
      return hits;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      const fieldM = Math.pow(10, ctx.scaleLog10);
      for (const v of visuals) {
        const mine = v.entity.id === ctx.selectedId || v.entity.id === ctx.focusEntityId;
        if (!ctx.overlays.spacecraft && !mine) continue;
        // At planet-scale views only nearby craft are labelled, like the trajectory fade above.
        if (!mine && fieldM < (v.centerId === 'earth' ? 2e8 : 3e9) && v.distM > 200 * fieldM) continue;
        const shownPx = v.px * v.enlarge;
        if (shownPx > ctx.viewport.height * 0.9) continue;
        ctx.project(v.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id, text: v.entity.name, x: screen.x, y: screen.y,
          priority: v.entity.importance, kind: 'body', offsetPx: Math.min(shownPx / 2, 4000) + 10,
        });
      }
    },

    dispose(): void {
      disposed = true;
      for (const v of visuals) {
        v.mesh?.removeFromParent();
        v.material?.dispose();
        v.orbit?.removeFromParent();
        v.orbit?.dispose();
      }
      disposeCraftGeometries();
      markerPoints?.removeFromParent();
      markerGeo?.dispose();
      markerMat?.dispose();
      TRACKS.clear();
      void centerWorld;
    },
  };
}
