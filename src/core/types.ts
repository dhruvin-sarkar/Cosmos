/**
 * Engine contracts shared by the core runtime, render domains, labs and UI.
 *
 * ── Render-space rule (precision) ────────────────────────────────────────────────────────────
 * World positions are float64 (JS numbers) in ICRS axes, meters, relative to the Solar System
 * barycenter (SSB). The GPU only ever sees CAMERA-RELATIVE coordinates:
 *     render = (world − ctx.cameraPosition) / ctx.metersPerUnit        (use ctx.toRender)
 * The render camera sits at the origin of render space every frame (floating origin). Never upload
 * absolute world coordinates to the GPU. Point clouds store float32 positions relative to a chunk
 * origin and position the chunk's Object3D with ctx.toRender(chunkOriginWorld).
 * Keep |render coordinates| below ~1e15 units: layers outside their scale range must hide themselves.
 *
 * ── Depth rule ───────────────────────────────────────────────────────────────────────────────
 * The renderer uses a LOGARITHMIC depth buffer. Every custom THREE.ShaderMaterial / RawShaderMaterial
 * MUST include the log-depth chunks or it will depth-test incorrectly:
 *   vertex:   #include <common>  #include <logdepthbuf_pars_vertex>   ... after gl_Position: #include <logdepthbuf_vertex>
 *   fragment: #include <logdepthbuf_pars_fragment>                    ... in main():          #include <logdepthbuf_fragment>
 * (Built-in materials handle this automatically.)
 *
 * ── Frame-loop rule ──────────────────────────────────────────────────────────────────────────
 * Layer.update() runs every frame: no allocations in steady state (reuse scratch Vector3s), no
 * synchronous parsing of large data (use workers / async init), no React state writes.
 */
import type * as THREE from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { EntityRegistry } from './entity';
import type { CosmosStore } from '../state/store';
import type { DataManifest } from '../data/provenance';

// ── Basic types ────────────────────────────────────────────────────────────────────────────

/** Viewport in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

/** Screen position in CSS pixels from the top-left of the viewport. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance from the camera along the view direction, meters (negative = behind camera). */
  depthM: number;
  /** In front of the camera and within the viewport (plus a small margin). */
  visible: boolean;
}

export type QualityPreset = 'auto' | 'performance' | 'balanced' | 'ultra';
export type EffectiveQuality = Exclude<QualityPreset, 'auto'>;

export interface QualityProfile {
  preset: EffectiveQuality;
  /** Cap on device pixel ratio. */
  maxPixelRatio: number;
  /** Dynamic-resolution multiplier applied on top of the pixel ratio (Auto adjusts within [0.5, 1]). */
  renderScale: number;
  bloom: boolean;
  bloomStrength: number;
  msaaSamples: 0 | 2 | 4;
  textureQuality: 'low' | 'high' | 'ultra';
  /** Max catalog stars drawn (catalog is sorted brightest-first, so a prefix is a valid LOD subset). */
  starBudget: number;
  /** Max survey galaxies drawn in the cosmic-web view. */
  galaxyBudget: number;
  /** Max orbital objects drawn. */
  satelliteBudget: number;
  /** Max procedural particles (Milky Way reconstruction, nebulae). */
  particleBudget: number;
  blackHoleQuality: 'fast' | 'high';
  labelBudget: number;
  /** Analytic eclipse / ring-shadow quality. */
  shadowQuality: 'off' | 'low' | 'high';
}

/** Spectral View Switcher bands (each backed by a real survey dataset where available). */
export type SpectralBandId =
  | 'visible' | 'h-alpha' | 'ultraviolet' | 'near-infrared' | 'mid-infrared' | 'far-infrared'
  | 'x-ray' | 'gamma-ray' | 'microwave' | 'cmb' | 'radio';

/** User-toggleable scientific overlays (annotations are toggles, never permanent clutter). */
export type OverlayId =
  | 'labels' | 'orbits' | 'satellites' | 'debris' | 'spacecraft' | 'asteroids'
  | 'constellations' | 'constellation-boundaries'
  | 'grid-equatorial' | 'grid-ecliptic' | 'grid-galactic'
  | 'habitable-zones' | 'milkyway-procedural' | 'scale-markers' | 'light-travel'
  /** Visual exaggeration of body sizes at system scales — must show an "Enlarged ×N (not to scale)" indicator. */
  | 'enlarge-bodies';

export type CameraMode = 'orbit' | 'free' | 'follow';

// ── Per-frame context ──────────────────────────────────────────────────────────────────────

export interface FrameContext {
  readonly frame: number;
  /** Simulation time, Unix ms (UTC). */
  readonly timeMs: number;
  /** Real seconds since the previous frame (clamped to [0, 0.1]). */
  readonly dtRealSec: number;
  /** Simulation seconds advanced this frame (rate × dtReal; negative when time runs backwards). */
  readonly dtSimSec: number;
  /** Camera world position (ICRS, meters, relative to SSB). Do not mutate. */
  readonly cameraPosition: THREE.Vector3;
  /** Camera world orientation (ICRS axes). Do not mutate. */
  readonly cameraQuaternion: THREE.Quaternion;
  /** Unit view direction in ICRS. Do not mutate. */
  readonly cameraForward: THREE.Vector3;
  /** Render scale: render units = (world − camera) / metersPerUnit. */
  readonly metersPerUnit: number;
  /** Cosmic Ruler scale: log10(visible field width in meters at the focus distance). */
  readonly scaleLog10: number;
  /** Distance from the camera to the current focus point, meters. */
  readonly focusDistanceM: number;
  readonly focusEntityId: string | null;
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly viewport: Viewport;
  readonly fovYRad: number;
  /** viewport.height / fovYRad — converts angular size (rad) to CSS px. */
  readonly pixelsPerRadian: number;
  readonly quality: QualityProfile;
  readonly spectralBand: SpectralBandId;
  readonly overlays: Readonly<Record<OverlayId, boolean>>;
  readonly reducedMotion: boolean;
  /** (world − camera) / metersPerUnit → render space. Allocation-free. */
  toRender(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  /** Approximate on-screen diameter in CSS px of a sphere of radius `radiusM` at distance `distanceM`. */
  pixelDiameter(radiusM: number, distanceM: number): number;
  /** Project a world position (ICRS m, rel. SSB) to the screen. Allocation-free. */
  project(world: THREE.Vector3, out: ScreenPoint): ScreenPoint;
}

// ── Layers (render domains implement this) ─────────────────────────────────────────────────

export interface PickHit {
  entityId: string;
  /** Screen distance from the cursor, CSS px. */
  distancePx: number;
  /** Distance from the camera, meters (front-most wins ties). */
  depthM: number;
  /** Importance tie-breaker (entity importance or layer-specific). */
  priority: number;
}

export type LabelKind =
  | 'body' | 'star' | 'satellite' | 'spacecraft' | 'galaxy' | 'structure' | 'constellation' | 'landmark' | 'annotation';

export interface LabelCandidate {
  entityId: string | null;
  text: string;
  /** Anchor screen position, CSS px. */
  x: number;
  y: number;
  /** Higher wins during decluttering. Selected/hovered objects are boosted by the label manager. */
  priority: number;
  kind: LabelKind;
  /** Radial offset from the anchor so labels sit beside a body's disk, CSS px. */
  offsetPx?: number;
  /** 0..1 fade (e.g. while cross-fading representations). */
  opacity?: number;
  /** Secondary text (e.g. distance) shown on hover/selection. */
  detail?: string;
}

export interface Layer {
  readonly id: string;
  /**
   * Called once. Add objects to `svc.groups.*`. Load data asynchronously and show it progressively —
   * never block the first frame on a large dataset. Throwing/rejecting marks the layer failed
   * (the app keeps running and shows a notice).
   */
  init(svc: EngineServices): void | Promise<void>;
  /** Per-frame update: position objects in render space, choose representation/LOD, fade by scale. */
  update(ctx: FrameContext): void;
  /** Return entities under a screen point (CSS px) within `radiusPx`. */
  pick?(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[];
  /** Submit label candidates for this frame (the label manager declutters and renders them). */
  collectLabels?(ctx: FrameContext, out: LabelCandidate[]): void;
  resize?(viewport: Viewport): void;
  dispose?(): void;
}

/** Ordering of the render groups (lower renders first). */
export const RENDER_ORDER = {
  background: -100,
  main: 0,
  far: 5,
  transparent: 10,
  overlay: 20,
} as const;

export interface RenderGroups {
  /** Sky backdrop at infinity (survey maps / star backdrop): drawn first, depthTest=false, depthWrite=false. */
  background: THREE.Group;
  /** Opaque solid bodies (planets, moons, spacecraft meshes). */
  main: THREE.Group;
  /** Point clouds / far field (stars, galaxies, orbital objects): additive, depthWrite=false, depthTest=true. */
  far: THREE.Group;
  /** Transparent volumes: atmospheres, rings, glows, nebulae. */
  transparent: THREE.Group;
  /** Scientific annotations: orbit lines, grids, markers, habitable zones (visually distinct from scenery). */
  overlay: THREE.Group;
}

// ── Services ───────────────────────────────────────────────────────────────────────────────

export interface TimeController {
  /** Current simulation time, Unix ms (UTC). */
  readonly nowMs: number;
  /** Simulation seconds per real second (negative = reverse). */
  readonly rate: number;
  readonly paused: boolean;
  /** Range in which the time-dependent models are valid; jumps outside are clamped with a notice. */
  readonly bounds: { minMs: number; maxMs: number };
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  jumpTo(ms: number): void;
  /** Return to wall-clock now at rate 1. */
  toNow(): void;
}

export interface TravelOptions {
  /** Override automatic duration (seconds of real time). */
  durationSec?: number;
  /** Final camera distance from the target's center, meters (defaults to entity.viewDistance.default). */
  distanceM?: number;
  /** Jump without animation (also used when the user prefers reduced motion). */
  instant?: boolean;
}

export interface CameraViewState {
  anchorId: string;
  /** Camera offset from the anchor's position, meters, ICRS axes. */
  offset: [number, number, number];
  quaternion: [number, number, number, number];
  mode: CameraMode;
  focusId: string | null;
  scaleLog10: number;
}

export interface CameraController {
  readonly mode: CameraMode;
  readonly focusId: string | null;
  readonly anchorId: string;
  readonly traveling: boolean;
  /** Travel to the entity and orbit it. Resolves when the camera arrives (or immediately if instant). */
  focus(id: string, opts?: TravelOptions): Promise<void>;
  /** Cinematic travel that keeps context during long jumps (zoom-out → move → zoom-in profile). */
  travelTo(id: string, opts?: TravelOptions): Promise<void>;
  /** Cosmic Ruler: set the view scale (log10 meters of visible width), re-anchoring along the focus chain. */
  setScale(scaleLog10: number, opts?: { animate?: boolean; durationSec?: number }): void;
  setMode(mode: CameraMode): void;
  getView(): CameraViewState;
  setView(view: CameraViewState, opts?: TravelOptions): Promise<void>;
  /** Navigate back in view history. Returns false when history is empty. */
  back(): boolean;
  cancelTravel(): void;
}

export interface AssetLoader {
  /**
   * Returns a texture immediately (a 1×1 placeholder of `fallbackColor`) and swaps in the image when
   * loaded; on failure keeps the fallback and reports a notice. Never throws. Paths are relative to the
   * app base, e.g. 'textures/earth/day_4k.jpg'.
   */
  texture(path: string, opts?: { colorSpace?: 'srgb' | 'linear'; fallbackColor?: number; anisotropy?: number }): THREE.Texture;
  textureAsync(path: string, opts?: { colorSpace?: 'srgb' | 'linear'; anisotropy?: number }): Promise<THREE.Texture>;
  /** Cached JSON fetch (rejects with a descriptive error). */
  json<T>(path: string): Promise<T>;
  /** Cached binary fetch. */
  binary(path: string): Promise<ArrayBuffer>;
  /** In-flight requests (debug overlay). */
  readonly pending: number;
}

export interface EngineEvents {
  select: { id: string | null };
  hover: { id: string | null };
  'travel-start': { targetId: string };
  'travel-end': { targetId: string; interrupted: boolean };
  'layer-ready': { layerId: string };
  'layer-error': { layerId: string; error: string };
  'frame-stats': PerfSnapshot;
}

export interface EventBus<E> {
  on<K extends keyof E>(type: K, listener: (payload: E[K]) => void): () => void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
}

export interface RendererCapabilities {
  webgl2: boolean;
  maxTextureSize: number;
  floatRenderTargets: boolean;
  gpuTimer: boolean;
  logarithmicDepth: boolean;
  /** Unmasked GPU renderer string when available (debug overlay). */
  gpu: string;
}

export interface PerfSnapshot {
  fps: number;
  cpuFrameMs: number;
  gpuFrameMs: number | null;
  /** Worst frame time over the last ~1 s window. */
  worstFrameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  textures: number;
  geometries: number;
  jsHeapMB: number | null;
  longTasks: number;
  pixelRatio: number;
  renderScale: number;
}

export interface EngineServices {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** Render camera: always at the render-space origin; orientation = camera world orientation. */
  readonly camera: THREE.PerspectiveCamera;
  readonly groups: RenderGroups;
  readonly registry: EntityRegistry;
  readonly time: TimeController;
  readonly cameraController: CameraController;
  readonly store: CosmosStore;
  readonly assets: AssetLoader;
  readonly events: EventBus<EngineEvents>;
  readonly capabilities: RendererCapabilities;
  /** Data-source registry (null until loaded). */
  manifest(): DataManifest | null;
  /**
   * Render a cube map of the scene as seen from a world position (e.g. for black-hole lensing).
   * `hide` objects are excluded during capture. Reuses an internal render target per size.
   */
  captureEnvironment(world: THREE.Vector3, size: number, hide?: THREE.Object3D[]): THREE.CubeTexture;
  /** Insert a post-processing pass (before bloom/tone-mapping); lower order runs first. Returns a remover. */
  addPostPass(pass: Pass, order: number): () => void;
}
