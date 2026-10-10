import * as THREE from 'three';
import { Parts, bar, box, rod } from './parts';

// The injector chair (phase 3, M8): "a bucket seat on a short column with a headrest and side rails, in the lounge's
// colours" — after 03_STANDBY_INJECTOR/ (TV_injector_bay_clean_01: tall tapered blue-grey backs in silver frames, red
// armrest pads on silver rails; TV_injector_chair_descent_01: the dark footplate under the boots, the grey arched cheeks
// beneath the seat, the slim column). Three stand at the control room's injector station (phase 4, render/rooms.ts); M8:
// **one chair object** carries Troy — this one, created with the station, re-parented by T7 to the shaft path while riding and to the sub's model
// aboard. Never two chairs.
//
// Frame (as Troy's and the sub's models): +Y up, forward −Z (the sitter faces −Z), metres. The origin is on the floor
// under the seat's centre — ROOMS.chair.pos, "seat centre on the floor" (M1). Under the origin hangs the carriage that
// rides the shaft: a hub and four spokes out to guide shoes at CHAIR_GUIDE_REACH, which in phase 3's lounge rested on the bore's
// rim (the bore is open between them).
//
// Troy seated (T7): parent his group to the chair and set troy.group.position = CHAIR_SEAT − TROY_SEAT (render/troy.ts),
// rotation 0 — his cushion point lands on the cushion's top centre and his soles on the footplate.

/** The cushion's top centre, in the chair's frame: where Troy's seat point (render/troy.ts TROY_SEAT) goes. */
export const CHAIR_SEAT: Readonly<{ x: number; y: number; z: number }> = Object.freeze({ x: 0, y: 0.5, z: 0.04 });
/** The footplate's top, in the chair's frame (Troy's soles rest here: CHAIR_SEAT.y − TROY_SEAT.y). */
export const CHAIR_FOOTPLATE_Y = 0.13;
/** How far the carriage's guide shoes reach from the column (m) — inside the bore's radius (render/rooms.ts). */
export const CHAIR_GUIDE_REACH = 0.9;
/** The chair's overall height above its origin (the headrest's top). */
export const CHAIR_HEIGHT = 1.62;

export interface InjectorChairMaterials {
  upholstery: THREE.Material;
  frame: THREE.Material;
  pad: THREE.Material;
  dark: THREE.Material;
  body: THREE.Material;
}

/** The lounge's chair colours: blue-grey upholstery, silver frame, red pads, a dark footplate, grey cheeks. */
export function injectorChairMaterials(): InjectorChairMaterials {
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  return {
    upholstery: lambert(0x5b6f8f),
    frame: lambert(0xd3d8dc),
    pad: lambert(0xc0362a),
    dark: lambert(0x2b2f35),
    body: lambert(0x9aa4ad),
  };
}

/**
 * One injector chair, its own object, merged per material (five meshes): the chair that carries Troy (M8). Pass shared
 * materials to draw several alike.
 */
export function createInjectorChair(mats: InjectorChairMaterials = injectorChairMaterials()): THREE.Group {
  const parts = new Parts();
  addInjectorChair(parts, mats);
  return parts.build('injector-chair');
}

/**
 * An injector chair's pieces added to `parts`, placed by `frame` (the chair's origin and yaw) — for chairs that never
 * move (Phones's and Marina's), merged with the rest of the room so they cost no draw calls of their own.
 */
export function addInjectorChair(parts: Parts, mats: InjectorChairMaterials, frame?: THREE.Matrix4): void {
  const add = (material: THREE.Material, ...geometries: THREE.BufferGeometry[]): void =>
    parts.add(material, ...geometries.map((g) => (frame ? g.applyMatrix4(frame) : g)));
  const S = CHAIR_SEAT;

  // The carriage under the floor line: a hub, four diagonal spokes, a guide shoe on each.
  add(mats.dark, new THREE.CylinderGeometry(0.24, 0.24, 0.08, 20).translate(0, 0.04, 0));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    add(mats.dark, bar({ x: ux * 0.2, y: 0.045, z: uz * 0.2 }, { x: ux * (CHAIR_GUIDE_REACH - 0.08), y: 0.045, z: uz * (CHAIR_GUIDE_REACH - 0.08) }, 0.06));
    add(mats.body, box(0.1, 0.12, 0.1, { x: ux * (CHAIR_GUIDE_REACH - 0.05), y: 0.06, z: uz * (CHAIR_GUIDE_REACH - 0.05) }, -a));
  }

  // The short column, and the footplate on its bracket.
  add(mats.frame, rod({ x: 0, y: 0.08, z: 0 }, { x: 0, y: 0.36, z: 0 }, 0.09, 0.07, 16));
  add(mats.dark, box(0.62, 0.05, 0.56, { x: 0, y: CHAIR_FOOTPLATE_Y - 0.025, z: -0.44 }));
  add(mats.frame, box(0.62, 0.02, 0.02, { x: 0, y: CHAIR_FOOTPLATE_Y - 0.01, z: -0.73 }));

  // The cheeks: a grey plate each side from the footplate to the seat, with an arch cut under it (ref, descent).
  const cheek = new THREE.Shape([
    new THREE.Vector2(-0.72, 0.06), new THREE.Vector2(-0.72, CHAIR_FOOTPLATE_Y), new THREE.Vector2(-0.3, 0.2),
    new THREE.Vector2(-0.26, 0.4), new THREE.Vector2(0.3, 0.4), new THREE.Vector2(0.3, 0.06), new THREE.Vector2(0.18, 0.06),
  ]);
  cheek.absarc(-0.06, 0.06, 0.22, 0, Math.PI, false); // the arch, from (0.16, 0.06) round to (−0.28, 0.06)
  cheek.lineTo(-0.72, 0.06);
  for (const side of [-1, 1]) {
    // Shape (u, v) → (z = u, y = v): turned −90° about Y, the 0.04 m extrusion runs along −x.
    const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.04, bevelEnabled: false, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(side > 0 ? 0.35 : -0.31, 0, 0);
    add(mats.body, g);
  }

  // The bucket: the seat pan under its cushion, a lip at the front.
  add(mats.frame, box(0.64, 0.06, 0.62, { x: 0, y: 0.41, z: 0.02 }));
  add(mats.upholstery, box(0.56, 0.06, 0.54, { x: 0, y: S.y - 0.03, z: S.z }));
  add(mats.frame, box(0.64, 0.08, 0.04, { x: 0, y: 0.46, z: -0.29 }));

  // The back: tall and tapered, wider at the seat (ref, bay), upholstered in a silver frame, leaning back a little.
  const lean = 0.1; // rad, the top back (+z), away from the sitter
  const back = new THREE.Shape([
    new THREE.Vector2(-0.3, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.21, 0.86), new THREE.Vector2(-0.21, 0.86),
  ]);
  const backFrame = new THREE.ExtrudeGeometry(back, { depth: 0.08, bevelEnabled: false });
  const backPad = new THREE.ExtrudeGeometry(new THREE.Shape([
    new THREE.Vector2(-0.25, 0.05), new THREE.Vector2(0.25, 0.05), new THREE.Vector2(0.175, 0.81), new THREE.Vector2(-0.175, 0.81),
  ]), { depth: 0.03, bevelEnabled: false });
  const tilt = (g: THREE.BufferGeometry, z: number) => g.translate(0, 0, z).rotateX(lean).translate(0, S.y, 0.3);
  add(mats.frame, tilt(backFrame, 0));
  add(mats.upholstery, tilt(backPad, -0.03));
  // The headrest: a padded block on the back's top, in the same frame.
  add(mats.frame, tilt(box(0.4, 0.2, 0.1, { x: 0, y: 0.97, z: 0.03 }), 0));
  add(mats.upholstery, tilt(box(0.34, 0.15, 0.04, { x: 0, y: 0.97, z: -0.03 }), 0));
  // A WASP-red stripe down the back's rear, so it reads from behind too.
  add(mats.pad, tilt(box(0.08, 0.7, 0.01, { x: 0, y: 0.45, z: 0.085 }), 0));

  // The side rails: a silver rail each side from the back down and forward, a red pad on it, a post to the seat, and
  // the rail's front end curled down (ref, descent).
  for (const side of [-1, 1]) {
    const x = side * 0.36;
    add(mats.frame,
      bar({ x, y: 0.72, z: 0.3 }, { x, y: 0.74, z: -0.24 }, 0.04),
      bar({ x, y: 0.74, z: -0.24 }, { x, y: 0.62, z: -0.33 }, 0.04),
      rod({ x, y: 0.42, z: -0.18 }, { x, y: 0.72, z: -0.18 }, 0.02, 0.02, 8),
      rod({ x, y: 0.42, z: 0.18 }, { x, y: 0.72, z: 0.18 }, 0.02, 0.02, 8));
    add(mats.pad, box(0.08, 0.05, 0.38, { x, y: 0.77, z: -0.02 }));
  }

}
