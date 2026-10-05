import * as THREE from 'three';
import { northOfFace } from '../sim/interior';
import { COAST_Z } from '../sim/world';
import type { Vec3 } from '../sim/vec3';

// Indoors (phase 2, L6 "interior light"): the one switch every render module reads to know whether the camera is
// inside Marineville, and the material patch that keeps interior meshes out of the sun.
//
//   - cameraIndoors(p): true while the camera is north of the cliff face. Pen, tunnel, sea, shafts and the camera
//     rig all key off this one test, so they switch together.
//   - indoorAmount(p): 0 at the face, rising to 1 a short way in — what the scene's sun and sky lights fade by,
//     so the craft and anything else not built as interior is lit by Marineville's own lamps once inside.
//   - oceanInView(p, door): whether the ocean side (seabed, landmarks, Marineville's buildings, targets) could be
//     seen from the camera at p — always from outside; from inside only through a door that is not fully shut.
//     When false, main.ts stops drawing that scenery (T6).
//   - makeInteriorMaterial(m): a lit material that takes no light from directional or hemisphere lights (the sun
//     and the sky) and opts out of caustics. Interior meshes are lit by point and spot lamps and ambient only.

/**
 * Could the ocean side be seen from the camera at p? Outside Marineville, always. Inside, only while the door is not
 * fully shut (`door` > 0, the drawn travel). The tunnel's S-bend does not hide the mouth from the far end of the
 * tunnel or from parts of the pen hall (a diagonal sightline clears the 13 m bore through both bends), so where the
 * camera is inside does not matter: a shut door is the one thing that hides the ocean.
 */
export function oceanInView(p: Vec3 | THREE.Vector3, door: number): boolean {
  return !cameraIndoors(p) || door > 0;
}

/** How far north of the face the sun and sky have fully faded (m). */
const FADE_DEPTH = 30;

/** The inside-Marineville switch: the camera (or any point) is north of the cliff face. */
export function cameraIndoors(p: Vec3 | THREE.Vector3): boolean {
  return northOfFace(p);
}

/** 0 south of the face, 1 once FADE_DEPTH inside: how much the outdoor lights are dimmed. */
export function indoorAmount(p: Vec3 | THREE.Vector3): number {
  return THREE.MathUtils.clamp((COAST_Z - p.z) / FADE_DEPTH, 0, 1);
}

/** userData flag read by caustics.ts: a material carrying it is never given caustics. */
export const NO_CAUSTICS = 'noCaustics';

// The lighting loop with the directional (sun) and hemisphere (sky) sections compiled out. three writes the light
// counts into the source as literal numbers, so the counts are replaced in this copy of the chunk rather than
// redefined. The uniforms stay declared, so the program's light layout is unchanged; only this material ignores them.
const indoorLightsBegin = (): string =>
  THREE.ShaderChunk.lights_fragment_begin.replace(/\bNUM_DIR_LIGHTS\b/g, '0').replace(/\bNUM_HEMI_LIGHTS\b/g, '0');

const interior = new WeakSet<THREE.Material>();

/** Make a lit material an interior one (idempotent). Returns it for chaining. */
export function makeInteriorMaterial<M extends THREE.Material>(material: M): M {
  if (interior.has(material)) return material;
  interior.add(material);
  material.userData[NO_CAUSTICS] = true;
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', indoorLightsBegin());
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|indoors`;
  material.needsUpdate = true;
  return material;
}

/** True if makeInteriorMaterial has been applied (for tests). */
export function isInteriorMaterial(material: THREE.Material): boolean {
  return interior.has(material);
}
