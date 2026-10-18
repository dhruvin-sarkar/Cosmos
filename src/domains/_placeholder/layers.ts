/**
 * TEMPORARY placeholder layers: Sun (HDR emissive disc + glow), Earth (procedural lit sphere with a true
 * day/night terminator from the real Sun direction), Moon (grey lit sphere) and an illustrative random star
 * backdrop. They prove the pipeline (floating origin, log depth, bloom, labels, picking) across scales until
 * the real domains replace them.
 */
import * as THREE from 'three';
import type { Entity } from '../../core/entity';
import type { EngineServices, FrameContext, LabelCandidate, Layer } from '../../core/types';
import { earthRotationRad } from './ephemeris';

/** Below this on-screen diameter a sphere is hidden (the label and the Sun's glow carry it). */
const MIN_MESH_PX = 0.35;

const LIT_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const LIT_FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform float uIrradiance;
  uniform int uMode; // 0 = Earth, 1 = Moon
  varying vec3 vNormalW;
  varying vec3 vObjPos;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i), n100 = hash(i + vec3(1,0,0)), n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
    float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1)), n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float mu = dot(n, normalize(uSunDir));
    vec3 albedo;
    if (uMode == 0) {
      float h = fbm(vObjPos * 2.2);
      float lat = abs(vObjPos.z);
      vec3 ocean = vec3(0.012, 0.035, 0.09);
      vec3 land = mix(vec3(0.11, 0.10, 0.05), vec3(0.20, 0.17, 0.11), fbm(vObjPos * 7.0));
      albedo = mix(ocean, land, smoothstep(0.52, 0.56, h));
      albedo = mix(albedo, vec3(0.7), smoothstep(0.86, 0.92, lat + 0.05 * h));
      float clouds = smoothstep(0.55, 0.8, fbm(vObjPos * 3.4 + 7.0));
      albedo = mix(albedo, vec3(0.75), clouds * 0.55);
    } else {
      float m = fbm(vObjPos * 3.0);
      albedo = vec3(0.13) * mix(0.62, 1.12, smoothstep(0.35, 0.65, m));
    }
    // Lambert with a narrow wrap so the terminator is soft like a real limb, never lifting the night side.
    float lit = clamp((mu + 0.02) / 1.02, 0.0, 1.0);
    vec3 color = albedo * uIrradiance * lit;
    gl_FragColor = vec4(color, 1.0);
  }`;

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.08, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

interface BodyVisual {
  entity: Entity;
  mesh: THREE.Mesh;
  world: THREE.Vector3;
  distanceM: number;
  pixelDiameter: number;
}

export function createPlaceholderBodiesLayer(entities: readonly Entity[]): Layer {
  const byId = new Map(entities.map(e => [e.id, e]));
  const sphere = new THREE.SphereGeometry(1, 96, 64);
  const visuals: BodyVisual[] = [];
  const disposables: { dispose(): void }[] = [sphere];
  const sunWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let glow: THREE.Sprite | null = null;
  let sunVisual: BodyVisual | null = null;
  const screen = { x: 0, y: 0, depthM: 0, visible: false };

  const litMaterial = (mode: 0 | 1): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({
      vertexShader: LIT_VERTEX,
      fragmentShader: LIT_FRAGMENT,
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uIrradiance: { value: 2.6 }, uMode: { value: mode } },
    });
    disposables.push(m);
    return m;
  };

  return {
    id: 'placeholder-bodies',
    init(svc: EngineServices): void {
      const add = (id: string, material: THREE.Material): BodyVisual | null => {
        const entity = byId.get(id);
        if (!entity) return null;
        const mesh = new THREE.Mesh(sphere, material);
        mesh.name = id;
        mesh.frustumCulled = false;
        svc.groups.main.add(mesh);
        const v: BodyVisual = { entity, mesh, world: new THREE.Vector3(), distanceM: 0, pixelDiameter: 0 };
        visuals.push(v);
        return v;
      };
      // Sun: linear HDR emission far above display white, so only it blooms.
      const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(24, 21.5, 18) });
      disposables.push(sunMat);
      sunVisual = add('sol:sun', sunMat);
      add('sol:earth', litMaterial(0));
      add('sol:moon', litMaterial(1));

      const glowTex = makeGlowTexture();
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(2.2, 1.95, 1.6),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      disposables.push(glowTex, glowMat);
      glow = new THREE.Sprite(glowMat);
      glow.name = 'sol:sun:glow';
      glow.frustumCulled = false;
      svc.groups.transparent.add(glow);
    },

    update(ctx: FrameContext): void {
      if (sunVisual) sunVisual.entity.position(ctx.timeMs, sunWorld);
      for (const v of visuals) {
        v.entity.position(ctx.timeMs, v.world);
        v.distanceM = v.world.distanceTo(ctx.cameraPosition);
        const r = v.entity.radiusM ?? 1;
        v.pixelDiameter = ctx.pixelDiameter(r, v.distanceM);
        v.mesh.visible = v.pixelDiameter >= MIN_MESH_PX;
        if (!v.mesh.visible) continue;
        ctx.toRender(v.world, v.mesh.position);
        v.mesh.scale.setScalar(r / ctx.metersPerUnit);
        const mat = v.mesh.material;
        if (mat instanceof THREE.ShaderMaterial) {
          (mat.uniforms.uSunDir.value as THREE.Vector3).subVectors(sunWorld, v.world).normalize();
        }
        if (v.entity.id === 'sol:earth') v.mesh.rotation.set(0, 0, earthRotationRad(ctx.timeMs));
      }
      if (glow && sunVisual) {
        ctx.toRender(sunWorld, glow.position);
        const distUnits = sunVisual.distanceM / ctx.metersPerUnit;
        const rUnits = (sunVisual.entity.radiusM ?? 7e8) / ctx.metersPerUnit;
        // At least ~14 px across so the Sun stays a visible point of light at every scale.
        const minUnits = (14 / ctx.pixelsPerRadian) * distUnits;
        glow.scale.setScalar(Math.max(rUnits * 9, minUnits));
        glow.visible = distUnits > rUnits * 1.05;
      }
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      for (const v of visuals) {
        tmp.copy(v.world);
        ctx.project(tmp, screen);
        if (!screen.visible) continue;
        out.push({
          entityId: v.entity.id,
          text: v.entity.name,
          x: screen.x,
          y: screen.y,
          priority: v.entity.importance,
          kind: 'body',
          offsetPx: Math.min(v.pixelDiameter / 2, 4000) + 2,
        });
      }
    },

    dispose(): void {
      for (const d of disposables) d.dispose();
      for (const v of visuals) v.mesh.removeFromParent();
      glow?.removeFromParent();
      visuals.length = 0;
    },
  };
}

const STAR_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    #include <logdepthbuf_vertex>
  }`;

const STAR_FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = gl_PointCoord - 0.5;
    float a = exp(-dot(d, d) * 18.0);
    gl_FragColor = vec4(vColor * a, 1.0);
  }`;

/** Illustrative random star backdrop (not catalogue positions) in the background group. */
export function createPlaceholderStarfieldLayer(count = 7000, seed = 1): Layer {
  let points: THREE.Points | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let geometry: THREE.BufferGeometry | null = null;
  let s = seed >>> 0 || 1;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };

  return {
    id: 'placeholder-starfield',
    init(svc: EngineServices): void {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const size = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const z = rand() * 2 - 1;
        const phi = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        pos[i * 3] = r * Math.cos(phi) * 1e6;
        pos[i * 3 + 1] = r * Math.sin(phi) * 1e6;
        pos[i * 3 + 2] = z * 1e6;
        // Steep power law: many faint stars, few bright ones.
        const b = Math.pow(rand(), 6);
        const warm = rand();
        const intensity = 0.05 + 0.9 * b;
        col[i * 3] = intensity * (0.85 + 0.2 * warm);
        col[i * 3 + 1] = intensity * (0.88 + 0.06 * warm);
        col[i * 3 + 2] = intensity * (1.05 - 0.25 * warm);
        size[i] = 1.6 + 3.2 * b;
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      material = new THREE.ShaderMaterial({
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        uniforms: { uPixelRatio: { value: 1 } },
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      points = new THREE.Points(geometry, material);
      points.name = 'placeholder-starfield';
      points.frustumCulled = false;
      svc.groups.background.add(points);
    },
    update(ctx: FrameContext): void {
      if (material) material.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
    },
    dispose(): void {
      points?.removeFromParent();
      geometry?.dispose();
      material?.dispose();
    },
  };
}
