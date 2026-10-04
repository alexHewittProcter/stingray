import * as THREE from 'three';
import { cradleHeight, type LaunchState } from '../sim/launch';
import type { Interior } from '../sim/world';
import { makeInteriorMaterial } from './indoors';
import { Parts, bar, box, rod } from './parts';
import { stripeTexture } from './pen-textures';

// Pen 3's launch cradle (L6): a hydraulic head that carries Stingray on a central ram, with clamp arms that grip
// the hull, over a fixed pedestal on the pool floor with red-and-white striped legs. Not solid (L1): it is drawn
// from the launch state and never collided with.
//
// The head's frame: origin at the hull centre it holds, forward −Z like the craft. It rides at cradleHeight and
// turns with the craft while the clamps hold it (the sim turns the craft; the head follows). The clamp arms open
// on release and close on lock, animated here over a fraction of a second.

const DECK = { width: 5.4, height: 0.8, length: 18, top: -3.0 };
const ARM_Z = [-5, 5.5] as const; // the two pairs of clamp arms, along the hull
const ARM = { hingeX: 3.0, hingeY: -3.0, rise: 3.6, reach: 1.15, thick: 0.45 };
const ARM_OPEN = 1.0; // radians each arm swings outward when released
const ARM_RATE = 1 / 0.45; // full travel in 0.45 s
const HEAD_TURN = Math.PI / 2; // rad/s the head can turn to follow the craft
const RAM = { radius: 1.05, length: 27 };
const SLEEVE = { radius: 1.7, top: -19.6 };

export interface Cradle {
  readonly head: THREE.Group;
  readonly pedestal: THREE.Group;
  /**
   * Pose the cradle. `cradle` is the interpolated L3 travel (0 raised … 1 lowered); `craftYaw` the drawn craft's
   * heading, followed while `clamps` is 'locked'.
   */
  update(cradle: number, clamps: LaunchState['clamps'], craftYaw: number, dtSeconds: number): void;
  /** Jump the arms and heading to their resting pose for the current state (start, R). */
  snap(cradle: number, clamps: LaunchState['clamps'], craftYaw: number): void;
}

function lambert(colour: number, name: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: colour, name, ...extra }));
}
function phong(colour: number, name: string, shininess = 60, extra: THREE.MeshPhongMaterialParameters = {}): THREE.MeshPhongMaterial {
  return makeInteriorMaterial(new THREE.MeshPhongMaterial({ color: colour, name, shininess, specular: 0x666666, ...extra }));
}

/** Nearest heading to `from` among `yaw` and its reverse: the head is near enough symmetric fore and aft. */
function nearestAlong(from: number, yaw: number): number {
  const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const d1 = wrap(yaw - from);
  const d2 = wrap(yaw + Math.PI - from);
  return from + (Math.abs(d1) <= Math.abs(d2) ? d1 : d2);
}

export function createCradle(interior: Interior): Cradle {
  const c = interior.cradle;
  const floorY = interior.pen.min.y;

  const steel = phong(0x8d9397, 'cradle-steel', 40);
  const dark = lambert(0x3a3f44, 'cradle-dark');
  const chrome = phong(0xd5d9dc, 'cradle-chrome', 90, { specular: 0xbbbbbb });
  const yellow = lambert(0xd8a722, 'cradle-yellow');
  const red = lambert(0xb7321f, 'cradle-red');
  const striped = lambert(0xffffff, 'cradle-stripes', { map: stripeTexture(5) });
  const stripedSleeve = lambert(0xffffff, 'cradle-sleeve', { map: stripeTexture(3) });

  // ---- The head: deck, saddles, machinery, the ram ----
  const head = new THREE.Group();
  head.name = 'cradle-head';
  const parts = new Parts();
  const deckY = DECK.top - DECK.height / 2;
  parts.add(steel, box(DECK.width, DECK.height, DECK.length, { x: 0, y: deckY, z: 0 }));
  // Side rails along the deck edges, and end beams.
  for (const sx of [-1, 1]) parts.add(dark, box(0.5, 0.5, DECK.length + 0.6, { x: sx * (DECK.width / 2 + 0.1), y: DECK.top + 0.05, z: 0 }));
  for (const sz of [-1, 1]) parts.add(dark, box(DECK.width + 0.8, 0.9, 0.7, { x: 0, y: deckY, z: sz * (DECK.length / 2) }));
  // Saddles under the keel: rubber-topped blocks shaped to the hull's underside.
  for (const z of [-7, -2, 3, 7.5]) {
    parts.add(dark, box(2.2, 0.6, 1.2, { x: 0, y: DECK.top + 0.3, z }));
    parts.add(yellow, box(1.6, 0.18, 1.25, { x: 0, y: DECK.top + 0.68, z }));
  }
  // The bank of short pistons under the deck (TV_launch_cradle_detail): two rows, chrome caps on dark bodies.
  for (let i = 0; i < 9; i++) {
    const z = -7.2 + i * 1.8;
    for (const sx of [-1, 1]) {
      parts.add(dark, rod({ x: sx * 1.6, y: deckY - 0.3, z }, { x: sx * 1.6, y: deckY - 1.4, z }, 0.32, 0.32, 8));
      parts.add(chrome, rod({ x: sx * 1.6, y: deckY - 1.4, z }, { x: sx * 1.6, y: deckY - 1.65, z }, 0.22, 0.22, 8));
    }
  }
  // A longitudinal beam the pistons hang beside, and the ram's crosshead.
  parts.add(dark, box(1.4, 1.1, DECK.length - 2, { x: 0, y: deckY - 0.9, z: 0 }));
  parts.add(steel, rod({ x: 0, y: deckY - 0.4, z: 0 }, { x: 0, y: deckY - 2.0, z: 0 }, 1.6, 1.4, 20));
  // The ram itself, down through the pedestal's sleeve (and on below the floor, out of sight).
  parts.add(chrome, rod({ x: 0, y: deckY - 2, z: 0 }, { x: 0, y: deckY - 2 - RAM.length, z: 0 }, RAM.radius, RAM.radius, 20, true));
  // Fixed posts at the deck's ends that the clamp arms hinge from.
  for (const z of ARM_Z) {
    for (const sx of [-1, 1]) {
      parts.add(steel, box(0.9, 1.4, 1.1, { x: sx * ARM.hingeX, y: ARM.hingeY - 0.2, z }));
      parts.add(dark, rod({ x: sx * ARM.hingeX, y: ARM.hingeY, z: z - 0.7 }, { x: sx * ARM.hingeX, y: ARM.hingeY, z: z + 0.7 }, 0.28, 0.28, 8));
    }
  }
  head.add(parts.build('cradle-head-body'));

  // ---- The clamp arms: each on its own hinge, rising beside the hull and hooking over its flank ----
  // side +1 is starboard (+X): its hook reaches toward −X, over the hull. Each side is built, not mirrored.
  const armFor = (side: number): THREE.Group => {
    const p = new Parts();
    const inward = -side;
    p.add(steel, box(ARM.thick, ARM.rise, ARM.thick * 1.5, { x: 0, y: ARM.rise / 2, z: 0 }));
    p.add(steel, bar({ x: 0, y: ARM.rise - 0.1, z: 0 }, { x: inward * ARM.reach, y: ARM.rise + 0.35, z: 0 }, ARM.thick, ARM.thick * 1.5));
    p.add(dark, bar({ x: inward * ARM.reach, y: ARM.rise + 0.35, z: 0 }, { x: inward * (ARM.reach + 0.25), y: ARM.rise - 0.35, z: 0 }, 0.5, 0.9));
    // A hydraulic strut along the arm's outer face, and a red lamp on the knuckle.
    p.add(chrome, rod({ x: side * 0.35, y: 0.3, z: 0 }, { x: side * 0.35, y: ARM.rise - 0.6, z: 0 }, 0.13, 0.13, 6));
    p.add(red, box(0.25, 0.25, 0.25, { x: side * 0.1, y: ARM.rise + 0.25, z: 0 }));
    return p.build('cradle-arm');
  };
  const arms: Array<{ pivot: THREE.Object3D; side: number }> = [];
  for (const z of ARM_Z) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * ARM.hingeX, ARM.hingeY, z);
      pivot.add(armFor(side));
      head.add(pivot);
      arms.push({ pivot, side });
    }
  }

  // ---- The pedestal on the pool floor: plinth, striped sleeve, four striped legs ----
  const pedestal = new THREE.Group();
  pedestal.name = 'cradle-pedestal';
  const base = new Parts();
  base.add(dark, box(9, 1.2, 15, { x: c.pos.x, y: floorY + 0.6, z: c.pos.z }));
  base.add(steel, box(6, 0.8, 11, { x: c.pos.x, y: floorY + 1.6, z: c.pos.z }));
  const sleeveBottom = floorY + 2;
  base.add(stripedSleeve, rod({ x: c.pos.x, y: sleeveBottom, z: c.pos.z }, { x: c.pos.x, y: SLEEVE.top, z: c.pos.z }, SLEEVE.radius, SLEEVE.radius, 24));
  base.add(dark, rod({ x: c.pos.x, y: SLEEVE.top - 0.4, z: c.pos.z }, { x: c.pos.x, y: SLEEVE.top + 0.05, z: c.pos.z }, SLEEVE.radius + 0.3, SLEEVE.radius + 0.3, 24));
  const legTop = SLEEVE.top - 1.2;
  for (const [lx, lz] of [[-3.8, -4.6], [3.8, -4.6], [-3.8, 4.6], [3.8, 4.6]] as const) {
    const foot = { x: c.pos.x + lx, y: floorY + 1.2, z: c.pos.z + lz };
    const top = { x: c.pos.x + lx * 0.32, y: legTop, z: c.pos.z + lz * 0.32 };
    base.add(striped, rod(foot, top, 0.55, 0.3, 12));
    base.add(dark, rod({ ...foot, y: floorY + 1.2 }, { ...foot, y: floorY + 1.6 }, 0.85, 0.85, 12));
  }
  // Two pale floor domes beside the pedestal (TV_pen3_submerged_cradle).
  for (const sx of [-1, 1]) {
    const dome = new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(c.pos.x + sx * 9, floorY, c.pos.z + 6);
    base.add(chrome, dome);
  }
  pedestal.add(base.build('cradle-pedestal'));

  let openness = 0;
  let headYaw = c.yawOut;

  function pose(cradle: number): void {
    head.position.set(c.pos.x, cradleHeight(cradle, interior), c.pos.z);
    head.rotation.set(0, headYaw, 0);
    // Opening swings each arm's top outward, away from the hull.
    for (const { pivot, side } of arms) pivot.rotation.z = -side * openness * ARM_OPEN;
  }

  return {
    head,
    pedestal,
    update(cradle, clamps, craftYaw, frameSeconds) {
      const dt = Math.max(frameSeconds, 0); // a first frame can report a negative time
      const want = clamps === 'released' ? 1 : 0;
      openness = THREE.MathUtils.clamp(openness + Math.sign(want - openness) * ARM_RATE * dt, Math.min(openness, want), Math.max(openness, want));
      if (clamps === 'locked') {
        const target = nearestAlong(headYaw, craftYaw);
        const step = HEAD_TURN * dt;
        headYaw += THREE.MathUtils.clamp(target - headYaw, -step, step);
      }
      pose(cradle);
    },
    snap(cradle, clamps, craftYaw) {
      openness = clamps === 'released' ? 1 : 0;
      headYaw = clamps === 'locked' ? craftYaw : headYaw;
      pose(cradle);
    },
  };
}
