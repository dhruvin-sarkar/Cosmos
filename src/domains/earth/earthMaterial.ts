/**
 * Earth surface material: Blue Marble day map, VIIRS night lights, cloud layer with cloud shadows, ocean sun
 * glitter, ETOPO relief normals and the Moon's shadow — one opaque pass.
 *
 * Frame and units: the mesh is a unit sphere in the Earth body-fixed frame (+x Greenwich, +z north pole), so all
 * lighting is done in planet radii in that frame — the same units as the render-kit atmosphere chunk, whose
 * Chapman sun transmittance gives the physically motivated terminator (sunset reddening on the ground and the
 * clouds) without any ambient fill.
 *
 * Radiance is scene-linear: albedo / π × irradiance (uSunIntensity at the Earth's distance). Nothing is clamped or
 * tone mapped here (AgX runs in post).
 *
 * Texture coordinates are computed per fragment from the body-fixed direction (no UV seam, no pole pinching
 * from triangle fans) with seam-safe gradients for textureGrad, so mip selection never breaks at the antimeridian.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { ATMOSPHERE_GLSL } from '../../render/glsl/atmosphere';
import { SHADOW_GLSL } from '../../render/glsl/shadow';
import { createAtmosphereUniforms } from '../../render/materials/AtmosphereShell';
import { EARTH_ATMOSPHERE } from '../../render/glsl/atmosphere';
import { createSolidTexture } from '../../render/textures';
import { NOISE_GLSL } from '../../render/glsl/noise';

/** Shared GLSL: equirectangular lookup with seam-safe gradients + local tangent frame. */
export const SPHERE_UV_GLSL = /* glsl */ `
vec2 sphereUv(vec3 p) {
  float lon = atan(p.y, p.x);
  float lat = asin(clamp(p.z, -1.0, 1.0));
  return vec2(lon * (0.5 / PI) + 0.5, lat * (1.0 / PI) + 0.5);
}
// Screen-space UV gradients with the 0/1 longitude wrap removed (u is periodic).
void sphereUvGrad(vec2 uv, out vec2 gx, out vec2 gy) {
  gx = dFdx(uv);
  gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5);
  gy.x -= floor(gy.x + 0.5);
}
// East / north unit vectors at body-fixed direction p (+z = north pole).
void sphereTangents(vec3 p, out vec3 east, out vec3 north) {
  vec2 h = vec2(-p.y, p.x);
  float l = length(h);
  east = l > 1e-6 ? vec3(h / l, 0.0) : vec3(0.0, 1.0, 0.0);
  north = cross(p, east);
}
`;

export const EARTH_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const EARTH_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
${ATMOSPHERE_GLSL}
${SHADOW_GLSL}
${SPHERE_UV_GLSL}
${NOISE_GLSL}
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uSpec;
uniform sampler2D uNormal;
uniform vec3 uSunDir;          // body-fixed, unit, toward the Sun
uniform vec3 uCamPos;          // body-fixed, planet radii
uniform float uSunIntensity;   // scene-linear irradiance at the Earth
uniform float uSunAngRadius;   // radians
uniform vec3 uMoonPos;         // body-fixed, planet radii
uniform float uMoonRadius;     // planet radii
uniform float uAlbedoGain;
uniform float uNightGain;
uniform float uNormalStrength;
uniform float uCloudOpacity;
uniform float uCloudTexel;     // 1 / cloud map width
uniform float uCloudShadow;
uniform float uHasNormal;
uniform float uDetail;         // 0..1, close-range procedural detail (low orbit), set from the camera altitude
uniform float uFlowPhase;      // 0..1 position within the cloud-drift flow period
uniform float uFlowPeriodS;    // flow period, simulation seconds
uniform float uDrift;          // 0 = static clouds, 1 = climatological zonal drift
uniform float uLightsGamma;    // contrast expansion of the night-lights product (peak preserved)
varying vec3 vPos;

const float CLOUD_HEIGHT = 0.0016;   // ~10 km in Earth radii
const float CLOUD_ALBEDO = 0.78;
// Open-ocean albedo (water-leaving + whitecaps, ~0.05 in the blue, darker in the red; Kirk 2011). The Blue Marble
// ocean is near-black (2,5,20 sRGB), so the deep navy of DSCOVR EPIC frames needs this floor.
const vec3 OCEAN_ALBEDO = vec3(0.012, 0.032, 0.085);
const vec3 LIGHTS_TINT = vec3(1.0, 0.62, 0.28);   // high-pressure sodium dominated

// Coverage map → opacity: the composite carries a thin veil almost everywhere; keep real decks, drop the veil.
float cloudCover(float c) {
  return pow(smoothstep(0.1, 0.9, c), 1.1) * uCloudOpacity;
}
// Zonal-mean wind at cloud level (m/s, + = eastward): trade easterlies, mid-latitude westerlies, polar easterlies
// (climatological; ERA5-like magnitudes at ~700 hPa). Real weather is not modelled — the cloud field itself is static.
float zonalWind(float latDeg) {
  float a = abs(latDeg);
  return -6.0 * (1.0 - smoothstep(15.0, 30.0, a)) + 11.0 * smoothstep(28.0, 42.0, a) * (1.0 - smoothstep(55.0, 68.0, a))
    - 3.0 * smoothstep(65.0, 75.0, a);
}
// Longitude shift (texture u) per full flow period at this latitude.
float cloudDu(float v) {
  float lat = (v - 0.5) * 180.0;
  return uDrift * zonalWind(lat) * uFlowPeriodS / (2.0 * PI * 6.371e6 * max(cos(radians(lat)), 0.15));
}
// Two-phase flow map (bounded displacement, continuous in time): the cloud texture advected by the zonal wind.
float cloudAt(vec2 uv, vec2 gx, vec2 gy, float du) {
  // Single exit (ANGLE/HLSL warns X4000 on an early return here).
  float c = 0.0;
  if (uDrift < 0.001) {
    c = textureGrad(uClouds, uv, gx, gy).r;
  } else {
    float p0 = uFlowPhase;
    float p1 = fract(uFlowPhase + 0.5);
    float a = textureGrad(uClouds, uv - vec2(du * (p0 - 0.5), 0.0), gx, gy).r;
    float b = textureGrad(uClouds, uv - vec2(du * (p1 - 0.5), 0.0), gx, gy).r;
    c = mix(a, b, abs(2.0 * p0 - 1.0));
  }
  return c;
}
float ggxD(float NdotH, float a2) {
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float smithVis(float NdotL, float NdotV, float a2) {
  float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
  float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 p = normalize(vPos);
  vec3 L = uSunDir;
  vec3 V = normalize(uCamPos - p);
  vec2 uv = sphereUv(p);
  vec2 gx, gy;
  sphereUvGrad(uv, gx, gy);
  vec3 east, north;
  sphereTangents(p, east, north);

  vec3 day = textureGrad(uDay, uv, gx, gy).rgb * uAlbedoGain;
  vec3 lights = textureGrad(uNight, uv, gx, gy).rgb;
  float ocean = textureGrad(uSpec, uv, gx, gy).r;
  // Blue Marble land is slightly desaturated relative to EPIC natural colour (Sahara, Kalahari): lift chroma a little.
  day = max(mix(vec3(dot(day, vec3(0.2126, 0.7152, 0.0722))), day, 1.0 + 0.15 * (1.0 - ocean)), 0.0);
  day = mix(day, max(day, OCEAN_ALBEDO), ocean);
  float du = cloudDu(uv.y);
  float cloud = cloudAt(uv, gx, gy, du);

  // Close range (low orbit): the maps are 2.4 km/texel (16K day) to 10 km/texel (4K). A coherent fbm micro-field
  // (base wavelength ~20 km, octaves at ~7 and ~2 km, each faded out before it would alias) erodes partial-coverage
  // cloud texels into clumped cumulus (decks stay solid, clear sky stays clear: no speckle) and gives land a
  // micro-albedo and micro-relief texture. Illustrative sub-resolution structure; the observed cloud field and land
  // cover are unchanged at the texel scale.
  float detailN = 0.0;
  if (uDetail > 0.001) {
    float fw = length(fwidth(p));
    vec3 q = p * 320.0; // 1 noise unit ~ 20 km (6371 km / 320)
    float a1 = 1.0 - smoothstep(0.25, 0.6, fw * 320.0);
    float a2 = 1.0 - smoothstep(0.25, 0.6, fw * 960.0);
    float a3 = 1.0 - smoothstep(0.25, 0.6, fw * 2880.0);
    float n1 = a1 > 0.0 ? simplexNoise3(q) : 0.0;
    float n2 = a2 > 0.0 ? simplexNoise3(q * 3.0 + 17.0) : 0.0;
    float n3 = a3 > 0.0 ? simplexNoise3(q * 9.0 - 31.0) : 0.0;
    detailN = (n1 * 0.55 * a1 + n2 * 0.3 * a2 + n3 * 0.15 * a3) * uDetail;
    // Domain warp of the cloud lookup (~1.5 texels): magnified texels read as organic cumulus, not bilinear squares.
    float nw = a1 > 0.0 ? simplexNoise3(q * 1.3 + 53.0) * a1 + n2 * 0.4 * a2 : 0.0;
    vec2 warp = vec2(n1 * a1 + n3 * 0.4 * a3, 2.0 * nw) * (1.5 * uCloudTexel * uDetail);
    cloud = cloudAt(uv + warp, gx, gy, du);
    float edge = smoothstep(0.12, 0.4, cloud) * (1.0 - smoothstep(0.7, 0.95, cloud));
    cloud = clamp(cloud + detailN * 0.7 * edge, 0.0, 1.0);
    day *= 1.0 + 0.22 * detailN * (1.0 - ocean);
  }

  // Relief from the ETOPO normal map (OpenGL tangent space: R = east, G = north).
  vec3 n = p;
  if (uHasNormal > 0.5 && uNormalStrength > 0.0) {
    vec3 nm = textureGrad(uNormal, uv, gx, gy).xyz * 2.0 - 1.0;
    nm.xy *= uNormalStrength;
    // Close range: the same relief field sampled 8× finer (terrain is self-similar) adds micro-relief beyond the map's
    // resolution, only where the map itself shows slopes (mountains, not oceans or plains).
    if (uDetail > 0.001) {
      vec3 dm = textureGrad(uNormal, fract(uv * 8.0), gx * 8.0, gy * 8.0).xyz * 2.0 - 1.0;
      float rough = smoothstep(0.02, 0.25, length(nm.xy)) * (1.0 - ocean);
      nm.xy += dm.xy * uNormalStrength * 0.6 * uDetail * rough;
    }
    n = normalize(east * nm.x + north * nm.y + p * max(nm.z, 0.05));
  }
  // Micro-relief from the same fbm field (derivative bump, Mikkelsen 2010): ~300 m amplitude on land, more in mountains.
  if (uDetail > 0.001) {
    float rough = uHasNormal > 0.5 ? smoothstep(0.02, 0.25, length(n - p)) : 0.0;
    float h = detailN * (4.7e-5 + 1.4e-4 * rough) * (1.0 - ocean);
    vec3 dpx = dFdx(p);
    vec3 dpy = dFdy(p);
    vec3 r1 = cross(dpy, n);
    vec3 r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    if (abs(det) > 1e-20) n = normalize(abs(det) * n - grad);
  }

  float muGeo = dot(p, L);
  float muV = max(dot(p, V), 1e-3);

  // Sun light reaching the ground and the cloud tops: Chapman transmittance (reddens, then dies past the terminator).
  vec3 Tg = atmosphereSunTransmittance(p * 1.000002, L);
  vec3 Tc = atmosphereSunTransmittance(p * (1.0 + CLOUD_HEIGHT), L);
  float eclipse = sphereShadow(p, L, uSunAngRadius, uMoonPos, uMoonRadius);
  vec3 E = uSunIntensity * eclipse * Tg;
  vec3 Ec = uSunIntensity * sphereShadow(p * (1.0 + CLOUD_HEIGHT), L, uSunAngRadius, uMoonPos, uMoonRadius) * Tc;

  // Cloud coverage → opacity; cloud shadow: the cloud along the ray toward the Sun from this ground point.
  float cA = cloudCover(cloud);
  vec3 ps = normalize(p + L * (CLOUD_HEIGHT / max(muGeo, 0.12)));
  vec2 uvs = sphereUv(ps);
  float cs = cloudAt(uvs, gx, gy, cloudDu(uvs.y));
  float shadow = 1.0 - uCloudShadow * cloudCover(cs);

  // Ground: Lambert on the relief normal, ocean glitter (GGX, wind-roughened, Schlick Fresnel).
  float NdotL = max(dot(n, L), 0.0);
  vec3 ground = day * (RECIPROCAL_PI * NdotL);
  if (ocean > 0.01 && muGeo > -0.02) {
    vec3 H = normalize(L + V);
    float NdotH = max(dot(p, H), 0.0);
    // Cox–Munk: mean-square slope 0.003 + 0.00512·U = 0.029 at U = 5 m/s. Seen from orbit the glint is dominated by the
    // large facets (the capillary part of the slope spectrum averages out over a pixel), so the lobe uses α² = mss / 2
    // (α ≈ 0.12 at 5 m/s): a tight, bright glint instead of a broad grey sheen. Surface wind varies across the glint
    // (calm patches sharpen it, windy ones spread it): a large-scale field of U ≈ 2–9 m/s (illustrative).
    float wind = 0.5 + 0.5 * simplexNoise3(p * 7.0);
    float a2 = 0.5 * (0.003 + 0.00512 * mix(2.0, 9.0, wind));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float NdotLs = max(muGeo, 0.0);
    float spec = ggxD(NdotH, a2) * smithVis(NdotLs, muV, a2) * F * NdotLs;
    // Skylight reflected by the sea (Fresnel-weighted, strongest toward the limb): blue sky radiance ≈ 3 % of the
    // diffuse sunlit-surface level, scaled by the local sun elevation.
    vec3 sky = vec3(0.30, 0.55, 1.0) * (0.03 * RECIPROCAL_PI * smoothstep(-0.05, 0.3, muGeo));
    // The thin cloud veil that cloudCover() drops still scatters the direct beam: no glint through it. Coverage is taken
    // from a ~3-mip-blurred lookup so scattered cumulus dims the glint smoothly instead of speckling it.
    float clear = 1.0 - smoothstep(0.05, 0.45, cloudAt(uv, gx * 8.0, gy * 8.0, du));
    ground = ground * (1.0 - 0.6 * F * ocean) + vec3(spec * ocean * clear) + sky * (F * ocean);
  }
  vec3 groundRad = ground * E * shadow;

  // Clouds: bright Lambert with a little relief from the coverage gradient (sculpts the terminator).
  vec3 cloudRad = vec3(0.0);
  if (cA > 0.002) {
    // Relief from the coverage gradient over a 2-texel footprint; weaker at close range, where per-texel gradients would
    // read as embossing rather than cloud tops.
    float tx = 2.0 * uCloudTexel;
    float cx = cloudAt(uv + vec2(tx, 0.0), gx, gy, du) - cloudAt(uv - vec2(tx, 0.0), gx, gy, du);
    float cy = cloudAt(uv + vec2(0.0, tx * 2.0), gx, gy, du) - cloudAt(uv - vec2(0.0, tx * 2.0), gx, gy, du);
    vec3 cn = normalize(p - 0.4 * (1.0 - 0.75 * uDetail) * (east * cx + north * cy));
    // Cloud tops ~10 km up see the Sun ~3° past the ground terminator (horizon dip √(2h) ≈ 0.057 rad): wrap the
    // Lambert term by that dip so they keep catching the reddened (Chapman-transmitted) sunset light.
    float cl = max(dot(cn, L) + 0.057, 0.0) / 1.057;
    // Forward-scattering brightening near the limb when looking toward the Sun (thin cloud edges).
    float fwd = 1.0 + 0.6 * pow(max(dot(-V, L), 0.0), 6.0) * (1.0 - cA);
    cloudRad = vec3(CLOUD_ALBEDO * RECIPROCAL_PI * cl * fwd) * Ec;
  }

  vec3 color = mix(groundRad, cloudRad, cA);

  // City lights: always on, visible once the sky darkens (sun ~3–8° below the horizon); dimmed under clouds.
  float dark = smoothstep(0.06, -0.12, muGeo);
  // The Black Marble product is a compressed (roughly logarithmic) stretch of VIIRS DNB radiance; expanding it restores
  // the large real contrast between bright urban cores and dim suburbs/roads (peak brightness unchanged).
  float lum = pow(dot(lights, vec3(0.2126, 0.7152, 0.0722)), uLightsGamma);
  // Warm sodium glow, whiter in saturated urban cores.
  vec3 city = lum * mix(LIGHTS_TINT, vec3(1.0, 0.9, 0.75), smoothstep(0.25, 0.9, lum)) * uNightGain * dark * (1.0 - 0.88 * cA);
  color += city;

  gl_FragColor = vec4(color, 1.0);
}
`;

export class EarthSurfaceMaterial extends THREE.ShaderMaterial {
  declare uniforms: ReturnType<typeof createAtmosphereUniforms> & {
    uDay: { value: THREE.Texture };
    uNight: { value: THREE.Texture };
    uClouds: { value: THREE.Texture };
    uSpec: { value: THREE.Texture };
    uNormal: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uCamPos: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngRadius: { value: number };
    uMoonPos: { value: THREE.Vector3 };
    uMoonRadius: { value: number };
    uAlbedoGain: { value: number };
    uNightGain: { value: number };
    uNormalStrength: { value: number };
    uCloudOpacity: { value: number };
    uCloudTexel: { value: number };
    uCloudShadow: { value: number };
    uHasNormal: { value: number };
    uDetail: { value: number };
    uFlowPhase: { value: number };
    uFlowPeriodS: { value: number };
    uDrift: { value: number };
    uLightsGamma: { value: number };
  };

  readonly fallbacks: THREE.Texture[];

  constructor() {
    const blue = createSolidTexture(0x0b2a52);
    const black = createSolidTexture(0x000000);
    const flat = createSolidTexture(0x8080ff);
    flat.colorSpace = THREE.NoColorSpace;
    black.colorSpace = THREE.NoColorSpace;
    super({
      uniforms: {
        ...createAtmosphereUniforms(EARTH_ATMOSPHERE),
        uDay: { value: blue },
        uNight: { value: black },
        uClouds: { value: black },
        uSpec: { value: black },
        uNormal: { value: flat },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamPos: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: 5 },
        uSunAngRadius: { value: 0.00465 },
        uMoonPos: { value: new THREE.Vector3(60, 0, 0) },
        uMoonRadius: { value: 0.2727 },
        uAlbedoGain: { value: 1.0 },
        uNightGain: { value: 1.6 },
        uNormalStrength: { value: 0.0 },
        uCloudOpacity: { value: 0.97 },
        uCloudTexel: { value: 1 / 2048 },
        uCloudShadow: { value: 0.7 },
        uHasNormal: { value: 0 },
        uDetail: { value: 0 },
        uFlowPhase: { value: 0.5 },
        uFlowPeriodS: { value: 3 * 3600 },
        uDrift: { value: 1 },
        uLightsGamma: { value: 1.5 },
      },
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
    });
    this.fallbacks = [blue, black, flat];
  }

  override dispose(): void {
    for (const t of this.fallbacks) t.dispose();
    super.dispose();
  }
}
