/**
 * Light-travel scale rings around the Sun in the ecliptic plane: 1 light-hour (7.2 au), 1 light-day (173 au), 1 light-year
 * (63,241 au). Subtle 1-px lines, DERIVED from c × time, shown with the 'scale-markers' overlay while the camera is within a
 * useful range of each ring (never when the camera is deep inside it, or when it has shrunk to a dot).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import { AU_M, DEG } from '../../core/units';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOSE_ECLIPTIC_LON_DEG, SCALE_RINGS, type ScaleRing } from './model';
import { sunSource } from './sources';

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}`;
const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform float uOpacity;
uniform vec3 uColor;
void main() {
  ${LOGDEPTH_FRAGMENT}
  gl_FragColor = vec4(uColor * uOpacity, uOpacity);
}`;

const SEGMENTS = 360;

interface RingVisual {
  ring: ScaleRing;
  line: THREE.LineLoop;
  material: THREE.ShaderMaterial;
  opacity: number;
}

const fmtAu = (au: number): string => (au >= 100 ? Math.round(au).toLocaleString('en-GB') : au.toFixed(1)) + ' au';

export function createScaleRingsLayer(registry: Pick<EntityRegistry, 'get'>): Layer {
  const sun = sunSource(registry);
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const screen = { x: 0, y: 0, depthM: 0, visible: false };
  const visuals: RingVisual[] = [];
  let geometry: THREE.BufferGeometry | null = null;
  const eclToIcrs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 23.4392911 * DEG);

  return {
    id: 'outer-scale-rings',

    init(svc: EngineServices): void {
      const pos = new Float32Array(SEGMENTS * 3);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        pos[3 * i] = Math.cos(a);
        pos[3 * i + 1] = Math.sin(a);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      for (const ring of SCALE_RINGS) {
        const material = new THREE.ShaderMaterial({
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Vector3(0.62, 0.72, 0.88) } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
        });
        const line = new THREE.LineLoop(geometry, material);
        line.name = `scale-ring-${ring.id}`;
        line.frustumCulled = false;
        line.visible = false;
        line.quaternion.copy(eclToIcrs);
        line.renderOrder = 4;
        svc.groups.overlay.add(line);
        visuals.push({ ring, line, material, opacity: 0 });
      }
    },

    update(ctx: FrameContext): void {
      sun(ctx.timeMs, sunWorld);
      const dSunAu = ctx.cameraPosition.distanceTo(sunWorld) / AU_M;
      const unitsPerAu = AU_M / ctx.metersPerUnit;
      for (const v of visuals) {
        const ratio = dSunAu / v.ring.radiusAU;
        // Visible from just outside the ring (camera ≳ 0.45 R) to ~700 R away.
        const target = ctx.overlays['scale-markers'] ? THREE.MathUtils.smoothstep(ratio, 0.3, 0.7) * (1 - THREE.MathUtils.smoothstep(ratio, 150, 1200)) : 0;
        v.opacity += (target - v.opacity) * Math.min(1, ctx.dtRealSec * 5);
        if (Math.abs(target - v.opacity) < 0.002) v.opacity = target;
        v.line.visible = v.opacity > 0.003;
        if (!v.line.visible) continue;
        ctx.toRender(sunWorld, v.line.position);
        v.line.scale.setScalar(v.ring.radiusAU * unitsPerAu);
        v.material.uniforms.uOpacity.value = v.opacity * 0.2;
      }
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!ctx.overlays.labels) return;
      sun(ctx.timeMs, sunWorld);
      const lon = NOSE_ECLIPTIC_LON_DEG * DEG + 0.5;
      const c = Math.cos(23.4392911 * DEG), s = Math.sin(23.4392911 * DEG);
      for (const v of visuals) {
        if (v.opacity < 0.35) continue;
        const R = v.ring.radiusM;
        // Point on the ring at ecliptic longitude `lon`, rotated to ICRS.
        const ex = Math.cos(lon), ey = Math.sin(lon);
        tmp.set(R * ex, R * ey * c, R * ey * s).add(sunWorld);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        out.push({ entityId: null, text: v.ring.label, detail: fmtAu(v.ring.radiusAU), x: screen.x, y: screen.y, priority: 10, kind: 'annotation', opacity: v.opacity * 0.85 });
      }
    },

    dispose(): void {
      for (const v of visuals) {
        v.line.removeFromParent();
        v.material.dispose();
      }
      visuals.length = 0;
      geometry?.dispose();
      geometry = null;
    },
  };
}
