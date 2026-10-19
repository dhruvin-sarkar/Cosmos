/**
 * Celestial coordinate grids ('sky:grids'): overlays 'grid-equatorial' (RA/Dec), 'grid-ecliptic' (λ/β, J2000) and
 * 'grid-galactic' (l/b). Drawn analytically per pixel on a full-screen triangle at infinity: every grid line is an
 * exact great/small circle with one-device-pixel anti-aliasing (distance to the line ÷ fwidth), and line density
 * adapts to the field of view (10°/15° majors, 5° and 1° minors fade in as you zoom). Meridians thin out towards the
 * poles so they never smear into a blob. The fundamental circle of each grid (celestial equator, ecliptic, Galactic
 * plane) is drawn stronger. Colours are VISUAL_DIRECTION hairline tokens, pre-inverted through AgX and divided by the
 * live exposure so they stay on-token at any exposure. Labels go through the label manager.
 */
import * as THREE from 'three';
import { POST_EXPOSURE_UNIFORM } from '../../core/post';
import type { EngineServices, FrameContext, LabelCandidate, Layer, OverlayId, ScreenPoint } from '../../core/types';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_FRAGMENT_AT_INFINITY, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { sceneLinearForOklch } from '../../render/tonemap';
import { frameDirToIcrs, icrsToFrameMatrix, type GridFrame } from './frames';
import { makeSkyQuad } from './skyMaterial';

export const SKY_GRID_LAYER_ID = 'sky:grids';
const FRAMES: readonly GridFrame[] = ['equatorial', 'ecliptic', 'galactic'];
const OVERLAY_OF: Record<GridFrame, OverlayId> = { equatorial: 'grid-equatorial', ecliptic: 'grid-ecliptic', galactic: 'grid-galactic' };
/** OKLCH tokens: equatorial = "Real" blue, ecliptic = "Modified" orange (colour-blind safe pair), galactic = ink. */
const TOKENS: Record<GridFrame, [number, number, number, number]> = {
  equatorial: [0.8, 0.085, 235, 0.24],
  ecliptic: [0.78, 0.14, 52, 0.24],
  galactic: [0.93, 0, 0, 0.13],
};
/** Fade the grids out far from the Sun, where Earth-sky coordinates stop being meaningful (kpc). */
const GRID_FADE_START_M = 1.5e19;
const GRID_FADE_END_M = 1.5e20;

const VS = /* glsl */ `
${VERTEX_PRELUDE}
uniform mat4 uInvProjection;
uniform mat3 uCameraRotation;
varying vec3 vDir;
void main() {
  vec4 view = uInvProjection * vec4(position.xy, -1.0, 1.0);
  vDir = uCameraRotation * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FS = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform mat3 uRot[3];
uniform vec3 uColor[3];
uniform vec3 uAlpha;
uniform vec3 uLonMajor;
uniform float uExposure;
varying vec3 vDir;

// Coverage of a 1-device-pixel line at coord = k * spacing.
float line(float coord, float spacing, float fw) {
  float d = abs(coord - spacing * floor(coord / spacing + 0.5));
  return clamp(1.0 - d / max(fw, 1e-6), 0.0, 1.0);
}

float grid(vec3 d, float lonMajor) {
  float lat = degrees(asin(clamp(d.z, -1.0, 1.0)));
  float lonS = degrees(atan(d.y, d.x));           // -180..180 (seam at 180)
  float lonU = lonS < 0.0 ? lonS + 360.0 : lonS;  // 0..360   (seam at 0)
  float fwLat = fwidth(lat);
  float fwS = fwidth(lonS);
  float fwU = fwidth(lonU);
  bool useS = fwS < fwU;
  float lon = useS ? lonS : lonU;
  float fwLon = min(fwS, fwU);
  float cl = cos(radians(lat));
  // Screen separation of neighbouring lines in pixels (fwLat = degrees of arc per pixel).
  float pxPerDeg = 1.0 / max(fwLat, 1e-6);
  float a = 0.0;
  // Fundamental circle (lat 0).
  a = max(a, line(lat, 360.0, fwLat) * 1.7);
  // Parallels: 10° major, 5° and 1° minors fade in with zoom.
  a = max(a, line(lat, 10.0, fwLat) * 1.0 * smoothstep(40.0, 90.0, 10.0 * pxPerDeg));
  a = max(a, line(lat, 5.0, fwLat) * 0.6 * smoothstep(110.0, 200.0, 5.0 * pxPerDeg));
  a = max(a, line(lat, 1.0, fwLat) * 0.45 * smoothstep(110.0, 200.0, 1.0 * pxPerDeg));
  // Meridians: lonMajor (15° = 1h for RA, else 30°/10° ...), thinning towards the poles.
  float sepMaj = lonMajor * cl * pxPerDeg;
  a = max(a, line(lon, lonMajor, fwLon) * 1.0 * smoothstep(30.0, 80.0, sepMaj));
  a = max(a, line(lon, 90.0, fwLon) * 1.0 * smoothstep(0.02, 0.1, cl));
  float minor = lonMajor / 3.0;
  a = max(a, line(lon, minor, fwLon) * 0.6 * smoothstep(110.0, 200.0, minor * cl * pxPerDeg));
  a = max(a, line(lon, 1.0, fwLon) * 0.45 * smoothstep(110.0, 200.0, cl * pxPerDeg));
  return a;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 c = vec3(0.0);
  if (uAlpha.x > 0.0) c += uColor[0] * grid(uRot[0] * d, uLonMajor.x) * uAlpha.x;
  if (uAlpha.y > 0.0) c += uColor[1] * grid(uRot[1] * d, uLonMajor.y) * uAlpha.y;
  if (uAlpha.z > 0.0) c += uColor[2] * grid(uRot[2] * d, uLonMajor.z) * uAlpha.z;
  if (dot(c, c) <= 0.0) discard;
  gl_FragColor = vec4(c / uExposure, 1.0);
  ${LOGDEPTH_FRAGMENT}
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
}
`;

interface GridLabel {
  frame: GridFrame;
  dir: THREE.Vector3;
  cand: LabelCandidate;
}

const fmtSigned = (v: number): string => (v > 0 ? `+${v}°` : v < 0 ? `−${-v}°` : '0°');

export function createSkyGridLayer(): Layer {
  let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  const alpha: Record<GridFrame, number> = { equatorial: 0, ecliptic: 0, galactic: 0 };
  const fixed: GridLabel[] = [];
  // Dynamic latitude labels along the meridian closest to the view centre, per frame.
  const LATS = [-80, -60, -40, -20, 20, 40, 60, 80];
  const dyn: Record<GridFrame, GridLabel[]> = { equatorial: [], ecliptic: [], galactic: [] };
  const tmpW = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const sp: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const rotM = FRAMES.map((f) => icrsToFrameMatrix(f));

  function mk(frame: GridFrame, lon: number, lat: number, text: string, priority: number): GridLabel {
    return {
      frame,
      dir: frameDirToIcrs(frame, lon, lat),
      cand: { entityId: null, text, x: 0, y: 0, priority, kind: 'annotation', opacity: 1, offsetPx: 0 },
    };
  }

  for (let h = 0; h < 24; h += 1) fixed.push(mk('equatorial', h * 15, 0, `${h}h`, h % 6 === 0 ? 6 : 3));
  fixed.push(mk('equatorial', 0, 90, 'NCP', 6), mk('equatorial', 0, -90, 'SCP', 6));
  for (let l = 0; l < 360; l += 30) fixed.push(mk('ecliptic', l, 0, l === 0 ? 'Ecliptic  λ 0°' : `λ ${l}°`, l % 90 === 0 ? 5 : 3));
  for (let l = 0; l < 360; l += 30) {
    const text = l === 0 ? 'Galactic centre  l 0°' : l === 180 ? 'Anticentre  l 180°' : `l ${l}°`;
    fixed.push(mk('galactic', l, 0, text, l % 90 === 0 ? 6 : 3));
  }
  fixed.push(mk('galactic', 0, 90, 'NGP', 5), mk('galactic', 0, -90, 'SGP', 5));
  for (const f of FRAMES) for (const b of LATS) dyn[f].push(mk(f, 0, b, f === 'equatorial' ? fmtSigned(b) : `${f === 'ecliptic' ? 'β' : 'b'} ${fmtSigned(b)}`, 2));

  let fadeDist = 1;

  function emit(ctx: FrameContext, g: GridLabel, out: LabelCandidate[]): void {
    const a = alpha[g.frame] * fadeDist;
    if (a <= 0.02) return;
    tmpW.copy(g.dir).multiplyScalar(1e24).add(ctx.cameraPosition);
    ctx.project(tmpW, sp);
    if (!sp.visible) return;
    g.cand.x = sp.x;
    g.cand.y = sp.y;
    g.cand.opacity = Math.min(1, a) * 0.8;
    out.push(g.cand);
  }

  return {
    id: SKY_GRID_LAYER_ID,
    init(svc: EngineServices) {
      const colors = FRAMES.map((f) => {
        const t = TOKENS[f];
        // Major lines at the token's hairline opacity (4th entry); the shader scales relative to that.
        const c = sceneLinearForOklch(t[0], t[1], t[2], t[3], 1);
        return new THREE.Vector3(c.r, c.g, c.b);
      });
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uInvProjection: { value: new THREE.Matrix4() },
          uCameraRotation: { value: new THREE.Matrix3() },
          uRot: { value: rotM },
          uColor: { value: colors },
          uAlpha: { value: new THREE.Vector3() },
          uLonMajor: { value: new THREE.Vector3(15, 30, 30) },
          uExposure: POST_EXPOSURE_UNIFORM,
        },
        vertexShader: VS,
        fragmentShader: FS,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
      });
      mesh = makeSkyQuad(mat as THREE.ShaderMaterial & { uniforms: { uInvProjection: { value: THREE.Matrix4 }; uCameraRotation: { value: THREE.Matrix3 } } }, -900);
      mesh.name = 'sky-grids';
      mesh.visible = false;
      svc.groups.background.add(mesh);
    },
    update(ctx: FrameContext) {
      if (!mesh) return;
      const k = ctx.reducedMotion ? 1 : Math.min(1, ctx.dtRealSec * 5);
      let any = false;
      const d = ctx.cameraPosition.length();
      const x = Math.min(1, Math.max(0, Math.log(Math.max(d, GRID_FADE_START_M) / GRID_FADE_START_M) / Math.log(GRID_FADE_END_M / GRID_FADE_START_M)));
      fadeDist = 1 - x * x * (3 - 2 * x);
      const ua = mesh.material.uniforms.uAlpha.value as THREE.Vector3;
      FRAMES.forEach((f, i) => {
        const target = ctx.overlays[OVERLAY_OF[f]] ? 1 : 0;
        alpha[f] += (target - alpha[f]) * k;
        if (Math.abs(alpha[f] - target) < 0.002) alpha[f] = target;
        const v = alpha[f] * fadeDist;
        ua.setComponent(i, v);
        if (v > 0) any = true;
      });
      mesh.visible = any;
    },
    collectLabels(ctx: FrameContext, out: LabelCandidate[]) {
      if (!mesh?.visible || !ctx.overlays.labels) return;
      for (const g of fixed) emit(ctx, g, out);
      // Latitude labels along the meridian nearest the view centre (rounded to the major meridian step).
      FRAMES.forEach((f, i) => {
        if (alpha[f] <= 0.02) return;
        tmpV.copy(ctx.cameraForward).applyMatrix3(rotM[i]);
        let lon = (Math.atan2(tmpV.y, tmpV.x) * 180) / Math.PI;
        const step = f === 'equatorial' ? 15 : 30;
        lon = Math.round(lon / step) * step;
        for (let j = 0; j < LATS.length; j++) {
          const g = dyn[f][j];
          frameDirToIcrs(f, lon, LATS[j], g.dir);
          emit(ctx, g, out);
        }
      });
    },
    dispose() {
      mesh?.material.dispose();
      mesh?.removeFromParent();
      mesh = null;
    },
  };
}
