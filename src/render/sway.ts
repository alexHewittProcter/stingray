import * as THREE from 'three';

// Scenery animation runs on the GPU: one shared time uniform, read by every patched material's vertex shader.
// The CPU's only per-frame work is that uniform and switching whole cells of dressing on or off by distance.

/** Seconds since the start, shared by every swaying plant and swimming fish. */
export const sceneryTime = { value: 0 };

const MAX_VIEW_RANGE = 800; // m: above the surface the fog thins, but the sea hides the bed anyway
/** Past this, small plants are a pixel or two in the murk and are not drawn; rocks and kelp still are. */
export const SMALL_RANGE = 330; // m

/** Per-frame work for a piece of scenery, given how far the camera can see. */
export type SceneryHook = (camera: THREE.Camera, viewRange: number) => void;
const hooks: SceneryHook[] = [];

export function onSceneryFrame(hook: SceneryHook): void {
  hooks.push(hook);
}

/** Call once a frame, after the fog has been set for the frame. */
export function updateScenery(elapsedSeconds: number, camera: THREE.Camera, scene: THREE.Scene): void {
  sceneryTime.value = elapsedSeconds;
  const range = scene.fog instanceof THREE.Fog ? Math.min(scene.fog.far, MAX_VIEW_RANGE) : MAX_VIEW_RANGE;
  for (const hook of hooks) hook(camera, range);
}

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/**
 * Adds a vertex patch to a standard material, keeping any patch already on it (and letting a later one chain onto
 * this). The program cache key is extended so a patched material never shares a program with an unpatched one.
 */
export function chainPatch(material: THREE.Material, key: string, patch: Patch): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patch(shader);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${key}`;
}

export interface SwayOptions {
  /** Metres of sideways travel at the tip. */
  amount: number;
  /** Height (local units) at which the full sway is reached; the base never moves. */
  height: number;
  /** Radians per second. */
  speed?: number;
  /** Phase change per local unit of height: the sway travels up the plant as a wave. */
  ripple?: number;
}

/** Plants bend with the swell: displacement grows with the square of height above the root. */
export function addSway(material: THREE.Material, options: SwayOptions): void {
  const { amount, height, speed = 0.9, ripple = 0 } = options;
  chainPatch(material, 'sway', (shader) => {
    shader.uniforms.uSceneryTime = sceneryTime;
    shader.uniforms.uSway = { value: [amount, height, speed, ripple] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSceneryTime;\nuniform vec4 uSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 swayRoot = instanceMatrix[3].xz;
        #else
          vec2 swayRoot = vec2(0.0);
        #endif
        float swayW = clamp(position.y / uSway.y, 0.0, 1.5);
        swayW *= swayW;
        float swayPhase = dot(swayRoot, vec2(0.071, 0.053)) + position.y * uSway.w;
        float swayT = uSceneryTime * uSway.z;
        transformed.x += uSway.x * swayW * sin(swayT + swayPhase);
        transformed.z += uSway.x * 0.6 * swayW * sin(swayT * 0.77 + swayPhase * 1.3 + 1.7);`,
      );
  });
}
