import * as THREE from 'three';
import type { Interior } from '../sim/world';
import { FLOOR_Y, type Rooms, SHAFT_RADIUS } from '../sim/rooms';
import type { Vec3 } from '../sim/vec3';
import { TUBE_TOP_Y } from './rooms';

// The injector shaft (phase 3, M1 "The shaft", T7; phase 4, D1): the closed tube the chair rides straight down, from
// the control room's bore (render/rooms.ts — the open throat, its flare and a 2 m stub of the tube) through the tower's
// drum and stalk and the 5 m of rock to Pen 3's hall ceiling, plumb over Troy's seat.
//
//   - The tube: radius SHAFT_RADIUS, continuing the bore's stub from TUBE_TOP_Y straight down to the hall's ceiling,
//     where it ends plain and open (phase 4, T1; T3 closes its foot down in an annulus to the ceiling's port, D3).
//   - Lighting (M6: the ride is lit by nothing in the scene): every surface is self-lit — the walls a basic material
//     whose vertex colours brighten toward light rings every RING_SPACING metres, the rings themselves bright bands.
//     No new scene light: the light count stays constant as T1/T4/T5 kept it.
//   - Visibility: the group is drawn while the camera is in the rooms (looking down the bore), in the shaft or in the
//     pen hall (inShaft / main.ts), and hidden at sea.
//
// The drop below the ceiling (≈ 11 m of open hall down to the seat) is drawn as nothing: the chair hangs in the hall,
// as the series' does (T3 adds the port, the lid and the pole).

/** Where the room's drawn stub of the tube ends (render/rooms.ts: the throat, its flare and the stub; defined there). */
export { TUBE_TOP_Y };
/** Light rings along the tube, every so many metres. */
const RING_SPACING = 6;
/** Wall rings along the tube (for the vertex-colour light falloff), every so many metres. */
const WALL_STEP = 0.75;
const AROUND = 40;

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
}

export function createShaft(rooms: Rooms, interior: Interior): ShaftView {
  const group = new THREE.Group();
  group.name = 'shaft';
  const line = shaftLine(rooms, interior);
  // The tube proper starts where the room's stub ends.
  const tubeLine = [{ ...line[0]!, y: TUBE_TOP_Y }, ...line.slice(1)];

  const wall = new THREE.Mesh(tubeGeometry(tubeLine, SHAFT_RADIUS, WALL_STEP, true), new THREE.MeshBasicMaterial({ map: wallTexture(), vertexColors: true }));
  wall.name = 'shaft-tube';
  group.add(wall);

  const rings = new THREE.Mesh(ringGeometry(tubeLine, SHAFT_RADIUS - 0.015), new THREE.MeshBasicMaterial({ color: 0xfff0cf }));
  rings.name = 'shaft-rings';
  group.add(rings);
  return { group, line };
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
