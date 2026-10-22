/**
 * Engine runtime (docs/ARCHITECTURE.md §5): renderer, render groups, frame loop, FrameContext, layers,
 * picking, labels, post-processing, quality, perf and the throttled store mirror.
 *
 * Camera & depth. The three.js camera sits at the render-space origin every frame (floating origin) with
 * fovY = 50°. The camera rig supplies metersPerUnit = focusDistance / 1000, so the focus target is always
 * ~1000 render units away. With a logarithmic depth buffer the depth precision depends on log2(far + 1)
 * (≈ 50 octaves for far = 1e15, i.e. ~3·10⁵ depth steps per octave with a 24-bit buffer — sub-ppm relative
 * resolution), not on the near/far ratio, so near can be tiny without z-fighting: near = 1e-5 units
 * (focusDistance·1e-8 — lets the camera come within centimetres of a spacecraft focused from metres away)
 * and far = 1e15 units, the render-space bound every layer respects (types.ts).
 *
 * Robustness. A layer whose init/update/collectLabels/pick throws is disabled (its private child groups are
 * hidden), a notice is pushed and 'layer-error' is emitted; the app keeps running. Rendering pauses while
 * the document is hidden; simulation time stays continuous (the hidden interval is applied on return).
 */
import * as THREE from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { CosmosStore, CosmosState, Crumb } from '../state/store';
import { pushNotice } from '../state/store';
import type { DataManifest } from '../data/provenance';
import type { Entity, EntityRegistry } from './entity';
import {
  RENDER_ORDER,
  type EngineEvents,
  type EngineServices,
  type FrameContext,
  type LabelCandidate,
  type Layer,
  type OverlayId,
  type PerfSnapshot,
  type QualityProfile,
  type RenderGroups,
  type RendererCapabilities,
  type ScreenPoint,
  type SpectralBandId,
  type Viewport,
} from './types';
import { applyProjectionShift, createCameraRig, type CameraFrameState, type CameraRig } from './camera/rig';
import { createEventBus, type DisposableEventBus } from './events';
import { createTimeController, type SimulationClock } from './time';
import { createAssetLoader, type CosmosAssetLoader } from './assets';
import { createPicker, DEFAULT_PICK_RADIUS_PX, TOUCH_PICK_RADIUS_PX, type Picker } from './picking';
import { createLabelManager, labelTier, labelViewBudget, type LabelManager } from './labels';
import { createPostPipeline, type PostPipeline } from './post';
import { createQualityController, pickInitialQuality, type QualityController } from './quality';
import { createPerfMonitor, createShaderWarmup, type PerfMonitor } from './perf';
import { createEnvironmentCapturer, type EnvironmentCapturer } from './env';
import { renderPosition, renderTransform } from './visualScale';

export const CAMERA_FOV_DEG = 50;
export const CAMERA_NEAR_UNITS = 1e-5;
export const CAMERA_FAR_UNITS = 1e15;
const MAX_DT_SEC = 0.1;
const STORE_MIRROR_INTERVAL_MS = 100;
const FRAME_STATS_INTERVAL_MS = 500;
const SCREEN_MARGIN_PX = 32;
const QUALITY_WARMUP_MS = 1500;
/** Longest the boot screen waits for the first shader programs to link (engine `ready`). */
const BOOT_COMPILE_CAP_MS = 6000;
/** Entity ids that live inside the Solar System (their labels are dropped at extragalactic scales). */
const SOLAR_LABEL_PREFIX = /^(sol|sc|sb|sat|feat|deb):/;

export class WebGLUnsupportedError extends Error {
  constructor(message = 'WebGL 2 is not available in this browser.') {
    super(message);
    this.name = 'WebGLUnsupportedError';
  }
}

/** Entity registry as the engine needs it (the core registry adds `list()` for generic picking). */
export type EngineRegistry = EntityRegistry & { list?(): readonly Entity[]; readonly version?: number };

export interface EngineOptions {
  container: HTMLElement;
  store: CosmosStore;
  registry: EngineRegistry;
  initialFocusId?: string;
  /** Initial simulation time, Unix ms (default: now). */
  timeMs?: number;
  /** Data-source registry accessor exposed to layers via services.manifest(). */
  manifest?: () => DataManifest | null;
}

/** Interaction targets for canvas/label clicks (wired to AppCommands by createCosmos). */
export interface InteractionHandlers {
  select(id: string | null): void;
  focus(id: string): void;
}

export interface Engine {
  readonly services: EngineServices;
  readonly rig: CameraRig;
  /** Simulation clock (TimeController + tick/onChange). */
  readonly time: SimulationClock;
  readonly labels: LabelManager;
  readonly post: PostPipeline;
  readonly canvas: HTMLCanvasElement;
  /** Resolves when the first frame has been rendered. */
  readonly ready: Promise<void>;
  addLayer(layer: Layer): void;
  removeLayer(id: string): void;
  layers(): readonly Layer[];
  /** True while the layer is initialized and not disabled by an error. */
  isLayerActive(id: string): boolean;
  start(): void;
  stop(): void;
  dispose(): void;
  /** Entity under a CSS-pixel point of the viewport, or null. */
  pickAt(x: number, y: number): string | null;
  perf(): PerfSnapshot;
  setInteractionHandlers(handlers: InteractionHandlers): void;
  /** The FrameContext of the last frame (read-only; valid until the next frame). */
  frameContext(): FrameContext;
}

interface LayerRecord {
  layer: Layer;
  groups: RenderGroups;
  state: 'init' | 'active' | 'failed';
}

type MutableFrameContext = {
  -readonly [K in keyof FrameContext]: FrameContext[K];
};

function detectWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function makeGroup(name: string, order: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.renderOrder = order;
  return g;
}

export function createEngine(opts: EngineOptions): Engine {
  const { container, store, registry } = opts;

  if (!detectWebGL2()) {
    store.setState(s => ({ boot: { ...s.boot, webgl: 'unsupported', phase: 'error', error: 'WebGL 2 is not available.' } }));
    throw new WebGLUnsupportedError();
  }

  // ── Renderer ──────────────────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.className = 'cosmos-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D view of the universe. Drag to orbit, scroll to change scale.');
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
  } catch (err) {
    canvas.remove();
    store.setState(s => ({ boot: { ...s.boot, webgl: 'unsupported', phase: 'error', error: errorText(err) } }));
    throw new WebGLUnsupportedError(`Could not create a WebGL 2 context: ${errorText(err)}`);
  }
  renderer.setClearColor(0x000000, 1);
  // Shader info-log queries are synchronous GPU-process round trips per program; keep them for development only (perf).
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.info.autoReset = false;
  store.setState(s => ({ boot: { ...s.boot, webgl: 'ok' } }));

  const gl = renderer.getContext();
  let gpuString = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    gpuString = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    gpuString = '';
  }
  const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

  const perfMon: PerfMonitor = createPerfMonitor(renderer);
  const capabilities: RendererCapabilities = {
    webgl2: true,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    floatRenderTargets: halfFloat,
    gpuTimer: perfMon.gpuTimer,
    logarithmicDepth: renderer.capabilities.logarithmicDepthBuffer,
    gpu: gpuString,
  };

  // ── Scene & groups ────────────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.name = 'Cosmos';
  scene.matrixWorldAutoUpdate = true;
  const groups: RenderGroups = {
    background: makeGroup('background', RENDER_ORDER.background),
    main: makeGroup('main', RENDER_ORDER.main),
    far: makeGroup('far', RENDER_ORDER.far),
    transparent: makeGroup('transparent', RENDER_ORDER.transparent),
    overlay: makeGroup('overlay', RENDER_ORDER.overlay),
  };
  scene.add(groups.background, groups.main, groups.far, groups.transparent, groups.overlay);

  const fovYRad = THREE.MathUtils.degToRad(CAMERA_FOV_DEG);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR_UNITS, CAMERA_FAR_UNITS);
  camera.name = 'Cosmos.renderCamera';
  camera.matrixAutoUpdate = false;

  // ── Services ──────────────────────────────────────────────────────────────────────────────
  const events: DisposableEventBus<EngineEvents> = createEventBus<EngineEvents>();
  const notice = (kind: 'info' | 'warning' | 'error', text: string, ttlMs?: number): void => {
    pushNotice(store, { kind, text, ttlMs });
  };
  const time = createTimeController({
    startMs: opts.timeMs,
    onClamp: message => notice('info', message, 6000),
  });
  const assets: CosmosAssetLoader = createAssetLoader({ renderer, store });
  const post = createPostPipeline({ renderer, scene, camera, halfFloat, registry });
  const shaderWarmup = createShaderWarmup(renderer, scene, camera);
  const capturer: EnvironmentCapturer = createEnvironmentCapturer({
    renderer,
    scene,
    overlay: groups.overlay,
    near: CAMERA_NEAR_UNITS,
    far: CAMERA_FAR_UNITS,
    halfFloat,
  });

  const viewport: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  let handlers: InteractionHandlers = {
    select: id => store.setState(s => ({ selection: { id }, ui: { ...s.ui, inspectorOpen: id !== null } })),
    focus: id => {
      void rig.focus(id);
    },
  };

  let ctx!: MutableFrameContext;
  let picker!: Picker;
  const coarsePointer = (() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  })();
  const pickRadius = coarsePointer ? TOUCH_PICK_RADIUS_PX : DEFAULT_PICK_RADIUS_PX;

  const rig: CameraRig = createCameraRig({
    registry,
    store,
    events,
    inputElement: canvas,
    getViewport: () => viewport,
    fovYRad,
    initialFocusId: opts.initialFocusId,
    onPointerClick: (x, y, double) => {
      const id = pickAt(x, y);
      if (double) {
        if (id) handlers.focus(id);
      } else {
        handlers.select(id);
      }
    },
    onPointerHover: (x, y) => setHover(pickAt(x, y), x, y),
  });

  const cameraController = rig;
  const services: EngineServices = {
    renderer,
    scene,
    camera,
    groups,
    registry,
    time,
    cameraController,
    store,
    assets,
    events,
    capabilities,
    manifest: () => opts.manifest?.() ?? null,
    captureEnvironment(world: THREE.Vector3, size: number, hide?: THREE.Object3D[]): THREE.CubeTexture {
      ctx.toRender(world, captureScratch);
      return capturer.capture(captureScratch, size, hide);
    },
    addPostPass(pass: Pass, order: number): () => void {
      return post.addPass(pass, order);
    },
  };
  const captureScratch = new THREE.Vector3();

  // ── Store cache (read side) ───────────────────────────────────────────────────────────────
  let st = store.getState();
  let selectedId = st.selection.id;
  let hoveredId = st.hover.id;
  let overlays: Readonly<Record<OverlayId, boolean>> = st.overlays;
  let spectralBand: SpectralBandId = st.spectral.band;
  let reducedMotion = st.ui.reducedMotion;

  const quality: QualityController = createQualityController({
    preset: st.quality.preset,
    autoBase: pickInitialQuality({
      gpu: gpuString,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      mobile: coarsePointer,
    }),
  });
  let profile: QualityProfile = quality.profile;

  const unsubscribeStore = store.subscribe((s: CosmosState, prev: CosmosState) => {
    st = s;
    if (s.selection !== prev.selection) selectedId = s.selection.id;
    if (s.hover !== prev.hover) hoveredId = s.hover.id;
    if (s.overlays !== prev.overlays) {
      overlays = s.overlays;
      ctx.overlays = overlays;
    }
    if (s.spectral !== prev.spectral) {
      spectralBand = s.spectral.band;
      ctx.spectralBand = spectralBand;
    }
    if (s.ui.reducedMotion !== prev.ui.reducedMotion) {
      reducedMotion = s.ui.reducedMotion;
      ctx.reducedMotion = reducedMotion;
      post.setReducedMotion(reducedMotion);
    }
    if (s.quality.preset !== prev.quality.preset && s.quality.preset !== quality.preset) {
      if (quality.setPreset(s.quality.preset)) applyProfile();
    }
  });

  // ── FrameContext ──────────────────────────────────────────────────────────────────────────
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const camFwd = new THREE.Vector3(0, 0, -1);
  const viewProj = new THREE.Matrix4();
  const tmp = new THREE.Vector3();

  // ── Label occlusion: hide labels of things behind a resolved body disc (the focus and its parent chain). ──
  const occluders: { x: number; y: number; r: number; d: number; R: number; id: string }[] = [];
  for (let i = 0; i < 3; i++) occluders.push({ x: 0, y: 0, r: 0, d: 0, R: 0, id: '' });
  // Same discs as [x, y, r] triples for the label manager's placement (labels outside a disc never spill onto it).
  const occDiscs = new Float64Array(9);
  let occDiscCount = 0;
  const occScreen: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const occWorld = new THREE.Vector3();
  function occludeLabels(out: LabelCandidate[]): void {
    let n = 0;
    let id: string | null = ctx.focusEntityId;
    for (let depth = 0; id && depth < 3; depth++) {
      const e = registry.get(id);
      if (!e) break;
      if (e.radiusM && e.radiusM > 0) {
        // Drawn (exhibition-scale) disc: position and radius from src/core/visualScale.ts (identity when unregistered).
        const f = renderTransform(e, ctx.timeMs, occWorld);
        const d = occWorld.distanceTo(ctx.cameraPosition);
        ctx.project(occWorld, occScreen);
        const r = 0.5 * ctx.pixelDiameter(e.radiusM * f, d);
        if (occScreen.depthM > 0 && r > 6) {
          const o = occluders[n++];
          o.x = occScreen.x;
          o.y = occScreen.y;
          o.r = r;
          o.d = d;
          o.R = e.radiusM * f;
          o.id = e.id;
        }
      }
      id = e.parentId;
    }
    occDiscCount = n;
    for (let k = 0; k < n; k++) {
      occDiscs[3 * k] = occluders[k].x;
      occDiscs[3 * k + 1] = occluders[k].y;
      occDiscs[3 * k + 2] = occluders[k].r * 1.04 + 4;
    }
    if (n === 0) return;
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      let hidden = false;
      for (let k = 0; k < n && !hidden; k++) {
        const o = occluders[k];
        // A body that fills a good part of the frame needs no name tag (the breadcrumb and inspector name it);
        // its edge-anchored label would otherwise sit on the HUD readouts.
        if (c.entityId === o.id) {
          hidden = o.r > 0.2 * ctx.viewport.height;
          continue;
        }
        const dx = c.x - o.x;
        const dy = c.y - o.y;
        // A little beyond the limb: the atmosphere/glow halo hides star labels just past the disc edge too.
        const rr = o.r * 1.04 + 6;
        const rho2 = dx * dx + dy * dy;
        if (rho2 > rr * rr) continue;
        const ce = c.entityId ? registry.get(c.entityId) : undefined;
        // Behind the visible surface along the anchor's line of sight (sphere depth there, not the centre's), so a
        // satellite crossing in front of the disc keeps its label and one behind the limb loses it.
        const front = o.d - o.R * Math.sqrt(Math.max(0, 1 - rho2 / (o.r * o.r)));
        hidden = ce ? renderPosition(ce, ctx.timeMs, occWorld).distanceTo(ctx.cameraPosition) > front : true;
      }
      if (!hidden) out[w++] = c;
    }
    out.length = w;
  }

  ctx = {
    frame: 0,
    timeMs: time.nowMs,
    dtRealSec: 0,
    dtSimSec: 0,
    cameraPosition: camPos,
    cameraQuaternion: camQuat,
    cameraForward: camFwd,
    metersPerUnit: 1,
    scaleLog10: 7,
    focusDistanceM: 1,
    focusEntityId: null,
    selectedId,
    hoveredId,
    viewport,
    fovYRad,
    pixelsPerRadian: 1,
    quality: profile,
    spectralBand,
    overlays,
    reducedMotion,
    toRender(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
      const k = 1 / ctx.metersPerUnit;
      return out.set((world.x - camPos.x) * k, (world.y - camPos.y) * k, (world.z - camPos.z) * k);
    },
    pixelDiameter(radiusM: number, distanceM: number): number {
      if (!(radiusM > 0)) return 0;
      if (!(distanceM > radiusM)) return viewport.height * 2;
      return 2 * Math.asin(radiusM / distanceM) * ctx.pixelsPerRadian;
    },
    project(world: THREE.Vector3, out: ScreenPoint): ScreenPoint {
      const dx = world.x - camPos.x;
      const dy = world.y - camPos.y;
      const dz = world.z - camPos.z;
      out.depthM = dx * camFwd.x + dy * camFwd.y + dz * camFwd.z;
      if (!(out.depthM > 0)) {
        out.x = Number.NaN;
        out.y = Number.NaN;
        out.visible = false;
        return out;
      }
      // Normalize before the matrix: only direction matters for projection, and it keeps float error bounded.
      const len = Math.hypot(dx, dy, dz);
      tmp.set(dx / len, dy / len, dz / len).applyMatrix4(viewProj);
      out.x = (tmp.x * 0.5 + 0.5) * viewport.width;
      out.y = (0.5 - tmp.y * 0.5) * viewport.height;
      out.visible =
        out.x >= -SCREEN_MARGIN_PX && out.x <= viewport.width + SCREEN_MARGIN_PX &&
        out.y >= -SCREEN_MARGIN_PX && out.y <= viewport.height + SCREEN_MARGIN_PX;
      return out;
    },
  };

  // ── Layers ────────────────────────────────────────────────────────────────────────────────
  const records: LayerRecord[] = [];
  const activeLayers: Layer[] = [];
  const refreshActive = (): void => {
    activeLayers.length = 0;
    for (const r of records) if (r.state === 'active') activeLayers.push(r.layer);
  };

  const layerGroups = (id: string): RenderGroups => {
    const g = {} as RenderGroups;
    for (const key of Object.keys(groups) as (keyof RenderGroups)[]) {
      const child = makeGroup(`${key}:${id}`, groups[key].renderOrder);
      groups[key].add(child);
      g[key] = child;
    }
    return g;
  };

  const setGroupsVisible = (g: RenderGroups, visible: boolean): void => {
    for (const key of Object.keys(g) as (keyof RenderGroups)[]) g[key].visible = visible;
  };

  const failLayer = (rec: LayerRecord, phase: string, err: unknown): void => {
    if (rec.state === 'failed') return;
    rec.state = 'failed';
    setGroupsVisible(rec.groups, false);
    refreshActive();
    const message = errorText(err);
    console.error(`[cosmos] layer '${rec.layer.id}' ${phase} failed`, err);
    notice('warning', `Part of the view ("${rec.layer.id}") failed and was turned off. Everything else keeps working.`, 10000);
    events.emit('layer-error', { layerId: rec.layer.id, error: message });
  };

  const recordFor = (layer: Layer): LayerRecord | undefined => records.find(r => r.layer === layer);

  const addLayer = (layer: Layer): void => {
    if (records.some(r => r.layer.id === layer.id)) {
      console.warn(`[cosmos] layer '${layer.id}' already added`);
      return;
    }
    const rec: LayerRecord = { layer, groups: layerGroups(layer.id), state: 'init' };
    records.push(rec);
    const layerServices: EngineServices = { ...services, groups: rec.groups };
    let result: void | Promise<void>;
    try {
      result = layer.init(layerServices);
    } catch (err) {
      failLayer(rec, 'init', err);
      return;
    }
    const activate = (): void => {
      if (rec.state !== 'init' || !records.includes(rec)) return;
      rec.state = 'active';
      try {
        layer.resize?.(viewport);
      } catch (err) {
        failLayer(rec, 'resize', err);
        return;
      }
      refreshActive();
      events.emit('layer-ready', { layerId: layer.id });
    };
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).then(activate, err => failLayer(rec, 'init', err));
    } else {
      activate();
    }
  };

  const removeLayer = (id: string): void => {
    const i = records.findIndex(r => r.layer.id === id);
    if (i < 0) return;
    const rec = records[i];
    records.splice(i, 1);
    refreshActive();
    try {
      rec.layer.dispose?.();
    } catch (err) {
      console.error(`[cosmos] layer '${id}' dispose threw`, err);
    }
    for (const key of Object.keys(rec.groups) as (keyof RenderGroups)[]) rec.groups[key].removeFromParent();
  };

  // ── Picking & labels ──────────────────────────────────────────────────────────────────────
  const labelTiers = new Map<string, number>();
  const labels = createLabelManager({
    parent: container,
    onSelect: id => handlers.select(id),
    onFocus: id => handlers.focus(id),
    onHover: id => setHover(id, Number.NaN, Number.NaN),
    wheelTarget: canvas,
    tierOf: c => {
      if (c.entityId === null) return 0;
      let t = labelTiers.get(c.entityId);
      if (t === undefined) {
        const e = registry.get(c.entityId);
        t = labelTier(c.entityId, e?.kind, c.kind);
        // Unregistered ids (still loading) are re-resolved on a later frame.
        if (e) labelTiers.set(c.entityId, t);
      }
      return t;
    },
  });

  picker = createPicker({
    entities: () => registry.list?.() ?? [],
    isLabelShown: id => labels.isShown(id),
    onLayerError: (layer, err) => {
      const rec = recordFor(layer);
      if (rec) failLayer(rec, 'pick', err);
    },
  });

  function pickAt(x: number, y: number): string | null {
    if (ctx.frame === 0) return null;
    try {
      return picker.pick(ctx, activeLayers, x, y, pickRadius);
    } catch (err) {
      console.error('[cosmos] picking failed', err);
      return null;
    }
  }

  function setHover(id: string | null, x: number, y: number): void {
    const cur = st.hover;
    if (cur.id === id && (Number.isNaN(x) || (cur.x === x && cur.y === y))) return;
    const changed = cur.id !== id;
    store.setState({ hover: { id, x: Number.isNaN(x) ? cur.x : x, y: Number.isNaN(y) ? cur.y : y } });
    if (changed) {
      canvas.style.cursor = id ? 'pointer' : '';
      events.emit('hover', { id });
    }
  }

  // ── Sizing & quality ──────────────────────────────────────────────────────────────────────
  let cssW = 0;
  let cssH = 0;
  const applySize = (): void => {
    const w = Math.max(1, Math.floor(container.clientWidth));
    const h = Math.max(1, Math.floor(container.clientHeight));
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pr = Math.max(0.25, Math.min(dpr, profile.maxPixelRatio) * profile.renderScale);
    if (w === cssW && h === cssH && Math.abs(pr - viewport.pixelRatio) < 1e-3) return;
    cssW = w;
    cssH = h;
    viewport.width = w;
    viewport.height = h;
    viewport.pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    ctx.pixelsPerRadian = h / fovYRad;
    perfMon.setScaleInfo(pr, profile.renderScale);
    for (const rec of records) {
      if (rec.state !== 'active') continue;
      try {
        rec.layer.resize?.(viewport);
      } catch (err) {
        failLayer(rec, 'resize', err);
      }
    }
  };

  function applyProfile(): void {
    const prevPreset = profile.preset;
    profile = quality.profile;
    ctx.quality = profile;
    post.applyQuality(profile);
    applySize();
    if (prevPreset !== profile.preset || st.quality.effective !== profile.preset) {
      store.setState(s => ({ quality: { ...s.quality, effective: profile.preset } }));
    }
  }
  post.setReducedMotion(reducedMotion);
  post.applyQuality(profile);
  store.setState(s => ({ quality: { ...s.quality, effective: profile.preset } }));

  const resizeObserver = new ResizeObserver(() => applySize());
  resizeObserver.observe(container);
  applySize();

  // ── Store mirror (write side, ~10 Hz) ─────────────────────────────────────────────────────
  let breadcrumbKey = '';
  let breadcrumb: Crumb[] = [];
  let travelTargetId: string | null = null;
  const offTravelStart = events.on('travel-start', e => {
    travelTargetId = e.targetId;
  });
  const offTravelEnd = events.on('travel-end', () => {
    travelTargetId = null;
  });

  const computeBreadcrumb = (focusId: string | null): Crumb[] => {
    const key = `${focusId ?? ''}|${registry.version ?? 0}`;
    if (key === breadcrumbKey) return breadcrumb;
    breadcrumbKey = key;
    if (!focusId) {
      breadcrumb = [];
      return breadcrumb;
    }
    const focus = registry.get(focusId);
    const chain = registry.ancestors(focusId).reverse();
    breadcrumb = chain.map(e => ({ id: e.id, name: e.name }));
    if (focus) breadcrumb.push({ id: focus.id, name: focus.name });
    return breadcrumb;
  };

  const mirrorTime = (): void => {
    const t = st.time;
    if (t.simTimeMs === time.nowMs && t.rate === time.rate && t.paused === time.paused) return;
    store.setState({ time: { simTimeMs: time.nowMs, rate: time.rate, paused: time.paused } });
  };
  const offTime = time.onChange(mirrorTime);

  const mirror = (cam: CameraFrameState, fps: number): void => {
    const s = st;
    const crumbs = computeBreadcrumb(cam.focusId);
    const patch: Partial<CosmosState> = {};
    const v = s.view;
    if (
      v.scaleLog10 !== cam.scaleLog10 || v.focusDistanceM !== cam.focusDistanceM ||
      v.breadcrumb !== crumbs || v.frameLabel !== cam.frameLabel
    ) {
      patch.view = { scaleLog10: cam.scaleLog10, focusDistanceM: cam.focusDistanceM, breadcrumb: crumbs, frameLabel: cam.frameLabel };
    }
    const c = s.camera;
    const traveling = rig.traveling;
    if (c.mode !== rig.mode || c.focusId !== cam.focusId || c.traveling !== traveling || c.travelTargetId !== travelTargetId) {
      patch.camera = { mode: rig.mode, focusId: cam.focusId, traveling, travelTargetId: traveling ? travelTargetId : null };
    }
    const t = s.time;
    if (t.simTimeMs !== time.nowMs || t.rate !== time.rate || t.paused !== time.paused) {
      patch.time = { simTimeMs: time.nowMs, rate: time.rate, paused: time.paused };
    }
    const roundedFps = Math.round(fps);
    if (s.quality.fps !== roundedFps || s.quality.effective !== profile.preset) {
      patch.quality = { ...s.quality, fps: roundedFps, effective: profile.preset };
    }
    if (Object.keys(patch).length > 0) store.setState(patch);
  };

  // ── Frame loop ────────────────────────────────────────────────────────────────────────────
  const labelCandidates: LabelCandidate[] = [];
  let rafId = 0;
  let running = false;
  let contextLost = false;
  let lastFrameMs = 0;
  let hiddenSinceMs = 0;
  let lastMirrorMs = 0;
  let lastStatsMs = 0;
  let disposed = false;
  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let firstFrame = true;
  let readyResolved = false;
  let readyMs = Number.POSITIVE_INFINITY;
  let settledFrames = 0;
  let firstFrameMs = Number.POSITIVE_INFINITY;
  let consecutiveRenderErrors = 0;
  // Boot progress while the first programs link (0.7 -> 0.98, monotonic): half the share of gated objects linked so
  // far (objects gated later add to the total), half the elapsed share of BOOT_COMPILE_CAP_MS, the wait's hard bound.
  let bootGatedTotal = 0;
  let bootGatedPrev = 0;
  let bootLinked = 0;
  let bootReportMs = Number.NEGATIVE_INFINITY;
  const reportBootLink = (now: number): void => {
    const gated = shaderWarmup.gated;
    bootGatedTotal += Math.max(0, gated - bootGatedPrev);
    bootGatedPrev = gated;
    const linked = Math.max(bootLinked, bootGatedTotal - gated);
    if (linked === bootLinked && now - bootReportMs < 150) return;
    bootLinked = linked;
    bootReportMs = now;
    const linkShare = bootGatedTotal > 0 ? linked / bootGatedTotal : 1;
    const timeShare = Math.min(1, Math.max(0, now - firstFrameMs) / BOOT_COMPILE_CAP_MS);
    const progress = 0.7 + 0.28 * (0.5 * linkShare + 0.5 * timeShare);
    const message = bootGatedTotal > 0 ? `Compiling shaders · ${linked} of ${bootGatedTotal} objects` : 'Compiling shaders';
    store.setState(s => ({ boot: { ...s.boot, progress: Math.max(s.boot.progress, progress), message } }));
  };

  const applyCamera = (cam: CameraFrameState): void => {
    camPos.copy(cam.position);
    camQuat.copy(cam.quaternion);
    camFwd.copy(cam.forward);
    ctx.metersPerUnit = cam.metersPerUnit > 0 ? cam.metersPerUnit : 1;
    ctx.scaleLog10 = cam.scaleLog10;
    ctx.focusDistanceM = cam.focusDistanceM;
    ctx.focusEntityId = cam.focusId;
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(cam.quaternion);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    // Off-axis inspect framing from the rig (fraction of viewport width; + moves the focus right).
    applyProjectionShift(camera, viewport, cam.projectionShiftX);
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  };

  const frame = (now: number): void => {
    if (!running || disposed) return;
    rafId = requestAnimationFrame(frame);
    if (contextLost) return;

    perfMon.beginFrame(now);
    renderer.info.reset();
    const dtReal = lastFrameMs === 0 ? 1 / 60 : Math.min(MAX_DT_SEC, Math.max(0, (now - lastFrameMs) / 1000));
    lastFrameMs = now;

    const dtSim = time.tick(dtReal);
    let cam: CameraFrameState;
    try {
      cam = rig.update(dtReal, time.nowMs);
    } catch (err) {
      console.error('[cosmos] camera update failed', err);
      perfMon.endFrame(performance.now());
      return;
    }
    applyCamera(cam);

    ctx.frame += 1;
    ctx.timeMs = time.nowMs;
    ctx.dtRealSec = dtReal;
    ctx.dtSimSec = dtSim;
    ctx.selectedId = selectedId;
    ctx.hoveredId = hoveredId;

    for (let i = 0; i < activeLayers.length; i++) {
      const layer = activeLayers[i];
      try {
        layer.update(ctx);
      } catch (err) {
        const rec = recordFor(layer);
        if (rec) {
          failLayer(rec, 'update', err);
          i--;
        }
      }
    }

    labelCandidates.length = 0;
    for (let i = 0; i < activeLayers.length; i++) {
      const layer = activeLayers[i];
      if (!layer.collectLabels) continue;
      try {
        layer.collectLabels(ctx, labelCandidates);
      } catch (err) {
        const rec = recordFor(layer);
        if (rec) {
          failLayer(rec, 'collectLabels', err);
          i--;
        }
      }
    }
    // Scale bands: beyond the Milky Way (~20 kpc of visible width and wider) Solar System labels (Sun, Earth, moons,
    // spacecraft, small bodies, surface features) would all sit on the Milky Way's own label: drop them unless selected.
    if (ctx.scaleLog10 > 21.6) {
      let w = 0;
      for (let i = 0; i < labelCandidates.length; i++) {
        const c = labelCandidates[i];
        const id = c.entityId;
        if (id !== null && id !== selectedId && id !== ctx.focusEntityId && SOLAR_LABEL_PREFIX.test(id)) continue;
        labelCandidates[w++] = c;
      }
      labelCandidates.length = w;
    }
    occludeLabels(labelCandidates);
    labels.update(labelCandidates, {
      selectedId,
      hoveredId,
      viewport,
      budget: labelViewBudget(viewport, profile.labelBudget),
      enabled: overlays.labels,
      nowMs: now,
      discs: occDiscs,
      discCount: occDiscCount,
    });

    shaderWarmup.gate(now);
    try {
      post.update(ctx);
      post.render(dtReal);
      consecutiveRenderErrors = 0;
    } catch (err) {
      consecutiveRenderErrors += 1;
      console.error('[cosmos] render failed', err);
      if (consecutiveRenderErrors === 30) notice('error', 'Rendering keeps failing on this device. Try a lower quality setting.');
    }
    const end = performance.now();
    perfMon.endFrame(end);
    shaderWarmup.tick(end);

    // Skip the first second: shader compilation and uploads make start-up frames unrepresentative.
    if (quality.preset === 'auto' && now - readyMs > QUALITY_WARMUP_MS) {
      const changed = quality.sample(
        { intervalMs: perfMon.lastIntervalMs, cpuMs: perfMon.lastCpuMs, gpuMs: perfMon.lastGpuMs },
        end,
      );
      if (changed) applyProfile();
    }

    if (firstFrame) {
      firstFrame = false;
      firstFrameMs = now;
    }
    // Boot screen stays up while the first programs link in parallel (shader gate), then the scene appears complete.
    if (!readyResolved) {
      settledFrames = shaderWarmup.gated === 0 ? settledFrames + 1 : 0;
      reportBootLink(now);
      if (settledFrames >= 3 || now - firstFrameMs > BOOT_COMPILE_CAP_MS) {
        readyResolved = true;
        readyMs = now;
        resolveReady();
      }
    }
    if (now - lastMirrorMs >= STORE_MIRROR_INTERVAL_MS) {
      lastMirrorMs = now;
      mirror(cam, perfMon.snapshot().fps);
    }
    if (now - lastStatsMs >= FRAME_STATS_INTERVAL_MS) {
      lastStatsMs = now;
      events.emit('frame-stats', perfMon.snapshot());
    }
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      hiddenSinceMs = performance.now();
      if (running) cancelAnimationFrame(rafId);
    } else {
      if (hiddenSinceMs > 0) {
        // Keep simulation time continuous across the hidden interval.
        time.tick((performance.now() - hiddenSinceMs) / 1000);
        hiddenSinceMs = 0;
      }
      lastFrameMs = 0;
      if (running) rafId = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
    labels.clear();
    notice('warning', 'The graphics context was lost. Trying to restore it…');
  };
  const onContextRestored = (): void => {
    contextLost = false;
    lastFrameMs = 0;
    post.applyQuality(profile);
    notice('info', 'Graphics restored.', 4000);
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const start = (): void => {
    if (running || disposed) return;
    running = true;
    lastFrameMs = 0;
    if (!document.hidden) rafId = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    running = false;
    cancelAnimationFrame(rafId);
  };

  const dispose = (): void => {
    if (disposed) return;
    stop();
    disposed = true;
    rejectReady(new Error('Engine disposed before the first frame'));
    ready.catch(() => undefined);
    for (const rec of [...records]) removeLayer(rec.layer.id);
    unsubscribeStore();
    offTime();
    offTravelStart();
    offTravelEnd();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    try {
      rig.dispose();
    } catch (err) {
      console.error('[cosmos] camera dispose threw', err);
    }
    labels.dispose();
    capturer.dispose();
    post.dispose();
    perfMon.dispose();
    shaderWarmup.dispose();
    assets.dispose();
    events.clear();
    renderer.dispose();
    canvas.remove();
  };

  return {
    services,
    rig,
    time,
    labels,
    post,
    canvas,
    ready,
    addLayer,
    removeLayer,
    layers: () => records.map(r => r.layer),
    isLayerActive: id => records.some(r => r.layer.id === id && r.state === 'active'),
    start,
    stop,
    dispose,
    pickAt,
    perf: () => perfMon.snapshot(),
    setInteractionHandlers(h: InteractionHandlers): void {
      handlers = h;
    },
    frameContext: () => ctx,
  };
}
