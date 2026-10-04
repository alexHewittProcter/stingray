import * as THREE from 'three';
import { SUN_DIRECTION } from './water-look';

// Caustics: the moving net of light the surface focuses onto everything below it at shallow depth.
// Added to any lit built-in material by patching its shader, so it works on meshes from every module
// (plain, instanced, vertex-coloured) without them knowing. Shared uniforms: one time value drives them all.

const CELL = 5; // m: size of one cell of the caustic pattern
const STRONG_DEPTH = 35; // m: full strength above this depth…
const GONE_DEPTH = 170; // …fading to nothing here
const NEAR_FADE = [70, 190] as const; // m from the camera: the fine net would shimmer to noise beyond this
const STRENGTH = 0.9;

export const causticUniforms = {
  uCausticTime: { value: 0 },
  /** Projects a point up to the surface along the sunlight: xz offset per metre of depth. */
  uCausticSlant: { value: new THREE.Vector2(SUN_DIRECTION.x / SUN_DIRECTION.y, SUN_DIRECTION.z / SUN_DIRECTION.y).multiplyScalar(0.75) },
  uCausticSun: { value: SUN_DIRECTION.clone() },
  /** 1 at sea; 0 while the camera is inside Marineville, where no sunlight comes through the surface (L6). */
  uCausticStrength: { value: 1 },
};

const VERTEX_PARS = /* glsl */ `
#include <common>
varying vec3 vCausticPos;
`;

const VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec4 causticWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    causticWorld = batchingMatrix * causticWorld;
  #endif
  #ifdef USE_INSTANCING
    causticWorld = instanceMatrix * causticWorld;
  #endif
  vCausticPos = (modelMatrix * causticWorld).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
#include <common>
varying vec3 vCausticPos;
uniform float uCausticTime;
uniform vec2 uCausticSlant;
uniform vec3 uCausticSun;
uniform float uCausticStrength;

// Bright seams between drifting cells (the gap between the nearest and second-nearest cell centre).
float causticSeams(vec2 p, float t, float blur) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = fract(sin(vec2(dot(cell + g, vec2(127.1, 311.7)), dot(cell + g, vec2(269.5, 183.3)))) * 43758.5453);
      float d = length(g + 0.5 + 0.42 * sin(t + 6.2831853 * h) - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  float width = 0.07 + blur * 1.5;
  return (1.0 - smoothstep(0.0, width, d2 - d1)) * (0.07 / width);
}

float causticNet(vec2 uv, float t, float blur) {
  float a = causticSeams(uv, t, blur);
  float b = causticSeams(uv * 1.37 + vec2(3.1, 7.7), t * 1.3 + 2.0, blur * 1.37);
  return a + b * 0.8 + a * b * 1.5;
}
`;

const FRAGMENT = /* glsl */ `
#include <lights_fragment_end>
// Derivatives must be taken outside the branches below.
vec2 causticUv = (vCausticPos.xz - uCausticSlant * vCausticPos.y) / ${CELL.toFixed(1)};
float causticBlur = fwidth(causticUv.x) + fwidth(causticUv.y);
if (vCausticPos.y < -0.4) {
  float causticDepth = 1.0 - smoothstep(${STRONG_DEPTH.toFixed(1)}, ${GONE_DEPTH.toFixed(1)}, -vCausticPos.y);
  float causticNear = 1.0 - smoothstep(${NEAR_FADE[0].toFixed(1)}, ${NEAR_FADE[1].toFixed(1)}, distance(vCausticPos, cameraPosition));
  vec3 causticNormal = inverseTransformDirection(normal, viewMatrix);
  float causticFacing = max(dot(causticNormal, uCausticSun), 0.0);
  float causticAmount = causticDepth * causticNear * causticFacing * uCausticStrength;
  if (causticAmount > 0.001) {
    float net = causticNet(causticUv, uCausticTime * 0.9, causticBlur);
    reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.85, 1.0, 0.95) * net * causticAmount * ${STRENGTH.toFixed(2)};
  }
}
`;

const patched = new WeakSet<THREE.Material>();

function isLit(m: THREE.Material): boolean {
  return (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true
    || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true
    || (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
    || (m as THREE.MeshToonMaterial).isMeshToonMaterial === true;
}

/** Give one lit material caustics (idempotent; keeps any onBeforeCompile it already had). */
export function addCausticsToMaterial(material: THREE.Material): void {
  // Interior meshes (indoors.ts) are lit by Marineville's own lamps, not the sun through the surface.
  if (patched.has(material) || !isLit(material) || material.userData.noCaustics === true) return;
  patched.add(material);
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const ownKey = previousKey === THREE.Material.prototype.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    Object.assign(shader.uniforms, causticUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_PARS)
      .replace('#include <project_vertex>', VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_PARS)
      .replace('#include <lights_fragment_end>', FRAGMENT);
  };
  // Materials with different hooks must not share a compiled program.
  material.customProgramCacheKey = () => (ownKey ? previousHook.toString() : previousKey.call(material)) + '|caustics';
  material.needsUpdate = true;
}

/** Give every lit material under root caustics. Cheap to call again: already-patched materials are skipped. */
export function addCaustics(root: THREE.Object3D): void {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(addCausticsToMaterial);
    else addCausticsToMaterial(material);
  });
}
