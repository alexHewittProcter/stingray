import * as THREE from 'three';
import { northOfFace } from '../sim/interior';
import { ROOMS, inRoomBox } from '../sim/rooms';
import { CLIFF_TOP, COAST_Z, MARINEVILLE } from '../sim/world';
import type { Vec3 } from '../sim/vec3';

// Indoors (phase 2, L6 "interior light"): the one switch every render module reads to know whether the camera is
// inside Marineville, and the material patch that keeps interior meshes out of the sun.
//
//   - cameraIndoors(p): true while the camera is inside the pen hall or the bore — north of the cliff face, below the
//     clifftop and inside (or within a hair of) phase 2's Interior (phase 3 narrowed it from "north of the face", Global
//     constraints, so the control tower's rooms are not "indoors"). Pen, tunnel, sea, shafts and lamps key off this
//     one test, so they switch together.
//   - inRooms(p): phase 3's separate switch — the camera is in Troy's rooms at the top of the control tower. The rooms
//     are drawn only then, and the pen hall and the tunnel are hidden then (main.ts).
//   - indoorAmount(p): 0 at the face, rising to 1 a short way in — what the scene's sun and sky lights fade by,
//     so the craft and anything else not built as interior is lit by Marineville's own lamps once inside.
//   - oceanInView(p, door): whether the ocean side (seabed, landmarks, Marineville's buildings, targets) could be
//     seen from the camera at p — always from outside; from inside only through a door that is not fully shut.
//     When false, main.ts stops drawing that scenery (T6).
//   - makeInteriorMaterial(m): a lit material that takes no light from directional or hemisphere lights (the sun
//     and the sky) and opts out of caustics. Interior meshes are lit by point and spot lamps and ambient only.

/**
 * Could the ocean side be seen from the camera at p? Outside Marineville, always. Inside, only while the door is not
 * fully shut (`door` > 0, the drawn travel). The tunnel is straight (phase 4 D6: a level chamber and one incline),
 * so the mouth is in sight from the far end of the tunnel and from the pen hall's end of it; where the camera is
 * inside does not matter: a shut door is the one thing that hides the ocean.
 */
export function oceanInView(p: Vec3 | THREE.Vector3, door: number): boolean {
  return !cameraIndoors(p) || door > 0;
}

/** How far out from the mouth the chase camera starts to tighten (m) — beyond this it is phase 1's, exactly. */
export const TIGHT_ZONE = 60;
/** How far in past the face the camera is fully tight wherever it is across the mouth (m). */
const TIGHT_IN = 10;

/**
 * How tight the chase boom should be for a sub at p (T8): 1 inside Marineville (the tunnel and the pen), falling
 * smoothly to 0 at TIGHT_ZONE from the mouth out at sea, and 0 everywhere else at sea — so the open-sea camera is
 * phase 1's. Continuous across the face: at the face it depends only on the distance from the mouth's centre.
 */
export function tunnelTightness(p: Vec3 | THREE.Vector3, mouth: Vec3): number {
  const lateral = Math.hypot(p.x - mouth.x, p.y - mouth.y);
  const inward = COAST_Z - p.z; // > 0 north of the face
  const d = inward >= 0
    ? lateral * Math.max(0, 1 - inward / TIGHT_IN)
    : Math.hypot(lateral, inward);
  const u = THREE.MathUtils.clamp(1 - d / TIGHT_ZONE, 0, 1);
  return u * u * (3 - 2 * u);
}

/** How far north of the face the sun and sky have fully faded (m). */
const FADE_DEPTH = 30;
/**
 * How far outside the drawn walls (bore and pen) a point still counts as indoors (m): the camera rig holds its camera
 * 1 m inside them, so this only matters for a fixed ?view= or a camera passing through the bore's wall in one frame.
 */
const INDOORS_SLACK = 2;

/** The inside-Marineville switch: the camera (or any point) is in the pen hall or the bore (phase 3 narrowing). */
export function cameraIndoors(p: Vec3 | THREE.Vector3): boolean {
  return northOfFace(p) && p.y < CLIFF_TOP && nearInterior(p);
}

/** How far outside a room's box (into its walls) a point still counts as in the rooms (m). */
const ROOMS_SLACK = 0.5;

/** Phase 3: the camera (or any point) is inside one of Troy's rooms (sim/rooms.ts), with a little slack for the walls. */
export function inRooms(p: Vec3 | THREE.Vector3): boolean {
  return inRoomBox(p, ROOMS, ROOMS_SLACK);
}

/** 0 south of the face (or anywhere not indoors), 1 once FADE_DEPTH inside: how much the outdoor lights are dimmed. */
export function indoorAmount(p: Vec3 | THREE.Vector3): number {
  if (!cameraIndoors(p)) return 0;
  return THREE.MathUtils.clamp((COAST_Z - p.z) / FADE_DEPTH, 0, 1);
}

/** Within INDOORS_SLACK of phase 2's drawn interior: the pen box, or the bore about the tunnel's centreline. */
function nearInterior(p: Vec3 | THREE.Vector3): boolean {
  const { pen, tunnel } = MARINEVILLE.interior;
  const s = INDOORS_SLACK;
  if (p.x >= pen.min.x - s && p.x <= pen.max.x + s && p.y >= pen.min.y - s && p.y <= pen.max.y + s
    && p.z >= pen.min.z - s && p.z <= pen.max.z + s) return true;
  const line = tunnel.centreline;
  const reach = tunnel.radius + s;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
    if (Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t) <= reach) return true;
  }
  return false;
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
