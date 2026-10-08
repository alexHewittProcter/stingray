import * as THREE from 'three';
import {
  CONTROL_ROOM_PROPS, CORRIDOR_PROPS, LOUNGE_PROPS, SHAFT_OPEN_TOP, SHAFT_RADIUS, TOWER_AXIS, type Box, type Room, type Rooms,
} from '../sim/rooms';
import { controlFloorTexture, decalAtlas, decalUV, meshWallTexture, type DecalName } from './control-room-textures';
import { inRooms } from './indoors';
import { type InjectorChairMaterials, addInjectorChair, createInjectorChair } from './injector-chair';
import {
  type LoungeDecal, corridorPanelTexture, hazardTexture, loungeDecalAtlas, loungeDecalUV, oliveWallTexture, quiltTexture,
  terrazzoTexture,
} from './lounge-textures';
import { Parts, box as boxAt, rod } from './parts';
import { mulberry32 } from './random';

// Troy's rooms (phase 3). M1 art: T4 dresses the control room after 02_MARINEVILLE_CONTROL_ROOM/ and 05_ART_DIRECTION
// "Marineville / WASP" — bright graphic 1960s miniature futurism: angular grey consoles with chunky red, yellow, green
// and blue switches, blue knob fields, visible labels; cream walls, the big wall map with its tracking line, the World
// Videophone's sunburst on a perforated grey wall, the locator compass on a green wall, Commander Shore's desk and
// hover chair, and the window band over Marineville and the sea. T5 dresses the corridor as a WASP connector and the
// Standby Lounge after 03_STANDBY_INJECTOR/ — the injector bay with the three chairs (M8, render/injector-chair.ts),
// the open bore under Troy's (M1's shaft, its first SHAFT_OPEN_TOP metres), and the lounge proper.
//
// M1 "art respects colliders" (Global constraints): every rooms mesh is tagged — `roomShell` (walls, windows,
// floor, ceiling: drawn on or outside the room boxes) or `roomProp` (furniture: drawn inside a sim/rooms.ts props box)
// — and render/rooms.test.ts checks both, as interior.test.ts and landmarks.test.ts do for phase 2.
//
// Draw calls: pieces are merged per material (parts.ts), the switches and the knobs/lamps are two instanced meshes,
// and every flat painted thing is in one decal atlas — about 30 calls for the dressed room.
//
// Global constraints (indoors switches): the group is outside main.ts's oceanSide root and drawn only while the camera
// is in the rooms (indoors.ts inRooms), so the tower, the grounds and the sea stay in view through the windows (the
// gallery's glazing is single-sided — opaque from the sea, open from inside). The one lamp lives outside the group and
// only dims, so the scene's light count — and with it every compiled program — never changes. The tower's exterior
// volumes for the rooms (marineville.ts, ROOMS_EXTERIOR_NAME) are hidden while the camera is in the rooms, so none of
// their faces can stand in a doorway.

const WALL = 0.2; // m — walls, floors and ceilings are this thick, drawn outside the room boxes
const SILL_DEFAULT = 1.0; // m — the control room's windows run from here …
const HEAD_DEFAULT = 3.6; // … to here above the floor
const LAMP_INTENSITY = 60;

/** The tower's exterior volumes for the rooms (marineville.ts) — hidden while the camera is inside them. */
export const ROOMS_EXTERIOR_NAME = 'rooms-exterior';

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
  const glass = new THREE.MeshBasicMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.12, depthWrite: false });
  const mats = controlMaterials(glass);

  // The control room, dressed (T4); the corridor and the Standby Lounge (T5).
  const control = rooms.rooms.find((r) => r.id === 'controlRoom');
  if (control) group.add(controlRoom(control, rooms.rooms, mats));
  group.add(corridor(rooms, mats), lounge(rooms, mats));

  const lamp = new THREE.PointLight(0xfff3df, 0, 30, 2);
  lamp.name = 'rooms-lamp';
  const room = new THREE.Vector3();
  let exterior: THREE.Object3D | null | undefined;

  return {
    group,
    lamp,
    update(camera) {
      const inside = inRooms(camera.position);
      group.visible = inside;
      lamp.intensity = inside ? LAMP_INTENSITY : 0;
      // The tower's rooms exterior (marineville.ts), looked up once the group is in the scene.
      if (exterior === undefined && group.parent) exterior = group.parent.getObjectByName(ROOMS_EXTERIOR_NAME) ?? null;
      if (exterior) exterior.visible = !inside;
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

// ---- The control room (T4, M1 art) ----

type V3 = { x: number; y: number; z: number };

/** A box from its min and max corners. */
const slab = (min: V3, max: V3) =>
  boxAt(max.x - min.x, max.y - min.y, max.z - min.z, { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 });

/** Scale a geometry's UVs (so a repeating texture tiles per metre). */
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
  return g;
}

/** Remap a geometry's 0…1 UVs into one decal's rectangle of the atlas. */
function toDecal(g: THREE.BufferGeometry, name: DecalName): THREE.BufferGeometry {
  const [u0, v0, u1, v1] = decalUV(name);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  return g;
}

/** The same surface seen from behind: normals negated and every triangle's winding reversed (for thin open shells). */
function backFaces(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const back = g.clone();
  const normal = back.attributes.normal as THREE.BufferAttribute;
  for (let k = 0; k < normal.count; k++) normal.setXYZ(k, -normal.getX(k), -normal.getY(k), -normal.getZ(k));
  const index = back.index!;
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k + 1);
    index.setX(k + 1, index.getX(k + 2));
    index.setX(k + 2, a);
  }
  return back;
}

/** Which way a wall-mounted decal faces. */
type Facing = 'x+' | 'x-' | 'z+' | 'z-';
const FACING_YAW: Record<Facing, number> = { 'z+': 0, 'x+': Math.PI / 2, 'z-': Math.PI, 'x-': -Math.PI / 2 };

/** A flat decal of size w × h, centred at c, facing a direction (a rectangle, or a disc of diameter w when round). */
function decal(name: DecalName, w: number, h: number, c: V3, facing: Facing, round = false): THREE.BufferGeometry {
  const g = toDecal(round ? new THREE.CircleGeometry(w / 2, 40) : new THREE.PlaneGeometry(w, h), name);
  g.rotateY(FACING_YAW[facing]);
  g.translate(c.x, c.y, c.z);
  return g;
}

type Stud = { m: THREE.Matrix4; colour: number };

interface Kit {
  shell: Parts;
  props: Parts;
  /** Instanced pieces, all on props: chunky toggles (boxes), and knobs and lamps (cylinders). */
  switches: Stud[];
  knobs: Stud[];
  /** Props the interactables (M5, sim/interactables.ts) light up: each its own meshes, tagged with the id. */
  tag: Record<'wallMap' | 'videophone' | 'locator' | 'shoresDesk', Parts>;
  mats: ReturnType<typeof controlMaterials>;
}

type ControlMaterials = ReturnType<typeof controlMaterials>;

function newKit(mats: ControlMaterials): Kit {
  return {
    shell: new Parts(), props: new Parts(), switches: [], knobs: [], mats,
    tag: { wallMap: new Parts(), videophone: new Parts(), locator: new Parts(), shoresDesk: new Parts() },
  };
}

/** A kit's instanced switches and knobs/lamps (consoleBank's), as two meshes tagged roomProp. */
function addStuds(group: THREE.Group, kit: Kit, name: string): void {
  const instanced = (geometry: THREE.BufferGeometry, list: Stud[], suffix: string) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, kit.mats.instanced, list.length);
    const colour = new THREE.Color();
    list.forEach((s, k) => {
      mesh.setMatrixAt(k, s.m);
      mesh.setColorAt(k, colour.setHex(s.colour));
    });
    mesh.name = `${name}-${suffix}`;
    mesh.userData.roomProp = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  instanced(new THREE.BoxGeometry(1, 1, 1), kit.switches, 'switches');
  instanced(new THREE.CylinderGeometry(1, 1, 1, 12), kit.knobs, 'knobs');
}

/** A kit's shell and props built and tagged (roomShell / roomProp, for render/rooms.test.ts), with its studs. */
function buildKit(kit: Kit, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const shell = kit.shell.build(`${name}-shell`);
  shell.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomShell = true; });
  const props = kit.props.build(`${name}-props`);
  props.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomProp = true; });
  group.add(shell, props);
  addStuds(group, kit, name);
  return group;
}

function controlMaterials(glass: THREE.Material) {
  const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const floorMap = controlFloorTexture();
  const meshMap = meshWallTexture();
  const atlas = decalAtlas();
  return {
    floor: lambert(floorMap ? 0xffffff : 0xa79aa3, { map: floorMap }),
    wall: lambert(0xd8cbaa), // the cream walls of ref 1
    meshWall: lambert(meshMap ? 0xffffff : 0x9a9c9c, { map: meshMap }),
    green: lambert(0x9cc96c), // the locator's green wall (ref 2)
    trim: lambert(0xc0362a), // red: the door frame, call panels, the desk front
    frame: lambert(0xd5d9dc), // silver-white mullions and rims
    ceiling: lambert(0xe6e3da, { emissive: 0x6e6b64 }), // lit from the troughs, not the sun
    light: new THREE.MeshBasicMaterial({ color: 0xfff7e6 }),
    glass,
    body: lambert(0xb7bcc0), // console grey
    bodyDark: lambert(0x50565c),
    panel: lambert(0x8b9196),
    gold: lambert(0xc9a54c),
    hover: lambert(0x7fb04e), // Shore's green hover chair
    desk: lambert(0x47525c),
    sky: lambert(0x9cc7dc), // the locator unit's pale blue
    decals: new THREE.MeshLambertMaterial({
      color: atlas ? 0xffffff : 0xc9c2b0, map: atlas, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
    instanced: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };
}

/** The dressed control room: its shell (walls, windows, floor, ceiling) and its furniture, merged per material. */
function controlRoom(room: Room, all: readonly Room[], mats: ControlMaterials): THREE.Group {
  const kit = newKit(mats);
  controlShell(kit, room, all);
  furniture(kit, room.min.y);

  const group = new THREE.Group();
  group.name = 'controlRoom';
  const shell = kit.shell.build('controlRoom-shell');
  shell.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomShell = true; });
  const props = kit.props.build('controlRoom-props');
  props.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomProp = true; });
  group.add(shell, props);
  // M5's glow (render/interact.ts) lights everything under an object tagged userData.interactable = id.
  for (const [id, parts] of Object.entries(kit.tag)) {
    const tagged = parts.build(`controlRoom-${id}`);
    tagged.userData.interactable = id;
    tagged.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomProp = true; });
    group.add(tagged);
  }
  addStuds(group, kit, 'controlRoom');
  return group;
}

// ---- The shell ----

function controlShell(kit: Kit, room: Room, all: readonly Room[]): void {
  const { shell, mats } = kit;
  const { min, max } = room;
  const F = min.y;
  const C = max.y;
  const top = C + WALL;
  const ax = (min.x + max.x) / 2;
  const az = (min.z + max.z) / 2;
  const doorway = all.find((o) => o.id === 'corridor' && o.min.z < min.z && o.max.z > min.z)!;
  const doorTop = Math.min(doorway.max.y, C);

  // The floor: one plane over the room (and under the walls), its painted tiles spanning the room.
  const floor = new THREE.PlaneGeometry(max.x - min.x + 2 * WALL, max.z - min.z + 2 * WALL);
  floor.rotateX(-Math.PI / 2);
  floor.translate(ax, F, az);
  shell.add(mats.floor, floor);

  // North wall (−z): cream and solid, the corridor's doorway framed in red, its sign on the lintel.
  const nz0 = min.z - WALL;
  const nz1 = min.z;
  const jamb = 0.3;
  shell.add(mats.wall,
    slab({ x: min.x - WALL, y: F, z: nz0 }, { x: doorway.min.x - jamb, y: top, z: nz1 }),
    slab({ x: doorway.max.x + jamb, y: F, z: nz0 }, { x: max.x + WALL, y: top, z: nz1 }));
  shell.add(mats.trim,
    slab({ x: doorway.min.x - jamb, y: F, z: nz0 }, { x: doorway.min.x, y: top, z: nz1 }),
    slab({ x: doorway.max.x, y: F, z: nz0 }, { x: doorway.max.x + jamb, y: top, z: nz1 }),
    slab({ x: doorway.min.x, y: doorTop, z: nz0 }, { x: doorway.max.x, y: top, z: nz1 }));
  const dw = doorway.max.x - doorway.min.x;
  shell.add(mats.decals, decal('loungeSign', dw * 0.9, dw * 0.9 * (96 / 512), {
    x: (doorway.min.x + doorway.max.x) / 2, y: (doorTop + C) / 2, z: nz1 + 0.0005,
  }, 'z+'));

  // West wall (−x): the perforated grey panel behind the Videophone, then windows toward the south-west.
  const westSolidTo = CONTROL_ROOM_PROPS.bankWest.min.z - 0.4;
  const westWall = slab({ x: min.x - WALL, y: F, z: min.z }, { x: min.x, y: top, z: westSolidTo });
  shell.add(mats.meshWall, scaleUV(westWall, westSolidTo - min.z, top - F));
  windowRun(kit, 'x', min.x - WALL, min.x, westSolidTo, max.z + WALL, F, top);

  // East wall (+x): the locator's green panel, then windows toward the south-east.
  const eastSolidTo = CONTROL_ROOM_PROPS.bankEast.min.z - 0.8;
  shell.add(mats.green, slab({ x: max.x, y: F, z: min.z }, { x: max.x + WALL, y: top, z: eastSolidTo }));
  windowRun(kit, 'x', max.x, max.x + WALL, eastSolidTo, max.z + WALL, F, top);

  // South wall (+z): the window band over Marineville and the sea, the whole width.
  windowRun(kit, 'z', max.z, max.z + WALL, min.x, max.x, F, top);

  // The ceiling: a slab, and under it coffers with three recessed light troughs running east–west.
  const x0 = min.x - WALL;
  const x1 = max.x + WALL;
  const z0 = min.z - WALL;
  const z1 = max.z + WALL;
  const coffer = 0.12;
  shell.add(mats.ceiling, slab({ x: x0, y: C + coffer, z: z0 }, { x: x1, y: top + 0.1, z: z1 }));
  const half = 0.35;
  const reach = 6.5;
  let at = z0;
  for (const tz of [az - 4.5, az, az + 4.5]) {
    shell.add(mats.ceiling,
      slab({ x: x0, y: C, z: at }, { x: x1, y: C + coffer, z: tz - half }),
      slab({ x: x0, y: C, z: tz - half }, { x: ax - reach, y: C + coffer, z: tz + half }),
      slab({ x: ax + reach, y: C, z: tz - half }, { x: x1, y: C + coffer, z: tz + half }));
    shell.add(mats.light, slab({ x: ax - reach, y: C + coffer - 0.03, z: tz - half }, { x: ax + reach, y: C + coffer, z: tz + half }));
    at = tz + half;
  }
  shell.add(mats.ceiling, slab({ x: x0, y: C, z: at }, { x: x1, y: C + coffer, z: z1 }));

  // From inside, the gallery's single-sided glazing vanishes: draw its mullions so the view out is still framed by the
  // tower — a ring of white posts at the glazing's radius, clear of the corridor's bridge.
  const others = all.filter((o) => o.id !== 'controlRoom');
  const radius = 13.3;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const px = ax + Math.cos(a) * radius;
    const pz = az + Math.sin(a) * radius;
    if (others.some((o) => px > o.min.x - 0.6 && px < o.max.x + 0.6 && pz > o.min.z - 0.6 && pz < o.max.z + 0.6)) continue;
    shell.add(mats.frame, boxAt(0.18, 4.4, 0.18, { x: px, y: F + 2.1, z: pz }, -a));
  }
}

/**
 * One run of window wall along an axis-aligned line: sill, glass band and head, with mullions every ≤ 2 m. `axis` is
 * the axis the wall's thickness (t0…t1) runs along: 'x' — the wall runs along z from a0 to a1 — or 'z'.
 */
function windowRun(
  kit: Kit, axis: 'x' | 'z', t0: number, t1: number, a0: number, a1: number, F: number, top: number,
  opts: { sill?: number; head?: number; wall?: THREE.Material } = {},
): void {
  const { shell, mats } = kit;
  const SILL = opts.sill ?? SILL_DEFAULT;
  const HEAD = opts.head ?? HEAD_DEFAULT;
  const wall = opts.wall ?? mats.wall;
  const piece = (lo: number, hi: number, from = a0, to = a1, inset = 0) => (axis === 'x'
    ? slab({ x: t0 + inset, y: lo, z: from }, { x: t1 - inset, y: hi, z: to })
    : slab({ x: from, y: lo, z: t0 + inset }, { x: to, y: hi, z: t1 - inset }));
  shell.add(wall, piece(F, F + SILL - 0.08), piece(F + HEAD + 0.08, top));
  shell.add(mats.frame, piece(F + SILL - 0.08, F + SILL), piece(F + HEAD, F + HEAD + 0.08));
  shell.add(mats.glass, piece(F + SILL, F + HEAD, a0, a1, 0.08)); // set back in the wall, behind the mullions
  const bays = Math.max(1, Math.ceil((a1 - a0) / 2));
  for (let k = 0; k <= bays; k++) {
    const at = a0 + ((a1 - a0) * k) / bays;
    shell.add(mats.frame, piece(F + SILL, F + HEAD, Math.max(a0, at - 0.06), Math.min(a1, at + 0.06)));
  }
}

// ---- The furniture ----

const UP = new THREE.Vector3(0, 1, 0);

interface ConsoleSpec {
  /** Along the bank (local x), across it (local z, front at +depth/2), and the back's height. */
  length: number;
  depth: number;
  height: number;
  /** Height of the front edge, where the sloping panel starts. */
  front: number;
  /** Where the bank stands — the centre of its footprint on the floor — and the yaw that turns local +z to its front. */
  at: V3;
  yaw: number;
  /** The fields along the sloping panel, left to right as seen from behind the bank. */
  fields: Array<'knobs' | 'switches' | 'lamps' | 'chart'>;
  /** Labels on the front face, one per field (or none). */
  labels?: Array<DecalName | null>;
}

/**
 * An angular WASP console bank (ref 1): a grey body with a toe recess, a front face, a panel sloping up to a back
 * ledge, and on the slope a run of fields — blue knob panels, rows of chunky toggles, lamp panels, an inclined chart.
 * Drawn within its footprint (length × depth) and below height + 0.1 (the knobs stand proud of the slope).
 */
function consoleBank(kit: Kit, s: ConsoleSpec): void {
  const { props, mats } = kit;
  const frame = new THREE.Matrix4().compose(
    new THREE.Vector3(s.at.x, s.at.y, s.at.z), new THREE.Quaternion().setFromAxisAngle(UP, s.yaw), new THREE.Vector3(1, 1, 1));
  const d2 = s.depth / 2;
  const back = Math.min(0.25, s.depth * 0.3);
  const toe = 0.08;
  // The profile in (local z, y): front at +d/2, back at −d/2. Shape x = −z, so after the extrusion is turned about Y
  // ((x, y, z) → (z, y, −x)) the extrusion runs along +x and the profile stands in the y–z plane the right way round.
  const profile: Array<[number, number]> = [
    [d2 - toe, 0], [d2 - toe, 0.1], [d2, 0.1], [d2, s.front], [-d2 + back, s.height], [-d2, s.height], [-d2, 0],
  ];
  const body = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y))), { depth: s.length, bevelEnabled: false });
  body.rotateY(Math.PI / 2);
  body.translate(-s.length / 2, 0, 0);
  props.add(mats.body, body.applyMatrix4(frame));
  // The back ledge's top in a darker grey, and a kick strip in the toe recess.
  props.add(mats.bodyDark,
    slab({ x: -s.length / 2, y: s.height, z: -d2 }, { x: s.length / 2, y: s.height + 0.02, z: -d2 + back }).applyMatrix4(frame),
    slab({ x: -s.length / 2, y: 0, z: d2 - toe - 0.01 }, { x: s.length / 2, y: 0.1, z: d2 - toe }).applyMatrix4(frame));

  // The slope's own frame: origin at its middle, y along its outward normal, z down the slope toward the front.
  const zb = -d2 + back;
  const rise = s.height - s.front;
  const run = d2 - zb;
  const slopeLength = Math.hypot(rise, run);
  const slope = new THREE.Matrix4().multiplyMatrices(frame, new THREE.Matrix4().compose(
    new THREE.Vector3(0, (s.height + s.front) / 2, (d2 + zb) / 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(rise, run)),
    new THREE.Vector3(1, 1, 1),
  ));
  const fieldLength = s.length / s.fields.length;
  const fieldDepth = slopeLength * 0.82;
  s.fields.forEach((field, k) => {
    const cx = -s.length / 2 + fieldLength * (k + 0.5);
    const w = fieldLength - 0.06;
    const plate = (name: DecalName) => {
      const g = toDecal(new THREE.PlaneGeometry(w, fieldDepth), name);
      g.rotateX(-Math.PI / 2); // face the slope's normal, its top edge up the slope
      g.translate(cx, 0.004, 0);
      props.add(mats.decals, g.applyMatrix4(slope));
    };
    const stud = (list: Stud[], x: number, z: number, sx: number, sy: number, sz: number, colour: number) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, sy / 2, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
      list.push({ m: m.premultiply(slope), colour });
    };
    const grid = (pitchX: number, pitchZ: number, each: (x: number, z: number, i: number, j: number) => void) => {
      const cols = Math.max(2, Math.floor(w / pitchX));
      const rows = Math.max(1, Math.floor(fieldDepth / pitchZ));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) each(cx - w / 2 + (w * (i + 0.5)) / cols, -fieldDepth / 2 + (fieldDepth * (j + 0.5)) / rows, i, j);
      }
    };
    if (field === 'knobs') {
      plate('knobPanel');
      grid(0.18, 0.18, (x, z) => stud(kit.knobs, x, z, 0.035, 0.05, 0.035, 0x16181a));
    } else if (field === 'switches') {
      props.add(mats.panel, slab({ x: cx - w / 2, y: 0, z: -fieldDepth / 2 }, { x: cx + w / 2, y: 0.01, z: fieldDepth / 2 }).applyMatrix4(slope));
      const colours = [0xd8322a, 0xf2c23a, 0x46a854, 0xeeeeee, 0x2f6fd0];
      grid(0.16, 0.24, (x, z, i, j) => stud(kit.switches, x, z, 0.07, 0.07, 0.11, colours[(i + j * 2 + k) % colours.length]!));
    } else {
      plate(field === 'lamps' ? 'lampPanel' : 'chart');
    }
    const label = s.labels?.[k];
    if (label) {
      const lh = Math.min(Math.min(w * 0.8, 1.2) * (96 / 512), (s.front - 0.1) * 0.5);
      props.add(mats.decals, decal(label, lh * (512 / 96), lh, { x: cx, y: 0.1 + (s.front - 0.1) * 0.62, z: d2 + 0.001 }, 'z+').applyMatrix4(frame));
    }
  });
}

/** A gold tulip swivel chair (ref 1): a disc foot, a stem, a cup seat and a curved back; the sitter faces `yaw`. */
function tulipChair(kit: Kit, at: V3, yaw: number): void {
  const { props, mats } = kit;
  const f = new THREE.Matrix4().compose(new THREE.Vector3(at.x, at.y, at.z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
  const foot = new THREE.CylinderGeometry(0.3, 0.34, 0.05, 20).translate(0, 0.025, 0);
  const stem = new THREE.CylinderGeometry(0.05, 0.07, 0.4, 10).translate(0, 0.25, 0);
  const cup = new THREE.CylinderGeometry(0.36, 0.2, 0.14, 20).translate(0, 0.52, 0);
  // The back: the −z half of a ring (CylinderGeometry's θ = 0 is +z), behind a sitter facing +z.
  const backrest = new THREE.CylinderGeometry(0.37, 0.36, 0.42, 20, 1, true, Math.PI * 0.5, Math.PI).translate(0, 0.8, 0);
  props.add(mats.gold, foot.applyMatrix4(f), stem.applyMatrix4(f), cup.applyMatrix4(f), backrest.applyMatrix4(f), backFaces(backrest));
  props.add(mats.bodyDark, new THREE.CylinderGeometry(0.31, 0.31, 0.04, 20).translate(0, 0.6, 0).applyMatrix4(f));
}

/** A vertical cylinder at (x, z) from y0 to y1. */
function rodY(x: number, z: number, y0: number, y1: number, r: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, y1 - y0, 14).translate(x, (y0 + y1) / 2, z);
}

function furniture(kit: Kit, F: number): void {
  const { props, mats, tag } = kit;
  const P = CONTROL_ROOM_PROPS;
  const mid = (b: Box) => ({ x: (b.min.x + b.max.x) / 2, y: F, z: (b.min.z + b.max.z) / 2 });
  /** A round knob, button or lamp of radius r standing len proud, its axis along x or z (wall-mounted) or y. */
  const knob = (x: number, y: number, z: number, axis: 'x' | 'y' | 'z', r: number, len: number, colour: number) => {
    const q = axis === 'y' ? new THREE.Quaternion()
      : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis === 'z' ? 1 : 0, 0, axis === 'x' ? 1 : 0), Math.PI / 2);
    kit.knobs.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, len, r)), colour });
  };

  // The main console bank across the room, its panels facing south (toward the start and Shore's desk).
  {
    const b = P.consoles;
    consoleBank(kit, {
      length: b.max.x - b.min.x - 0.04, depth: b.max.z - b.min.z - 0.04, height: b.max.y - F - 0.12, front: 0.78,
      at: mid(b), yaw: 0,
      fields: ['knobs', 'switches', 'chart', 'lamps', 'switches', 'knobs'],
      labels: ['hydrophones', null, 'sonar', null, 'power', 'comms'],
    });
  }
  // The operators' chairs, facing the bank (north).
  tulipChair(kit, mid(P.chairWest), Math.PI);
  tulipChair(kit, mid(P.chairEast), Math.PI);

  // Low banks under the windows, facing into the room.
  const low = (b: Box, yaw: number, along: 'x' | 'z', fields: ConsoleSpec['fields'], labels?: ConsoleSpec['labels']) => {
    const length = along === 'x' ? b.max.x - b.min.x : b.max.z - b.min.z;
    const depth = along === 'x' ? b.max.z - b.min.z : b.max.x - b.min.x;
    consoleBank(kit, { length: length - 0.04, depth: depth - 0.04, height: b.max.y - F - 0.12, front: 0.66, at: mid(b), yaw, fields, labels });
  };
  low(P.bankSouthWest, Math.PI, 'x', ['switches', 'knobs', 'lamps', 'switches']);
  low(P.bankSouthEast, Math.PI, 'x', ['lamps', 'switches', 'knobs', 'switches'], [null, 'launch', null, null]);
  low(P.bankWest, Math.PI / 2, 'z', ['knobs', 'switches', 'lamps']);
  low(P.bankEast, -Math.PI / 2, 'z', ['switches', 'lamps', 'knobs', 'switches', 'chart']);

  // The wall map (north wall): its frame, the map, the banner over it, the console beneath, the Action Area screen and
  // its red call panel, the extinguisher and its FIRE sign (ref 1).
  {
    const b = P.map;
    const wz = b.min.z; // the wall's face
    const cx = -3.0;
    const mapW = 6.6;
    const mapH = mapW * (384 / 1024);
    const my = F + 1.15 + mapH / 2;
    const frameTop = my + mapH / 2 + 0.1;
    tag.wallMap.add(mats.frame, slab({ x: cx - mapW / 2 - 0.1, y: my - mapH / 2 - 0.1, z: wz }, { x: cx + mapW / 2 + 0.1, y: frameTop, z: wz + 0.05 }));
    tag.wallMap.add(mats.decals, decal('map', mapW, mapH, { x: cx, y: my, z: wz + 0.051 }, 'z+'));
    props.add(mats.decals, decal('banner', mapW, mapW / 16, { x: cx, y: (frameTop + b.max.y) / 2, z: wz + 0.01 }, 'z+'));
    consoleBank(kit, {
      length: mapW, depth: 0.7, height: 0.9, front: 0.74, at: { x: cx, y: F, z: wz + 0.37 }, yaw: 0,
      fields: ['switches', 'lamps', 'knobs', 'switches'],
    });
    // The Action Area: a silver-rimmed round screen with its label, and the red call panel beside it.
    const sx = 1.75;
    const sy = F + 2.5;
    props.add(mats.frame, new THREE.CylinderGeometry(0.62, 0.62, 0.08, 40).rotateX(Math.PI / 2).translate(sx, sy, wz + 0.04));
    props.add(mats.decals, decal('actionScreen', 1.1, 1.1, { x: sx, y: sy, z: wz + 0.081 }, 'z+', true));
    props.add(mats.decals, decal('actionSign', 1.3, 1.3 * (96 / 512), { x: sx, y: sy + 0.9, z: wz + 0.01 }, 'z+'));
    props.add(mats.trim, slab({ x: 0.55, y: F + 2.0, z: wz }, { x: 0.9, y: F + 3.0, z: wz + 0.05 }));
    for (const [y, c] of [[2.8, 0xf2efe6], [2.6, 0xf2efe6], [2.35, 0xf2c23a], [2.15, 0xf2efe6]] as const) knob(0.725, F + y, wz + 0.07, 'z', 0.05, 0.04, c);
    // The extinguisher on its bracket, and the FIRE sign over it.
    const ex = -7.05;
    const ez = wz + 0.2;
    props.add(mats.trim, rodY(ex, ez, F + 0.95, F + 1.55, 0.12));
    props.add(mats.bodyDark, rodY(ex, ez, F + 1.55, F + 1.68, 0.05), slab({ x: ex - 0.05, y: F + 1.2, z: wz }, { x: ex + 0.05, y: F + 1.3, z: ez - 0.1 }));
    props.add(mats.decals, decal('fireSign', 0.5, 0.5 * (96 / 256), { x: ex, y: F + 2.05, z: wz + 0.01 }, 'z+'));
  }

  // The World Videophone (west wall): its gilt-rimmed sunburst panel, the call buttons beside it, a ledge beneath (ref 2).
  {
    const b = P.videophone;
    const wx = b.min.x;
    const cz = (b.min.z + b.max.z) / 2 - 0.3;
    const vy = F + 2.05;
    const vw = 2.1;
    const vh = vw * (384 / 512);
    tag.videophone.add(mats.gold, slab({ x: wx, y: vy - vh / 2 - 0.05, z: cz - vw / 2 - 0.05 }, { x: wx + 0.08, y: vy + vh / 2 + 0.05, z: cz + vw / 2 + 0.05 }));
    tag.videophone.add(mats.decals, decal('videophone', vw, vh, { x: wx + 0.081, y: vy, z: cz }, 'x+'));
    const bz = cz + vw / 2 + 0.35;
    props.add(mats.trim, slab({ x: wx, y: F + 1.6, z: bz - 0.17 }, { x: wx + 0.06, y: F + 2.5, z: bz + 0.17 }));
    for (const [y, c] of [[2.38, 0xe8322a], [2.2, 0xf2efe6], [2.05, 0xf2efe6], [1.8, 0xc9a54c]] as const) knob(wx + 0.08, F + y, bz, 'x', 0.05, 0.05, c);
    props.add(mats.body, slab({ x: wx, y: F, z: b.min.z + 0.3 }, { x: wx + 0.45, y: F + 0.85, z: b.max.z - 0.3 }));
    props.add(mats.trim, slab({ x: wx, y: F + 0.85, z: b.min.z + 0.25 }, { x: wx + 0.5, y: F + 0.92, z: b.max.z - 0.25 }));
  }

  // The locator (east wall): the compass dial on the green panel under its plaque, and the lamp unit on a red-plinthed
  // pedestal in front of it (ref 2).
  {
    const b = P.locator;
    const wx = b.max.x;
    const cz = (b.min.z + b.max.z) / 2;
    const dy = F + 2.75;
    tag.locator.add(mats.bodyDark, new THREE.CylinderGeometry(0.82, 0.82, 0.06, 40).rotateZ(Math.PI / 2).translate(wx - 0.03, dy, cz));
    tag.locator.add(mats.decals, decal('compass', 1.5, 1.5, { x: wx - 0.061, y: dy, z: cz }, 'x-', true));
    props.add(mats.decals, decal('locatorSign', 1.8, 1.8 * (96 / 512), { x: wx - 0.01, y: dy + 1.05, z: cz }, 'x-'));
    const px = wx - 0.95;
    props.add(mats.trim, slab({ x: px - 0.55, y: F, z: cz - 0.6 }, { x: px + 0.55, y: F + 0.15, z: cz + 0.6 }));
    props.add(mats.frame, rodY(px, cz, F + 0.15, F + 1.1, 0.06));
    tag.locator.add(mats.sky, slab({ x: px - 0.2, y: F + 1.05, z: cz - 0.7 }, { x: px + 0.2, y: F + 1.85, z: cz + 0.7 }));
    tag.locator.add(mats.frame, slab({ x: px - 0.22, y: F + 1.38, z: cz - 0.18 }, { x: px - 0.2, y: F + 1.78, z: cz + 0.18 }));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const z = cz + side * (0.31 + i * 0.12);
        knob(px - 0.22, F + 1.72, z, 'x', 0.035, 0.03, 0x2f6fd0);
        knob(px - 0.22, F + 1.58, z, 'x', 0.035, 0.03, 0x2f6fd0);
        knob(px - 0.22, F + 1.18, z, 'x', 0.04, 0.05, 0xd2772e);
      }
    }
  }

  // Commander Shore's desk by the south windows, facing north into the room, and his green hover chair (ref 1).
  {
    const b = P.shoreDesk;
    const front = b.min.z + 0.02;
    const back = front + 1.2;
    tag.shoresDesk.add(mats.desk, slab({ x: b.min.x + 0.2, y: F + 0.74, z: front }, { x: b.max.x - 0.2, y: F + 0.8, z: back }));
    tag.shoresDesk.add(mats.frame, slab({ x: b.min.x + 0.2, y: F + 0.71, z: front }, { x: b.max.x - 0.2, y: F + 0.74, z: back }));
    tag.shoresDesk.add(mats.trim, slab({ x: b.min.x + 0.3, y: F + 0.1, z: front + 0.02 }, { x: b.max.x - 0.3, y: F + 0.71, z: front + 0.12 }));
    tag.shoresDesk.add(mats.body,
      slab({ x: b.min.x + 0.25, y: F, z: front + 0.1 }, { x: b.min.x + 0.75, y: F + 0.71, z: back - 0.1 }),
      slab({ x: b.max.x - 0.75, y: F, z: front + 0.1 }, { x: b.max.x - 0.25, y: F + 0.71, z: back - 0.1 }));
    tag.shoresDesk.add(mats.decals, decal('shorePlate', 1.0, 1.0 * (96 / 512), { x: (b.min.x + b.max.x) / 2, y: F + 0.5, z: front + 0.019 }, 'z-'));
    // The desk's own small console, facing Shore (south).
    consoleBank(kit, {
      length: 2.2, depth: 0.42, height: 0.28, front: 0.08, at: { x: (b.min.x + b.max.x) / 2, y: F + 0.8, z: front + 0.3 }, yaw: 0,
      fields: ['switches', 'lamps', 'switches'],
    });
    // The hover chair: a dark hover skirt, the green tub with a gold band, the cushion, the curved back, two arm pods.
    const hx = (b.min.x + b.max.x) / 2;
    const hz = b.max.z - 0.62;
    props.add(mats.bodyDark, new THREE.CylinderGeometry(0.42, 0.46, 0.12, 24).translate(hx, F + 0.16, hz));
    props.add(mats.hover, new THREE.CylinderGeometry(0.56, 0.5, 0.36, 28).translate(hx, F + 0.4, hz));
    props.add(mats.gold,
      new THREE.CylinderGeometry(0.57, 0.565, 0.04, 28).translate(hx, F + 0.46, hz),
      new THREE.CylinderGeometry(0.46, 0.46, 0.06, 24).translate(hx, F + 0.61, hz));
    // The back: a band of the ring on the +z side (behind Shore, who faces north), solid from both sides.
    const backrest = new THREE.CylinderGeometry(0.56, 0.56, 0.5, 24, 1, true, -Math.PI * 0.4, Math.PI * 0.8).translate(hx, F + 0.83, hz);
    props.add(mats.hover, backrest, backFaces(backrest));
    for (const side of [-1, 1]) {
      props.add(mats.bodyDark, new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12).translate(hx + side * 0.46, F + 0.7, hz - 0.1));
      knob(hx + side * 0.46, F + 0.78, hz - 0.1, 'y', 0.03, 0.04, 0xe8322a);
    }
  }
}

// ---- The corridor (T5, M1 art) ----

/** A box from min/max, for the dressed shells (an alias that reads better in the corridor and lounge code). */
const block = slab;

/** A flat decal from the lounge atlas, w × h, centred at c, facing a direction (or up, for the floor). */
function loungeDecal(name: LoungeDecal, w: number, h: number, c: V3, facing: Facing | 'up'): THREE.BufferGeometry {
  const [u0, v0, u1, v1] = loungeDecalUV(name);
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  if (facing === 'up') g.rotateX(-Math.PI / 2);
  else g.rotateY(FACING_YAW[facing]);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** A down-facing panel flush with a ceiling at y (a light fitting), x0…x1 × z0…z1. */
function ceilingPanel(x0: number, x1: number, z0: number, z1: number, y: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
}

function loungeMaterials(mats: ControlMaterials) {
  const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const tiled = (map: THREE.Texture | null, fallback: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
    lambert(map ? 0xffffff : fallback, { map, ...extra });
  const atlas = loungeDecalAtlas();
  return {
    // The corridor: a WASP connector's pale panelling, a blue-grey floor.
    panel: tiled(corridorPanelTexture(), 0xc9ccc9),
    corridorFloor: lambert(0x6c7680),
    // The lounge (ref, lounge): olive ribbed walls, a pale green wall, grey terrazzo; the bay (ref, bay): maroon below
    // a gold rail, T4's perforated grey above.
    olive: tiled(oliveWallTexture(), 0x9a9a55),
    paleGreen: lambert(0xb4cf96),
    maroon: lambert(0x7b3b35),
    terrazzo: tiled(terrazzoTexture(), 0x9b9a97),
    quilt: tiled(quiltTexture(), 0xb3242a),
    hazard: tiled(hazardTexture(), 0xe9b52c),
    plinth: lambert(0x5d646b),
    bore: lambert(0x5d666e, { emissive: 0x14171a }),
    boreDark: lambert(0x1c2024),
    boreLight: new THREE.MeshBasicMaterial({ color: 0xf6f0d8 }),
    lampRed: new THREE.MeshBasicMaterial({ color: 0xff4a36 }),
    white: lambert(0xf0ede4),
    leaf: lambert(0x3f7d3a, { side: THREE.DoubleSide }),
    soil: lambert(0x3b2c22),
    amber: lambert(0xb8792a, { emissive: 0x2a1404 }),
    bottle: new THREE.MeshLambertMaterial({ color: 0xdfeef2, transparent: true, opacity: 0.55, depthWrite: false }),
    tableTop: lambert(0xb3242a),
    conduits: [lambert(0x2f6fd0), lambert(0xd8322a), lambert(0xf2c23a)] as const,
    decals: new THREE.MeshLambertMaterial({
      color: atlas ? 0xffffff : 0xc9c2b0, map: atlas, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
    chair: {
      upholstery: lambert(0x5b6f8f), frame: mats.frame, pad: mats.trim, dark: mats.bodyDark, body: mats.body,
    } satisfies InjectorChairMaterials,
  };
}
type LoungeMaterials = ReturnType<typeof loungeMaterials>;

let loungeMats: { control: ControlMaterials; lounge: LoungeMaterials } | null = null;
/** One set of lounge materials per control-materials set (the corridor and the lounge share it). */
function loungeMaterialsFor(mats: ControlMaterials): LoungeMaterials {
  if (loungeMats?.control !== mats) loungeMats = { control: mats, lounge: loungeMaterials(mats) };
  return loungeMats.lounge;
}

/** Corridor walls: panelled where solid, a window band where the bridge is outside the gallery's glazing. */
const BRIDGE_Z = TOWER_AXIS.z - 13.2; // north of this the corridor is out in the open, on the bridge

/**
 * The corridor (M1 art), a WASP connector: pale panelled walls with a blue band, a bridge section with a window band
 * on both sides once it leaves the gallery, conduits along the east wall above the windows, a chevroned floor stripe
 * round the turn, light panels in the ceiling, signs at the turn, and a red-jambed doorway into the lounge.
 */
function corridor(rooms: Rooms, mats: ControlMaterials): THREE.Group {
  const kit = newKit(mats);
  const L = loungeMaterialsFor(mats);
  const { shell, props } = kit;
  const legs = rooms.rooms.filter((r) => r.id === 'corridor');
  const control = rooms.rooms.find((r) => r.id === 'controlRoom')!;
  const loungeRoom = rooms.rooms.find((r) => r.id === 'lounge')!;
  // The leg out of the control room (long along z) and the leg into the lounge (long along x).
  const north = legs.reduce((a, b) => (b.max.z - b.min.z > a.max.z - a.min.z ? b : a));
  const west = legs.find((r) => r !== north)!;
  const F = north.min.y;
  const C = north.max.y;
  const top = C + WALL;

  // Floor and ceiling: each leg's own footprint, clipped off the control room, the lounge and each other, run under
  // the walls (WALL) where there are walls.
  const nFoot = { x0: north.min.x - WALL, x1: north.max.x + WALL, z0: north.min.z - WALL, z1: control.min.z };
  const wFoot = { x0: loungeRoom.max.x + WALL, x1: north.min.x - WALL, z0: west.min.z - WALL, z1: west.max.z + WALL };
  for (const f of [nFoot, wFoot]) {
    shell.add(L.corridorFloor, block({ x: f.x0, y: F - WALL, z: f.z0 }, { x: f.x1, y: F, z: f.z1 }));
    shell.add(mats.ceiling, block({ x: f.x0, y: C, z: f.z0 }, { x: f.x1, y: top, z: f.z1 }));
  }
  // Light panels down the north leg and one at the turn, each in a silver rim.
  const cx = (north.min.x + north.max.x) / 2;
  for (let z = control.min.z - 1.6; z > north.min.z + 0.5; z -= 2.6) {
    shell.add(mats.light, ceilingPanel(cx - 0.5, cx + 0.5, z - 0.35, z + 0.35, C - 0.0005));
    shell.add(mats.frame, ceilingPanel(cx - 0.58, cx + 0.58, z - 0.43, z + 0.43, C - 0.0002));
  }
  const wz = (west.min.z + west.max.z) / 2;
  shell.add(mats.light, ceilingPanel(2.6, 3.4, wz - 0.35, wz + 0.35, C - 0.0005));
  shell.add(mats.frame, ceilingPanel(2.52, 3.48, wz - 0.43, wz + 0.43, C - 0.0002));
  // The floor stripe: chevrons pointing the way to the lounge — north up the leg, then west.
  const stripe = 0.22;
  const nz0 = west.min.z + (west.max.z - west.min.z) / 2;
  {
    // Turned so the chevrons (+u) point north (−z): the strip's u runs along −z.
    const g = loungeDecal('floorStripe', control.min.z - nz0 - stripe / 2, stripe, { x: 0, y: 0, z: 0 }, 'up');
    g.rotateY(Math.PI / 2).translate(cx, F, (control.min.z + nz0) / 2 - stripe / 4);
    shell.add(L.decals, g);
  }
  {
    const len = cx - stripe / 2 - (loungeRoom.max.x + WALL);
    const g = loungeDecal('floorStripe', len, stripe, { x: 0, y: 0, z: 0 }, 'up');
    g.rotateY(Math.PI).translate(loungeRoom.max.x + WALL + len / 2, F, nz0);
    shell.add(L.decals, g);
  }

  // The walls (T1's walls(), less the pieces one leg shares with the other).
  const pieces = legs.flatMap((leg) => walls(leg, rooms.rooms));
  const contains = (a: Box, b: Box) => a !== b && b.min.x >= a.min.x - 1e-6 && b.max.x <= a.max.x + 1e-6
    && b.min.z >= a.min.z - 1e-6 && b.max.z <= a.max.z + 1e-6 && b.min.y >= a.min.y - 1e-6 && b.max.y <= a.max.y + 1e-6;
  const own = pieces.filter((p, i) => !pieces.some((q, j) => (contains(q, p) && !contains(p, q)) || (j < i && contains(q, p) && contains(p, q))));
  const jamb = 0.3;
  for (const w of own) {
    const alongZ = w.max.z - w.min.z > w.max.x - w.min.x; // a wall running north–south (its thickness along x)
    const [a0, a1] = alongZ ? [w.min.z, w.max.z] : [w.min.x, w.max.x];
    const [t0, t1] = alongZ ? [w.min.x, w.max.x] : [w.min.z, w.max.z];
    const solid = (from: number, to: number, material: THREE.Material = L.panel) => {
      if (to - from <= 1e-6) return;
      const g = alongZ ? block({ x: t0, y: w.min.y, z: from }, { x: t1, y: w.max.y, z: to }) : block({ x: from, y: w.min.y, z: t0 }, { x: to, y: w.max.y, z: t1 });
      shell.add(material, scaleUV(g, (to - from) / 1.2, 1));
    };
    // The lounge doorway's jambs: the last 0.3 m of a wall that ends at the lounge's east wall, in red.
    let lo = a0;
    if (!alongZ && Math.abs(a0 - loungeRoom.max.x) < 1e-6) {
      solid(a0, a0 + jamb, mats.trim);
      lo = a0 + jamb;
    }
    // The bridge's window band: on the north leg's two long walls, north of the gallery's glazing (BRIDGE_Z), and
    // clear of the corner where the conduits end and the sign hangs.
    if (alongZ && lo < BRIDGE_Z) {
      const w0 = Math.max(lo, west.max.z);
      const w1 = Math.min(a1, BRIDGE_Z);
      solid(lo, w0);
      if (w1 > w0) windowRun(kit, 'x', t0, t1, w0, w1, F, w.max.y, { sill: 1.0, head: 2.3, wall: L.panel });
      solid(Math.max(w0, w1), a1);
    } else {
      solid(lo, a1);
    }
  }

  // The doorway's lintel side: a red band across the ceiling's edge at the lounge.
  shell.add(mats.trim, block({ x: loungeRoom.max.x + WALL, y: C, z: west.min.z - WALL }, { x: loungeRoom.max.x + WALL + jamb, y: top, z: west.max.z + WALL }));

  // Signs at the turn: to the lounge on the end wall (seen walking north), to the control room on the east wall (seen
  // walking back east from the lounge).
  shell.add(L.decals, loungeDecal('toLounge', 1.8, 1.8 * (96 / 512), { x: cx, y: F + 2.05, z: north.min.z + 0.0005 }, 'z+'));
  shell.add(L.decals, loungeDecal('toControl', 1.6, 1.6 * (96 / 512), { x: north.max.x - 0.0005, y: F + 2.05, z: wz }, 'x-'));
  shell.add(L.decals, loungeDecal('crest', 0.7, 0.7, { x: north.max.x - 0.0005, y: F + 1.7, z: control.min.z - 1.0 }, 'x-'));

  // The conduits (CORRIDOR_PROPS.conduits): three coloured pipes along the east wall above the windows, on brackets,
  // with a riser to the floor at each end.
  {
    const b = CORRIDOR_PROPS.conduits;
    const x = b.max.x;
    const z0 = b.min.z + 0.06;
    const z1 = b.max.z - 0.06;
    [2.5, 2.64, 2.78].forEach((y, k) => {
      props.add(L.conduits[k]!, rod({ x: x - 0.07, y: F + y, z: z0 }, { x: x - 0.07, y: F + y, z: z1 }, 0.045, 0.045, 10));
    });
    for (let z = z0 + 0.3; z < z1; z += 1.6) props.add(mats.frame, block({ x: x - 0.13, y: F + 2.42, z: z - 0.03 }, { x, y: F + 2.86, z: z + 0.03 }));
    for (const z of [z0 + 0.06, z1 - 0.06]) {
      props.add(mats.bodyDark, rod({ x: x - 0.07, y: F, z }, { x: x - 0.07, y: F + 2.5, z }, 0.05, 0.05, 10));
      props.add(mats.bodyDark, block({ x: x - 0.13, y: F + 1.2, z: z - 0.1 }, { x, y: F + 1.5, z: z + 0.1 }));
    }
  }

  return buildKit(kit, 'corridor');
}

// ---- The Standby Lounge (T5, M1 art, M8's chairs) ----

/** The bore's radius at the lounge floor (the injector chair's guide shoes reach CHAIR_GUIDE_REACH, just inside it). */
export const BORE_RADIUS = 0.95;
/** How far down the drawn bore runs before it opens into the shaft's tube (sim/rooms.ts SHAFT_OPEN_TOP). */
const BORE_DEPTH = SHAFT_OPEN_TOP;
/** The drawn top of the shaft's tube: SHAFT_RADIUS wide, from the bore's flare down this far, then a cap (T7's). */
const TUBE_STUB = 2;
/** The bay plinth's height (the chairs' carriages sit flush in it). */
const PLINTH = 0.08;
/** The name of the dark disc that closes the drawn tube stub (T7 removes it when it draws the shaft). */
export const BORE_CAP_NAME = 'shaft-bore-cap';

/**
 * The Standby Lounge (M1 art) after 03_STANDBY_INJECTOR/: the injector bay along the north wall — the plinth with the
 * three chairs on it (M8), the open bore under Troy's (the shaft's first 10 m and its tube's top, M1), the INJECTOR
 * BAY plate and its three red lamps on the perforated wall over a maroon dado and a gold rail — and the lounge proper:
 * olive ribbed walls, a pale green wall with the side console and the standby board, red quilted loungers under the
 * south window band, the low red table with a siphon and a bottle, a plant.
 */
function lounge(rooms: Rooms, mats: ControlMaterials): THREE.Group {
  const kit = newKit(mats);
  const L = loungeMaterialsFor(mats);
  const { shell, props } = kit;
  const room = rooms.rooms.find((r) => r.id === 'lounge')!;
  const { min, max } = room;
  const F = min.y;
  const C = max.y;
  const top = C + WALL;
  const chair = rooms.chair;
  const P = LOUNGE_PROPS;
  let cap: THREE.Mesh | null = null;

  // The floor: terrazzo under the room and its walls, with the bore's round opening at the chair.
  {
    const shape = new THREE.Shape();
    const x0 = min.x - WALL;
    const x1 = max.x + WALL;
    const y0 = -(max.z + WALL); // shape y = −z (rotateX(−90°) takes the shape's +y to −z)
    const y1 = -(min.z - WALL);
    shape.moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).closePath();
    const hole = new THREE.Path().absarc(chair.pos.x, -chair.pos.z, BORE_RADIUS, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, 32).rotateX(-Math.PI / 2).translate(0, F, 0);
    shell.add(L.terrazzo, scaleUV(g, 0.5, 0.5));
    // Its underside, so the bore's rim has a floor slab's thickness.
    shell.add(L.boreDark, new THREE.CylinderGeometry(BORE_RADIUS, BORE_RADIUS, WALL, 32, 1, true).translate(chair.pos.x, F - WALL / 2, chair.pos.z));
  }

  // The ceiling: a slab, a light trough over the chairs, two round lights over the lounge.
  shell.add(mats.ceiling, block({ x: min.x - WALL, y: C, z: min.z - WALL }, { x: max.x + WALL, y: top, z: max.z + WALL }));
  shell.add(mats.light, ceilingPanel(-6.6, 1.2, chair.pos.z - 0.3, chair.pos.z + 0.3, C - 0.0005));
  shell.add(mats.frame, ceilingPanel(-6.7, 1.3, chair.pos.z - 0.4, chair.pos.z + 0.4, C - 0.0002));
  for (const x of [-5.2, -1.6]) {
    shell.add(mats.frame, new THREE.CircleGeometry(0.72, 32).rotateX(Math.PI / 2).translate(x, C - 0.0002, -1270.6));
    shell.add(mats.light, new THREE.CircleGeometry(0.6, 32).rotateX(Math.PI / 2).translate(x, C - 0.0005, -1270.6));
  }

  // The walls (T1's walls()): dressed per side.
  const jamb = 0.3;
  for (const w of walls(room, rooms.rooms)) {
    const alongZ = w.max.z - w.min.z > w.max.x - w.min.x;
    const isLintel = w.min.y > F + 1e-6;
    if (!alongZ && w.max.z <= min.z + 1e-6) {
      // North: the injector bay wall — maroon dado, T4's perforated grey above the gold rail.
      const rail = F + 2.4;
      shell.add(L.maroon, block({ x: w.min.x, y: F, z: w.min.z }, { x: w.max.x, y: rail, z: w.max.z }));
      shell.add(mats.meshWall, scaleUV(block({ x: w.min.x, y: rail, z: w.min.z }, { x: w.max.x, y: w.max.y, z: w.max.z }), w.max.x - w.min.x, w.max.y - rail));
    } else if (!alongZ) {
      // South: olive, the window band over the loungers.
      windowRun(kit, 'z', w.min.z, w.max.z, w.min.x, w.max.x, F, w.max.y, { sill: 1.3, head: 3.4, wall: L.olive });
    } else if (w.max.x <= min.x + 1e-6) {
      // West: pale green.
      shell.add(L.paleGreen, block(w.min, w.max));
    } else if (isLintel) {
      // East, over the doorway: the red lintel, signed to the control room.
      shell.add(mats.trim, block(w.min, w.max));
    } else {
      // East: olive, red jambs where it meets the doorway.
      const doorAt = (z: number) => rooms.rooms.some((o) => o.id === 'corridor' && Math.abs(o.min.z - z) < 1e-6 || o.id === 'corridor' && Math.abs(o.max.z - z) < 1e-6);
      let z0 = w.min.z;
      let z1 = w.max.z;
      if (doorAt(z1)) { shell.add(mats.trim, block({ x: w.min.x, y: w.min.y, z: z1 - jamb }, w.max)); z1 -= jamb; }
      if (doorAt(z0)) { shell.add(mats.trim, block(w.min, { x: w.max.x, y: w.max.y, z: z0 + jamb })); z0 += jamb; }
      shell.add(L.olive, scaleUV(block({ x: w.min.x, y: w.min.y, z: z0 }, { x: w.max.x, y: w.max.y, z: z1 }), z1 - z0, w.max.y - w.min.y));
    }
  }
  // The lintel's sign, and the WASP crest on the east wall.
  const door = rooms.rooms.find((o) => o.id === 'corridor' && o.min.x < max.x && o.max.x > max.x)!;
  shell.add(L.decals, loungeDecal('toControl', 1.6, 1.6 * (96 / 512), { x: max.x - 0.0005, y: (door.max.y + C) / 2, z: (door.min.z + door.max.z) / 2 }, 'x-'));
  shell.add(L.decals, loungeDecal('crest', 0.9, 0.9, { x: max.x - 0.0005, y: F + 2.3, z: -1275.4 }, 'x-'));
  // The west wall: the standby board over the side console.
  {
    const b = P.sideConsole;
    shell.add(L.decals, loungeDecal('standbyBoard', 1.7, 0.64, { x: min.x + 0.0005, y: F + 2.15, z: (b.min.z + b.max.z) / 2 }, 'x+'));
  }

  // The bore (M1: "a visible bore in the floor", the shaft's first SHAFT_OPEN_TOP metres): a lit throat with four
  // guide rails, flaring at its foot into the top of the shaft's SHAFT_RADIUS tube, closed (for now) by a dark cap.
  {
    const { x, z } = chair.pos;
    const inside = (g: THREE.BufferGeometry) => backFaces(g);
    shell.add(L.bore, inside(new THREE.CylinderGeometry(BORE_RADIUS, BORE_RADIUS, BORE_DEPTH, 32, 1, true).translate(x, F - BORE_DEPTH / 2, z)));
    for (let d = 1.5; d < BORE_DEPTH; d += 2) {
      shell.add(L.boreLight, inside(new THREE.CylinderGeometry(BORE_RADIUS - 0.012, BORE_RADIUS - 0.012, 0.09, 32, 1, true).translate(x, F - d, z)));
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const r = BORE_RADIUS - 0.03;
      shell.add(L.boreDark, boxAt(0.08, BORE_DEPTH, 0.06, { x: x + Math.cos(a) * r, y: F - BORE_DEPTH / 2, z: z + Math.sin(a) * r }, -a));
    }
    const flare = 1.2;
    shell.add(L.bore, inside(new THREE.CylinderGeometry(BORE_RADIUS, SHAFT_RADIUS, flare, 32, 1, true).translate(x, F - BORE_DEPTH - flare / 2, z)));
    const tubeTop = F - BORE_DEPTH - flare;
    shell.add(L.bore, inside(new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, TUBE_STUB, 32, 1, true).translate(x, tubeTop - TUBE_STUB / 2, z)));
    shell.add(L.boreLight, inside(new THREE.CylinderGeometry(SHAFT_RADIUS - 0.012, SHAFT_RADIUS - 0.012, 0.12, 32, 1, true).translate(x, tubeTop - 0.6, z)));
    // The stub's dark cap: its own mesh, so T7 can drop it when it draws the rest of the shaft.
    cap = new THREE.Mesh(new THREE.CircleGeometry(SHAFT_RADIUS, 32).rotateX(-Math.PI / 2).translate(x, tubeTop - TUBE_STUB, z), L.boreDark);
    cap.name = BORE_CAP_NAME;
    cap.userData.roomShell = true;
  }

  // The injector bay plinth (LOUNGE_PROPS.injectorBay): grey, the bore through it, a hazard band along its front, a
  // hazard ring round the bore and round each closed hatch, the hatches themselves.
  const seats = [chair.pos.x, chair.pos.x - 2.6, chair.pos.x - 5.2];
  {
    const b = P.injectorBay;
    const shape = new THREE.Shape();
    shape.moveTo(b.min.x, -b.max.z).lineTo(b.max.x, -b.max.z).lineTo(b.max.x, -b.min.z).lineTo(b.min.x, -b.min.z).closePath();
    shape.holes.push(new THREE.Path().absarc(chair.pos.x, -chair.pos.z, BORE_RADIUS, 0, Math.PI * 2, true));
    props.add(L.plinth, new THREE.ExtrudeGeometry(shape, { depth: PLINTH, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2).translate(0, F, 0));
    const y = F + PLINTH + 0.001;
    const band = new THREE.PlaneGeometry(b.max.x - b.min.x, 0.14).rotateX(-Math.PI / 2).translate((b.min.x + b.max.x) / 2, y, b.max.z - 0.07);
    props.add(L.hazard, scaleUV(band, (b.max.x - b.min.x) / 0.4, 0.35));
    seats.forEach((sx, k) => {
      const ring = new THREE.RingGeometry(BORE_RADIUS, BORE_RADIUS + 0.12, 40, 1).rotateX(-Math.PI / 2).translate(sx, y, chair.pos.z);
      props.add(L.hazard, scaleUV(ring, 6, 6));
      if (k > 0) props.add(L.decals, loungeDecal('hatch', BORE_RADIUS * 2.05, BORE_RADIUS * 2.05, { x: sx, y, z: chair.pos.z }, 'up'));
    });
  }

  // The chairs (M8): Troy's is its own object — the one that carries him (T7) — tagged for M5's prompt and glow;
  // Phones's and Marina's, identical, merge with the room.
  const yaw = chair.yaw + Math.PI; // the seat faces away from the way Troy walks up to it
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  for (const sx of seats.slice(1)) {
    addInjectorChair(props, L.chair, new THREE.Matrix4().compose(new THREE.Vector3(sx, F, chair.pos.z), turn, new THREE.Vector3(1, 1, 1)));
  }
  const troysChair = createInjectorChair(L.chair);
  troysChair.name = INJECTOR_CHAIR_NAME;
  troysChair.position.set(chair.pos.x, chair.pos.y, chair.pos.z);
  troysChair.rotation.y = yaw;
  troysChair.userData.interactable = 'chair';
  troysChair.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomProp = true; });

  // The INJECTOR BAY wall (LOUNGE_PROPS.bayWall): the gold rail, the yellow plate on its red lamp bar with a lamp over
  // each chair (ref, bay), the speaker grille above.
  {
    const b = P.bayWall;
    const wz = b.min.z;
    props.add(mats.gold, block({ x: b.min.x, y: F + 2.38, z: wz }, { x: b.max.x, y: F + 2.46, z: wz + 0.06 }));
    const x0 = seats[2]! - 0.7;
    const x1 = seats[0]! + 0.7;
    const mid = (x0 + x1) / 2;
    props.add(mats.trim, block({ x: x0, y: F + 2.62, z: wz }, { x: x1, y: F + 3.12, z: wz + 0.1 }));
    props.add(mats.bodyDark, block({ x: x0 + 0.3, y: F + 3.12, z: wz }, { x: x1 - 0.3, y: F + 3.5, z: wz + 0.04 }));
    props.add(L.decals, loungeDecal('injectorBay', x1 - x0 - 0.7, 0.34, { x: mid, y: F + 3.31, z: wz + 0.041 }, 'z+'));
    for (const sx of seats) {
      props.add(mats.gold, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24).rotateX(Math.PI / 2).translate(sx, F + 2.87, wz + 0.125));
      props.add(L.lampRed, new THREE.SphereGeometry(0.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(sx, F + 2.87, wz + 0.13));
    }
    props.add(L.decals, loungeDecal('grille', 0.6, 0.6, { x: mid, y: F + 3.62, z: wz + 0.01 }, 'z+'));
  }

  // The side console on the west wall (LOUNGE_PROPS.sideConsole): T4's console bank, facing into the room.
  {
    const b = P.sideConsole;
    consoleBank(kit, {
      length: b.max.z - b.min.z - 0.04, depth: b.max.x - b.min.x - 0.04, height: b.max.y - F - 0.12, front: 0.78,
      at: { x: (b.min.x + b.max.x) / 2, y: F, z: (b.min.z + b.max.z) / 2 }, yaw: Math.PI / 2,
      fields: ['lamps', 'switches', 'knobs', 'switches'],
    });
  }

  // The loungers (ref, lounge): red quilted seat and back in a gold frame, against the south wall, facing north.
  for (const b of [P.loungerWest, P.loungerEast]) lounger(props, L, mats, b);

  // The table (ref, lounge): white foot, chrome stem, a red top in a gold rim; a soda siphon and a bottle on it.
  {
    const b = P.table;
    const tx = (b.min.x + b.max.x) / 2;
    const tz = (b.min.z + b.max.z) / 2;
    const r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2 - 0.02;
    props.add(L.white, new THREE.CylinderGeometry(0.28, 0.36, 0.08, 24).translate(tx, F + 0.04, tz));
    props.add(mats.frame, rodY(tx, tz, F + 0.08, F + 0.5, 0.045));
    props.add(mats.gold, new THREE.CylinderGeometry(r, r - 0.02, 0.05, 36).translate(tx, F + 0.53, tz));
    props.add(L.tableTop, new THREE.CylinderGeometry(r - 0.04, r - 0.04, 0.02, 36).translate(tx, F + 0.56, tz));
    props.add(L.bottle, new THREE.CylinderGeometry(0.05, 0.05, 0.26, 16).translate(tx - 0.2, F + 0.7, tz + 0.1));
    props.add(mats.frame, new THREE.CylinderGeometry(0.03, 0.05, 0.08, 12).translate(tx - 0.2, F + 0.87, tz + 0.1));
    props.add(L.amber, block({ x: tx + 0.05, y: F + 0.57, z: tz - 0.15 }, { x: tx + 0.19, y: F + 0.79, z: tz - 0.05 }));
    props.add(L.amber, new THREE.CylinderGeometry(0.02, 0.03, 0.08, 10).translate(tx + 0.12, F + 0.83, tz - 0.1));
  }

  // The plant (ref, lounge): a white tub and broad leaves on long stems.
  {
    const b = P.plant;
    const px = (b.min.x + b.max.x) / 2;
    const pz = (b.min.z + b.max.z) / 2;
    const reachX = (b.max.x - b.min.x) / 2 - 0.04;
    const reachZ = (b.max.z - b.min.z) / 2 - 0.04;
    props.add(L.white, new THREE.CylinderGeometry(0.34, 0.28, 0.5, 24).translate(px, F + 0.25, pz));
    props.add(L.soil, new THREE.CylinderGeometry(0.31, 0.31, 0.02, 24).translate(px, F + 0.48, pz));
    const rand = mulberry32(0x91a7);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + rand() * 0.4;
      const reach = 0.55 + rand() * 0.35; // of the box's half-extent
      const tip = { x: px + Math.cos(a) * reachX * reach, y: F + 1.3 + rand() * 0.8, z: pz + Math.sin(a) * reachZ * reach };
      const base = { x: px + (tip.x - px) * 0.35, y: tip.y - 0.55, z: pz + (tip.z - pz) * 0.35 };
      props.add(L.leaf, rod({ x: px, y: F + 0.48, z: pz }, base, 0.012, 0.01, 5));
      // The leaf: a flattened ellipsoid from base to tip.
      const len = Math.hypot(tip.x - base.x, tip.y - base.y, tip.z - base.z);
      const leaf = new THREE.SphereGeometry(0.5, 10, 6).scale(0.16, len, 0.02).translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(tip.x - base.x, tip.y - base.y, tip.z - base.z).normalize());
      const twist = new THREE.Quaternion().setFromAxisAngle(UP, a);
      leaf.applyQuaternion(twist).applyQuaternion(q).translate(base.x, base.y, base.z);
      props.add(L.leaf, leaf);
    }
  }

  const group = buildKit(kit, 'lounge');
  group.add(troysChair);
  if (cap) group.add(cap);
  return group;
}

/** The name of Troy's injector chair object in the rooms group (T7 finds it by this name to re-parent it). */
export const INJECTOR_CHAIR_NAME = 'injector-chair';

/** A quilted lounger in its props box, its back to the box's +z side (the south wall), facing −z. */
function lounger(props: Parts, L: LoungeMaterials, mats: ControlMaterials, b: Box): void {
  const F = b.min.y;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const half = (b.max.x - b.min.x) / 2;
  const d = (b.max.z - b.min.z) / 2; // local z −d (front) … +d (back)
  const at = (g: THREE.BufferGeometry) => g.translate(cx, F, cz);
  // The gold side frames: a seat line sweeping up into the back, on a curved runner.
  const frame = new THREE.Shape();
  frame.moveTo(-d + 0.02, 0.02);
  frame.quadraticCurveTo(-d + 0.1, 0.45, -d + 0.2, 0.46);
  frame.lineTo(d - 0.35, 0.42);
  frame.quadraticCurveTo(d - 0.12, 0.5, d - 0.04, 1.04);
  frame.lineTo(d - 0.01, 1.04);
  frame.quadraticCurveTo(d - 0.06, 0.4, d - 0.02, 0.02);
  frame.closePath();
  for (const side of [-1, 1]) {
    // Shape (u, v) → (z = u, y = v), turned −90° about Y; 0.06 thick along −x.
    const g = new THREE.ExtrudeGeometry(frame, { depth: 0.06, bevelEnabled: false, curveSegments: 10 }).rotateY(-Math.PI / 2);
    props.add(mats.gold, at(g.translate(side > 0 ? half - 0.01 : -half + 0.07, 0, 0)));
  }
  // The cushion, the tilted back, a gold runner along the floor.
  const w = 2 * half - 0.16;
  props.add(L.quilt, at(scaleUV(boxAt(w, 0.16, 2 * d - 0.5, { x: 0, y: 0.38, z: -0.06 }), w / 0.24, 1)));
  const back = boxAt(w, 0.68, 0.14, { x: 0, y: 0.34, z: 0 });
  back.rotateX(-0.32).translate(0, 0.42, d - 0.24);
  props.add(L.quilt, at(scaleUV(back, w / 0.24, 0.68 / 0.24)));
  props.add(mats.gold, at(boxAt(2 * half - 0.04, 0.04, 0.08, { x: 0, y: 0.02, z: -d + 0.12 })), at(boxAt(2 * half - 0.04, 0.04, 0.08, { x: 0, y: 0.02, z: d - 0.1 })));
}
