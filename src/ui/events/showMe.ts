/**
 * "Show me": turn a sky event's camera hint into a CameraViewState and fly there. Light stays physically true (the
 * engine renders the real Sun direction and eclipse shadows at the event time); we only choose where to stand.
 *
 * The UI has no camera handle in AppContext, so this uses the documented automation handle `window.__cosmos.engine.rig`
 * (duck-typed setView) and falls back to `commands.focus` when it is missing. Requested contract change: expose
 * `setView(view, opts)` on AppCommands.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { AppCommands } from '../../app/commands';
import type { EntityRegistry } from '../../core/entity';
import type { CameraViewState, TravelOptions } from '../../core/types';
import { scaleFromFocusDistance } from '../../core/scale';
import type { SkyEvent, Vec3 } from '../../science/events';
import type { VisualScaleMode } from '../../core/visualScale';
import { setVisualScale, type CosmosStore } from '../../state/store';

/** Engine vertical field of view (src/core/engine.ts CAMERA_FOV_DEG). */
const FOV_Y = (50 * Math.PI) / 180;
const R_EARTH = 6.371e6;
const R_MOON = 1.7374e6;
/** Ecliptic north on ICRS axes (obliquity 23.4393°). */
const ECL_NORTH = new Vector3(0, -Math.sin(0.40909280), Math.cos(0.40909280));

interface RigLike {
  setView(view: CameraViewState, opts?: TravelOptions): Promise<void>;
}

function rig(): RigLike | null {
  if (typeof window === 'undefined') return null;
  const r = (window.__cosmos?.engine as { rig?: Partial<RigLike> } | undefined)?.rig;
  return r && typeof r.setView === 'function' ? (r as RigLike) : null;
}

const v3 = (a: Vec3): Vector3 => new Vector3(a[0], a[1], a[2]);

/** Camera orientation looking along `forward` with `upHint` up (orthogonalised; falls back when parallel). */
function lookQuaternion(forward: Vector3, upHint: Vector3): [number, number, number, number] {
  const back = forward.clone().normalize().negate();
  const up = upHint.clone().addScaledVector(back, -upHint.dot(back));
  if (up.lengthSq() < 1e-10) up.copy(Math.abs(back.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)).addScaledVector(back, -back.z);
  up.normalize();
  const right = new Vector3().crossVectors(up, back).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
  return [q.x, q.y, q.z, q.w];
}

/** Distance at which a sphere of radius R fills `fill` of the frame height. */
function framingDistance(R: number, fill: number): number {
  return R / Math.sin(Math.atan(fill * Math.tan(FOV_Y / 2)));
}

function orbitView(anchorId: string, dirFromAnchor: Vector3, distanceM: number, upHint: Vector3): CameraViewState {
  const d = dirFromAnchor.clone().normalize();
  const off = d.clone().multiplyScalar(distanceM);
  return {
    anchorId, offset: [off.x, off.y, off.z], quaternion: lookQuaternion(d.clone().negate(), upHint),
    mode: 'orbit', focusId: anchorId, scaleLog10: scaleFromFocusDistance(distanceM, FOV_Y),
  };
}

/** Camera view for an event at its own time, or null when the needed entity is not registered. */
export function viewForEvent(ev: SkyEvent, registry: EntityRegistry): CameraViewState | null {
  const radius = (id: string, fallback: number): number => registry.get(id)?.radiusM ?? fallback;
  const v = ev.view;
  switch (v.type) {
    case 'shadow-on-earth': {
      if (!registry.get('sol:earth')) return null;
      // Straight down the shadow axis (the DSCOVR view): the Moon's shadow sits mid-disc on the sunlit face.
      return orbitView('sol:earth', v3(v.dirEqj), framingDistance(radius('sol:earth', R_EARTH), 0.78), ECL_NORTH);
    }
    case 'moon-in-shadow': {
      if (!registry.get('sol:moon')) return null;
      return orbitView('sol:moon', v3(v.dirEqj), framingDistance(radius('sol:moon', R_MOON), 0.6), ECL_NORTH);
    }
    case 'earth-season': {
      if (!registry.get('sol:earth')) return null;
      // Side-on to the Sun so the terminator runs pole to pole and the axial tilt reads against it.
      const side = new Vector3().crossVectors(ECL_NORTH, v3(v.sunDirEqj)).normalize();
      // A little toward the Sun so most of the disc is lit (a gibbous Earth), ecliptic north up.
      side.addScaledVector(v3(v.sunDirEqj), 0.35).normalize();
      return orbitView('sol:earth', side, framingDistance(radius('sol:earth', R_EARTH), 0.62), ECL_NORTH);
    }
    case 'from-earth': {
      if (!registry.get('sol:earth')) return null;
      // Low orbit over the night (or twilight) side: Earth's limb along the bottom, the targets just above it.
      const R = radius('sol:earth', R_EARTH);
      const dir = v3(v.dirEqj).normalize(), up = v3(v.upEqj).normalize();
      const pitch = (8 * Math.PI) / 180;
      const forward = dir.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, -Math.sin(pitch));
      const camUp = up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(dir, Math.sin(pitch));
      const off = up.clone().multiplyScalar(R * 1.12);
      return {
        anchorId: 'sol:earth', offset: [off.x, off.y, off.z], quaternion: lookQuaternion(forward, camUp),
        mode: 'orbit', focusId: 'sol:earth', scaleLog10: scaleFromFocusDistance(R * 1.12, FOV_Y),
      };
    }
    case 'iss': {
      if (!registry.get('sc:iss')) return null;
      // Behind the station, looking down past it toward the visitor's city.
      return orbitView('sc:iss', v3(v.dirEqj), 160, v3(v.upEqj));
    }
  }
}

/** Eclipse shadows are only drawn with Earth and Moon at their real sizes (an enlarged Moon would cast a fake shadow). */
export function needsTrueScale(ev: SkyEvent): boolean {
  return ev.kind === 'solar-eclipse' || ev.kind === 'lunar-eclipse';
}

/**
 * Jump the clock to the event (paused there) and fly to its view. Eclipses switch to true scale; the previous mode is
 * returned so the caller can restore it (null when unchanged). Resolves when the camera arrives.
 */
export async function showEvent(
  ev: SkyEvent, deps: { commands: AppCommands; registry: EntityRegistry; store: CosmosStore }, reducedMotion = false,
): Promise<VisualScaleMode | null> {
  const { commands, registry, store } = deps;
  let previous: VisualScaleMode | null = null;
  if (needsTrueScale(ev) && store.getState().visualScale !== 'true') {
    previous = store.getState().visualScale;
    setVisualScale(store, 'true');
  }
  commands.pause();
  commands.jumpToTime(ev.timeMs);
  const view = viewForEvent(ev, registry);
  const r = rig();
  if (view && r) {
    await r.setView(view, reducedMotion ? { instant: true } : { durationSec: 4.5 });
  } else {
    const target = ev.bodies.find(id => registry.get(id)) ?? 'sol:earth';
    await commands.focus(target, reducedMotion ? { instant: true } : undefined);
  }
  return previous;
}
