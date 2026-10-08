import * as THREE from 'three';
import type { Box, Room, Rooms } from '../sim/rooms';
import { inRooms } from './indoors';

// Troy's rooms (phase 3, T1 greybox): the control room, the corridor and the Standby Lounge drawn as grey boxes straight
// from sim/rooms.ts — floors, ceilings, walls with the doorways cut where rooms overlap, the props as solid blocks —
// so walking and the cameras can be built and witnessed before T4 and T5 dress them. The control room's walls are a
// sill, a window band and a head, so the tower, the grounds and the sea stay in view through them.
//
// The group is outside main.ts's oceanSide root (Global constraints, indoors switches): it is drawn only while the
// camera is in the rooms (indoors.ts inRooms), and the pen hall and the bore hide themselves then (cameraIndoors is
// false up here). The one lamp lives outside the group and only dims, so the scene's light count — and with it every
// compiled program — never changes when the camera comes or goes.

const WALL = 0.2; // m — walls, floors and ceilings are this thick, drawn outside the room boxes
const SILL = 1.0; // m — the control room's windows run from here …
const HEAD = 3.6; // … to here above the floor
const LAMP_INTENSITY = 60;

export interface RoomsView {
  /** The rooms' meshes; visible only while the camera is in the rooms. */
  readonly group: THREE.Group;
  /** The rooms' lamp (outside the group, so it never leaves the scene). */
  readonly lamp: THREE.PointLight;
  update(camera: THREE.Camera): void;
}

export function createRooms(rooms: Rooms): RoomsView {
  const group = new THREE.Group();
  group.name = 'rooms';
  const mats = {
    floor: new THREE.MeshLambertMaterial({ color: 0x7c8187 }),
    wall: new THREE.MeshLambertMaterial({ color: 0xb4b8bc }),
    ceiling: new THREE.MeshLambertMaterial({ color: 0x9a9ea3, emissive: 0x3a3d41 }),
    prop: new THREE.MeshLambertMaterial({ color: 0x5d6268 }),
    chair: new THREE.MeshLambertMaterial({ color: 0xc8a23a }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.12, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }),
  };

  const add = (min: THREE.Vector3Like, max: THREE.Vector3Like, material: THREE.Material, name: string) => {
    const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
    if (size.x <= 1e-6 || size.y <= 1e-6 || size.z <= 1e-6) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    mesh.name = name;
    group.add(mesh);
  };

  for (const room of rooms.rooms) {
    const { min, max } = room;
    add({ x: min.x, y: min.y - WALL, z: min.z }, { x: max.x, y: min.y, z: max.z }, mats.floor, `${room.id}-floor`);
    add({ x: min.x, y: max.y, z: min.z }, { x: max.x, y: max.y + WALL, z: max.z }, mats.ceiling, `${room.id}-ceiling`);
    // A light panel in the ceiling's middle.
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const hx = Math.min(1.2, (max.x - min.x) / 4);
    const hz = Math.min(1.2, (max.z - min.z) / 4);
    add({ x: cx - hx, y: max.y - 0.04, z: cz - hz }, { x: cx + hx, y: max.y, z: cz + hz }, mats.light, `${room.id}-light`);
    for (const wall of walls(room, rooms.rooms)) {
      if (room.id === 'controlRoom' && wall.min.y <= min.y) { // not over a doorway's lintel
        // Sill, window band, head (the window band is clamped to the wall piece's own height).
        const bandLo = Math.max(wall.min.y, min.y + SILL);
        const bandHi = Math.min(wall.max.y, min.y + HEAD);
        if (bandHi > bandLo) {
          add(wall.min, { ...wall.max, y: bandLo }, mats.wall, 'controlRoom-sill');
          add({ ...wall.min, y: bandLo }, { ...wall.max, y: bandHi }, mats.glass, 'controlRoom-window');
          add({ ...wall.min, y: bandHi }, wall.max, mats.wall, 'controlRoom-head');
          continue;
        }
      }
      add(wall.min, wall.max, mats.wall, `${room.id}-wall`);
    }
  }
  for (const prop of rooms.props) add(prop.min, prop.max, mats.prop, 'prop');
  // Troy's chair: a placeholder block beside the bore (T5 draws the injector chairs).
  const c = rooms.chair.pos;
  add({ x: c.x - 0.45, y: c.y, z: c.z - 0.45 }, { x: c.x + 0.45, y: c.y + 0.5, z: c.z + 0.45 }, mats.chair, 'chair');

  const lamp = new THREE.PointLight(0xfff3df, 0, 30, 2);
  lamp.name = 'rooms-lamp';
  const room = new THREE.Vector3();

  return {
    group,
    lamp,
    update(camera) {
      const inside = inRooms(camera.position);
      group.visible = inside;
      lamp.intensity = inside ? LAMP_INTENSITY : 0;
      if (!inside) return;
      // The lamp hangs under the ceiling of whichever room the camera is in.
      const r = roomAt(camera.position, rooms.rooms) ?? rooms.rooms[0]!;
      room.set((r.min.x + r.max.x) / 2, r.max.y - 0.4, (r.min.z + r.max.z) / 2);
      lamp.position.copy(room);
    },
  };
}

function roomAt(p: THREE.Vector3, list: readonly Room[]): Room | null {
  return list.find((r) => p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z && p.y >= r.min.y && p.y <= r.max.y) ?? null;
}

/**
 * The wall pieces of one room: its four sides, WALL thick and just outside its box, less the doorways — where another
 * room straddles that side, the wall is open up to the lower of the two ceilings, with a lintel above if this room is
 * the taller.
 */
export function walls(room: Room, all: readonly Room[]): Box[] {
  const out: Box[] = [];
  const { min, max } = room;
  for (const axis of ['x', 'z'] as const) {
    const along = axis === 'x' ? 'z' : 'x';
    for (const side of [min[axis], max[axis]]) {
      const outward = side === min[axis] ? -1 : 1;
      // The openings on this side: [from, to, top] intervals along it.
      const openings = all
        .filter((o) => o !== room && o.min[axis] < side && o.max[axis] > side)
        .map((o) => ({ from: Math.max(o.min[along], min[along]), to: Math.min(o.max[along], max[along]), top: Math.min(o.max.y, max.y) }))
        .filter((o) => o.to > o.from)
        .sort((a, b) => a.from - b.from);
      const piece = (from: number, to: number, lo: number, hi: number) => {
        if (to - from <= 1e-6 || hi - lo <= 1e-6) return;
        const a = side + (outward < 0 ? -WALL : 0);
        const b = side + (outward < 0 ? 0 : WALL);
        out.push(axis === 'x'
          ? { min: { x: a, y: lo, z: from }, max: { x: b, y: hi, z: to } }
          : { min: { x: from, y: lo, z: a }, max: { x: to, y: hi, z: b } });
      };
      let at = min[along];
      for (const o of openings) {
        piece(at, o.from, min.y, max.y + WALL);
        if (o.top < max.y) piece(o.from, o.to, o.top, max.y + WALL); // the lintel, where this room is the taller
        at = Math.max(at, o.to);
      }
      piece(at, max[along], min.y, max.y + WALL);
    }
  }
  return out;
}
