/**
 * Texture configuration helpers: colour space, anisotropy, mipmaps, small generated textures.
 *
 * Rule of thumb: textures holding colour (albedo, sky maps in visible light, ring colours) are sRGB; data
 * (normals, heights, masks, survey intensities) are linear (NoColorSpace / LinearSRGBColorSpace).
 */
import * as THREE from 'three';

export interface TextureConfig {
  /** 'srgb' for colour, 'linear' for data. */
  colorSpace?: 'srgb' | 'linear';
  /** Requested anisotropy (clamped to the GPU max). Default 16 (crisp at grazing angles near the limb; ~free on desktop GPUs). */
  anisotropy?: number;
  mipmaps?: boolean;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
}

/** Apply colour space / filtering / anisotropy in place and flag the texture for upload. */
export function configureTexture<T extends THREE.Texture>(tex: T, renderer: THREE.WebGLRenderer | null, cfg: TextureConfig = {}): T {
  tex.colorSpace = cfg.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const mip = cfg.mipmaps ?? true;
  tex.generateMipmaps = mip;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  tex.anisotropy = Math.max(1, Math.min(cfg.anisotropy ?? 16, maxAniso));
  if (cfg.wrapS !== undefined) tex.wrapS = cfg.wrapS;
  if (cfg.wrapT !== undefined) tex.wrapT = cfg.wrapT;
  tex.needsUpdate = true;
  return tex;
}

/** Equirectangular maps: repeat in u (RA / longitude wraps), clamp in v (poles). */
export function configureEquirect<T extends THREE.Texture>(tex: T, renderer: THREE.WebGLRenderer | null, cfg: TextureConfig = {}): T {
  return configureTexture(tex, renderer, { ...cfg, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

export interface StripStop {
  /** Position 0–1 along the strip. */
  t: number;
  /** sRGB colour 0–255. */
  rgb: [number, number, number];
  /** Opacity 0–1. */
  a: number;
}

/**
 * 1-D RGBA strip (rings, gradients) built from stops with linear interpolation, `width` texels wide. Colour is
 * sRGB-encoded (SRGBColorSpace), alpha linear. Clamp-to-edge, linear filtering, no mipmaps along v.
 */
export function createStripTexture(stops: StripStop[], width = 1024): THREE.DataTexture {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const data = new Uint8Array(4 * width);
  for (let x = 0; x < width; x++) {
    const t = (x + 0.5) / width;
    let k = 0;
    while (k < sorted.length - 2 && sorted[k + 1].t < t) k++;
    const s0 = sorted[k];
    const s1 = sorted[Math.min(k + 1, sorted.length - 1)];
    const f = s1.t > s0.t ? Math.min(1, Math.max(0, (t - s0.t) / (s1.t - s0.t))) : 0;
    for (let c = 0; c < 3; c++) data[4 * x + c] = Math.round(s0.rgb[c] + (s1.rgb[c] - s0.rgb[c]) * f);
    data[4 * x + 3] = Math.round(255 * (s0.a + (s1.a - s0.a) * f));
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 1×1 placeholder texture of a colour (sRGB hex). */
export function createSolidTexture(hex: number, alpha = 1): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, Math.round(alpha * 255)]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
