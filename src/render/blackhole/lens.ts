/**
 * BlackHoleLens: the shared ray-traced black-hole renderer (shadow, photon ring, lensed background with secondary
 * images and Einstein rings, thin accretion disc, relativistic jets, an analytic companion star). One instance draws
 * one black hole; a domain keeps one per "hero" slot and points it at the nearest black hole each frame.
 *
 * Proxy: a back-faced sphere around the hole (radius ≥ the lensing sphere, the disc, and the impact parameter where the
 * weak-field deflection drops below ~0.3 px) drawn with premultiplied alpha and depth test, so objects in front of it
 * (a companion star outside the sphere) occlude it correctly and the scene shows through where nothing bends.
 *
 * Cost control: the ray-march only runs for pixels inside the lensing sphere and only once that sphere is ≥ 3 px on
 * screen; the whole thing hides below ~1 px. Quality 'high' (Ultra) = 260 steps, full disc texture and a 1024² background
 * capture; 'fast' (Balanced/Performance) = 140 longer steps, 3-octave disc texture and 512². The background is captured once per black hole (and on
 * quality changes), never per frame.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext } from '../../core/types';
import { BLACKHOLE_FRAG, BLACKHOLE_VERT } from './glsl';
import { createJetRibbons, type JetParams, type JetRibbons } from './jets';
import { horizonRadiusM, iscoRadiusM, clampSpin } from './physics';

export interface LensDisc {
  /** Inner edge (r_s); default the ISCO for the spin. */
  innerRs?: number;
  outerRs: number;
  /** Display colour temperature at the profile peak (K). */
  displayPeakK: number;
  /** T_display ∝ profile^tempExponent (1 = physical T ∝ r^{-3/4}). Default 0.75 (compressed into the visible). */
  tempExponent?: number;
  /** Brightness ∝ profile^intensityExponent (4 = physical σT⁴). Default 1.35 (flattened, as in DNGR's Gargantua, so the whole disc reads under one exposure). */
  intensityExponent?: number;
  gain?: number;
  /** Peak opacity of the thin disc, default 0.92. */
  opacity?: number;
}

export interface LensJet extends JetParams {
  /** Unit axis (world); default the disc normal. */
  axis?: THREE.Vector3;
}

export interface LensStar {
  centerWorld: THREE.Vector3;
  radiusM: number;
  /** Linear HDR colour at disc centre. */
  colorHdr: THREE.Vector3;
}

export interface BlackHoleLensParams {
  /** Key of the black hole (background re-captured when it changes). */
  key: string;
  rsM: number;
  /** Dimensionless spin a*, along `normal` (negative = retrograde disc). */
  spin: number;
  /** Disc / spin axis (unit, world). */
  normal: THREE.Vector3;
  disc: LensDisc | null;
  /** 0..1 disc fade. */
  discVisibility?: number;
  jet: LensJet | null;
  star: LensStar | null;
  /** Upper limit for the proxy radius (m), e.g. separation − companion radius. */
  maxRadiusM?: number;
}

const LENS_RADIUS_RS = 40;
const DEFLECTION_MIN_PX = 0.6;
/** Below this lens size (px) the bent background is invisible anyway: draw only the shadow/disc, never the captured sky. */
const MIN_ENV_LENS_PX = 6;

function scalePoints(root: THREE.Object3D, f: number): void {
  root.traverseVisible((o) => {
    if (!(o as THREE.Points).isPoints) return;
    const m = (o as THREE.Points).material as THREE.ShaderMaterial;
    const u = m.uniforms?.uPixelRatio;
    if (u && typeof u.value === 'number') u.value *= f;
  });
}

export class BlackHoleLens {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly jets: JetRibbons;
  private svc: EngineServices | null = null;
  private env: THREE.CubeTexture | null = null;
  private envKey = '';
  private wantCapture = true;
  private elapsed = 0;
  private readonly camRs = new THREE.Vector3();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly bhRender = new THREE.Vector3();
  private readonly hideList: THREE.Object3D[] = [];
  /** Screen radius (CSS px) of the lensing sphere this frame (0 when hidden). */
  lensPx = 0;
  /** True while the full ray-march runs. */
  marching = false;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: BLACKHOLE_VERT,
      fragmentShader: BLACKHOLE_FRAG,
      uniforms: {
        uEnv: { value: null },
        uHasEnv: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uRP: { value: LENS_RADIUS_RS },
        uRL: { value: LENS_RADIUS_RS },
        uDeflMin: { value: 3e-4 },
        uMarch: { value: 1 },
        uSteps: { value: 150 },
        uStepScale: { value: 1 },
        uSpin: { value: 0 },
        uHorizon: { value: 1 },
        uPhoton: { value: 1.5 },
        uN: { value: new THREE.Vector3(0, 0, 1) },
        uE1: { value: new THREE.Vector3(1, 0, 0) },
        uE2: { value: new THREE.Vector3(0, 1, 0) },
        uDisc: { value: 0 },
        uRin: { value: 3 },
        uRout: { value: 30 },
        uTpeak: { value: 9000 },
        uTexp: { value: 0.45 },
        uIexp: { value: 1.6 },
        uDiscGain: { value: 4 },
        uDiscAlpha: { value: 0.92 },
        uOverview: { value: 0 },
        uFast: { value: 1 },
        uTime: { value: 0 },
        uJet: { value: 0 },
        uJetAxis: { value: new THREE.Vector3(0, 0, 1) },
        uJetBeta: { value: 0.9 },
        uJetGain: { value: 1 },
        uJetW: { value: 0.25 },
        uJetBase: { value: 14 },
        uStar: { value: new THREE.Vector4(0, 0, 0, 0) },
        uStarCol: { value: new THREE.Vector3() },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
    this.mesh.name = 'blackhole-lens';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
    this.jets = createJetRibbons();
  }

  init(svc: EngineServices, parent: THREE.Object3D = svc.groups.transparent): void {
    this.svc = svc;
    parent.add(this.mesh);
    parent.add(this.jets.mesh);
  }

  /** Force a background re-capture (e.g. after the scene around the hole changed a lot). */
  recapture(): void {
    this.wantCapture = true;
  }

  hide(): void {
    // The engine reuses one capture target per size (other black holes, e.g. Sgr A*, capture into it too).
    if (this.mesh.visible) this.wantCapture = true;
    this.mesh.visible = false;
    this.jets.mesh.visible = false;
    this.lensPx = 0;
    this.marching = false;
  }

  /**
   * Position and configure the lens for this frame. `captureHide`: extra objects to leave out of the background capture
   * (the companion star mesh, mass stream). Returns whether anything is drawn.
   */
  update(ctx: FrameContext, bhWorld: THREE.Vector3, p: BlackHoleLensParams, captureHide: readonly THREE.Object3D[] = []): boolean {
    const svc = this.svc;
    if (!svc) return false;
    const rs = p.rsM;
    const cam = ctx.cameraPosition;
    this.camRs.set((cam.x - bhWorld.x) / rs, (cam.y - bhWorld.y) / rs, (cam.z - bhWorld.z) / rs);
    const D = this.camRs.length();
    const ppr = ctx.pixelsPerRadian;
    const deflMin = DEFLECTION_MIN_PX / ppr;
    const bOpaque = 2 / deflMin;
    const disc = p.disc;
    const discVis = disc ? (p.discVisibility ?? 1) : 0;
    const lensPxEarly = D > LENS_RADIUS_RS ? Math.asin(Math.min(1, LENS_RADIUS_RS / D)) * ppr : Infinity;
    const useEnv = lensPxEarly >= MIN_ENV_LENS_PX;
    let proxy = Math.max(LENS_RADIUS_RS * 1.02, useEnv ? bOpaque * 1.1 : 0, disc && discVis > 0 ? disc.outerRs * 1.02 : 0);
    if (p.maxRadiusM) proxy = Math.min(proxy, Math.max(LENS_RADIUS_RS * 1.02, p.maxRadiusM / rs));
    const proxyPx = D > proxy ? Math.asin(Math.min(1, proxy / D)) * ppr : Infinity;
    // Visible content within the proxy: the lens (when resolved) or a disc of at least ~1 px.
    const lensPx = lensPxEarly;
    const discPx = disc && discVis > 0 ? (D > disc.outerRs ? (disc.outerRs / D) * ppr : Infinity) : 0;
    const inv = 1 / ctx.metersPerUnit;
    this.bhRender.set((bhWorld.x - cam.x) * inv, (bhWorld.y - cam.y) * inv, (bhWorld.z - cam.z) * inv);
    if (!ctx.reducedMotion) this.elapsed += ctx.dtRealSec;
    if (proxyPx < 0.75 || (lensPx < 1.5 && discPx < 1)) {
      this.hide();
      // Jets are far longer than the lens: keep drawing them (kpc-scale for M87*) when the hole itself is unresolved.
      const jet = p.jet;
      if (jet) {
        this.jets.mesh.visible = true;
        this.jets.setDisc(p.normal, 0, 0);
        this.jets.update(this.bhRender, jet.axis ?? p.normal, this.camRs, rs * inv, 1.5, jet, this.elapsed, 1);
      }
      return !!jet;
    }
    const march = lensPx >= 1.5;
    this.lensPx = lensPx;
    this.marching = march;

    const high = ctx.quality.blackHoleQuality === 'high';
    const size = high ? 1024 : 512;
    const key = `${p.key}|${size}`;
    if (march && useEnv && (this.wantCapture || this.envKey !== key)) this.capture(ctx, bhWorld, size, captureHide, key);

    this.mesh.position.copy(this.bhRender);
    this.mesh.scale.setScalar(proxy * rs * inv);
    this.mesh.visible = true;

    const n = p.normal;
    this.e1.set(1, 0, 0);
    if (Math.abs(n.x) > 0.9) this.e1.set(0, 1, 0);
    this.e1.addScaledVector(n, -this.e1.dot(n)).normalize();
    this.e2.crossVectors(n, this.e1);

    const spin = clampSpin(p.spin);
    const u = this.mesh.material.uniforms;
    (u.uCam.value as THREE.Vector3).copy(this.camRs);
    u.uRP.value = proxy;
    u.uRL.value = LENS_RADIUS_RS;
    u.uDeflMin.value = deflMin;
    u.uMarch.value = march ? 1 : 0;
    u.uSteps.value = high ? 260 : 140;
    u.uStepScale.value = high ? 1.25 : 1.9;
    u.uFast.value = high ? 0 : 1;
    u.uSpin.value = spin;
    u.uHorizon.value = horizonRadiusM(spin) / 2;
    // Prograde circular photon orbit (Bardeen et al. 1972) in r_s, a little inside for safety.
    u.uPhoton.value = Math.max(u.uHorizon.value * 1.02, 0.97 * (1 + Math.cos((2 / 3) * Math.acos(-Math.abs(spin)))));
    (u.uN.value as THREE.Vector3).copy(n);
    (u.uE1.value as THREE.Vector3).copy(this.e1);
    (u.uE2.value as THREE.Vector3).copy(this.e2);
    u.uDisc.value = discVis;
    if (disc) {
      u.uRin.value = disc.innerRs ?? iscoRadiusM(spin) / 2;
      u.uRout.value = disc.outerRs;
      u.uTpeak.value = disc.displayPeakK;
      u.uTexp.value = disc.tempExponent ?? 0.75;
      u.uIexp.value = disc.intensityExponent ?? 1.35;
      u.uDiscGain.value = disc.gain ?? 4;
      u.uDiscAlpha.value = disc.opacity ?? 0.92;
      // Fade the heated outer disc in once the inner disc is too small to read (camera beyond ~ the disc radius / 4).
      u.uOverview.value = THREE.MathUtils.smoothstep(D, disc.outerRs * 0.05, disc.outerRs * 0.4);
    }
    u.uTime.value = this.elapsed;
    u.uEnv.value = this.env;
    u.uHasEnv.value = useEnv && this.env && this.envKey.startsWith(`${p.key}|`) ? 1 : 0;
    const jet = p.jet;
    const axis = jet?.axis ?? n;
    const jetOpacity = jet?.fadeInRs ? THREE.MathUtils.smoothstep(D, jet.fadeInRs, jet.fadeInRs * 4) : 1;
    u.uJet.value = jet ? jetOpacity : 0;
    if (jet) {
      (u.uJetAxis.value as THREE.Vector3).copy(axis);
      u.uJetBeta.value = jet.beta;
      u.uJetGain.value = jet.gain;
      u.uJetW.value = jet.width;
    }
    const star = u.uStar.value as THREE.Vector4;
    if (p.star) {
      const s = p.star;
      star.set((s.centerWorld.x - bhWorld.x) / rs, (s.centerWorld.y - bhWorld.y) / rs, (s.centerWorld.z - bhWorld.z) / rs, s.radiusM / rs);
      (u.uStarCol.value as THREE.Vector3).copy(s.colorHdr);
    } else star.set(0, 0, 0, 0);

    if (jet && jetOpacity > 0.002) {
      this.jets.mesh.visible = true;
      this.jets.setDisc(n, disc ? disc.outerRs : 0, (disc?.opacity ?? 0.92) * discVis);
      this.jets.update(this.bhRender, axis, this.camRs, rs * inv, march ? LENS_RADIUS_RS : 1.5, jet, this.elapsed, jetOpacity);
    } else this.jets.mesh.visible = false;
    return true;
  }

  private capture(ctx: FrameContext, bhWorld: THREE.Vector3, size: number, hide: readonly THREE.Object3D[], key: string): void {
    const svc = this.svc!;
    this.hideList.length = 0;
    this.hideList.push(this.mesh, this.jets.mesh, ...hide);
    const prevVis = this.mesh.visible;
    this.mesh.visible = false;
    // Point sprites are sized in framebuffer pixels; a cube face has fewer pixels per radian than the screen.
    const screenPxPerRad = (ctx.viewport.height * ctx.viewport.pixelRatio) / ctx.fovYRad;
    const f = Math.min(1, size / (Math.PI / 2) / screenPxPerRad);
    scalePoints(svc.scene, f);
    try {
      this.tmp.copy(bhWorld);
      this.env = svc.captureEnvironment(this.tmp, size, this.hideList);
      this.envKey = key;
    } catch {
      this.env = null;
      this.envKey = '';
    }
    scalePoints(svc.scene, 1 / f);
    this.mesh.visible = prevVis;
    this.wantCapture = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.jets.mesh.removeFromParent();
    this.jets.dispose();
    this.env = null;
    this.svc = null;
  }
}
