/**
 * Heliosphere: termination shock + heliopause as subtle RECONSTRUCTED shells (model.ts), elongated downwind, nose toward the
 * interstellar inflow, with markers where Voyager 1 and 2 crossed each boundary (taken from the spacecraft entities' trajectories
 * at the crossing dates; falls back to the sky direction + published distance when the trajectory is unavailable).
 * Visible from roughly 50 au out to a few thousand au, or whenever an outer:* entity or a Voyager is focused/selected.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M } from '../../core/units';
import { raDecDistToIcrs } from '../../core/frames';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { CRAFT_FALLBACK_RADEC, CROSSINGS, ECLIPTIC_NORTH_ICRS, HELIOPAUSE, NOSE_ICRS, TERMINATION_SHOCK, shellRadiusAU, type ShellCrossing } from './model';
import { OUTER_IDS } from './entities';
import { createShellVisual, type ShellVisual } from './shell';
import { sunSource } from './sources';

const MARKER_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aColor;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uSize;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio;
  vColor = aColor * uOpacity;
  ${LOGDEPTH_VERTEX}
}`;

const MARKER_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float ring = smoothstep(0.52, 0.66, d) * (1.0 - smoothstep(0.80, 0.94, d));
  float dot_ = 1.0 - smoothstep(0.10, 0.22, d);
  float a = max(ring, dot_ * 0.9);
  gl_FragColor = vec4(vColor * a, a);
}`;

interface Marker {
  crossing: ShellCrossing;
  world: THREE.Vector3;
  resolved: boolean;
  fromTrajectory: boolean;
}

/** Inside the shipped Horizons coverage (2025-2030). */
const DIRECTION_REFERENCE_MS = Date.UTC(2026, 0, 1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string): string => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const craftName = (id: ShellCrossing['craftId']): string => (id === 'voyager-1' ? 'Voyager 1' : 'Voyager 2');
const shellName = (s: ShellCrossing['shell']): string => (s === 'heliopause' ? 'heliopause' : 'termination shock');

const SHELL_LABELS = [
  [OUTER_IDS.terminationShock, 'Termination shock', TERMINATION_SHOCK, 118, 'reconstructed'],
  [OUTER_IDS.heliopause, 'Heliopause', HELIOPAUSE, 100, 'reconstructed'],
] as const;

export interface HeliosphereLayer extends Layer {
  /** World position (ICRS m) of each crossing marker, once resolved. */
  markerPositions(): readonly { crossing: ShellCrossing; world: THREE.Vector3; fromTrajectory: boolean }[];
}

export function createHeliosphereLayer(registry: Pick<EntityRegistry, 'get'>): HeliosphereLayer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const north = new THREE.Vector3(ECLIPTIC_NORTH_ICRS.x, ECLIPTIC_NORTH_ICRS.y, ECLIPTIC_NORTH_ICRS.z);
  const nose = new THREE.Vector3(NOSE_ICRS.x, NOSE_ICRS.y, NOSE_ICRS.z);
  const e1 = north.clone().addScaledVector(nose, -north.dot(nose)).normalize();

  let ts: ShellVisual | null = null;
  let hp: ShellVisual | null = null;
  let markerPts: THREE.Points | null = null;
  let markerMat: THREE.ShaderMaterial | null = null;
  let markerGeo: THREE.BufferGeometry | null = null;
  const markers: Marker[] = CROSSINGS.map((c) => ({ crossing: c, world: new THREE.Vector3(), resolved: false, fromTrajectory: false }));
  let opacity = 0;
  let disposed = false;
  let sunAtResolve = new THREE.Vector3();

  /**
   * Place a crossing marker. The shipped Horizons trajectories only cover 2025-2030, so the crossing position is the published
   * heliocentric distance along the spacecraft's current heliocentric direction (both craft move almost radially, so the
   * direction at 2026 is within a few degrees of the direction at crossing); without the craft entity the sky direction
   * constants in model.ts are used instead.
   */
  const resolveMarker = (m: Marker): void => {
    const craft = registry.get(`sc:${m.crossing.craftId}`);
    sun(Date.parse(m.crossing.dateIso), sunAtResolve);
    if (craft) {
      sun(DIRECTION_REFERENCE_MS, tmp2);
      craft.position(DIRECTION_REFERENCE_MS, tmp).sub(tmp2);
      if (tmp.length() > 50 * AU_M) {
        m.world.copy(tmp).normalize().multiplyScalar(m.crossing.distanceAU * AU_M).add(sunAtResolve);
        m.fromTrajectory = true;
        m.resolved = true;
        return;
      }
    }
    const f = CRAFT_FALLBACK_RADEC[m.crossing.craftId];
    raDecDistToIcrs(f.raDeg, f.decDeg, m.crossing.distanceAU * AU_M, m.world);
    m.world.add(sunAtResolve);
    m.fromTrajectory = false;
    m.resolved = false; // retry next frame until the spacecraft entity (and its ephemeris) is available
  };

  const layer: HeliosphereLayer = {
    id: 'outer-heliosphere',

    init(svc: EngineServices): void {
      ts = createShellVisual(TERMINATION_SHOCK, { color: [0.55, 0.62, 1.0], base: 0.008, rim: 0.26, grid: 0.1, gridThetaDeg: 15, gridPhiDeg: 30 }, 'termination-shock');
      hp = createShellVisual(HELIOPAUSE, { color: [0.4, 0.86, 1.0], base: 0.01, rim: 0.3, grid: 0.09, gridThetaDeg: 15, gridPhiDeg: 30 }, 'heliopause');
      ts.mesh.renderOrder = 6;
      hp.mesh.renderOrder = 7;
      svc.groups.transparent.add(ts.mesh, hp.mesh);

      const n = markers.length;
      const colors = new Float32Array(n * 3);
      markers.forEach((m, i) => {
        // Voyager 1 warm amber, Voyager 2 cool mint: a pairing readable without a legend.
        const c = m.crossing.craftId === 'voyager-1' ? [1.0, 0.78, 0.4] : [0.55, 1.0, 0.85];
        colors.set(c, i * 3);
      });
      markerGeo = new THREE.BufferGeometry();
      markerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      markerGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      markerGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      markerMat = new THREE.ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 }, uSize: { value: 15 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      markerPts = new THREE.Points(markerGeo, markerMat);
      markerPts.name = 'voyager-crossings';
      markerPts.frustumCulled = false;
      markerPts.visible = false;
      markerPts.renderOrder = 8;
      svc.groups.overlay.add(markerPts);
    },

    update(ctx: FrameContext): void {
      if (!ts || !hp || !markerPts || !markerMat || !markerGeo) return;
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      const focusRelated = (id: string | null): boolean => id !== null && (id.startsWith('outer:') || id === 'sc:voyager-1' || id === 'sc:voyager-2');
      const emphasised = focusRelated(ctx.focusEntityId) || focusRelated(ctx.selectedId);
      const ramp = THREE.MathUtils.smoothstep(dSunAu, 35, 110) * (1 - THREE.MathUtils.smoothstep(dSunAu, 8000, 80000));
      const target = Math.max(ramp, emphasised ? 0.9 * (1 - THREE.MathUtils.smoothstep(dSunAu, 8000, 80000)) : 0);
      opacity += (target - opacity) * Math.min(1, ctx.dtRealSec * 4);
      if (Math.abs(target - opacity) < 0.002) opacity = target;
      const show = opacity > 0.003;

      const unitsPerAu = AU_M / ctx.metersPerUnit;
      // Seen from inside (planetary views) the shells stay a faint hint; from outside they read as surfaces.
      const outside = 0.4 + 0.6 * THREE.MathUtils.smoothstep(dSunAu, 70, 260);
      ts.setFrame(unitsPerAu, show ? opacity * 0.85 * outside : 0);
      hp.setFrame(unitsPerAu, show ? opacity * outside : 0);
      markerPts.visible = show;
      if (!show) return;
      ctx.toRender(sunWorld, ts.mesh.position);
      hp.mesh.position.copy(ts.mesh.position);

      // Crossing markers are fixed points in space (barycentric); resolve lazily, then upload render-space positions.
      const arr = (markerGeo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!m.resolved) resolveMarker(m);
        ctx.toRender(m.world, tmp);
        arr[3 * i] = tmp.x;
        arr[3 * i + 1] = tmp.y;
        arr[3 * i + 2] = tmp.z;
      }
      (markerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      markerMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      markerMat.uniforms.uOpacity.value = Math.min(1, opacity * 1.1);
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      if (opacity < 0.4) return [];
      let best: PickHit | null = null;
      for (const m of markers) {
        ctx.project(m.world, screen);
        if (!screen.visible) continue;
        const d = Math.hypot(screen.x - x, screen.y - y);
        if (d > Math.min(radiusPx, 16)) continue;
        if (!best || d < best.distancePx) {
          best = { entityId: m.crossing.shell === 'heliopause' ? OUTER_IDS.heliopause : OUTER_IDS.terminationShock, distancePx: d, depthM: screen.depthM, priority: 12 };
        }
      }
      return best ? [best] : [];
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels || opacity < 0.25) return;
      sun(ctx.timeMs, sunWorld);
      for (const m of markers) {
        ctx.project(m.world, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: null, // the label manager de-duplicates by entity id; each crossing label is unique by text
          text: `${craftName(m.crossing.craftId)} · ${shellName(m.crossing.shell)}`,
          detail: `${m.crossing.distanceAU.toFixed(m.crossing.distanceAU % 1 ? 1 : 0)} au · ${shortDate(m.crossing.dateIso)}`,
          x: screen.x,
          y: screen.y,
          priority: 22,
          kind: 'annotation',
          offsetPx: 12,
          opacity: Math.min(1, opacity),
        });
      }
      // Shell names, anchored on each shell's flank above the ecliptic (θ = 100° / 118° in the nose–north plane).
      for (const [id, text, params, thetaDeg, detail] of SHELL_LABELS) {
        const th = (thetaDeg * Math.PI) / 180;
        tmp2.copy(nose).multiplyScalar(Math.cos(th)).addScaledVector(e1, Math.sin(th));
        const rAu = shellRadiusAU(params, tmp2);
        tmp.copy(tmp2).multiplyScalar(rAu * AU_M).add(sunWorld);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        out.push({ entityId: id, text, detail, x: screen.x, y: screen.y, priority: 24, kind: 'annotation', opacity: Math.min(1, opacity) });
      }
    },

    markerPositions: () => markers.map((m) => ({ crossing: m.crossing, world: m.world, fromTrajectory: m.fromTrajectory })),

    dispose(): void {
      disposed = true;
      ts?.dispose();
      hp?.dispose();
      markerPts?.removeFromParent();
      markerGeo?.dispose();
      markerMat?.dispose();
      ts = hp = null;
      void disposed;
    },
  };
  return layer;
}
