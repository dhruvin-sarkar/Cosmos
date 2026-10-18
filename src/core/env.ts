/**
 * Environment capture (docs/ARCHITECTURE.md §5.8): render a cube map of the scene as seen from a world
 * position, e.g. the background sky behind Sagittarius A* for ray-traced lensing.
 *
 * Valid only after layers have positioned everything camera-relative for the current frame: the cube camera
 * is placed at ctx.toRender(world), so the capture shares this frame's floating origin. Render targets are
 * HalfFloat (HDR, so bright stars keep their energy for bloom after lensing) and cached per size.
 */
import * as THREE from 'three';

export interface EnvironmentCapturer {
  /**
   * @param renderPos capture position already converted to render space (ctx.toRender(world)).
   * @param hide objects excluded from the capture (e.g. the lensing mesh itself); the overlay group is always hidden.
   */
  capture(renderPos: THREE.Vector3, size: number, hide?: readonly THREE.Object3D[]): THREE.CubeTexture;
  dispose(): void;
}

interface CubeEntry {
  target: THREE.WebGLCubeRenderTarget;
  camera: THREE.CubeCamera;
}

export function createEnvironmentCapturer(opts: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  overlay: THREE.Object3D;
  /** Near/far of the cube camera in render units (match the main camera for log depth). */
  near: number;
  far: number;
  halfFloat: boolean;
}): EnvironmentCapturer {
  const cache = new Map<number, CubeEntry>();
  const hiddenScratch: THREE.Object3D[] = [];
  const visScratch: boolean[] = [];

  const entryFor = (size: number): CubeEntry => {
    const s = Math.max(16, Math.min(2048, Math.round(size)));
    let e = cache.get(s);
    if (!e) {
      const target = new THREE.WebGLCubeRenderTarget(s, {
        type: opts.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
      });
      target.texture.name = `Cosmos.envCube.${s}`;
      const camera = new THREE.CubeCamera(opts.near, opts.far, target);
      e = { target, camera };
      cache.set(s, e);
    }
    return e;
  };

  return {
    capture(renderPos, size, hide = []): THREE.CubeTexture {
      const { target, camera } = entryFor(size);
      hiddenScratch.length = 0;
      visScratch.length = 0;
      hiddenScratch.push(opts.overlay);
      for (const o of hide) hiddenScratch.push(o);
      for (const o of hiddenScratch) {
        visScratch.push(o.visible);
        o.visible = false;
      }
      const prevTarget = opts.renderer.getRenderTarget();
      const prevToneMapping = opts.renderer.toneMapping;
      // Capture stays linear HDR; tone mapping happens once, at the end of the main post chain.
      opts.renderer.toneMapping = THREE.NoToneMapping;
      try {
        camera.position.copy(renderPos);
        camera.updateMatrixWorld(true);
        camera.update(opts.renderer, opts.scene);
      } finally {
        opts.renderer.toneMapping = prevToneMapping;
        opts.renderer.setRenderTarget(prevTarget);
        for (let i = 0; i < hiddenScratch.length; i++) hiddenScratch[i].visible = visScratch[i];
      }
      return target.texture;
    },

    dispose(): void {
      for (const e of cache.values()) e.target.dispose();
      cache.clear();
    },
  };
}
