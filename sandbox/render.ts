/**
 * Render-kit test bench (self-contained; mirrors the engine's renderer setup without depending on it):
 * WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true }) → HalfFloat EffectComposer → UnrealBloom
 * (threshold 1.5) → OutputPass (AgX, sRGB). Camera-relative rendering: every case keeps float64 world positions
 * and places objects with toRender() each frame; the camera sits at the render origin.
 *
 *   /sandbox/render.html              grid of all cases (iframes)
 *   /sandbox/render.html?case=stars   one case full-window
 */
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/jetbrains-mono/400.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  AtmosphereShell,
  ChunkedPointCloud,
  EARTH_ATMOSPHERE,
  GlowSprite,
  LitBodyMaterial,
  OrbitLine,
  PointStarMaterial,
  RingMesh,
  SkySphere,
  StarSurfaceMaterial,
  blackbodyLinearSrgb,
  configureEquirect,
  createStarfieldPoints,
  createStripTexture,
  generateStarfield,
  pixelsPerRadian,
  type OrbitFrameContext,
} from '../src/render';
import { AU_M, DEG, GM_SUN, PC_M, R_EARTH_MEAN_M, R_SUN_M } from '../src/core/units';
import type { KeplerElements } from '../src/science/orbits';

// ── Harness ────────────────────────────────────────────────────────────────────────────────────

interface Bench {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Camera world position, ICRS m (float64). */
  cameraWorld: THREE.Vector3;
  metersPerUnit: number;
  ctx: OrbitFrameContext;
  toRender(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  lookAtWorld(world: THREE.Vector3, up?: THREE.Vector3): void;
}

interface Case {
  title: string;
  notes: string;
  setup(b: Bench): (tSec: number) => void;
}

const params = new URLSearchParams(location.search);
const caseId = params.get('case');

function boot(c: Case): void {
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1e-6, 1e12);
  camera.up.set(0, 0, 1);

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 1.5);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(dpr);
  composer.setSize(window.innerWidth, window.innerHeight);

  const cameraWorld = new THREE.Vector3();
  const viewport = { width: window.innerWidth, height: window.innerHeight, pixelRatio: dpr };
  const ctx = { cameraPosition: cameraWorld, metersPerUnit: 1, pixelsPerRadian: pixelsPerRadian(viewport.height, 50 * DEG), viewport };
  const bench: Bench = {
    renderer,
    scene,
    camera,
    cameraWorld,
    get metersPerUnit() {
      return ctx.metersPerUnit;
    },
    set metersPerUnit(v: number) {
      ctx.metersPerUnit = v;
    },
    ctx,
    toRender(world, out) {
      return out.subVectors(world, cameraWorld).divideScalar(ctx.metersPerUnit);
    },
    lookAtWorld(world, up) {
      if (up) camera.up.copy(up);
      camera.position.set(0, 0, 0);
      camera.lookAt(scratch.subVectors(world, cameraWorld));
    },
  };
  const scratch = new THREE.Vector3();

  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `<h1>${c.title}</h1><p>${c.notes}</p>`;
  document.body.appendChild(hud);

  const update = c.setup(bench);
  const t0 = performance.now();
  let frames = 0;
  let fps = 0;
  let last = t0;
  const frame = (): void => {
    const now = performance.now();
    frames++;
    if (now - last > 1000) {
      fps = (frames * 1000) / (now - last);
      frames = 0;
      last = now;
    }
    update((now - t0) / 1000);
    camera.updateMatrixWorld();
    composer.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    camera.aspect = viewport.width / viewport.height;
    camera.updateProjectionMatrix();
    ctx.pixelsPerRadian = pixelsPerRadian(viewport.height, camera.fov * DEG);
    renderer.setSize(viewport.width, viewport.height);
    composer.setSize(viewport.width, viewport.height);
  });

  (window as unknown as { __cosmos: unknown }).__cosmos = {
    ready: true,
    perf: () => ({ fps: Math.round(fps), calls: renderer.info.render.calls, points: renderer.info.render.points }),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const blackbodyColor = (k: number): THREE.Color => {
  const c = blackbodyLinearSrgb(k);
  return new THREE.Color().setRGB(c.r, c.g, c.b, THREE.LinearSRGBColorSpace);
};
const OBLIQUITY = 23.4392911 * DEG;
const ECLIPTIC_TO_ICRS = new THREE.Matrix3().set(1, 0, 0, 0, Math.cos(OBLIQUITY), -Math.sin(OBLIQUITY), 0, Math.sin(OBLIQUITY), Math.cos(OBLIQUITY));

function raDecDir(raDeg: number, decDeg: number): THREE.Vector3 {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return v3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Saturn's main rings, radial profile in Saturn radii (approximate optical depths; illustrative for the bench). */
function saturnRingStrip(): { tex: THREE.DataTexture; inner: number; outer: number } {
  const inner = 1.239, outer = 2.27;
  const t = (r: number): number => (r - inner) / (outer - inner);
  const tex = createStripTexture([
    { t: 0, rgb: [120, 112, 104], a: 0.05 },
    { t: t(1.45), rgb: [140, 128, 116], a: 0.12 },
    { t: t(1.527), rgb: [150, 138, 122], a: 0.18 },
    { t: t(1.54), rgb: [205, 186, 158], a: 0.75 },
    { t: t(1.75), rgb: [222, 202, 170], a: 0.95 },
    { t: t(1.94), rgb: [214, 196, 166], a: 0.9 },
    { t: t(1.951), rgb: [90, 84, 78], a: 0.08 },
    { t: t(2.02), rgb: [100, 92, 84], a: 0.1 },
    { t: t(2.03), rgb: [190, 176, 152], a: 0.55 },
    { t: t(2.205), rgb: [185, 171, 148], a: 0.5 },
    { t: t(2.212), rgb: [60, 56, 52], a: 0.02 },
    { t: t(2.218), rgb: [182, 168, 146], a: 0.45 },
    { t: 1, rgb: [170, 158, 138], a: 0.3 },
  ]);
  return { tex, inner, outer };
}

/** Equirectangular test map following the sky-map convention (RA increases to the right of the image). */
function skyTestTexture(): THREE.CanvasTexture {
  const W = 4096, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, W, H);
  const xOf = (raDeg: number): number => (raDeg / 360) * W;
  const yOf = (decDeg: number): number => ((90 - decDeg) / 180) * H;
  for (let ra = 0; ra < 360; ra += 15) {
    g.strokeStyle = ra === 0 ? '#ff5050' : ra === 90 ? '#50a0ff' : 'rgba(200,200,200,0.35)';
    g.lineWidth = ra % 90 === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(xOf(ra), 0);
    g.lineTo(xOf(ra), H);
    g.stroke();
  }
  for (let dec = -75; dec <= 75; dec += 15) {
    g.strokeStyle = dec === 0 ? '#50ff80' : 'rgba(200,200,200,0.35)';
    g.lineWidth = dec === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(0, yOf(dec));
    g.lineTo(W, yOf(dec));
    g.stroke();
  }
  g.fillStyle = '#e8e8e8';
  g.font = '600 26px Inter Variable, sans-serif';
  g.textAlign = 'center';
  for (let ra = 0; ra < 360; ra += 30) {
    for (let dec = -60; dec <= 60; dec += 30) {
      g.fillText(`${ra / 15}h ${dec >= 0 ? '+' : ''}${dec}°`, xOf(ra + 7.5), yOf(dec + 4));
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

// ── Cases ──────────────────────────────────────────────────────────────────────────────────────

const CASES: Record<string, Case> = {
  stars: {
    title: 'Photometric stars',
    notes:
      'Top: magnitude ladder −1.5 … 7.5 (step 1) at 5800 K. Middle: Teff ladder 2500 … 30000 K at m = 1.\n' +
      'Below: 40 000 catalogue-like stars (absolute magnitudes, 2–60 pc) in a ChunkedPointCloud.',
    setup(b) {
      b.metersPerUnit = PC_M;
      b.cameraWorld.set(0, 0, 0);
      b.camera.up.set(0, 0, 1);
      b.camera.lookAt(1, 0, 0);
      // Calibration ladders in render space (apparent magnitudes), 10 units in front of the camera.
      const ladder = (mags: number[], teffs: number[], z: number): THREE.Points => {
        const n = mags.length;
        const pos = new Float32Array(3 * n);
        for (let i = 0; i < n; i++) pos.set([10, -((i - (n - 1) / 2) * 0.55), z], 3 * i);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array(mags), 1));
        g.setAttribute('aTeff', new THREE.BufferAttribute(new Float32Array(teffs), 1));
        const p = new THREE.Points(g, new PointStarMaterial({ limitMag: 8.5 }));
        p.frustumCulled = false;
        return p;
      };
      const mags = Array.from({ length: 10 }, (_, i) => -1.5 + i);
      b.scene.add(ladder(mags, mags.map(() => 5800), 2.2));
      const teffs = [2500, 3000, 3500, 4000, 5000, 5800, 7000, 9000, 12000, 20000, 30000];
      b.scene.add(ladder(teffs.map(() => 1), teffs, 1.2));

      const rand = mulberry(7);
      const N = 40_000;
      const posM = new Float64Array(3 * N);
      const absMag = new Float32Array(N);
      const teff = new Float32Array(N);
      const rows: Array<[number, number, number]> = [];
      for (let i = 0; i < N; i++) {
        const d = (2 + 58 * Math.cbrt(rand())) * PC_M;
        // Concentrate in a band below the ladders so the field reads like a sky.
        const az = (rand() - 0.5) * 1.3;
        const el = -0.08 - rand() * 0.32;
        const dir = v3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
        const M = -1 + 14 * Math.pow(rand(), 0.6);
        const T = M < 1 ? 9000 + 15000 * rand() : M < 5 ? 5000 + 3000 * rand() : 2800 + 2000 * rand();
        rows.push([M, T, 0]);
        posM.set([dir.x * d, dir.y * d, dir.z * d], 3 * i);
        absMag[i] = M;
        teff[i] = T;
      }
      // Brightest-first ordering (by absolute magnitude here).
      const order = Array.from({ length: N }, (_, i) => i).sort((a, c) => absMag[a] - absMag[c]);
      const pS = new Float64Array(3 * N), mS = new Float32Array(N), tS = new Float32Array(N);
      order.forEach((src, dst) => {
        pS.set(posM.subarray(3 * src, 3 * src + 3), 3 * dst);
        mS[dst] = absMag[src];
        tS[dst] = teff[src];
      });
      const mat = new PointStarMaterial({ magnitudeMode: 'absolute', limitMag: 8 });
      const cloud = new ChunkedPointCloud({
        positionsM: pS,
        attributes: { aMag: { array: mS, itemSize: 1 }, aTeff: { array: tS, itemSize: 1 } },
        absMag: mS,
        material: mat,
        targetPointsPerChunk: 2048,
      });
      b.scene.add(cloud.object);
      return () => {
        mat.setMetersPerUnit(b.metersPerUnit);
        mat.setPixelRatio(b.ctx.viewport.pixelRatio);
        b.scene.traverse((o) => {
          if (o instanceof THREE.Points && o.material instanceof PointStarMaterial) o.material.setPixelRatio(b.ctx.viewport.pixelRatio);
        });
        cloud.update(b.cameraWorld, b.metersPerUnit, b.camera, { budget: 40_000, limitMag: 8 });
      };
    },
  },

  sun: {
    title: 'Sun photosphere',
    notes: 'StarSurfaceMaterial at 5772 K: quadratic limb darkening (redder, darker limb), animated granulation\n(faded by on-screen cell size). Camera 1.25 R☉ from centre. Glow sprite behind the limb.',
    setup(b) {
      b.metersPerUnit = 1e6;
      const sunWorld = v3(0, 0, 0);
      b.cameraWorld.set(-1.25 * R_SUN_M, 0.35 * R_SUN_M, 0.25 * R_SUN_M);
      const mat = new StarSurfaceMaterial({ intensity: 10 });
      const sun = new THREE.Mesh(new THREE.SphereGeometry(R_SUN_M / b.metersPerUnit, 256, 128), mat);
      b.scene.add(sun);
      const glow = new GlowSprite({ color: blackbodyColor(5772), intensity: 0.6, coreFraction: 0.45 });
      glow.material.setRadius((2.2 * R_SUN_M) / b.metersPerUnit);
      b.scene.add(glow);
      const tmp = new THREE.Vector3();
      return (t) => {
        b.lookAtWorld(v3(0, 0.55 * R_SUN_M, 0.3 * R_SUN_M));
        b.toRender(sunWorld, tmp);
        sun.position.copy(tmp);
        glow.position.copy(tmp);
        glow.material.setViewportHeight(b.ctx.viewport.height);
        mat.setTime(t * 60);
      };
    },
  },

  sunfar: {
    title: 'Sun at 30 R☉',
    notes: 'Same material from far away: granulation must fade to a clean, shimmer-free disc.',
    setup(b) {
      b.metersPerUnit = 1e7;
      b.cameraWorld.set(-30 * R_SUN_M, 0, 0);
      const mat = new StarSurfaceMaterial({ intensity: 10 });
      const sun = new THREE.Mesh(new THREE.SphereGeometry(R_SUN_M / b.metersPerUnit, 128, 64), mat);
      b.scene.add(sun);
      const tmp = new THREE.Vector3();
      return (t) => {
        b.lookAtWorld(v3(0, 0, 0));
        sun.position.copy(b.toRender(v3(0, 0, 0), tmp));
        mat.setTime(t * 60);
      };
    },
  },

  glow: {
    title: 'Glow sprites',
    notes: 'Blackbody 3000 / 5772 / 10000 / 25000 K, HDR intensities 0.5 … 4 (bloom above 1.5).\nThe grey sphere occludes the right half of the last glow (depth-tested).',
    setup(b) {
      b.metersPerUnit = 1;
      b.cameraWorld.set(0, 0, 0);
      const glows: GlowSprite[] = [];
      const temps = [3000, 5772, 10000, 25000];
      temps.forEach((k, i) => {
        const g = new GlowSprite({ color: blackbodyColor(k), intensity: [0.5, 1.2, 2.5, 4][i], coreFraction: 0.18 });
        g.position.set(10, 4.5 - i * 3, 0);
        g.material.setRadius(1.4);
        glows.push(g);
        b.scene.add(g);
      });
      const occ = new THREE.Mesh(new THREE.SphereGeometry(0.9, 64, 32), new LitBodyMaterial({ color: 0x808080, planetRadius: 0.9 }));
      occ.position.set(9, -4.5 + 0.9, 0);
      (occ.material as LitBodyMaterial).sunDirectionWorld.set(-1, 0.3, 0.4).normalize();
      b.scene.add(occ);
      return () => {
        b.camera.up.set(0, 0, 1);
        b.camera.lookAt(1, 0, 0);
        for (const g of glows) g.material.setViewportHeight(b.ctx.viewport.height);
        (occ.material as LitBodyMaterial).updateForMesh(occ);
      };
    },
  },

  orbits: {
    title: 'Orbit lines',
    notes:
      'Mercury ink 30 % solid · Venus dotted 1.5/5 (illustrative) · Earth focused, brass 70 %\n' +
      'Mars dashed 9/6 (reconstructed) · 1P/Halley e = 0.967, minor-body ink 18 % with trail fade.',
    setup(b) {
      b.metersPerUnit = 1e9;
      const el = (aAu: number, e: number, i: number, node: number, peri: number, M: number): KeplerElements => ({
        semiMajorAxisM: aAu * AU_M,
        eccentricity: e,
        inclinationRad: i * DEG,
        raanRad: node * DEG,
        argPeriapsisRad: peri * DEG,
        meanAnomalyRad: M * DEG,
      });
      const defs: Array<{ el: KeplerElements; role: 'planet' | 'minor' | 'focused'; prov: 'observed' | 'reconstructed' | 'illustrative' }> = [
        { el: el(0.387, 0.2056, 7.0, 48.33, 29.12, 174), role: 'planet', prov: 'observed' },
        { el: el(0.723, 0.0068, 3.39, 76.68, 54.88, 50), role: 'planet', prov: 'illustrative' },
        { el: el(1.0, 0.0167, 0.0, -11.26, 114.2, 358), role: 'focused', prov: 'observed' },
        { el: el(1.524, 0.0934, 1.85, 49.56, 286.5, 19), role: 'planet', prov: 'reconstructed' },
        { el: el(17.83, 0.967, 162.3, 58.42, 111.33, 38), role: 'minor', prov: 'observed' },
      ];
      const lines = defs.map((d) => {
        const l = new OrbitLine({ role: d.role, provenance: d.prov });
        l.setFromElements(d.el, GM_SUN, { samples: 720, frame: ECLIPTIC_TO_ICRS });
        b.scene.add(l);
        return l;
      });
      lines[4].setHead(0.06);
      const sun = new GlowSprite({ color: blackbodyColor(5772), intensity: 3, coreFraction: 0.08, minRadiusPx: 22 });
      sun.material.setRadius(R_SUN_M / b.metersPerUnit);
      b.scene.add(sun);
      // Camera above the ecliptic, looking at the Sun.
      const eclNorth = v3(0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY));
      b.cameraWorld.copy(eclNorth).multiplyScalar(2.3 * AU_M).add(v3(-1.9 * AU_M, 0.6 * AU_M, 0));
      const tmp = new THREE.Vector3();
      return () => {
        b.lookAtWorld(v3(0.15 * AU_M, 0, 0), eclNorth);
        sun.position.copy(b.toRender(v3(0, 0, 0), tmp));
        sun.material.setViewportHeight(b.ctx.viewport.height);
        for (const l of lines) l.update(b.ctx);
      };
    },
  },

  rings: {
    title: 'Saturn: rings + shadows',
    notes:
      'RingMaterial (single-scattering layer, two-lobe phase) with the planet’s penumbral shadow across the rings;\n' +
      'LitBodyMaterial shows the ring shadow on the globe. Ring profile approximate (bench only).',
    setup(b) {
      const R = 58_232e3;
      b.metersPerUnit = 1e6;
      const { tex, inner, outer } = saturnRingStrip();
      const group = new THREE.Group();
      const planetMat = new LitBodyMaterial({ color: 0xd8c49a, planetRadius: 1, ring: { strip: tex, innerRadius: inner, outerRadius: outer }, sunIntensity: 7 });
      const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), planetMat);
      planet.scale.set(1, 1, 0.902); // oblateness (polar/equatorial ≈ 0.902)
      const ring = new RingMesh({ strip: tex, innerRadius: inner, outerRadius: outer, planetRadius: 1, sunIntensity: 7 });
      group.add(planet, ring);
      group.rotation.x = 26.7 * DEG;
      group.scale.setScalar(R / b.metersPerUnit);
      b.scene.add(group);
      const sunDir = v3(0.55, -0.83, 0.12).normalize();
      planetMat.sunDirectionWorld.copy(sunDir);
      ring.material.sunDirectionWorld.copy(sunDir);
      b.cameraWorld.set(-3.4 * R, -3.9 * R, 1.25 * R);
      const tmp = new THREE.Vector3();
      return () => {
        b.lookAtWorld(v3(0.15 * R, 0, -0.1 * R));
        group.position.copy(b.toRender(v3(0, 0, 0), tmp));
        group.updateMatrixWorld();
        planetMat.updateForMesh(planet);
      };
    },
  },

  atmosphere: {
    title: 'Earth atmosphere from space',
    notes: 'Single-scattering Rayleigh + Mie shell: blue limb, haze over the disc, reddened soft terminator.\nCamera 2.6 R⊕ from the centre; Sun 100° from the view direction.',
    setup(b) {
      b.metersPerUnit = 1e5;
      const R = R_EARTH_MEAN_M;
      const sunDir = v3(-0.17, 0.98, 0.1).normalize();
      const earthMat = new LitBodyMaterial({ color: 0x29435a, planetRadius: 1, atmosphere: EARTH_ATMOSPHERE, sunIntensity: 5 });
      earthMat.sunDirectionWorld.copy(sunDir);
      const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat);
      const shell = new AtmosphereShell({ params: EARTH_ATMOSPHERE, sunIntensity: 5, steps: 16 });
      shell.sunDirectionWorld.copy(sunDir);
      const group = new THREE.Group();
      group.add(earth, shell);
      group.scale.setScalar(R / b.metersPerUnit);
      b.scene.add(group);
      b.cameraWorld.set(-2.6 * R, 0.1 * R, 0.25 * R);
      const tmp = new THREE.Vector3();
      return () => {
        b.lookAtWorld(v3(0, 0.25 * R, 0));
        group.position.copy(b.toRender(v3(0, 0, 0), tmp));
        group.updateMatrixWorld();
        earthMat.updateForMesh(earth);
      };
    },
  },

  lowOrbit: {
    title: 'Earth limb from low orbit (400 km)',
    notes: 'Camera inside the shell (back faces): sunset band at the horizon, Earth’s shadow on the sky.',
    setup(b) {
      b.metersPerUnit = 1e3;
      const R = R_EARTH_MEAN_M;
      const sunDir = v3(0.995, 0, 0.1).normalize();
      const earthMat = new LitBodyMaterial({ color: 0x29435a, planetRadius: 1, atmosphere: EARTH_ATMOSPHERE, sunIntensity: 5 });
      earthMat.sunDirectionWorld.copy(sunDir);
      const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 512, 256), earthMat);
      const shell = new AtmosphereShell({ params: EARTH_ATMOSPHERE, sunIntensity: 5, steps: 16 });
      shell.sunDirectionWorld.copy(sunDir);
      const group = new THREE.Group();
      group.add(earth, shell);
      group.scale.setScalar(R / b.metersPerUnit);
      b.scene.add(group);
      const alt = 400e3;
      b.cameraWorld.set(0, 0, R + alt);
      const tmp = new THREE.Vector3();
      return () => {
        // Look toward the Sun-side horizon (the horizon dips ≈ 20° below local horizontal at 400 km).
        b.lookAtWorld(v3(3000e3, 0, R - 250e3), v3(0, 0, 1));
        group.position.copy(b.toRender(v3(0, 0, 0), tmp));
        group.updateMatrixWorld();
        earthMat.updateForMesh(earth);
      };
    },
  },

  sky: {
    title: 'Sky sphere orientation',
    notes:
      'Generated equirect map: RA = 360·(x+0.5)/W to the right, Dec = 90 − 180·(y+0.5)/H. Red = 0h, blue = 6h, green = equator.\n' +
      'Camera looks at RA 6h, Dec +30° (north up): expect the blue 6h meridian through the centre, RA increasing to the LEFT\n' +
      '(sky seen from inside, as in the real sky) and labels mirrored for the same reason. Procedural starfield on top.',
    setup(b) {
      b.metersPerUnit = 1;
      b.cameraWorld.set(0, 0, 0);
      const sky = new SkySphere({ texture: configureEquirect(skyTestTexture(), b.renderer), exposure: 0.6 });
      b.scene.add(sky);
      const stars = createStarfieldPoints(generateStarfield({ count: 6000 }));
      b.scene.add(stars);
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.textContent = '+ expected RA 6h Dec +30°';
      mark.style.left = '50%';
      mark.style.top = '50%';
      document.body.appendChild(mark);
      return () => {
        b.camera.up.set(0, 0, 1);
        b.camera.lookAt(raDecDir(90, 30));
        stars.material.setPixelRatio(b.ctx.viewport.pixelRatio);
      };
    },
  },

  precision: {
    title: 'Precision: chunk 1e20 m from the origin, viewed from 1e9 m',
    notes: 'ChunkedPointCloud of 2 000 stars within 3e8 m of (1e20, 0, 0). The camera drifts 1 m per frame;\nstars must stay perfectly still and crisp (see chunkedPoints.test.ts for the numeric check).',
    setup(b) {
      b.metersPerUnit = 1e6;
      const origin = v3(1e20, 0, 0);
      const rand = mulberry(3);
      const N = 2000;
      const pos = new Float64Array(3 * N);
      const mag = new Float32Array(N);
      const teff = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        pos.set([origin.x + (rand() - 0.5) * 6e8, origin.y + (rand() - 0.5) * 6e8, origin.z + (rand() - 0.5) * 6e8], 3 * i);
        mag[i] = 1 + i * (6 / N);
        teff[i] = 3000 + rand() * 12000;
      }
      const mat = new PointStarMaterial({ limitMag: 8 });
      const cloud = new ChunkedPointCloud({ positionsM: pos, attributes: { aMag: { array: mag, itemSize: 1 }, aTeff: { array: teff, itemSize: 1 } }, material: mat, targetPointsPerChunk: 256 });
      b.scene.add(cloud.object);
      const base = v3(1e20 - 1e9, 0, 0);
      let f = 0;
      return () => {
        f++;
        b.cameraWorld.set(base.x + f, base.y, base.z);
        b.camera.up.set(0, 0, 1);
        b.camera.lookAt(1, 0, 0);
        b.camera.updateMatrixWorld();
        mat.setPixelRatio(b.ctx.viewport.pixelRatio);
        cloud.update(b.cameraWorld, b.metersPerUnit, b.camera);
      };
    },
  },
};

// ── Entry ──────────────────────────────────────────────────────────────────────────────────────

if (caseId && CASES[caseId]) {
  boot(CASES[caseId]);
} else {
  const grid = document.createElement('div');
  grid.id = 'grid';
  for (const id of Object.keys(CASES)) {
    const f = document.createElement('iframe');
    f.src = `render.html?case=${id}`;
    f.title = CASES[id].title;
    grid.appendChild(f);
  }
  document.body.appendChild(grid);
  (window as unknown as { __cosmos: unknown }).__cosmos = { ready: true, perf: () => ({}) };
}
