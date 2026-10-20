/**
 * The Sun: an HDR photosphere (sunMaterial.ts: per-channel limb darkening, granulation, supergranular network,
 * faculae, today's SDO/HMI sunspots projected from Earth's viewpoint) at its IAU orientation, an eclipse-style
 * corona with streamers and today's AIA 304 Å prominences (sunCorona.ts), an optional SDO view that follows the
 * spectral switcher (H-alpha → AIA 304, ultraviolet → AIA 171, X-ray → AIA 193), and two soft glows that keep the
 * Sun a bright point while its disc is unresolved.
 *
 * Size: drawn at the exhibition-scale radius from src/core/visualScale.ts (enlarged at system scale, exactly true
 * within 40 radii); the corona and glows scale with it. Heliocentric position never changes.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit, SpectralBandId } from '../../core/types';
import { AU_M, T_SUN_EFF_K } from '../../core/units';
import { registerScaledBody, renderTransform } from '../../core/visualScale';
import { blackbodyLinearSrgb } from '../../render/glsl/blackbody';
import { regimeEv } from '../../render/post/exposure';
import { GlowSprite } from '../../render/materials/GlowSpriteMaterial';
import type { SolarEntity } from './entities';
import { bodyNorthPole, bodyOrientation } from './ephemeris';
import { SunCorona } from './sunCorona';
import { acquireGranulationTexture, releaseGranulationTexture } from './sunGranulation';
import { createSunImagery, type SunImage, type SunImageId, type SunImagery } from './sunImagery';
import { SunMaterial } from './sunMaterial';

/** Disc-centre radiance (scene-linear); other photospheres (stars domain) scale from it. */
const SUN_DISC_INTENSITY = 14;
/** Seconds for the SDO-view cross-fade. */
const SDO_FADE_SEC = 0.6;

/** Spectral band → SDO image shown on the Sun (null = white-light photosphere). */
export function sunImageForBand(band: SpectralBandId): Exclude<SunImageId, 'hmi-continuum'> | null {
  switch (band) {
    case 'h-alpha': return 'aia304';
    case 'ultraviolet': return 'aia171';
    case 'x-ray': return 'aia193';
    default: return null;
  }
}

/** The Sun's drawn radius factor (exhibition scale); one place to rewire. */
function sunRenderTransform(sun: SolarEntity, tMs: number, out: THREE.Vector3): number {
  const f = renderTransform(sun, tMs, out);
  return Number.isFinite(f) && f >= 1 ? f : 1;
}

export interface SunLayerHandle extends Layer {
  /** Currently shown SDO image (null = white light) — for HUD credits. */
  readonly sdoImage: SunImage | null;
}

export function createSunLayer(sun: SolarEntity): SunLayerHandle {
  const def = sun.def;
  const R = def.axesM[0];
  const world = new THREE.Vector3();
  const geometry = new THREE.SphereGeometry(1, 160, 80);
  const material = new SunMaterial({ intensity: SUN_DISC_INTENSITY });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sol:sun';
  mesh.frustumCulled = false;
  const bb = blackbodyLinearSrgb(T_SUN_EFF_K);
  const color = new THREE.Color(bb.r, bb.g, bb.b);
  // Corona light is scattered photospheric light (K corona) and dust-scattered light (F corona): pearly white.
  const coronaColor = color.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
  const corona = new SunCorona(coronaColor);
  corona.name = 'sol:sun:corona';
  corona.material.uniforms.uIntensity.value = SUN_DISC_INTENSITY;
  const glare = new GlowSprite({ color, intensity: 3, coreFraction: 0.1, minRadiusPx: 26 });
  glare.name = 'sol:sun:glare';
  const veil = new GlowSprite({ color, intensity: 0.12, coreFraction: 0.18, minRadiusPx: 70 });
  veil.name = 'sol:sun:veil';
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const toCam = new THREE.Vector3();
  const north = new THREE.Vector3();
  const west = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  let px = 0;
  let distM = 1;
  let factor = 1;
  let imagery: SunImagery | null = null;
  let svcRef: EngineServices | null = null;
  let unregister: (() => void) | null = null;
  let baseRequested = false;
  let patternAcquired = false;
  let wantSdo: Exclude<SunImageId, 'hmi-continuum'> | null = null;
  let sdoShown: SunImage | null = null;
  let sdoMix = 0;
  let band: 'visible' | 'infrared' = 'visible';

  function showSdo(img: SunImage | null): void {
    sdoShown = img;
    material.setSdo(img);
    corona.material.setSdoImage(img);
  }

  return {
    id: 'solar-sun',
    get sdoImage() {
      return sdoMix > 0.5 ? sdoShown : null;
    },

    init(svc: EngineServices): void {
      svcRef = svc;
      svc.groups.main.add(mesh);
      svc.groups.transparent.add(corona, veil, glare);
      unregister = registerScaledBody(sun);
      imagery = createSunImagery(svc.assets, def.rotation, R, svc.renderer.capabilities.getMaxAnisotropy());
    },

    update(ctx: FrameContext): void {
      factor = sunRenderTransform(sun, ctx.timeMs, world);
      const Rd = R * factor;
      distM = Math.max(world.distanceTo(ctx.cameraPosition), 1);
      px = ctx.pixelDiameter(Rd, distM);
      const inv = 1 / ctx.metersPerUnit;
      const rUnits = Rd * inv;
      ctx.toRender(world, mesh.position);
      mesh.visible = px > 0.6;

      // Lazy imagery: never on the first frames, and only once the disc is resolved.
      if (imagery && !baseRequested && ctx.frame > 3 && px > 3) {
        baseRequested = true;
        // ~200 ms of CPU work in ~6 ms slices, once, the first time the Sun is resolved (never during start-up).
        patternAcquired = true;
        void acquireGranulationTexture().then((tex) => {
          if (svcRef) material.setPattern(tex);
        });
        void imagery.request('hmi-continuum').then((img) => img && material.setHmi(img));
        void imagery.request('aia304').then((img) => img && corona.material.setProminenceImage(img));
      }
      const target = sunImageForBand(ctx.spectralBand);
      if (target !== wantSdo) {
        wantSdo = target;
        if (target && imagery) {
          void imagery.request(target).then((img) => {
            if (img && wantSdo === img.id) showSdo(img);
          });
        }
      }
      const goal = wantSdo && sdoShown?.id === wantSdo ? 1 : 0;
      const step = ctx.reducedMotion ? 1 : Math.min(1, ctx.dtRealSec / SDO_FADE_SEC);
      sdoMix += Math.sign(goal - sdoMix) * Math.min(Math.abs(goal - sdoMix), step);
      material.uniforms.uSdoMix.value = sdoMix;
      if (sdoMix > 0) {
        // The AIA LUT is display-graded for exposure 1. Scaled by 2^−(regime EV), the disc sits in the post meter's
        // dead zone (lit log-mean within ±1.25 EV of the key, almost no pixels above the highlight level), so the
        // exposure stays at the regime base and the screen shows the image's own colours.
        const gain = Math.pow(2, -regimeEv(ctx.scaleLog10)) / SUN_DISC_INTENSITY;
        material.uniforms.uSdoGain.value = gain;
        corona.material.uniforms.uSdoGain.value = gain;
      }
      corona.material.uniforms.uSdoMix.value = sdoMix;
      const ir = ctx.spectralBand === 'near-infrared' || ctx.spectralBand === 'mid-infrared' || ctx.spectralBand === 'far-infrared';
      const wantBand = ir ? 'infrared' : 'visible';
      if (wantBand !== band) {
        band = wantBand;
        material.setBand(band);
      }

      if (mesh.visible) {
        mesh.scale.setScalar(rUnits);
        bodyOrientation(def.rotation, ctx.timeMs, mesh.quaternion);
        material.setTime(ctx.timeMs);
      }

      // Corona: plane-of-sky axes (solar west, projected north) in camera right/up coordinates.
      corona.visible = px > 6;
      if (corona.visible) {
        corona.position.copy(mesh.position);
        corona.material.uniforms.uRadius.value = rUnits;
        corona.material.uniforms.uTime.value = (ctx.timeMs / 1000) % 86_400;
        toCam.subVectors(ctx.cameraPosition, world).normalize();
        bodyNorthPole(def.rotation, ctx.timeMs, north);
        north.addScaledVector(toCam, -north.dot(toCam));
        if (north.lengthSq() < 1e-10) north.set(0, 0, 1).addScaledVector(toCam, -toCam.z);
        if (north.lengthSq() < 1e-10) north.set(1, 0, 0);
        north.normalize();
        west.crossVectors(north, toCam).normalize();
        camRight.set(1, 0, 0).applyQuaternion(ctx.cameraQuaternion);
        camUp.set(0, 1, 0).applyQuaternion(ctx.cameraQuaternion);
        corona.material.uniforms.uWest.value.set(west.dot(camRight), west.dot(camUp));
        corona.material.uniforms.uNorth.value.set(north.dot(camRight), north.dot(camUp));
        // Fade in as the disc resolves (a few-pixel Sun is the glow sprites' job).
        // At exhibition scale the billboard grows with the enlarged disc and would veil the whole inner system in a
        // golden haze: keep the corona faint while the Sun is drawn several times its true size.
        const enlarged = 1 - 0.8 * THREE.MathUtils.smoothstep(factor, 1.5, 8);
        corona.material.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(px, 6, 40) * enlarged;
      }

      // The post pipeline's glare PSF (src/render/post/glare.ts) and metered exposure handle the resolved Sun; the
      // sprites only keep the Sun a bright point while its disc is a few pixels or less, and the wide veil is a
      // faint halo for the far view. Both vanish once the disc is resolved.
      const auDist = distM / AU_M;
      const far = auDist > 50 ? Math.pow(50 / auDist, 1.2) : 1;
      const unresolved = 1 - THREE.MathUtils.smoothstep(px, 4, 40);
      glare.position.copy(mesh.position);
      veil.position.copy(mesh.position);
      glare.material.setViewportHeight(ctx.viewport.height);
      veil.material.setViewportHeight(ctx.viewport.height);
      glare.material.setRadius(rUnits * 2);
      // Exhibition scale: an enlarged disc of up to ~120 px still blooms (the post glare is scaled to the true size).
      const enlargedGlow = factor > 1 ? 0.35 * (1 - THREE.MathUtils.smoothstep(px, 80, 120)) : 0;
      glare.material.uniforms.uOpacity.value = far * Math.max(unresolved, enlargedGlow);
      veil.material.setRadius(rUnits * 6);
      veil.material.uniforms.uOpacity.value = 0.5 * far * unresolved;
      const visible = far > 0.002 && unresolved > 0.002;
      glare.visible = far > 0.002 && Math.max(unresolved, enlargedGlow) > 0.002;
      veil.visible = visible;
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      ctx.project(world, screen);
      if (!screen.visible) return [];
      const d = Math.hypot(screen.x - x, screen.y - y) - Math.max(px / 2, 6);
      if (d > radiusPx) return [];
      return [{ entityId: sun.id, distancePx: Math.max(d, 0), depthM: screen.depthM, priority: sun.importance }];
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (px > ctx.viewport.height * 0.9) return;
      // Beyond the Milky Way's scale the 'Sun' label would sit on the Milky Way and hide its label: hand over (~20 → 100 kpc).
      const farFade = 1 - THREE.MathUtils.smoothstep(ctx.scaleLog10, 21.3, 22);
      if (farFade <= 0.01) return;
      ctx.project(world, screen);
      if (!screen.visible) return;
      out.push({ entityId: sun.id, text: sun.name, x: screen.x, y: screen.y, priority: sun.importance, kind: 'body', offsetPx: Math.min(px / 2, 4000) + 8, opacity: farFade });
    },

    dispose(): void {
      unregister?.();
      if (patternAcquired) releaseGranulationTexture();
      mesh.removeFromParent();
      corona.removeFromParent();
      glare.removeFromParent();
      veil.removeFromParent();
      geometry.dispose();
      material.dispose();
      corona.dispose();
      glare.dispose();
      veil.dispose();
      imagery?.dispose();
      svcRef = null;
    },
  };
}
