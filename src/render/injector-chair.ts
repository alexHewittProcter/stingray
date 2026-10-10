import * as THREE from 'three';
import { Parts, bar, box, rod } from './parts';

// The injector chair (phase 3, M8; phase 4, D2): "the bucket seat, headrest and side rails stay, the short column goes —
// the chair hangs on a pole (radius 0.05–0.08 m, chrome) rising from the seat's back up through a head bar and on up
// … the carriage's spokes go with the column, and the whole chair fits inside a 0.6 m radius … (footplate included) so
// it passes the hatch and the port". After 03_STANDBY_INJECTOR/ (TV_injector_bay_clean_01: tall tapered blue-grey backs
// in silver frames, red armrest pads on silver rails, a chrome rod rising from the top of each back;
// TV_injector_chair_descent_01: the dark footplate under the boots, the grey arched cheeks beneath the seat, the rod
// running up behind the head) and references/launch-and-boarding/troy-in-injector-chair-on-pole.png (the pole behind
// his head). Three stand at the control room's injector station (render/rooms.ts); M8: **one chair object** carries
// Troy — this one, created with the station, re-parented by main.ts to the shaft path while riding and to the sub's
// model aboard. Never two chairs.
//
// Frame (as Troy's and the sub's models): +Y up, forward −Z (the sitter faces −Z), metres. The origin is on the floor
// under the seat's centre — ROOMS.chair.pos, "seat centre on the floor" (M1) — and is the shaft's axis while riding
// (sim/ride.ts) and SEATS_LOCAL.troy aboard. Nothing is under the origin any more: the chair hangs on its pole, its
// lowest point (CHAIR_LOWEST_Y, the footplate's underside and the cheeks' feet) clear of the station's dais.
//
// The pole and CHAIR_RADIUS (phase 4, D2): the pole rises from the seat's back — CHAIR_POLE_Z behind the origin, just
// behind the back and the headrest, as the series' rod is — so it is *not* on the origin: a seated sitter's boots reach
// 0.58 m forward of the seat's centre (render/troy.ts), ≈ 1.06 m from a pole at the back, so no chair with its pole at
// the back fits a 0.6 m circle *about the pole*. What the radius is for is passing the hatch and the port, which are
// centred on the shaft's axis (the origin); so the whole chair — footplate, rails, cheeks, back, pole, head bar — lies
// inside sim/rooms.ts CHAIR_RADIUS of the origin's vertical line (render/injector-chair.test.ts), the pole included.
//
// The pole's own length (CHAIR_POLE_TOP_Y): from the seat's back up through the head bar and CHAIR_POLE_ABOVE_HEAD_BAR
// on. Standing in the control room it runs on into a fixed sleeve hanging from a ceiling boss (render/rooms.ts — the
// sleeve stays when the chair drops: the pole slides out of it). Riding and aboard, the chair's pole ends there; phase
// 4 T3 draws the long pole down from the pen's port to its top.
//
// Troy seated (T7): parent his group to the chair and set troy.group.position = CHAIR_SEAT − TROY_SEAT (render/troy.ts),
// rotation 0 — his cushion point lands on the cushion's top centre and his soles on the footplate.

/** The cushion's top centre, in the chair's frame: where Troy's seat point (render/troy.ts TROY_SEAT) goes. */
export const CHAIR_SEAT: Readonly<{ x: number; y: number; z: number }> = Object.freeze({ x: 0, y: 0.5, z: 0.04 });
/** The footplate's top, in the chair's frame (Troy's soles rest here: CHAIR_SEAT.y − TROY_SEAT.y). */
export const CHAIR_FOOTPLATE_Y = 0.13;
/** The chair's lowest point above its origin: the footplate's underside and the cheeks' feet (it hangs; D2). */
export const CHAIR_LOWEST_Y = 0.115;
/** The chair's back and headrest's height above its origin (the headrest's top). */
export const CHAIR_HEIGHT = 1.62;
/** The pole's axis, in the chair's frame: x 0, z CHAIR_POLE_Z (behind the back — the sitter faces −Z). */
export const CHAIR_POLE_Z = 0.48;
/** The pole's radius (D2: 0.05–0.08 m, chrome). */
export const CHAIR_POLE_RADIUS = 0.06;
/** Where the pole leaves the seat's back (its foot, on a bracket behind the seat pan). */
export const CHAIR_POLE_FOOT_Y = 0.36;
/** The head bar's height: a crossbar clamped on the pole behind the headrest. */
export const CHAIR_HEAD_BAR_Y = 1.5;
/** How far the chair's own pole runs on above the head bar (T3 draws the long pole from the port down to its top). */
export const CHAIR_POLE_ABOVE_HEAD_BAR = 1.2;
/** The top of the chair's own pole, in its frame. */
export const CHAIR_POLE_TOP_Y = CHAIR_HEAD_BAR_Y + CHAIR_POLE_ABOVE_HEAD_BAR;

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

  const low = CHAIR_LOWEST_Y;

  // The footplate under the boots (a seated sitter's heels at z −0.29, toes at −0.58), and its silver front lip.
  add(mats.dark, box(0.44, CHAIR_FOOTPLATE_Y - low, 0.33, { x: 0, y: (CHAIR_FOOTPLATE_Y + low) / 2, z: -0.375 }));
  add(mats.frame, box(0.44, 0.02, 0.02, { x: 0, y: CHAIR_FOOTPLATE_Y - 0.005, z: -0.53 }));

  // The cheeks: a grey plate each side from the footplate to the seat, with an arch cut under it (ref, descent).
  const cheek = new THREE.Shape([
    new THREE.Vector2(-0.5, low), new THREE.Vector2(-0.5, CHAIR_FOOTPLATE_Y), new THREE.Vector2(-0.3, 0.2),
    new THREE.Vector2(-0.26, 0.4), new THREE.Vector2(0.3, 0.4), new THREE.Vector2(0.3, low), new THREE.Vector2(0.14, low),
  ]);
  cheek.absarc(-0.06, low, 0.2, 0, Math.PI, false); // the arch, from (0.14, low) round to (−0.26, low)
  cheek.lineTo(-0.5, low);
  for (const side of [-1, 1]) {
    // Shape (u, v) → (z = u, y = v): turned −90° about Y, the 0.04 m extrusion runs along −x.
    const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.04, bevelEnabled: false, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(side > 0 ? 0.28 : -0.24, 0, 0);
    add(mats.body, g);
  }

  // The bucket: the seat pan under its cushion, a lip at the front.
  add(mats.frame, box(0.64, 0.06, 0.62, { x: 0, y: 0.41, z: 0.02 }));
  add(mats.upholstery, box(0.56, 0.06, 0.54, { x: 0, y: S.y - 0.03, z: S.z }));
  add(mats.frame, box(0.64, 0.08, 0.04, { x: 0, y: 0.46, z: -0.29 }));

  // The back: tall and tapered, wider at the seat (ref, bay), upholstered in a silver frame, leaning back a touch (the
  // pole stands just behind its top).
  const lean = 0.05; // rad, the top back (+z), away from the sitter
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
  add(mats.frame, tilt(box(0.4, 0.2, 0.08, { x: 0, y: 0.97, z: 0.04 }), 0));
  add(mats.upholstery, tilt(box(0.34, 0.15, 0.04, { x: 0, y: 0.97, z: -0.02 }), 0));
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

  // The pole (D2): chrome, rising from a bracket behind the seat pan, up the back, through the head bar and on up.
  const P = CHAIR_POLE_Z;
  add(mats.frame, rod({ x: 0, y: CHAIR_POLE_FOOT_Y, z: P }, { x: 0, y: CHAIR_POLE_TOP_Y, z: P }, CHAIR_POLE_RADIUS, CHAIR_POLE_RADIUS, 16));
  // The bracket that carries the seat: a dark block from the seat pan's back to the pole, a collar round the pole.
  add(mats.dark, box(0.22, 0.1, 0.18, { x: 0, y: 0.41, z: 0.39 }));
  add(mats.dark, rod({ x: 0, y: CHAIR_POLE_FOOT_Y, z: P }, { x: 0, y: CHAIR_POLE_FOOT_Y + 0.14, z: P }, 0.085, 0.085, 16));
  // A strut up the back from the bracket to the head bar: the back hangs on the pole.
  add(mats.dark, box(0.06, CHAIR_HEAD_BAR_Y - 0.5, 0.04, { x: 0, y: (CHAIR_HEAD_BAR_Y + 0.5) / 2, z: 0.44 }));
  // The head bar: a crossbar behind the headrest, clamped to the pole by a collar.
  add(mats.frame, bar({ x: -0.2, y: CHAIR_HEAD_BAR_Y, z: 0.44 }, { x: 0.2, y: CHAIR_HEAD_BAR_Y, z: 0.44 }, 0.05, 0.04));
  add(mats.dark, rod({ x: 0, y: CHAIR_HEAD_BAR_Y - 0.07, z: P }, { x: 0, y: CHAIR_HEAD_BAR_Y + 0.07, z: P }, 0.09, 0.09, 16));
  // A cap on the pole's top.
  add(mats.dark, rod({ x: 0, y: CHAIR_POLE_TOP_Y - 0.04, z: P }, { x: 0, y: CHAIR_POLE_TOP_Y, z: P }, 0.07, 0.07, 16));
}
