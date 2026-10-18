/**
 * Screen-space level of detail (docs/ARCHITECTURE.md §5.6): representation is chosen by on-screen pixel
 * diameter, never by distance alone, and neighbouring representations cross-fade over a pixel range (no popping).
 *
 * | Pixel diameter | Representation                                   |
 * |----------------|--------------------------------------------------|
 * | < 1.5          | photometric point                                |
 * | 1.5 – 4        | point fading out, low-poly sphere fading in      |
 * | 4 – 12         | textured low-res sphere                          |
 * | > 12           | full shader (high-res textures, atmosphere)      |
 * | > 400          | surface extras (cloud detail, terminator glow)   |
 */

export const LOD_PX = {
  pointMax: 1.5,
  sphereFull: 4,
  lowResMax: 12,
  extras: 400,
} as const;

export type LodLevel = 'point' | 'point-sphere' | 'low' | 'full' | 'extras';

/** CSS px per radian for a vertical field of view: viewportHeight / (2·tan(fov/2)) at the screen centre. */
export function pixelsPerRadian(viewportHeightCssPx: number, fovYRad: number): number {
  return viewportHeightCssPx / (2 * Math.tan(fovYRad / 2));
}

/**
 * On-screen diameter (CSS px) of a sphere of radius `radiusM` whose centre is `distanceM` away: the exact angular
 * diameter 2·asin(r/d) × px/rad. Infinity when the camera is inside the sphere; 0 for invalid input.
 */
export function pixelDiameter(radiusM: number, distanceM: number, pxPerRad: number): number {
  if (!(radiusM > 0) || !(distanceM > 0) || !(pxPerRad > 0)) return 0;
  if (distanceM <= radiusM) return Infinity;
  return 2 * Math.asin(radiusM / distanceM) * pxPerRad;
}

/** Distance (m) at which a sphere of radius `radiusM` spans `px` CSS pixels (inverse of pixelDiameter). */
export function distanceForPixelDiameter(radiusM: number, px: number, pxPerRad: number): number {
  const half = px / (2 * pxPerRad);
  if (half >= Math.PI / 2) return radiusM;
  return radiusM / Math.sin(half);
}

function smooth01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface LodBlend {
  level: LodLevel;
  /** Opacity of the photometric point (1 → 0 across 1.5–4 px). */
  point: number;
  /** Opacity of the sphere mesh (0 → 1 across 1.5–4 px). */
  sphere: number;
  /** 0 → 1 across 8–16 px: blend from the low-res to the full shader (use for texture/atmosphere fade-in). */
  detail: number;
  /** 0 → 1 across 300–500 px: surface extras. */
  extras: number;
}

/** Cross-fade weights for a body at `px` CSS pixels diameter. Mutates and returns `out` (allocation-free). */
export function lodBlend(px: number, out: LodBlend = { level: 'point', point: 1, sphere: 0, detail: 0, extras: 0 }): LodBlend {
  out.sphere = smooth01(LOD_PX.pointMax, LOD_PX.sphereFull, px);
  out.point = 1 - out.sphere;
  out.detail = smooth01(LOD_PX.lowResMax * (2 / 3), LOD_PX.lowResMax * (4 / 3), px);
  out.extras = smooth01(LOD_PX.extras * 0.75, LOD_PX.extras * 1.25, px);
  out.level = lodLevel(px);
  return out;
}

export function lodLevel(px: number): LodLevel {
  if (px < LOD_PX.pointMax) return 'point';
  if (px < LOD_PX.sphereFull) return 'point-sphere';
  if (px < LOD_PX.lowResMax) return 'low';
  if (px < LOD_PX.extras) return 'full';
  return 'extras';
}

/**
 * Sphere tessellation (width segments) so that the polygon's sagitta stays below `maxErrorPx`:
 * sagitta ≈ R(1 − cos(π/n)) projected → n ≥ π / acos(1 − 2·err/px). Clamped to [8, 256].
 */
export function sphereSegmentsForPixels(px: number, maxErrorPx = 0.5): number {
  if (!(px > 0)) return 8;
  const c = 1 - (2 * maxErrorPx) / px;
  if (c <= -1) return 8;
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, c))));
  return Math.min(256, Math.max(8, n));
}
