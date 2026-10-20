/**
 * KTX2 vs image comparison: the same map through the AssetLoader (ImageBitmap, RGBA8) on the left/top and through the
 * texture manager (KTX2 -> BC7) on the right/bottom, unlit, on 2:1 planes. Checks orientation, colour space and detail.
 * Query: ?map=textures/mars/color_8k.jpg&cs=srgb&zoom=1&cx=0.5&cy=0.5  (zoom crops around cx, cy in uv)
 * Result in window.__gpuTextures (timings + texture manager stats).
 */
import * as THREE from 'three';
import { createAssetLoader } from '../src/core/assets';
import { getTextureManager } from '../src/core/textures';

const q = new URLSearchParams(location.search);
const map = q.get('map') ?? 'textures/earth/day_4k.jpg';
const cs = (q.get('cs') ?? 'srgb') as 'srgb' | 'linear';
const zoom = Number(q.get('zoom') ?? '1');
const cx = Number(q.get('cx') ?? '0.5');
const cy = Number(q.get('cy') ?? '0.5');

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const aspect = innerWidth / innerHeight;
const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -1, 1);

const assets = createAssetLoader({ renderer });
const mgr = getTextureManager(assets, renderer);
const mkPlane = (y: number): THREE.Mesh => {
  // Each plane shows a [cx ± 0.5/zoom] x [cy ± 0.25/zoom]... crop of the map through the uv transform.
  const w = Math.min(2 * aspect - 0.04, 1.92) , h = w / 2;
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cx + (uv.getX(i) - 0.5) / zoom, cy + (uv.getY(i) - 0.5) / zoom);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x222222 }));
  m.position.y = y * (h / 2 + 0.01);
  scene.add(m);
  return m;
};
const top = mkPlane(1);
const bottom = mkPlane(-1);
const result: Record<string, unknown> = { map };
(window as unknown as { __gpuTextures: unknown }).__gpuTextures = result;

const t0 = performance.now();
void assets.textureAsync(map, { colorSpace: cs, anisotropy: 16 }).then(t => {
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  const u0 = performance.now();
  renderer.initTexture(t); // the RGBA8 upload + generateMipmap that a render frame would otherwise absorb
  result.imageUploadMs = performance.now() - u0;
  (top.material as THREE.MeshBasicMaterial).map = t;
  (top.material as THREE.MeshBasicMaterial).color.set(0xffffff);
  (top.material as THREE.MeshBasicMaterial).needsUpdate = true;
  result.imageMs = performance.now() - t0;
});
void mgr.loadKtx2(map, { colorSpace: cs, anisotropy: 16 }).then(t => {
  result.ktx2Ms = performance.now() - t0;
  result.ktx2 = !!t;
  if (!t) return;
  result.format = t.format;
  result.levels = (t as THREE.CompressedTexture).mipmaps.length;
  (bottom.material as THREE.MeshBasicMaterial).map = t;
  (bottom.material as THREE.MeshBasicMaterial).color.set(0xffffff);
  (bottom.material as THREE.MeshBasicMaterial).needsUpdate = true;
});
let longest = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  longest = Math.max(longest, now - last);
  last = now;
  renderer.render(scene, cam);
  result.longestFrameMs = longest;
  result.stats = mgr.stats();
});
