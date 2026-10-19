/**
 * Orbit hairlines for the planets and dwarf planets (overlay 'orbits'), drawn with the render kit's OrbitLine:
 * the osculating heliocentric ellipse from the body's current state (exactly tangent at the body, refreshed as
 * simulation time advances), ICRS axes, focus at the Sun. Planets ink 30 %, dwarf planets 18 %, the focused or
 * selected body's orbit brass 70 % (VISUAL_DIRECTION). Lines fade out when the orbit is only a few pixels across and
 * when the body itself fills the view; a trail fades behind the body.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer } from '../../core/types';
import { OrbitLine } from '../../render/orbitBuilder';
import { stateToElements, type KeplerElements } from '../../science/orbits';
import { SOLAR_BODY_BY_ID, type SolarBodyDef } from './constants';
import type { SolarEntity } from './entities';
import { bodyPosition, bodyVelocity, sunPosition } from './ephemeris';
import { GM_SUN } from '../../core/units';

interface OrbitVisual {
  entity: SolarEntity;
  line: OrbitLine;
  el: KeplerElements;
  mu: number;
  periodMs: number;
  builtAtMs: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Earth's heliocentric orbit belongs to the Solar-System picture but Earth itself is the earth domain's entity:
 * draw the line from astronomy-engine's Earth state (orbit-only definition, never registered as an entity).
 */
const EARTH_ORBIT_DEF: SolarBodyDef = {
  ...SOLAR_BODY_BY_ID.get('sol:mars')!,
  id: 'sol:earth',
  key: 'earth',
  name: 'Earth',
  aliases: [],
  kind: 'planet',
  aeBody: 'Earth',
  elements: undefined,
  axesM: [6_378_137, 6_378_137, 6_356_752],
  meanRadiusM: 6_371_000,
  gmM3S2: 3.986004418e14 + 4.9028e12,
  periodDays: 365.256,
  rings: undefined,
  atmosphere: undefined,
};

function earthOrbitEntity(): SolarEntity {
  return { id: 'sol:earth', def: EARTH_ORBIT_DEF, position: (t: number, out: THREE.Vector3) => bodyPosition(EARTH_ORBIT_DEF, t, out) } as unknown as SolarEntity;
}

export function createOrbitsLayer(solarBodies: SolarEntity[]): Layer {
  const bodies = [...solarBodies, earthOrbitEntity()];
  const visuals: OrbitVisual[] = [];
  const state = new Float64Array(6);
  const p = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const sun = new THREE.Vector3();
  const sunVel = new THREE.Vector3();

  const rebuild = (v: OrbitVisual, tMs: number): void => {
    const def = v.entity.def;
    bodyPosition(def, tMs, p);
    bodyVelocity(def, tMs, vel);
    sunPosition(tMs, sun);
    bodyVelocity(bodies[0].def, tMs, sunVel);
    state[0] = p.x - sun.x;
    state[1] = p.y - sun.y;
    state[2] = p.z - sun.z;
    state[3] = vel.x - sunVel.x;
    state[4] = vel.y - sunVel.y;
    state[5] = vel.z - sunVel.z;
    stateToElements(state, v.mu, v.el);
    if (!(v.el.eccentricity < 1) || !Number.isFinite(v.el.semiMajorAxisM)) return;
    v.line.setFromElements(v.el, v.mu, { samples: def.kind === 'planet' ? 720 : 900 });
    v.builtAtMs = tMs;
  };

  return {
    id: 'solar-orbits',
    init(svc: EngineServices): void {
      for (const entity of bodies) {
        if (entity.def.kind === 'star') continue;
        const line = new OrbitLine({ role: entity.def.kind === 'planet' ? 'planet' : 'minor', provenance: 'observed', maxVertices: 1024 });
        line.name = `${entity.id}:orbit`;
        // Render-kit workaround: the segment quads wind clockwise on screen, so FrontSide culls every line.
        line.material.side = THREE.DoubleSide;
        svc.groups.overlay.add(line);
        const mu = GM_SUN + entity.def.gmM3S2;
        visuals.push({
          entity,
          line,
          el: { semiMajorAxisM: 1, eccentricity: 0, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 },
          mu,
          periodMs: entity.def.periodDays * 86_400_000,
          builtAtMs: Number.NaN,
        });
      }
    },

    update(ctx: FrameContext): void {
      const on = ctx.overlays.orbits;
      sunPosition(ctx.timeMs, sun);
      for (const v of visuals) {
        if (!on) {
          v.line.visible = false;
          continue;
        }
        if (!(Math.abs(ctx.timeMs - v.builtAtMs) < v.periodMs / 720)) rebuild(v, ctx.timeMs);
        // Orbit size on screen (diameter ≈ 2a seen from the camera's distance to the Sun).
        const a = v.el.semiMajorAxisM;
        const dSun = Math.max(sun.distanceTo(ctx.cameraPosition), 1);
        const orbitPx = ctx.pixelDiameter(a, Math.max(dSun, a));
        v.entity.position(ctx.timeMs, p);
        const bodyPx = ctx.pixelDiameter(v.entity.def.axesM[0], Math.max(p.distanceTo(ctx.cameraPosition), 1));
        // From deep inside an orbit (an outer orbit seen from the inner system) the line degenerates into stray
        // straight strokes across the frame: fade it until the camera is far enough out to see it as an ellipse.
        const fieldM = Math.pow(10, ctx.scaleLog10);
        const inside = dSun >= a ? 1 : 1 - smooth(1.6, 3.2, a / fieldM);
        const fade = smooth(24, 90, orbitPx) * (1 - smooth(14, 60, bodyPx)) * inside;
        v.line.visible = fade > 0.003;
        if (!v.line.visible) continue;
        const focused = ctx.focusEntityId === v.entity.id || ctx.selectedId === v.entity.id;
        const role = focused ? 'focused' : v.entity.def.kind === 'planet' ? 'planet' : 'minor';
        if (v.line.material.role !== role) v.line.material.role = role;
        v.line.material.setFade(fade);
        // Mean anomaly now → orbit fraction for the trail head.
        const n = Math.sqrt(v.mu / (a * a * a));
        const M = v.el.meanAnomalyRad + (n * (ctx.timeMs - v.builtAtMs)) / 1000;
        v.line.setHead(M / (2 * Math.PI), 0.22);
        v.line.parentPositionM.copy(sun);
        v.line.update(ctx);
      }
    },

    dispose(): void {
      for (const v of visuals) {
        v.line.removeFromParent();
        v.line.dispose();
      }
      visuals.length = 0;
    },
  };
}
