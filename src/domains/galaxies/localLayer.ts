/**
 * Local-volume galaxies layer ('galaxies:local'): ~870 galaxies within ~11 Mpc at their catalogued 3-D positions.
 *  - every galaxy: an elliptical glow sprite (size, orientation, surface brightness, colour from the catalogue);
 *  - hero galaxies (M31, M33, LMC, SMC) and ~60 large/famous ones: observed DSS2 images projected onto their disc
 *    planes (ImpostorMaterial), cross-faded in as they grow beyond ~40 px;
 *  - up close (≲ 4 disc radii) the heroes hand over to 3-D star clouds sampled from the same image (starClouds.ts);
 *  - the Milky Way seen from outside: a face-on reconstruction (Reid et al. 2019 arms, bar, bulge) that fades in
 *    beyond ~30 kpc from the Galactic Centre;
 *  - labels, picking and the 'gal:*' / 'struct:*' entity provider.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { GALACTIC_CENTER_DIRECTION_ICRS, galacticToIcrs } from '../../core/frames';
import { sliceUpload } from '../../core/perf';
import { KPC_M, MPC_M } from '../../core/units';
import { loadGalaxyCatalog, MILKY_WAY_ID, type Galaxy, type GalaxyCatalog } from './catalog';
import { createGalaxiesProvider, galaxyRadiusM } from './entities';
import { localGalaxiesOpacity, smooth } from './fade';
import { createImpostorGeometry, GalaxyPointsMaterial, ImpostorMaterial } from './materials';
import { createMilkyWayFallbackProvider, MW_R0_KPC } from './milkyway';
import { StarCloudMaterial } from './starClouds';
import { buildCloudAsync } from './starCloudsAsync';

const POINT_GAIN = 0.55;
const IMPOSTOR_GAIN = 1.25;
const HANDOVER = new THREE.Vector2(36, 90);
const MAX_RENDER_DEPTH = 1e14;

export interface LocalGalaxiesLayer extends Layer {
  readonly catalog: GalaxyCatalog | null;
  /** Current overall opacity (0..1), for other layers that cross-fade with it. */
  readonly opacity: number;
}

interface Hero {
  g: Galaxy;
  mesh: THREE.Mesh;
  mat: ImpostorMaterial;
  lowPath: string;
  highPath: string;
  midPath: string;
  upgraded: boolean;
  /** Star cloud (built on approach): 0 = none, 1 = building, 2 = ready, 3 = failed. */
  cloudState: number;
  cloud: THREE.Points | null;
  cloudMat: StarCloudMaterial | null;
  /** 0→1 ramp once the cloud is ready (no pop). */
  cloudRamp: number;
}

/** Star-cloud particle diameter (Mpc): 0.18 kpc blobs, i.e. unresolved star clouds / associations. */
const CLOUD_PARTICLE_MPC = 0.00018;

export function createLocalGalaxiesLayer(): LocalGalaxiesLayer {
  let svc: EngineServices | null = null;
  let cat: GalaxyCatalog | null = null;
  let points: THREE.Points | null = null;
  let pointsMat: GalaxyPointsMaterial | null = null;
  let atlasMesh: THREE.Mesh | null = null;
  let atlasMat: ImpostorMaterial | null = null;
  let atlasUpgraded = false;
  let mwMesh: THREE.Mesh | null = null;
  let mwMat: ImpostorMaterial | null = null;
  const heroes: Hero[] = [];
  const disposables: { dispose(): void }[] = [];
  let disposed = false;

  /**
   * A 1x1 black stand-in for `mat`'s map, replaced once `path` has loaded and gone up in slices (each 2K map was a
   * 20-30 ms texSubImage2D on its first draw, several in the same frame when the Local Group comes into view: perf).
   */
  function lazyMap(path: string, anisotropy: number, mat: () => THREE.ShaderMaterial | null): THREE.Texture {
    const ph = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    ph.needsUpdate = true;
    const s = svc!;
    void s.assets.textureAsync(path, { colorSpace: 'srgb', anisotropy }).then(t => sliceUpload(s.renderer, t)).then((t) => {
      const m = mat();
      // Superseded (quality upgrade landed first) or disposed meanwhile.
      if (disposed || !m || m.uniforms.uMap.value !== ph) { t.dispose(); return; }
      m.uniforms.uMap.value = t;
      disposables.push(t);
      ph.dispose();
    }).catch(() => undefined);
    return ph;
  }
  let opacity = 0;
  let otherMilkyWay = false;
  let mwCheckFrame = 0;
  const mwFallback = createMilkyWayFallbackProvider();
  let mwFallbackRegistered = false;
  const camMpc = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const sp = { x: 0, y: 0, depthM: 0, visible: false };
  const gcMpc = new THREE.Vector3(GALACTIC_CENTER_DIRECTION_ICRS.x, GALACTIC_CENTER_DIRECTION_ICRS.y, GALACTIC_CENTER_DIRECTION_ICRS.z)
    .multiplyScalar(MW_R0_KPC / 1000);
  let pxPerRad = 1000;

  function buildPoints(c: GalaxyCatalog): void {
    const n = c.galaxies.length;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), par = new Float32Array(n * 4), col = new Float32Array(n * 3);
    c.galaxies.forEach((g, i) => {
      pos.set([g.pos.x, g.pos.y, g.pos.z], i * 3);
      nrm.set([g.normal.x, g.normal.y, g.normal.z], i * 3);
      par.set([g.majorAxisKpc ?? 3, g.surfaceBrightness, g.spheroid ? 1 : 0, g.impostor ? 1 : 0], i * 4);
      col.set(g.color, i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aParams', new THREE.BufferAttribute(par, 4));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    pointsMat = new GalaxyPointsMaterial();
    pointsMat.uniforms.uGain.value = POINT_GAIN;
    pointsMat.uniforms.uHandover.value.copy(HANDOVER);
    points = new THREE.Points(geo, pointsMat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    svc!.groups.far.add(points);
    disposables.push(geo, pointsMat);
  }

  /** Fill one impostor instance from a galaxy's image metadata. */
  function fillInstance(geo: ReturnType<typeof createImpostorGeometry>, k: number, g: Galaxy, slot: number): void {
    const im = g.impostor!;
    const a = im.semiMajorArcmin / 60 * Math.PI / 180; // rad
    const d = g.distMpc;
    const fov = im.fovDeg * Math.PI / 180;
    const cosI = Math.cos(im.inclinationDeg * Math.PI / 180);
    const qWin = Math.max(cosI, 0.22);
    const halfA = 1.45 * a * d;
    const halfB = halfA * Math.max(1, qWin / Math.max(cosI, 1e-3));
    const t = geo.attrs;
    t.center.set([g.pos.x, g.pos.y, g.pos.z], k * 3);
    if (g.spheroid) {
      const h = 0.5 * fov * d;
      t.axisA.set([h, 0, 0], k * 3);
      t.axisB.set([0, h, 0], k * 3);
      t.mode[k] = 1;
    } else {
      t.axisA.set([g.majorAxis.x * halfA, g.majorAxis.y * halfA, g.majorAxis.z * halfA], k * 3);
      t.axisB.set([g.minorAxis.x * halfB, g.minorAxis.y * halfB, g.minorAxis.z * halfB], k * 3);
      t.mode[k] = 0;
    }
    t.params.set([slot, fov, Math.min(Math.max(g.surfaceBrightness, 0.35), 2.2), Math.max(cosI, 0.05)], k * 4);
  }

  function buildImpostors(c: GalaxyCatalog): void {
    const s = svc!;
    const idx = c.impostors;
    if (!idx) return;
    const tq = s.store.getState().quality.effective;
    const atlasG = c.galaxies.filter((g) => g.impostor?.atlasSlot !== undefined);
    if (atlasG.length) {
      const geo = createImpostorGeometry(atlasG.length);
      atlasG.forEach((g, k) => fillInstance(geo, k, g, g.impostor!.atlasSlot!));
      const tex = lazyMap(idx.atlas.files['2k'], 8, () => atlasMat);
      atlasMat = new ImpostorMaterial(tex, idx.atlas.grid);
      atlasMat.uniforms.uGain.value = IMPOSTOR_GAIN;
      atlasMat.uniforms.uHandover.value.copy(HANDOVER);
      atlasMesh = new THREE.Mesh(geo, atlasMat);
      atlasMesh.frustumCulled = false;
      atlasMesh.renderOrder = 2;
      s.groups.transparent.add(atlasMesh);
      disposables.push(geo, atlasMat, tex);
      atlasUpgraded = tq === 'performance';
    }
    for (const g of c.galaxies) {
      const im = g.impostor;
      if (!im?.file) continue;
      const geo = createImpostorGeometry(1);
      fillInstance(geo, 0, g, 0);
      const low = im.fileLow ?? im.file;
      let mat: ImpostorMaterial | null = null;
      const tex = lazyMap(low, 16, () => mat);
      mat = new ImpostorMaterial(tex, 1);
      mat.uniforms.uGain.value = IMPOSTOR_GAIN;
      mat.uniforms.uHandover.value.copy(HANDOVER);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      s.groups.transparent.add(mesh);
      disposables.push(geo, mat, tex);
      heroes.push({ g, mesh, mat, lowPath: low, highPath: im.file, midPath: im.fileMid ?? im.file, upgraded: false, cloudState: 0, cloud: null, cloudMat: null, cloudRamp: 0 });
    }
  }

  function buildMilkyWay(): void {
    const s = svc!;
    const geo = createImpostorGeometry(1);
    const half = 20 / 1000; // Mpc (texture spans ±20 kpc)
    const gx = GALACTIC_CENTER_DIRECTION_ICRS;
    const gy = galacticToIcrs({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
    geo.attrs.center.set([gcMpc.x, gcMpc.y, gcMpc.z], 0);
    geo.attrs.axisA.set([gx.x * half, gx.y * half, gx.z * half], 0);
    geo.attrs.axisB.set([gy.x * half, gy.y * half, gy.z * half], 0);
    geo.attrs.params.set([0, 1, 0.9, 1], 0);
    geo.attrs.mode[0] = 2;
    const tex = lazyMap('textures/galaxies/milkyway_faceon_2k.jpg', 16, () => mwMat);
    mwMat = new ImpostorMaterial(tex, 1);
    mwMat.uniforms.uGain.value = IMPOSTOR_GAIN;
    mwMat.uniforms.uHandover.value.set(0, 1);
    mwMesh = new THREE.Mesh(geo, mwMat);
    mwMesh.frustumCulled = false;
    mwMesh.renderOrder = 2;
    s.groups.transparent.add(mwMesh);
    disposables.push(geo, mwMat, tex);
  }

  function setCommon(m: GalaxyPointsMaterial | ImpostorMaterial | StarCloudMaterial, scale: number, op: number): void {
    m.uniforms.uCamMpc.value.copy(camMpc);
    m.uniforms.uScale.value = scale;
    m.uniforms.uPxPerRad.value = pxPerRad;
    m.uniforms.uOpacity.value = op;
  }

  /** Build a hero's star cloud from its low-tier image (async, once). */
  function buildCloud(h: Hero, count: number): void {
    const s = svc!;
    h.cloudState = 1;
    const im = h.g.impostor!;
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
    const C = h.g.pos;
    const N = new THREE.Vector3().crossVectors(
      new THREE.Vector3(h.g.majorAxis.x, h.g.majorAxis.y, h.g.majorAxis.z),
      new THREE.Vector3(h.g.minorAxis.x, h.g.minorAxis.y, h.g.minorAxis.z)).normalize();
    const a = im.semiMajorArcmin / 60 * Math.PI / 180;
    const fov = im.fovDeg * Math.PI / 180;
    const R = 1.45 * a * h.g.distMpc;
    // Image decode + sampling run in a worker (were a ~190 ms main-thread task on the M31 approach).
    const url = new URL(base + h.lowPath, globalThis.location?.href).href;
    void buildCloudAsync({ url, maxSize: 512, center: { x: C.x, y: C.y, z: C.z }, normal: { x: N.x, y: N.y, z: N.z }, radiusMpc: R, fovRad: fov, count, seed: 0x5eed + h.g.id.length * 7919 }).then((smp) => {
      const img = { width: smp.width };
      if (!svc || smp.count === 0) { h.cloudState = 3; return; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(smp.positions, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(smp.colors, 3));
      const mat = new StarCloudMaterial();
      // Same light as the impostor seen from Earth: G · ΣL · (pixel solid angle) · D² / N (see starClouds.ts).
      const gain = IMPOSTOR_GAIN * Math.min(Math.max(h.g.surfaceBrightness, 0.35), 2.2);
      mat.uniforms.uK.value = gain * smp.sumLum * (fov / img.width) ** 2 * h.g.distMpc ** 2 / smp.count;
      mat.uniforms.uSizeMpc.value = CLOUD_PARTICLE_MPC;
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 3;
      pts.visible = false;
      s.groups.transparent.add(pts);
      disposables.push(geo, mat);
      h.cloud = pts; h.cloudMat = mat; h.cloudState = 2;
    }).catch((err: unknown) => {
      h.cloudState = 3;
      console.warn('[galaxies] star cloud failed for', h.g.id, err);
    });
  }

  const apparentPx = (g: Galaxy, ctx: FrameContext): number => {
    scratch.set(g.pos.x, g.pos.y, g.pos.z).multiplyScalar(MPC_M);
    const d = scratch.distanceTo(ctx.cameraPosition);
    return (2 * galaxyRadiusM(g) / Math.max(d, 1)) * ctx.pixelsPerRadian;
  };

  const layer: LocalGalaxiesLayer = {
    id: 'galaxies:local',
    get catalog() { return cat; },
    get opacity() { return opacity; },

    init(s: EngineServices): void {
      svc = s;
      // Hidden stand-in so the idle shader warm-up links the star-cloud program long before the first hero approach
      // (its first link mid-travel was the 510 ms Andromeda hitch). Never drawn; shares the program by source.
      const warmGeo = new THREE.BufferGeometry();
      warmGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      warmGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(3), 3));
      const warmMat = new StarCloudMaterial();
      const warm = new THREE.Points(warmGeo, warmMat);
      warm.visible = false;
      warm.frustumCulled = false;
      s.groups.transparent.add(warm);
      disposables.push(warmGeo, warmMat, { dispose: () => warm.removeFromParent() });
      void loadGalaxyCatalog(s.assets).then((c) => {
        cat = c;
        buildPoints(c);
        buildImpostors(c);
        buildMilkyWay();
        s.registry.registerProvider(createGalaxiesProvider(c));
        // The galaxy domain normally owns 'mw:galaxy'; provide a fallback only if nobody has after boot settles.
        setTimeout(() => {
          if (!s.registry.get(MILKY_WAY_ID)) { s.registry.registerProvider(mwFallback); mwFallbackRegistered = true; }
        }, 4000);
      }).catch((err: unknown) => {
        s.store.getState();
        console.warn('[galaxies] catalogue failed to load', err);
      });
    },

    update(ctx: FrameContext): void {
      if (!svc || !cat || !points || !pointsMat) return;
      const camR = ctx.cameraPosition.length();
      opacity = localGalaxiesOpacity(ctx.scaleLog10, camR);
      pxPerRad = ctx.pixelsPerRadian;
      camMpc.copy(ctx.cameraPosition).multiplyScalar(1 / MPC_M);
      const farM = camR + 15 * MPC_M;
      const k = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / farM);
      const scale = (MPC_M / ctx.metersPerUnit) * k;
      const vis = opacity > 0.002;
      points.visible = vis;
      if (atlasMesh) atlasMesh.visible = vis;
      for (const h of heroes) {
        h.mesh.visible = vis;
        if (h.cloud && !vis) h.cloud.visible = false;
      }
      // Milky Way from outside: someone else may render it up close (the galaxy domain); stay out of its way.
      if (++mwCheckFrame % 60 === 1) {
        const e = svc.registry.get(MILKY_WAY_ID);
        otherMilkyWay = !!e && (!mwFallbackRegistered || e !== mwFallback.resolve(MILKY_WAY_ID));
      }
      const dGc = Math.sqrt((camMpc.x - gcMpc.x) ** 2 + (camMpc.y - gcMpc.y) ** 2 + (camMpc.z - gcMpc.z) ** 2) * MPC_M;
      const mwOp = (otherMilkyWay ? smooth(30 * KPC_M, 70 * KPC_M, dGc) : smooth(14 * KPC_M, 34 * KPC_M, dGc)) * (1 - smooth(24.6, 25.4, ctx.scaleLog10));
      if (mwMesh && mwMat) {
        mwMesh.visible = mwOp > 0.002;
        if (mwMesh.visible) setCommon(mwMat, scale, mwOp);
      }
      if (!vis) return;
      pointsMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
      setCommon(pointsMat, scale, opacity);
      if (atlasMat) {
        setCommon(atlasMat, scale, opacity);
        if (!atlasUpgraded && cat.impostors && ctx.quality.textureQuality !== 'low') {
          atlasUpgraded = true;
          const old = atlasMat.uniforms.uMap.value;
          const r = svc.renderer;
          // Sliced upload: a 4K map in one texSubImage2D stalls the frame 50-500 ms mid-travel (perf).
          void svc.assets.textureAsync(cat.impostors.atlas.files['4k'], { colorSpace: 'srgb', anisotropy: 16 }).then(t => sliceUpload(r, t)).then((t) => {
            if (!atlasMat) { t.dispose(); return; }
            atlasMat.uniforms.uMap.value = t;
            disposables.push(t);
            old?.dispose();
          }).catch(() => undefined);
        }
      }
      for (const h of heroes) {
        // Impostor ↔ star cloud cross-fade by camera distance in disc radii.
        const dM = Math.sqrt((camMpc.x - h.g.pos.x) ** 2 + (camMpc.y - h.g.pos.y) ** 2 + (camMpc.z - h.g.pos.z) ** 2);
        const rM = galaxyRadiusM(h.g) / MPC_M;
        if (h.cloudState === 0 && dM < 6 * rM) buildCloud(h, ctx.quality.textureQuality === 'low' ? 30_000 : 60_000);
        if (h.cloudState === 2) h.cloudRamp = Math.min(1, h.cloudRamp + ctx.dtRealSec * 1.5);
        // The image is exact along Earth's sight line, the cloud carries the 3-D shape: keep more of the image the closer
        // the view is to Earth's (both carry the same light, so the weights sum to one).
        const align = Math.abs((camMpc.x - h.g.pos.x) * -h.g.pos.x + (camMpc.y - h.g.pos.y) * -h.g.pos.y + (camMpc.z - h.g.pos.z) * -h.g.pos.z)
          / Math.max(dM * h.g.distMpc, 1e-12);
        const wCloud = (1 - smooth(1.5 * rM, 4 * rM, dM)) * h.cloudRamp * (0.8 - 0.45 * align ** 4);
        setCommon(h.mat, scale, opacity * (1 - wCloud));
        if (h.cloud && h.cloudMat) {
          h.cloud.visible = wCloud * opacity > 0.002;
          if (h.cloud.visible) {
            setCommon(h.cloudMat, scale, opacity * wCloud);
            h.cloudMat.uniforms.uPixelRatio.value = ctx.viewport.pixelRatio;
          }
        }
        if (!h.upgraded && ctx.quality.textureQuality !== 'low' && apparentPx(h.g, ctx) > 220) {
          h.upgraded = true;
          const old = h.mat.uniforms.uMap.value;
          const r = svc.renderer;
          void svc.assets.textureAsync(ctx.quality.textureQuality === 'ultra' ? h.highPath : h.midPath, { colorSpace: 'srgb', anisotropy: 16 }).then(t => sliceUpload(r, t)).then((t) => {
            h.mat.uniforms.uMap.value = t;
            disposables.push(t);
            old?.dispose();
          }).catch(() => undefined);
        }
      }
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      if (!cat || opacity < 0.15) return;
      for (const g of cat.galaxies) {
        const px = apparentPx(g, ctx);
        if (px < 2.5 && g.importance < 66) continue;
        if (px < 0.6) continue;
        scratch.set(g.pos.x, g.pos.y, g.pos.z).multiplyScalar(MPC_M);
        ctx.project(scratch, sp);
        if (!sp.visible) continue;
        const big = Math.min(px, 2000);
        out.push({
          entityId: g.id, text: g.name.replace(/ \((M\d+|NGC \d+|M51a)\)$/, ''), x: sp.x, y: sp.y,
          priority: g.importance + Math.min(30, Math.log2(1 + big) * 4), kind: 'galaxy',
          offsetPx: Math.min(big * 0.5, 260) + 6, opacity: opacity * smooth(0.6, 6, px + (g.importance >= 66 ? 5 : 0)),
        });
      }
      const mwOp = mwMesh?.visible ? (mwMat?.uniforms.uOpacity.value ?? 0) : 0;
      if (mwOp > 0.2) {
        scratch.copy(gcMpc).multiplyScalar(MPC_M);
        ctx.project(scratch, sp);
        if (sp.visible) {
          const d = scratch.distanceTo(ctx.cameraPosition);
          out.push({ entityId: MILKY_WAY_ID, text: 'Milky Way', x: sp.x, y: sp.y, priority: 95, kind: 'galaxy', offsetPx: Math.min((15 * KPC_M / d) * ctx.pixelsPerRadian, 260) + 6, opacity: mwOp });
        }
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const hits: PickHit[] = [];
      if (!cat || opacity < 0.15) return hits;
      for (const g of cat.galaxies) {
        const px = apparentPx(g, ctx);
        if (px < 0.8) continue;
        scratch.set(g.pos.x, g.pos.y, g.pos.z).multiplyScalar(MPC_M);
        ctx.project(scratch, sp);
        if (!sp.visible) continue;
        const dd = Math.hypot(sp.x - x, sp.y - y);
        if (dd <= Math.max(radiusPx, Math.min(px * 0.35, 200))) hits.push({ entityId: g.id, distancePx: dd, depthM: sp.depthM, priority: g.importance });
      }
      return hits;
    },

    dispose(): void {
      disposed = true;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      points?.removeFromParent();
      atlasMesh?.removeFromParent();
      mwMesh?.removeFromParent();
      for (const h of heroes) { h.mesh.removeFromParent(); h.cloud?.removeFromParent(); }
      heroes.length = 0;
    },
  };
  return layer;
}

