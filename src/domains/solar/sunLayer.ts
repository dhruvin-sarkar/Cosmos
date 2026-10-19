/**
 * The Sun: an HDR photosphere (render-kit StarSurfaceMaterial: 5772 K blackbody colour, measured quadratic
 * limb darkening, granulation at its real ~1 Mm scale) at its true size and IAU orientation, plus two soft glows
 * that stand for light scattered in the eye/camera optics (a tight glare hugging the limb and a faint wide veil).
 * Glows are depth-tested so the disc and any body in front hide them. Seen from far away the glare keeps a
 * minimum on-screen size so the Sun stays a bright point; beyond ~50 au its brightness falls off with distance and
 * it hands over to the star field.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { AU_M, T_SUN_EFF_K } from '../../core/units';
import { blackbodyLinearSrgb } from '../../render/glsl/blackbody';
import { GlowSprite } from '../../render/materials/GlowSpriteMaterial';
import { StarSurfaceMaterial } from '../../render/materials/StarSurfaceMaterial';
import type { SolarEntity } from './entities';
import { bodyOrientation } from './ephemeris';

const SUN_DISC_INTENSITY = 14;

export function createSunLayer(sun: SolarEntity): Layer {
  const def = sun.def;
  const R = def.axesM[0];
  const world = new THREE.Vector3();
  const geometry = new THREE.SphereGeometry(1, 128, 64);
  const material = new StarSurfaceMaterial({ teffK: T_SUN_EFF_K, intensity: SUN_DISC_INTENSITY });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sol:sun';
  mesh.frustumCulled = false;
  const bb = blackbodyLinearSrgb(T_SUN_EFF_K);
  const color = new THREE.Color(bb.r, bb.g, bb.b);
  const glare = new GlowSprite({ color, intensity: 3, coreFraction: 0.1, minRadiusPx: 26 });
  glare.name = 'sol:sun:glare';
  const veil = new GlowSprite({ color, intensity: 0.12, coreFraction: 0.18, minRadiusPx: 70 });
  veil.name = 'sol:sun:veil';
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  let px = 0;
  let distM = 1;

  return {
    id: 'solar-sun',
    init(svc: EngineServices): void {
      svc.groups.main.add(mesh);
      svc.groups.transparent.add(veil, glare);
    },

    update(ctx: FrameContext): void {
      sun.position(ctx.timeMs, world);
      distM = Math.max(world.distanceTo(ctx.cameraPosition), 1);
      px = ctx.pixelDiameter(R, distM);
      const inv = 1 / ctx.metersPerUnit;
      const rUnits = R * inv;
      ctx.toRender(world, mesh.position);
      mesh.visible = px > 0.6;
      if (mesh.visible) {
        mesh.scale.setScalar(rUnits);
        bodyOrientation(def.rotation, ctx.timeMs, mesh.quaternion);
        material.setTime(ctx.timeMs / 1000);
      }
      // The post pipeline's glare PSF (src/render/post/glare.ts) and metered exposure handle the resolved Sun; the
      // sprites only keep the Sun a bright point while its disc is a few pixels or less, and the wide veil is a
      // faint halo for the far view. Both vanish once the disc is resolved, so the close-up shows the photosphere
      // (limb darkening, granulation) without a grey haze.
      const auDist = distM / AU_M;
      const far = auDist > 50 ? Math.pow(50 / auDist, 1.2) : 1;
      const unresolved = 1 - THREE.MathUtils.smoothstep(px, 4, 40);
      glare.position.copy(mesh.position);
      veil.position.copy(mesh.position);
      glare.material.setViewportHeight(ctx.viewport.height);
      veil.material.setViewportHeight(ctx.viewport.height);
      glare.material.setRadius(rUnits * 2);
      glare.material.uniforms.uOpacity.value = far * unresolved;
      veil.material.setRadius(rUnits * 6);
      veil.material.uniforms.uOpacity.value = 0.5 * far * unresolved;
      const visible = far > 0.002 && unresolved > 0.002;
      glare.visible = visible;
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
      ctx.project(world, screen);
      if (!screen.visible) return;
      out.push({ entityId: sun.id, text: sun.name, x: screen.x, y: screen.y, priority: sun.importance, kind: 'body', offsetPx: Math.min(px / 2, 4000) + 8 });
    },

    dispose(): void {
      mesh.removeFromParent();
      glare.removeFromParent();
      veil.removeFromParent();
      geometry.dispose();
      material.dispose();
      glare.dispose();
      veil.dispose();
    },
  };
}
