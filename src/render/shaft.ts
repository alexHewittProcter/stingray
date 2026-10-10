import * as THREE from 'three';
import type { Interior } from '../sim/world';
import { FLOOR_Y, type Rooms, SHAFT_RADIUS } from '../sim/rooms';
import type { Vec3 } from '../sim/vec3';
import { type Boarding, PORT_Y, smooth } from './boarding';
import { TUBE_TOP_Y } from './rooms';

// The injector shaft (phase 3, M1 "The shaft", T7; phase 4, D1): the closed tube the chair rides straight down, from
// the control room's bore (render/rooms.ts — the open throat, its flare and a 2 m stub of the tube) through the tower's
// drum and stalk and the 5 m of rock to Pen 3's hall ceiling, plumb over Troy's seat.
//
//   - The tube: radius SHAFT_RADIUS, continuing the bore's stub from TUBE_TOP_Y straight down to ANNULUS_TOP_Y, just
//     above the hall's ceiling, where its foot closes down in an annulus (a short cone, SHAFT_RADIUS → PORT_RADIUS
//     over ANNULUS_HEIGHT, inside the rock) to Troy's port (phase 4, D3).
//   - The ports (D3, T3): two round openings in the pen hall's ceiling — Troy's, PORT_RADIUS at (SEAT.x, pen.max.y,
//     SEAT.z), with a two-leaf lid that swings up into the annulus (render/boarding.ts says when); Phones's, a dummy,
//     DUMMY_PORT_RADIUS, PORT_SPACING west, drawn shut. Each has a short collar under the ceiling (COLLAR_DEPTH), a
//     flange on the ceiling round it and a lit ring at its lip. The ceiling itself is cut open at Troy's
//     (render/pen.ts, from portsOf).
//   - The pole (D3): the long chrome one, drawn from inside Troy's port down to the riding chair's pole top, or aboard
//     down to the chair's head bar in the open hatch, retracting up into the port (ShaftView.update).
//   - Lighting (M6: the ride is lit by nothing in the scene): every surface is self-lit — the walls a basic material
//     whose vertex colours brighten toward light rings every RING_SPACING metres, the rings themselves bright bands.
//     No new scene light: the light count stays constant as T1/T4/T5 kept it.
//   - Visibility: the group is drawn while the camera is in the rooms (looking down the bore), in the shaft or in the
//     pen hall (inShaft / main.ts), and hidden at sea.
//
// The drop below the ceiling (≈ 11 m of open hall down to the seat) is the pole and nothing else: the chair hangs on it
// in the hall, as the series' does.

/** Where the room's drawn stub of the tube ends (render/rooms.ts: the throat, its flare and the stub; defined there). */
export { TUBE_TOP_Y };
/** Light rings along the tube, every so many metres. */
const RING_SPACING = 6;
/** Wall rings along the tube (for the vertex-colour light falloff), every so many metres. */
const WALL_STEP = 0.75;
const AROUND = 40;

/** D3: Troy's port in the hall's ceiling — "radius 0.8 m … directly over his hatch". */
export const PORT_RADIUS = 0.8;
/** D3: Phones's port, a dummy drawn shut. */
export const DUMMY_PORT_RADIUS = 0.5;
/** D3: Phones's port is 1.6 m west of Troy's (they do not overlap: 0.8 + 0.5 < 1.6). */
export const PORT_SPACING = 1.6;
/** D3: "a short collar (≤ 0.6 m)" under the ceiling round each port; its lip carries the lit ring and the lid. */
export const COLLAR_DEPTH = 0.45;
/** The flange round each port on the ceiling: this much wider than the port (it covers the ceiling's cut edge). */
const FLANGE_WIDTH = 0.32;
/** D1/D3: the tube's foot closes down from SHAFT_RADIUS to PORT_RADIUS over this height, ending at the ceiling. */
export const ANNULUS_HEIGHT = 1.2;
/** Where the tube's straight wall ends and the annulus begins (T4: radiusAt tapers from here to the port). */
export const ANNULUS_TOP_Y = PORT_Y + ANNULUS_HEIGHT;
/** The lid's two leaves: just inside the port; they swing up (into the annulus) about hinges at the east/west rims. */
const LID_RADIUS = PORT_RADIUS - 0.03;
const LID_SWING = Math.PI / 2;
const LID_THICKNESS = 0.04;
/** The long pole's radius (D3: "r ≈ 0.06", the chair's own — render/injector-chair.ts CHAIR_POLE_RADIUS). */
export const LONG_POLE_RADIUS = 0.06;
/** The long pole's top: up inside the port, hidden in the annulus. */
const POLE_TOP_Y = PORT_Y + 0.6;

export interface Port {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** D3: Troy's real port over his seat and Phones's dummy 1.6 m west, on the pen hall's ceiling. */
export function portsOf(rooms: Rooms, interior: Interior): { troy: Port; phones: Port } {
  const seat = rooms.shaft[rooms.shaft.length - 1]!;
  const y = interior.pen.max.y;
  return {
    troy: { x: seat.x, y, z: seat.z, radius: PORT_RADIUS },
    phones: { x: seat.x - PORT_SPACING, y, z: seat.z, radius: DUMMY_PORT_RADIUS },
  };
}

/**
 * The shaft's centreline as drawn: from the control room's floor (through the bore) straight down to the pen hall's
 * ceiling, over the seat (D1: the shaft is one vertical leg).
 */
export function shaftLine(rooms: Rooms, interior: Interior): Vec3[] {
  const s = rooms.shaft;
  const top = s[0]!;
  const seat = s[s.length - 1]!;
  return [{ x: top.x, y: FLOOR_Y, z: top.z }, { x: seat.x, y: interior.pen.max.y, z: seat.z }];
}

/** Distance from p to a polyline. */
export function distanceToLine(p: Vec3 | THREE.Vector3, line: readonly Vec3[]): number {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    const t = len2 > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t));
  }
  return best;
}

/** The camera (or any point) is inside the shaft — the bore's throat, the tube — below the room's floor, above the hall. */
export function inShaft(p: Vec3 | THREE.Vector3, line: readonly Vec3[], slack = 0.5): boolean {
  const foot = Math.min(...line.map((q) => q.y));
  return p.y < FLOOR_Y - 0.05 && p.y > foot - slack && distanceToLine(p, line) <= SHAFT_RADIUS + slack;
}

export interface ShaftView {
  readonly group: THREE.Group;
  /** The drawn centreline (shaftLine). */
  readonly line: readonly Vec3[];
  /** The port, lid and pole: the parts seen from the pen hall (main.ts hands them to the pool's reflection). */
  readonly port: THREE.Group;
  /**
   * Once per drawn frame (D3): the lid as `b.lid` says (eased), and the long pole from inside the port down to `foot`
   * (world), `extent` of the way (0 = retracted into the port … 1 = down at the foot) — or no pole when `foot` is null
   * or not below the port.
   */
  update(b: Boarding, foot: Vec3 | null, extent: number): void;
  /** The pole as last drawn: its foot's y, or null when none is drawn (for tests). */
  poleFootY(): number | null;
}

export function createShaft(rooms: Rooms, interior: Interior): ShaftView {
  const group = new THREE.Group();
  group.name = 'shaft';
  const line = shaftLine(rooms, interior);
  // The tube proper starts where the room's stub ends, and its straight wall stops at the annulus.
  const tubeLine = [{ ...line[0]!, y: TUBE_TOP_Y }, { ...line[1]!, y: ANNULUS_TOP_Y }];

  const wallMap = wallTexture();
  const wall = new THREE.Mesh(tubeGeometry(tubeLine, SHAFT_RADIUS, WALL_STEP, true), new THREE.MeshBasicMaterial({ map: wallMap, vertexColors: true }));
  wall.name = 'shaft-tube';
  group.add(wall);

  const rings = new THREE.Mesh(ringGeometry(tubeLine, SHAFT_RADIUS - 0.015), new THREE.MeshBasicMaterial({ color: 0xfff0cf }));
  rings.name = 'shaft-rings';
  group.add(rings);

  const { troy, phones } = portsOf(rooms, interior);
  // The annulus: a cone from the tube's wall down to the port's rim at the ceiling, seen from inside (self-lit, a
  // little darker than the wall — it is the last of the tube, out of the rings' light).
  const annulus = new THREE.Mesh(
    new THREE.CylinderGeometry(SHAFT_RADIUS, PORT_RADIUS, ANNULUS_HEIGHT, AROUND, 1, true).translate(troy.x, PORT_Y + ANNULUS_HEIGHT / 2, troy.z),
    new THREE.MeshBasicMaterial({ map: wallMap, color: 0x8a929a, side: THREE.BackSide }),
  );
  annulus.name = 'shaft-annulus';
  group.add(annulus);

  const port = new THREE.Group();
  port.name = 'shaft-port';
  group.add(port);
  const steel = new THREE.MeshLambertMaterial({ color: 0x5b6168 });
  const darkSteel = new THREE.MeshLambertMaterial({ color: 0x2b2f33, side: THREE.DoubleSide });
  const lit = new THREE.MeshBasicMaterial({ color: 0xf6f0d8 });
  const chrome = new THREE.MeshPhongMaterial({ color: 0xd5dade, specular: 0xffffff, shininess: 90 });
  const lidPaint = new THREE.MeshLambertMaterial({ color: 0x3e444a, side: THREE.DoubleSide });

  for (const [p, name] of [[troy, 'port-troy'], [phones, 'port-phones']] as const) {
    const lip = p.y - COLLAR_DEPTH;
    // The collar: a short open cylinder under the ceiling, seen both sides (outside from the hall, inside up the port).
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(p.radius + 0.04, p.radius + 0.04, COLLAR_DEPTH, AROUND, 1, true)
      .translate(p.x, p.y - COLLAR_DEPTH / 2, p.z), darkSteel);
    collar.name = `${name}-collar`;
    // The flange on the ceiling round it, and a thicker bead round the lip.
    const flange = new THREE.Mesh(new THREE.RingGeometry(p.radius + 0.04, p.radius + FLANGE_WIDTH, AROUND).rotateX(Math.PI / 2)
      .translate(p.x, p.y - 0.01, p.z), steel);
    flange.name = `${name}-flange`;
    const bead = new THREE.Mesh(new THREE.TorusGeometry(p.radius + 0.06, 0.05, 8, AROUND).rotateX(Math.PI / 2).translate(p.x, lip, p.z), steel);
    bead.name = `${name}-bead`;
    // The lit ring: a bright band on the lip's underside, inside the bead (self-lit: no new light).
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.02, p.radius + 0.04, AROUND).rotateX(Math.PI / 2)
      .translate(p.x, lip - 0.055, p.z), lit);
    ring.name = `${name}-ring`;
    port.add(collar, flange, bead, ring);
  }
  // Phones's dummy: shut for good — a disc across its lip.
  const dummyLid = new THREE.Mesh(new THREE.CircleGeometry(DUMMY_PORT_RADIUS, AROUND).rotateX(Math.PI / 2)
    .translate(phones.x, phones.y - COLLAR_DEPTH + 0.01, phones.z), lidPaint);
  dummyLid.name = 'port-phones-lid';
  port.add(dummyLid);

  // Troy's lid: two half-disc leaves across the lip, hinged at its west and east rims, swinging up into the port.
  const lidY = troy.y - COLLAR_DEPTH + 0.01;
  const leaves = ([-1, 1] as const).map((side) => {
    const shape = new THREE.Shape();
    if (side < 0) shape.moveTo(0, LID_RADIUS).absarc(0, 0, LID_RADIUS, Math.PI / 2, (3 * Math.PI) / 2, false).lineTo(0, LID_RADIUS);
    else shape.moveTo(0, -LID_RADIUS).absarc(0, 0, LID_RADIUS, -Math.PI / 2, Math.PI / 2, false).lineTo(0, -LID_RADIUS);
    const g = new THREE.ExtrudeGeometry(shape, { depth: LID_THICKNESS, bevelEnabled: false, curveSegments: 20 })
      .rotateX(-Math.PI / 2).translate(-side * LID_RADIUS, 0, 0);
    const leaf = new THREE.Mesh(g, lidPaint);
    leaf.name = side < 0 ? 'port-lid-west' : 'port-lid-east';
    const hinge = new THREE.Group();
    hinge.name = `${leaf.name}-hinge`;
    hinge.position.set(troy.x + side * LID_RADIUS, lidY, troy.z);
    hinge.add(leaf);
    port.add(hinge);
    return { hinge, side };
  });

  // The long pole: a unit-height chrome rod, stretched each frame from inside the port down to its foot.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(LONG_POLE_RADIUS, LONG_POLE_RADIUS, 1, 16, 1, false).translate(0, -0.5, 0), chrome);
  pole.name = 'long-pole';
  pole.visible = false;
  port.add(pole);
  // A fitting on it a little below the port (the reference frame's "small fitting mid-way", kept near the top so it
  // reads on a retracting pole too).
  const fitting = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 12), steel);
  fitting.name = 'long-pole-fitting';
  pole.add(fitting);

  let footY: number | null = null;
  return {
    group,
    line,
    port,
    update(b, foot, extent) {
      // West leaf (hinge at its −x rim): its +x side swings up — rotation +θ about z; the east leaf the mirror.
      const swing = LID_SWING * smooth(b.lid);
      for (const { hinge, side } of leaves) hinge.rotation.z = side < 0 ? swing : -swing;
      if (foot === null || foot.y >= PORT_Y || extent <= 0) {
        pole.visible = false;
        footY = null;
        return;
      }
      const bottom = PORT_Y - (PORT_Y - foot.y) * Math.min(1, extent);
      const length = POLE_TOP_Y - bottom;
      pole.visible = true;
      pole.position.set(foot.x, POLE_TOP_Y, foot.z);
      pole.scale.set(1, length, 1);
      // Keep the fitting round and 1.2 m under the ceiling (or at the pole's foot, retracting).
      fitting.scale.set(1, 1 / length, 1);
      fitting.position.y = -Math.min(length - 0.12, POLE_TOP_Y - PORT_Y + 1.2) / length;
      footY = bottom;
    },
    poleFootY: () => footY,
  };
}

// ---- The tube ----

interface Station {
  /** The ring's centre on the axis. */
  at: THREE.Vector3;
  /** Arc length along the axis. */
  s: number;
  /** The leg's direction: the ring lies square to it. */
  dir: THREE.Vector3;
}

const X = new THREE.Vector3(1, 0, 0);

/** Stations along the line every `step` metres (phase 4: one straight leg, so every ring is square to it). */
function stations(line: readonly Vec3[], step: number): Station[] {
  const out: Station[] = [];
  let s = 0;
  for (let k = 1; k < line.length; k++) {
    const a = new THREE.Vector3(line[k - 1]!.x, line[k - 1]!.y, line[k - 1]!.z);
    const b = new THREE.Vector3(line[k]!.x, line[k]!.y, line[k]!.z);
    const dir = b.clone().sub(a);
    const length = dir.length();
    dir.normalize();
    const n = Math.max(1, Math.ceil(length / step));
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const f = i / n;
      out.push({ at: a.clone().lerp(b, f), s: s + length * f, dir });
    }
    s += length;
  }
  return out;
}

/** A ring's points: round the axis in the plane ⟂ dir (u = +x, v = dir × u). */
function ringPoints(st: Station, radius: number): THREE.Vector3[] {
  const v = st.dir.clone().cross(X).normalize();
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j <= AROUND; j++) {
    const th = (j / AROUND) * Math.PI * 2;
    pts.push(st.at.clone().addScaledVector(X, Math.cos(th) * radius).addScaledVector(v, Math.sin(th) * radius));
  }
  return pts;
}

/**
 * The tube's wall as one geometry: rings at every station joined into quads, faces toward the axis (it is seen from
 * inside), u round the girth and v along the axis in metres / 4. Vertex colours: brighter near each light ring.
 */
export function tubeGeometry(line: readonly Vec3[], radius: number, step: number, lit: boolean): THREE.BufferGeometry {
  const sts = stations(line, step);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const ringVerts = AROUND + 1;
  sts.forEach((st, i) => {
    const light = lit ? ringLight(st.s) : 1;
    for (const [j, p] of ringPoints(st, radius).entries()) {
      positions.push(p.x, p.y, p.z);
      uvs.push(j / AROUND, st.s / 4);
      colours.push(light, light, light);
    }
    if (i === 0) return;
    for (let j = 0; j < AROUND; j++) {
      const a = (i - 1) * ringVerts + j;
      const b = i * ringVerts + j;
      // (a, b, a+1) winds toward the axis (see the T7 notes: (a, a+1, b) faces outward).
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** The wall's brightness at arc s: a pool of light about each ring, dim between (the tube reads as long and lit). */
function ringLight(s: number): number {
  const d = Math.abs(s - Math.round(s / RING_SPACING) * RING_SPACING);
  return 0.32 + 0.68 * Math.exp(-(d * d) / 1.6);
}

/** The light rings: a bright band every RING_SPACING metres. */
function ringGeometry(line: readonly Vec3[], radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sts = stations(line, 0.5);
  const end = sts[sts.length - 1]!.s;
  for (let s = RING_SPACING; s < end - 0.5; s += RING_SPACING) {
    const st = sts.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
    const half = 0.09;
    const a: Station = { ...st, at: st.at.clone().addScaledVector(st.dir, -half) };
    const b: Station = { ...st, at: st.at.clone().addScaledVector(st.dir, half) };
    parts.push(band(ringPoints(a, radius), ringPoints(b, radius)));
  }
  return mergeAll(parts);
}

function band(a: THREE.Vector3[], b: THREE.Vector3[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of [...a, ...b]) positions.push(p.x, p.y, p.z);
  const n = a.length;
  for (let j = 0; j < n - 1; j++) indices.push(j, n + j, j + 1, j + 1, n + j, n + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

/** Riveted grey-blue panels: seams round and along, two dark guide tracks down the sides. A DataTexture (no DOM). */
function wallTexture(): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let c = [104, 116, 128];
      const seamU = Math.abs(((u * 10) % 1) - 0.5) > 0.47;
      const seamV = Math.abs(((v * 2) % 1) - 0.5) > 0.46;
      if (seamU || seamV) c = [62, 70, 78];
      // Guide tracks at the sides (u ≈ 0.25 and 0.75: the ±v directions).
      if (Math.abs(u - 0.25) < 0.018 || Math.abs(u - 0.75) < 0.018) c = [38, 42, 48];
      if (Math.abs(u - 0.25) < 0.006 || Math.abs(u - 0.75) < 0.006) c = [150, 156, 162];
      const k = (y * W + x) * 4;
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
