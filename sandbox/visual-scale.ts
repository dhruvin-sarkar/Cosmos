/**
 * Visual-scale probe: installs on the REAL app (http://localhost:5173/?vsprobe or via tools/shot.mjs --eval) and draws, over the
 * canvas, the exhibition-scale discs from src/core/visualScale.ts for every solar body (outline = drawn disc, dot = true position).
 * It registers sol:* entities that their domains have not registered yet, so the camera/picker behave as after full adoption.
 *
 *   node tools/shot.mjs "/" out.png --eval "import('/sandbox/visual-scale.ts').then(m => m.install({ focus: 'sol:jupiter', dist: 1.5e10 }))"
 */
import * as THREE from 'three';
import type { Entity, EntityRegistry } from '../src/core/entity';
import type { FrameContext, Layer, ScreenPoint } from '../src/core/types';
import type { CosmosStore } from '../src/state/store';
import { setVisualScale } from '../src/state/store';
import { getScaleView, isScaledBody, registerScaledBody, renderTransform } from '../src/core/visualScale';

const IDS = [
  'sol:sun', 'sol:mercury', 'sol:venus', 'sol:earth', 'sol:moon', 'sol:mars', 'sol:phobos', 'sol:deimos', 'sol:jupiter', 'sol:io',
  'sol:europa', 'sol:ganymede', 'sol:callisto', 'sol:saturn', 'sol:mimas', 'sol:enceladus', 'sol:tethys', 'sol:dione', 'sol:rhea',
  'sol:titan', 'sol:iapetus', 'sol:uranus', 'sol:miranda', 'sol:ariel', 'sol:umbriel', 'sol:titania', 'sol:oberon', 'sol:neptune',
  'sol:triton', 'sol:ceres', 'sol:pluto', 'sol:charon', 'sol:eris', 'sol:haumea', 'sol:makemake',
];

interface Handle { engine: { addLayer(l: Layer): void; services: { cameraController: { setView(v: unknown, o?: unknown): Promise<void> } } }; registry: EntityRegistry; store: CosmosStore; commands: { focus(id: string): Promise<void>; travelTo(id: string): Promise<void>; select(id: string | null): void; setScale(s: number, o?: unknown): void } }

export interface ProbeOptions {
  /** Place the camera looking at this entity from `dist` metres (at `elevDeg` above the ecliptic). */
  focus?: string;
  dist?: number;
  elevDeg?: number;
  mode?: 'exhibition' | 'true';
  overlay?: boolean;
  /** Travel (animated) to this entity after placing the camera. */
  travel?: string;
  /** Log (console.warn) the drawn-radius history of this entity during the first `traceSec` seconds. */
  trace?: string;
  traceSec?: number;
}

const ECL_POLE = new THREE.Vector3(0, -0.3977771559, 0.9174820621); // ecliptic north pole in ICRS (obliquity 23.44°)

export async function install(opts: ProbeOptions = {}): Promise<unknown> {
  const h = (window as unknown as { __cosmos: Handle & { ready: Promise<void> } }).__cosmos;
  await h.ready;
  const { registry, store } = h;
  if (opts.mode) setVisualScale(store, opts.mode);
  store.setState(s => ({ time: { ...s.time, paused: true } }));
  const registered: string[] = [];
  const reg = (): void => {
    for (const id of IDS) {
      if (isScaledBody(id)) continue;
      const e = registry.get(id);
      if (e) { registerScaledBody(e); registered.push(id); }
    }
  };
  reg();
  registry.onChange(reg);

  if (opts.overlay !== false) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
    document.body.appendChild(cv);
    const g = cv.getContext('2d')!;
    const world = new THREE.Vector3(), truePos = new THREE.Vector3();
    const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
    const sp2: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
    const layer: Layer = {
      id: 'debug:visual-scale', init() {},
      update(ctx: FrameContext) {
        const dpr = ctx.viewport.pixelRatio || 1;
        if (cv.width !== Math.round(ctx.viewport.width * dpr)) { cv.width = Math.round(ctx.viewport.width * dpr); cv.height = Math.round(ctx.viewport.height * dpr); }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, ctx.viewport.width, ctx.viewport.height);
        g.font = '11px monospace';
        for (const id of IDS) {
          const e: Entity | undefined = registry.get(id);
          if (!e || !e.radiusM) continue;
          const f = renderTransform(e, ctx.timeMs, world);
          e.position(ctx.timeMs, truePos);
          ctx.project(world, sp);
          if (!sp.visible) continue;
          const d = world.distanceTo(ctx.cameraPosition);
          const r = ctx.pixelDiameter(e.radiusM * f, d) / 2;
          if (r > 3000) continue;
          g.strokeStyle = e.kind === 'moon' ? 'rgba(120,220,255,0.9)' : 'rgba(255,200,90,0.95)';
          g.lineWidth = 1;
          g.beginPath(); g.arc(sp.x, sp.y, Math.max(r, 1.5), 0, Math.PI * 2); g.stroke();
          ctx.project(truePos, sp2);
          if (sp2.visible && Math.hypot(sp2.x - sp.x, sp2.y - sp.y) > 2) { g.fillStyle = 'rgba(255,80,80,0.9)'; g.fillRect(sp2.x - 1, sp2.y - 1, 2, 2); }
          if (r > 1.5 || e.kind !== 'moon') { g.fillStyle = 'rgba(230,230,230,0.85)'; g.fillText(`${e.name} ×${f < 10 ? f.toFixed(2) : f.toFixed(0)}`, sp.x + Math.max(r, 2) + 3, sp.y - 3); }
        }
        const v = getScaleView();
        g.fillStyle = 'rgba(230,230,230,0.9)';
        g.fillText(`mode ${v.mode} w=${v.weight.toFixed(2)}  focus ${ctx.focusEntityId}  d=${ctx.focusDistanceM.toExponential(2)} m`, 14, ctx.viewport.height - 90);
      },
    };
    h.engine.addLayer(layer);
  }

  if (opts.trace) {
    const id = opts.trace;
    const rows: Array<[number, number, number]> = [];
    const w = new THREE.Vector3();
    const t0 = performance.now();
    h.engine.addLayer({
      id: 'debug:visual-scale-trace', init() {},
      update(ctx: FrameContext) {
        const e = registry.get(id);
        if (!e || !e.radiusM || performance.now() - t0 > (opts.traceSec ?? 10) * 1000) return;
        const f = renderTransform(e, ctx.timeMs, w);
        const d = w.distanceTo(ctx.cameraPosition);
        rows.push([d / e.radiusM, f, ctx.pixelDiameter(e.radiusM * f, d)]);
      },
    });
    setTimeout(() => {
      // Pop metric: frame-to-frame change of the drawn size NOT explained by the camera motion (true size change).
      let maxJump = 0, at = 0;
      for (let i = 1; i < rows.length; i++) {
        const j = Math.abs(Math.log(rows[i][1] / rows[i - 1][1]));
        const motion = Math.abs(Math.log(rows[i][0] / rows[i - 1][0]));
        const excess = j / Math.max(motion, 1e-6);
        if (j > 1e-4 && excess > maxJump) { maxJump = excess; at = i; }
      }
      const pick = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 14)) === 0).map(r => `${r[0].toFixed(0)}R ×${r[1].toFixed(2)} ${r[2].toFixed(1)}px`);
      console.warn(`[vs-trace] ${id} frames=${rows.length} maxFactorChangePerDistanceChange=${maxJump.toFixed(3)} (1 = drawn size frozen) at ${rows[at]?.map(v => v.toFixed(2)).join('/')} | ${pick.join(' | ')}`);
    }, (opts.traceSec ?? 10) * 1000 + 50);
  }

  if (opts.focus) {
    const id = opts.focus;
    const e = registry.get(id);
    if (e) {
      const t = store.getState().time.simTimeMs;
      const p = e.position(t, new THREE.Vector3());
      const sun = registry.get('sol:sun')?.position(t, new THREE.Vector3()) ?? new THREE.Vector3();
      const toSun = sun.clone().sub(p);
      if (toSun.lengthSq() === 0) toSun.set(1, 0, 0);
      toSun.normalize();
      const elev = ((opts.elevDeg ?? 35) * Math.PI) / 180;
      const side = new THREE.Vector3().crossVectors(ECL_POLE, toSun).normalize();
      // 60° phase from the Sun direction, lifted by elev.
      const dir = toSun.clone().applyAxisAngle(ECL_POLE, (60 * Math.PI) / 180).multiplyScalar(Math.cos(elev)).addScaledVector(ECL_POLE, Math.sin(elev)).normalize();
      void side;
      const dist = opts.dist ?? 3 * (e.radiusM ?? 1);
      const offset = dir.multiplyScalar(dist);
      const look = offset.clone().negate().normalize();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, ECL_POLE);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      await h.engine.services.cameraController.setView(
        { anchorId: id, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: id, scaleLog10: Math.log10(dist) },
        { instant: true },
      );
    }
  }
  if (opts.travel) void h.commands.travelTo(opts.travel);
  return { registered };
}


