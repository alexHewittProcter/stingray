import * as THREE from 'three';

// The look of the water itself, shared by every shader in the scene.
//
// Fog in three is applied after tone mapping, in display (sRGB) space, so every colour here is a
// display colour. The fog chunks are replaced globally: any built-in material with fog on — including
// ones other modules create — gets underwater absorption, depth darkening and the surface crossing for free.
// The scene's THREE.Fog carries the per-frame state: fog.color = the water (or haze) colour at the camera,
// fog.near = radius of the lit zone around the camera, fog.far = visibility in the camera's medium.

/** Where the sunlight comes from (unit vector, world space): high in the south-east. */
export const SUN_DIRECTION = new THREE.Vector3(0.42, 0.78, 0.46).normalize();

/** A display-space colour as a GLSL vec3 literal. */
export function glslColour(hex: number): string {
  const c = (shift: number) => (((hex >> shift) & 255) / 255).toFixed(4);
  return `vec3(${c(16)}, ${c(8)}, ${c(0)})`;
}

export const SKY_ZENITH = 0x4f7fbf;
export const SKY_HORIZON = 0xbccbdb;
/** The open sea far off, where it meets the sky. */
export const SEA_HORIZON = 0x5d7398;
/** The body colour of the sea seen from above. */
export const SEA_BODY = 0x1c3a63;
export const AIR_VISIBILITY = 9000; // m

// Water seen from inside, at the surface and at the bottom of the trench.
const WATER_SHALLOW = new THREE.Color(0x0c3a55);
const WATER_DEEP = new THREE.Color(0x041422);
const VISIBILITY_SHALLOW = 400; // m (C6)
const VISIBILITY_DEEP = 250;
const LIT_RADIUS_SHALLOW = 170; // m: the "studio lights" zone around the camera
const LIT_RADIUS_DEEP = 130;
const DEEPEST = 300;

export interface WaterState {
  colour: THREE.Color;
  visibility: number;
  litRadius: number;
}

/** The water at a camera depth (metres below the surface, ≥ 0). Writes into `out`. */
export function waterAt(depth: number, out: WaterState): WaterState {
  const k = Math.min(Math.max(depth / DEEPEST, 0), 1);
  // Light dies off quickly near the surface, then slowly.
  const fade = 1 - Math.pow(1 - k, 2.2);
  out.colour.copy(WATER_SHALLOW).lerp(WATER_DEEP, fade);
  out.visibility = THREE.MathUtils.lerp(VISIBILITY_SHALLOW, VISIBILITY_DEEP, k);
  out.litRadius = THREE.MathUtils.lerp(LIT_RADIUS_SHALLOW, LIT_RADIUS_DEEP, k);
  return out;
}

/** GLSL helpers (display space). Prefixed sw* so they can't clash with anything in a host shader. */
export const WATER_GLSL = /* glsl */ `
const vec3 SW_ABSORB = vec3(1.3, 1.0, 0.85);
const vec3 SW_AIR_HAZE = ${glslColour(SKY_HORIZON)};
const vec3 SW_SEA_BODY = ${glslColour(SEA_BODY)};
const float SW_AIR_VIS = ${AIR_VISIBILITY.toFixed(1)};
const float SW_SEA_VIS_FROM_ABOVE = 34.0;

// How much of the daylight reaches depth y: red goes first, blue last; never quite black.
vec3 swDepthLight(float y) {
  float d = max(-y, 0.0);
  return max(exp(-d * vec3(0.0048, 0.0026, 0.0016)), vec3(0.2, 0.28, 0.34));
}

// The colour of the water itself looking along dir: bright toward the surface, darkest straight down.
vec3 swWaterScatter(vec3 dir, vec3 horizon, float camY) {
  float shallow = exp(min(camY, 0.0) / 70.0);
  vec3 c = horizon * mix(1.0, 0.25, smoothstep(0.0, -0.85, dir.y));
  vec3 glow = horizon * 2.6 + vec3(0.02, 0.10, 0.13);
  return mix(c, glow, smoothstep(-0.1, 0.95, dir.y) * shallow);
}

vec3 swWaterTransmit(float dist, float visibility) {
  return exp(-dist * (2.1 / visibility) * SW_ABSORB);
}

// Light from a point seen through ray (camera -> point): air haze and water, in the order the light meets them.
vec3 swThroughWater(vec3 colour, vec3 ray, vec3 fogCol, float visibility) {
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-3);
  float camY = cameraPosition.y;
  float endY = camY + ray.y;
  float wet = (camY < 0.0) == (endY < 0.0)
    ? (endY < 0.0 ? dist : 0.0)
    : dist * -min(camY, endY) / max(abs(endY - camY), 1e-3);
  float dry = dist - wet;
  if (camY < 0.0) {
    colour = mix(colour, SW_AIR_HAZE, 1.0 - exp(-3.0 * dry / SW_AIR_VIS));
    vec3 t = swWaterTransmit(wet, visibility);
    return colour * t + swWaterScatter(dir, fogCol, camY) * (1.0 - t);
  }
  vec3 t = swWaterTransmit(wet, SW_SEA_VIS_FROM_ABOVE);
  colour = colour * t + SW_SEA_BODY * (1.0 - t);
  return mix(colour, fogCol, 1.0 - exp(-3.0 * dry / visibility));
}
`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif
`;

// mvPosition * viewMatrix rotates a view-space vector back to world space (the view rotation is orthonormal).
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying float vFogDepth;
  varying vec3 vFogRay;
  ${WATER_GLSL}
#endif
`;

// Lit surfaces under water darken and shift blue with depth, except inside the lit zone around the camera
// (the series lit its miniatures like a stage: the action stays bright, the distance goes black).
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #if defined( LAMBERT ) || defined( PHONG ) || defined( STANDARD ) || defined( TOON )
  {
    float fogY = cameraPosition.y + vFogRay.y;
    if (fogY < 0.0) {
      float lit = exp(-dot(vFogRay, vFogRay) / (fogNear * fogNear));
      gl_FragColor.rgb *= mix(swDepthLight(fogY), vec3(1.0), lit * 0.9);
    }
  }
  #endif
  gl_FragColor.rgb = swThroughWater(gl_FragColor.rgb, vFogRay, fogColor, fogFar);
#endif
`;

let installed = false;

/** Replace three's fog with the water model. Must run before the first render compiles any material. */
export function installWaterFog(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
}

/** A display-space colour as a uniform value (uniform Colors upload in linear, which these shaders don't want). */
const rgb = { r: 0, g: 0, b: 0 };
export function displayVector(colour: THREE.Color, out: THREE.Vector3): THREE.Vector3 {
  colour.getRGB(rgb, THREE.SRGBColorSpace);
  return out.set(rgb.r, rgb.g, rgb.b);
}
