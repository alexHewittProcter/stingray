import * as THREE from 'three';
import {
  CONTROL_ROOM_PROPS, DAIS_HEIGHT, FLOOR_Y, SHAFT_OPEN_TOP, SHAFT_RADIUS, STATION_CHAIRS, TOWER_AXIS, type Box, type Room,
  type Rooms,
} from '../sim/rooms';
import { controlFloorTexture, decalAtlas, decalUV, meshWallTexture, type DecalName } from './control-room-textures';
import { inRooms } from './indoors';
import { CHAIR_POLE_TOP_Y, CHAIR_POLE_Z, type InjectorChairMaterials, addInjectorChair, createInjectorChair } from './injector-chair';
import { Parts, box as boxAt } from './parts';
import {
  STATION_DECALS, STATION_MAROON, type StationDecal, hazardTexture, stationDecalAtlas, stationDecalUV,
} from './station-textures';

// Troy's rooms (phase 3; phase 4 D2: the control room alone, the injector station at its centre). M1 art: T4 dresses
// the control room after 02_MARINEVILLE_CONTROL_ROOM/ and 05_ART_DIRECTION "Marineville / WASP" — bright graphic 1960s
// miniature futurism: angular grey consoles with chunky red, yellow, green and blue switches, blue knob fields,
// visible labels; cream walls, the big wall map with its tracking line, the World Videophone's sunburst on a perforated
// grey wall, the locator compass on a green wall, Commander Shore's desk and hover chair, and the window band over
// Marineville and the sea. Phase 4 (T1): the corridor and the Standby Lounge are gone; the station — a dais, three
// injector chairs (M8, render/injector-chair.ts), the maroon back panel, and the open bore under Troy's chair (the
// shaft's first SHAFT_OPEN_TOP metres) — stands at the room's centre, greyboxed here and dressed by T2.
//
// M1 "art respects colliders" (Global constraints): every rooms mesh is tagged — `roomShell` (walls, windows,
// floor, ceiling: drawn on or outside the room boxes) or `roomProp` (furniture: drawn inside a sim/rooms.ts props box)
// — and render/rooms.test.ts checks both, as interior.test.ts and landmarks.test.ts do for phase 2.
//
// Draw calls: pieces are merged per material (parts.ts), the switches and the knobs/lamps are two instanced meshes,
// and every flat painted thing is in one decal atlas — about 30 calls for the dressed room.
//
// Global constraints (indoors switches): the group is outside main.ts's oceanSide root and drawn only while the camera
// is in the rooms (indoors.ts inRooms) or down the shaft, so the tower, the grounds and the sea stay in view through the
// windows (the gallery's glazing is single-sided — opaque from the sea, open from inside). The one lamp lives outside
// the group and only dims, so the scene's light count — and with it every compiled program — never changes.

const WALL = 0.2; // m — walls, floors and ceilings are this thick, drawn outside the room boxes
const SILL_DEFAULT = 1.0; // m — the control room's windows run from here …
const HEAD_DEFAULT = 3.6; // … to here above the floor
const LAMP_INTENSITY = 60;

export interface RoomsView {
  /** The rooms' meshes; visible only while the camera is in the rooms. */
  readonly group: THREE.Group;
  /** The rooms' lamp (outside the group, so it never leaves the scene). */
  readonly lamp: THREE.PointLight;
  /**
   * Once per drawn frame. `shaft` (T7): the camera is down the injector shaft's bore or tube — the rooms stay drawn
   * (the bore's throat and the room above it are theirs) and the lamp stays in the room. `dt` (s) eases the bore's
   * lid (phase 4 T2); left out, the view reads its own wall clock between calls.
   */
  update(camera: THREE.Camera, shaft?: boolean, dt?: number): void;
  /** The bore's lid as drawn, 0 shut … 1 open (phase 4 T2; for tests and T3). */
  lid(): number;
}

export function createRooms(rooms: Rooms): RoomsView {
  const group = new THREE.Group();
  group.name = 'rooms';
  const glass = new THREE.MeshBasicMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.12, depthWrite: false });
  const mats = controlMaterials(glass);

  // The control room, dressed (T4), and the injector station at its centre (phase 4, D2 — dressed, T2).
  const control = rooms.rooms.find((r) => r.id === 'controlRoom');
  if (control) group.add(controlRoom(control, rooms, mats));
  const dais = station(rooms, mats);
  group.add(dais.group);
  let lastClock: number | null = null;

  const lamp = new THREE.PointLight(0xfff3df, 0, 30, 2);
  lamp.name = 'rooms-lamp';
  const room = new THREE.Vector3();

  return {
    group,
    lamp,
    lid: dais.lid,
    update(camera, shaft = false, dt) {
      // The lid follows Troy's chair whether or not the rooms are drawn (it must be shut when the camera comes back).
      const now = performance.now();
      const step = dt ?? (lastClock === null ? 0 : Math.min(0.1, (now - lastClock) / 1000));
      lastClock = now;
      dais.update(step);
      const inside = inRooms(camera.position) || shaft;
      group.visible = inside;
      lamp.intensity = inside ? LAMP_INTENSITY : 0;
      if (!inside) return;
      // The lamp hangs under the ceiling of whichever room the camera is in (the control room, from the shaft).
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
function controlRoom(room: Room, rooms: Rooms, mats: ControlMaterials): THREE.Group {
  const kit = newKit(mats);
  controlShell(kit, room, rooms.chair.pos);
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

function controlShell(kit: Kit, room: Room, bore: V3): void {
  const { shell, mats } = kit;
  const { min, max } = room;
  const F = min.y;
  const C = max.y;
  const top = C + WALL;
  const ax = (min.x + max.x) / 2;
  const az = (min.z + max.z) / 2;

  // The floor: one plane over the room (and under the walls), its painted tiles spanning the room, with the bore's
  // round opening under Troy's chair (phase 4, D1 — the station's dais stands over it, render: station()).
  {
    const x0 = min.x - WALL;
    const x1 = max.x + WALL;
    const z0 = min.z - WALL;
    const z1 = max.z + WALL;
    const shape = new THREE.Shape();
    shape.moveTo(x0, -z1).lineTo(x1, -z1).lineTo(x1, -z0).lineTo(x0, -z0).closePath(); // shape y = −z
    shape.holes.push(new THREE.Path().absarc(bore.x, -bore.z, BORE_RADIUS, 0, Math.PI * 2, true));
    const floor = new THREE.ShapeGeometry(shape, 32).rotateX(-Math.PI / 2).translate(0, F, 0);
    // UVs 0…1 across the room, as the plane's were, so the painted tiles span it.
    const pos = floor.attributes.position as THREE.BufferAttribute;
    const uv = floor.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (pos.getX(k) - x0) / (x1 - x0), (z1 - pos.getZ(k)) / (z1 - z0));
    shell.add(mats.floor, floor);
  }

  // North wall (−z): cream and solid (phase 4: the corridor's doorway is gone).
  shell.add(mats.wall, slab({ x: min.x - WALL, y: F, z: min.z - WALL }, { x: max.x + WALL, y: top, z: min.z }));

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
  // tower — a ring of white posts at the glazing's radius.
  const radius = 13.3;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    shell.add(mats.frame, boxAt(0.18, 4.4, 0.18, { x: ax + Math.cos(a) * radius, y: F + 2.1, z: az + Math.sin(a) * radius }, -a));
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

  // The main console bank at the back of the room (phase 4, D2: behind the station), its panels facing south.
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
    const AX = TOWER_AXIS.x;
    const cx = AX - 3.0; // sim/interactables.ts's wallMap stands under this
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
    const sx = AX + 1.75;
    const sy = F + 2.5;
    props.add(mats.frame, new THREE.CylinderGeometry(0.62, 0.62, 0.08, 40).rotateX(Math.PI / 2).translate(sx, sy, wz + 0.04));
    props.add(mats.decals, decal('actionScreen', 1.1, 1.1, { x: sx, y: sy, z: wz + 0.081 }, 'z+', true));
    props.add(mats.decals, decal('actionSign', 1.3, 1.3 * (96 / 512), { x: sx, y: sy + 0.9, z: wz + 0.01 }, 'z+'));
    props.add(mats.trim, slab({ x: AX + 0.55, y: F + 2.0, z: wz }, { x: AX + 0.9, y: F + 3.0, z: wz + 0.05 }));
    for (const [y, c] of [[2.8, 0xf2efe6], [2.6, 0xf2efe6], [2.35, 0xf2c23a], [2.15, 0xf2efe6]] as const) knob(AX + 0.725, F + y, wz + 0.07, 'z', 0.05, 0.04, c);
    // The extinguisher on its bracket, and the FIRE sign over it.
    const ex = AX - 7.05;
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

  // Commander Shore's desk on the room's west side, facing north into the room, and his green hover chair (ref 1).
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

// ---- The injector station (phase 4, D2; T2 dressed) ----

/** A box from min/max. */
const block = slab;

/**
 * The bore's radius at the control room's floor (D1: 1.2 m, shared with the ride camera's wall radius,
 * render/ride-camera.ts radiusAt). The station's dais (sim/rooms.ts DAIS_FRONT_Z) is sized so the bore stays inside it.
 */
export const BORE_RADIUS = 1.2;
/** How far down the drawn bore runs before it opens into the shaft's tube (sim/rooms.ts SHAFT_OPEN_TOP). */
const BORE_DEPTH = SHAFT_OPEN_TOP;
/** The bore's flare from BORE_RADIUS out to the tube's SHAFT_RADIUS, below its throat. */
export const BORE_FLARE = 1.2;
/** The drawn top of the shaft's tube: SHAFT_RADIUS wide, from the bore's flare down this far; render/shaft.ts (T7)
 * continues it from there (TUBE_TOP_Y). */
export const TUBE_STUB = 2;
/** Where the room's drawn stub of the tube ends (the throat, its flare and the stub) and render/shaft.ts's tube begins. */
export const TUBE_TOP_Y = FLOOR_Y - SHAFT_OPEN_TOP - BORE_FLARE - TUBE_STUB;

/**
 * The bore's lid (phase 4 T2 — T1's hand-off: the 1.2 m bore and the chairs 1.2 m apart overlap, so Phones's chair
 * would overhang an open hole; the founder's caption "this goes down a tunnel that opens"): two half-disc leaves flush
 * with the dais top, hinged at the bore's east and west rims, that swing down into the bore. Shut whenever nobody is
 * riding — so Phones's and Marina's chairs stand over a closed floor — they open as Troy's chair sets off, shut once it
 * is below the tube's top (TUBE_TOP_Y), and the reverse on the way up. Render-side only: lidWanted(riding, chair y).
 */
export const LID_SECONDS = 0.5;
/** How far the leaves swing down, fully open (rad): hanging plumb, just outside the bore's wall. */
const LID_SWING = Math.PI / 2;
/** The leaves' thickness. */
const LID_THICKNESS = 0.03;
/** The leaves' radius: inside the bore's, the lit ring between (and, open, they hang just inside the throat's wall). */
const LID_RADIUS = BORE_RADIUS - 0.08;

/** D2/T2: the bore's lid is open while the chair is riding above the tube's top (render-side; no sim state). */
export function lidWanted(riding: boolean, chairY: number): boolean {
  return riding && chairY > TUBE_TOP_Y;
}

/** The station's sleeve for each chair's pole: hangs from a ceiling boss, overlapping the pole's top by this much. */
const SLEEVE_OVERLAP = 0.12;
const SLEEVE_RADIUS = 0.085;

function stationMaterials(mats: ControlMaterials) {
  const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const hazard = hazardTexture();
  const atlas = stationDecalAtlas();
  return {
    maroon: lambert(STATION_MAROON),
    hazard: lambert(hazard ? 0xffffff : 0xe9b52c, { map: hazard }),
    decals: new THREE.MeshLambertMaterial({
      color: atlas ? 0xffffff : 0x8a8f94, map: atlas, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
    bore: lambert(0x5d666e, { emissive: 0x14171a }),
    boreDark: lambert(0x1c2024),
    boreLight: new THREE.MeshBasicMaterial({ color: 0xf6f0d8 }),
    chair: {
      upholstery: lambert(0x5b6f8f), frame: mats.frame, pad: mats.trim, dark: mats.bodyDark, body: mats.panel,
    } satisfies InjectorChairMaterials,
  };
}
type StationMaterials = ReturnType<typeof stationMaterials>;

let stationMats: { control: ControlMaterials; station: StationMaterials } | null = null;
/** One set of station materials per control-materials set. */
function stationMaterialsFor(mats: ControlMaterials): StationMaterials {
  if (stationMats?.control !== mats) stationMats = { control: mats, station: stationMaterials(mats) };
  return stationMats.station;
}

/** Remap a geometry's UVs from its x/z position over a square of half-size r about (cx, cz) into a station decal. */
function stationDecalByXZ(g: THREE.BufferGeometry, name: StationDecal, cx: number, cz: number, r: number): THREE.BufferGeometry {
  const [u0, v0, u1, v1] = stationDecalUV(name);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    uv.setXY(k, u0 + ((pos.getX(k) - cx) / r + 1) / 2 * (u1 - u0), v0 + ((cz - pos.getZ(k)) / r + 1) / 2 * (v1 - v0));
  }
  return g;
}

/** A flat station decal of size w × h, centred at c, facing south (+z) — or a disc of diameter w when round. */
function stationDecal(name: StationDecal, w: number, h: number, c: V3, round = false): THREE.BufferGeometry {
  const g = round ? new THREE.CircleGeometry(w / 2, 40) : new THREE.PlaneGeometry(w, h);
  const [u0, v0, u1, v1] = stationDecalUV(name);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  return g.translate(c.x, c.y, c.z);
}

interface StationView {
  group: THREE.Group;
  /** Once per drawn frame: the lid follows the chair (lidWanted), eased over LID_SECONDS. */
  update(dt: number): void;
  /** The lid as drawn, 0 shut … 1 open (for tests). */
  lid(): number;
}

/**
 * The injector station (D2): the dais (CONTROL_ROOM_PROPS.station) — a low grey slab with a silver edge trim, a hazard
 * band along its front, the "INJECTOR STATION" plate low on its front face, the bore through it under Troy's chair with
 * a lit ring round its rim and its two-leaf lid; the three chairs on their poles facing the windows (south), each pole
 * running on up into a sleeve under a ceiling boss — Troy's chair its own object (M8), the one that carries him,
 * Phones's and Marina's merged with the room; behind the row the series' bay wall (TV_injector_bay_clean_01,
 * troy-in-injector-chair-on-pole.png): maroon below a thin gold rail, a perforated silver band above it with the round
 * mesh grille. Below the floor, the open bore (D1: the shaft's first SHAFT_OPEN_TOP metres) — a lit throat flaring at
 * its foot into the top of the shaft's SHAFT_RADIUS tube, which render/shaft.ts continues. No lights: the ring and the
 * throat's bands are self-lit materials.
 */
function station(rooms: Rooms, mats: ControlMaterials): StationView {
  const kit = newKit(mats);
  const S = stationMaterialsFor(mats);
  const { shell, props } = kit;
  const P = CONTROL_ROOM_PROPS;
  const chair = rooms.chair;
  const F = chair.pos.y;
  const b = P.station;
  const top = F + DAIS_HEIGHT - 0.004; // the slab's top: the band, ring and plate sit just on it, inside the collider
  const midX = (b.min.x + b.max.x) / 2;

  // The dais: a mid-grey slab (the consoles' panel grey, so the trim and the lit ring read against it), inset a little inside its collider so the trim can stand on the collider's faces, with the
  // bore's round hole under Troy's chair.
  {
    const i = 0.005;
    const shape = new THREE.Shape();
    shape.moveTo(b.min.x + i, -b.max.z + i).lineTo(b.max.x - i, -b.max.z + i).lineTo(b.max.x - i, -b.min.z - i).lineTo(b.min.x + i, -b.min.z - i).closePath();
    shape.holes.push(new THREE.Path().absarc(chair.pos.x, -chair.pos.z, BORE_RADIUS, 0, Math.PI * 2, true));
    props.add(mats.panel, new THREE.ExtrudeGeometry(shape, { depth: top - F, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2).translate(0, F, 0));
    // The silver edge trim on all four sides, from the floor to just under the collider's top.
    const t = 0.04;
    const h = DAIS_HEIGHT - 0.001;
    props.add(mats.frame,
      block({ x: b.min.x, y: F, z: b.max.z - t }, { x: b.max.x, y: F + h, z: b.max.z }),
      block({ x: b.min.x, y: F, z: b.min.z }, { x: b.max.x, y: F + h, z: b.min.z + t }),
      block({ x: b.min.x, y: F, z: b.min.z + t }, { x: b.min.x + t, y: F + h, z: b.max.z - t }),
      block({ x: b.max.x - t, y: F, z: b.min.z + t }, { x: b.max.x, y: F + h, z: b.max.z - t }));
    // The hazard band along the front, just inside the trim.
    const band = new THREE.PlaneGeometry(b.max.x - b.min.x - 2 * t, 0.14).rotateX(-Math.PI / 2)
      .translate(midX, top + 0.001, b.max.z - t - 0.07);
    scaleUV(band, (b.max.x - b.min.x) / 0.4, 0.35);
    props.add(S.hazard, band);
    // The plate, low on the front face: INJECTOR STATION (D2), yellow on the silver trim.
    const plateH = 0.07;
    const [, , pw, ph] = STATION_DECALS.stationPlate;
    props.add(S.decals, stationDecal('stationPlate', (plateH * pw) / ph, plateH, { x: midX, y: F + DAIS_HEIGHT / 2, z: b.max.z }));
    // The lit ring round the bore's rim, inside it, framing the lid (self-lit: no new light). Inside, because the
    // bore's rim meets the dais's front edge (sim/rooms.ts DAIS_FRONT_Z).
    props.add(S.boreLight, new THREE.RingGeometry(LID_RADIUS + 0.004, BORE_RADIUS, 64).rotateX(-Math.PI / 2).translate(chair.pos.x, top + 0.001, chair.pos.z));
  }

  // The bay wall behind the row: maroon below a thin gold rail, a perforated silver band above, the mesh grille on it.
  {
    const w = P.stationPanel;
    const railY = F + 1.9;
    const front = w.max.z - 0.04; // the wall's face, the rail standing proud of it inside the collider
    props.add(S.maroon, block({ x: w.min.x + 0.01, y: F, z: w.min.z + 0.01 }, { x: w.max.x - 0.01, y: railY - 0.03, z: front }));
    props.add(mats.meshWall, scaleUV(block({ x: w.min.x + 0.01, y: railY + 0.03, z: w.min.z + 0.01 }, { x: w.max.x - 0.01, y: w.max.y - 0.01, z: front }), 4, 0.7));
    props.add(mats.bodyDark, block({ x: w.min.x + 0.01, y: railY - 0.03, z: w.min.z + 0.01 }, { x: w.max.x - 0.01, y: railY + 0.03, z: front - 0.005 }));
    props.add(mats.gold, rodX(w.min.x + 0.02, w.max.x - 0.02, railY, w.max.z - 0.02, 0.018));
    props.add(S.decals, stationDecal('grille', 0.5, 0.5, { x: midX, y: (railY + w.max.y) / 2, z: front }, true));
  }

  // The bore (D1): the lit throat through the floor slab, a guide rail at each quarter, the flare and the tube's stub.
  {
    const { x, z } = chair.pos;
    const inside = (g: THREE.BufferGeometry) => backFaces(g);
    shell.add(S.bore, inside(new THREE.CylinderGeometry(BORE_RADIUS, BORE_RADIUS, BORE_DEPTH, 40, 1, true).translate(x, F - BORE_DEPTH / 2, z)));
    // A lit band just under the rim, then one every 2 m down the throat.
    for (let d = 0.12; d < BORE_DEPTH; d += 2) {
      shell.add(S.boreLight, inside(new THREE.CylinderGeometry(BORE_RADIUS - 0.012, BORE_RADIUS - 0.012, 0.09, 40, 1, true).translate(x, F - d, z)));
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const r = BORE_RADIUS - 0.03;
      shell.add(S.boreDark, boxAt(0.08, BORE_DEPTH, 0.06, { x: x + Math.cos(a) * r, y: F - BORE_DEPTH / 2, z: z + Math.sin(a) * r }, -a));
    }
    shell.add(S.bore, inside(new THREE.CylinderGeometry(BORE_RADIUS, SHAFT_RADIUS, BORE_FLARE, 40, 1, true).translate(x, F - BORE_DEPTH - BORE_FLARE / 2, z)));
    shell.add(S.bore, inside(new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, TUBE_STUB, 40, 1, true).translate(x, TUBE_TOP_Y + TUBE_STUB / 2, z)));
    shell.add(S.boreLight, inside(new THREE.CylinderGeometry(SHAFT_RADIUS - 0.012, SHAFT_RADIUS - 0.012, 0.12, 40, 1, true).translate(x, TUBE_TOP_Y + TUBE_STUB - 0.6, z)));
  }

  // The chairs (M8), on their poles, facing the windows: Troy's is its own object — the one that carries him (T7) —
  // tagged for M5's prompt and glow; Phones's and Marina's, identical, merge with the room. Each pole runs on up into a
  // sleeve hanging from a boss on the ceiling; the sleeves stay when Troy's chair drops (its pole slides out).
  const yaw = chair.yaw + Math.PI; // the seat faces away from the way Troy walks up to it
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const ceiling = rooms.rooms[0]!.max.y;
  for (const c of [STATION_CHAIRS.troy, STATION_CHAIRS.phones, STATION_CHAIRS.marina]) {
    if (c !== STATION_CHAIRS.troy) {
      addInjectorChair(props, S.chair, new THREE.Matrix4().compose(new THREE.Vector3(c.x, F, c.z), turn, new THREE.Vector3(1, 1, 1)));
    }
    const pole = new THREE.Vector3(0, 0, CHAIR_POLE_Z).applyQuaternion(turn).add(new THREE.Vector3(c.x, 0, c.z));
    props.add(mats.frame, rodY(pole.x, pole.z, F + CHAIR_POLE_TOP_Y - SLEEVE_OVERLAP, ceiling - 0.06, SLEEVE_RADIUS));
    props.add(mats.bodyDark,
      rodY(pole.x, pole.z, F + CHAIR_POLE_TOP_Y - SLEEVE_OVERLAP - 0.03, F + CHAIR_POLE_TOP_Y - SLEEVE_OVERLAP + 0.05, SLEEVE_RADIUS + 0.025),
      rodY(pole.x, pole.z, ceiling - 0.06, ceiling, 0.11));
  }
  const troysChair = createInjectorChair(S.chair);
  troysChair.name = INJECTOR_CHAIR_NAME;
  troysChair.position.set(chair.pos.x, chair.pos.y, chair.pos.z);
  troysChair.rotation.y = yaw;
  troysChair.userData.interactable = 'chair';
  troysChair.traverse((o) => { if (o instanceof THREE.Mesh) o.userData.roomProp = true; });

  const group = buildKit(kit, 'station');
  group.add(troysChair);

  // The lid: two half-disc leaves in the bore's hole, their tops just under the dais's, hinged at the rim (west and
  // east) and swinging down into the bore — the hatch decal across both. Each leaf is its own mesh (they move).
  const R = LID_RADIUS;
  const lidTop = top - 0.002;
  const leaves = ([-1, 1] as const).map((side) => {
    // side −1: the west leaf (x < the bore's centre), hinged at the west rim; +1 the east.
    const shape = new THREE.Shape();
    if (side < 0) shape.moveTo(0, R).absarc(0, 0, R, Math.PI / 2, (3 * Math.PI) / 2, false).lineTo(0, R);
    else shape.moveTo(0, -R).absarc(0, 0, R, -Math.PI / 2, Math.PI / 2, false).lineTo(0, -R);
    const g = new THREE.ExtrudeGeometry(shape, { depth: LID_THICKNESS, bevelEnabled: false, curveSegments: 24 })
      .rotateX(-Math.PI / 2).translate(0, -LID_THICKNESS, 0);
    stationDecalByXZ(g, 'hatch', 0, 0, R);
    g.translate(-side * R, 0, 0); // into the hinge's frame: the hinge line (along z) at the leaf's outer rim
    const mesh = new THREE.Mesh(g, S.decals);
    mesh.name = side < 0 ? 'bore-lid-west' : 'bore-lid-east';
    mesh.userData.roomProp = true;
    const hinge = new THREE.Group();
    hinge.name = `${mesh.name}-hinge`;
    hinge.position.set(chair.pos.x + side * R, lidTop, chair.pos.z);
    hinge.add(mesh);
    group.add(hinge);
    return { hinge, side };
  });

  let open = 0; // 0 shut … 1 open, linear in time; drawn eased
  const setLid = () => {
    const swing = LID_SWING * open * open * (3 - 2 * open);
    // West leaf (hinge at its −x rim): its +x side swings down — rotation −θ about z; the east leaf the mirror.
    for (const { hinge, side } of leaves) hinge.rotation.z = side < 0 ? -swing : swing;
  };
  setLid();
  const at = new THREE.Vector3();
  return {
    group,
    update(dt) {
      const riding = troysChair.parent !== group;
      const want = lidWanted(riding, troysChair.getWorldPosition(at).y) ? 1 : 0;
      open += Math.sign(want - open) * Math.min(Math.abs(want - open), Math.max(0, dt) / LID_SECONDS);
      setLid();
    },
    lid: () => open,
  };
}

/** A round rod along x from x0 to x1 at (y, z). */
function rodX(x0: number, x1: number, y: number, z: number, r: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, x1 - x0, 12).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z);
}

/** The name of Troy's injector chair object in the rooms group (T7 finds it by this name to re-parent it). */
export const INJECTOR_CHAIR_NAME = 'injector-chair';
