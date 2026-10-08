import * as THREE from 'three';
import type { Interior } from '../sim/world';
import { FLOOR_Y, type Rooms, SHAFT_OPEN_TOP, SHAFT_RADIUS } from '../sim/rooms';
import type { Vec3 } from '../sim/vec3';
import { makeInteriorMaterial } from './indoors';

// The injector shaft (phase 3, M1 "The shaft", T7): the closed tube the chair rides down between the lounge's bore
// (render/rooms.ts — the open throat, its flare and a 2 m stub of the tube) and Pen 3's hall, and the shaft's housing
// where it meets the hall's ceiling above the cradle.
//
//   - The tube: radius SHAFT_RADIUS, continuing the bore's stub from TUBE_TOP_Y down leg 1 (inside the annexe's column),
//     along leg 2 (north through the rock under the grounds), and down leg 3 through the pen's ceiling into the
//     housing, which ends COLLAR_DEPTH below the ceiling. Its ends are open; the legs meet on mitred rings (the shaft
//     lies in the x = 0 plane, so one cross-section axis, +x, serves every leg and the rings at a corner coincide).
//   - Lighting (M6: the ride is lit by nothing in the scene): every surface is self-lit — the walls a basic material
//     whose vertex colours brighten toward light rings every RING_SPACING metres, the rings themselves bright bands.
//     No new scene light: the light count stays constant as T1/T4/T5 kept it. The housing's outside, in the hall, is
//     an interior material lit by the pen's lamps like the rest of the hall; its lip carries a ring of amber lamps.
//   - Visibility: the group is drawn while the camera is in the rooms (looking down the bore), in the shaft or in the
//     pen hall (inShaft / main.ts), and hidden at sea.
//
// The leg-3 drop below the housing (≈ 9 m of open hall down to the seat) is drawn as nothing: the chair hangs in the
// hall on its column, as the series' does.

/** Where the lounge's drawn stub of the tube ends (render/rooms.ts: the throat, its 1.2 m flare and the 2 m stub). */
export const TUBE_TOP_Y = FLOOR_Y - SHAFT_OPEN_TOP - 1.2 - 2;
/** How far the housing reaches down below the pen hall's ceiling (m). */
export const COLLAR_DEPTH = 2;
/** The housing's outer radius (its skin, seen from the hall). */
const COLLAR_OUTER = SHAFT_RADIUS + 0.45;
/** Light rings along the tube, every so many metres. */
const RING_SPACING = 6;
/** Wall rings along the tube (for the vertex-colour light falloff), every so many metres. */
const WALL_STEP = 0.75;
const AROUND = 40;

/** The shaft's centreline as drawn: from the lounge floor (through the bore) to the housing's lip in the hall. */
export function shaftLine(rooms: Rooms, interior: Interior): Vec3[] {
  const s = rooms.shaft;
  const top = s[0]!;
  const seat = s[s.length - 1]!;
  return [{ x: top.x, y: FLOOR_Y, z: top.z }, ...s.slice(1, -1), { x: seat.x, y: interior.pen.max.y - COLLAR_DEPTH, z: seat.z }];
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

/** The camera (or any point) is inside the shaft — the bore's throat, the tube, the housing — below the lounge floor. */
export function inShaft(p: Vec3 | THREE.Vector3, line: readonly Vec3[], slack = 0.5): boolean {
  return p.y < FLOOR_Y - 0.05 && distanceToLine(p, line) <= SHAFT_RADIUS + slack;
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
  // The tube proper starts where the lounge's stub ends.
  const tubeLine = [{ ...line[0]!, y: TUBE_TOP_Y }, ...line.slice(1)];

  const wall = new THREE.Mesh(tubeGeometry(tubeLine, SHAFT_RADIUS, WALL_STEP, true), new THREE.MeshBasicMaterial({ map: wallTexture(), vertexColors: true }));
  wall.name = 'shaft-tube';
  group.add(wall);

  const rings = new THREE.Mesh(ringGeometry(tubeLine, SHAFT_RADIUS - 0.015), new THREE.MeshBasicMaterial({ color: 0xfff0cf }));
  rings.name = 'shaft-rings';
  group.add(rings);

  group.add(housing(rooms, interior));
  return { group, line };
}

// ---- The tube ----

interface Station {
  /** The ring's centre on the axis. */
  at: THREE.Vector3;
  /** Arc length along the axis. */
  s: number;
  /** The plane the ring lies on (a leg's square end, or the bisector at a corner). */
  normal: THREE.Vector3;
  /** The legs either side: the ring's points are projected along the leg's direction onto the plane. */
  dir: THREE.Vector3;
  /**
   * The leg's mitre planes (a point on each and its normal along the leg), where it meets the legs either side. A ring
   * within a radius of a corner would reach past its mitre into the next leg's bore; its points are held back onto it.
   */
  mitres: { at: THREE.Vector3; normal: THREE.Vector3 }[];
}

const X = new THREE.Vector3(1, 0, 0);

/** Stations along the polyline every `step` metres plus every corner (on its mitre plane). */
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
    const mitres: Station['mitres'] = [];
    if (k > 1) {
      const prev = a.clone().sub(new THREE.Vector3(line[k - 2]!.x, line[k - 2]!.y, line[k - 2]!.z)).normalize();
      mitres.push({ at: a, normal: prev.add(dir).normalize().negate() }); // facing back up the shaft, out of this leg
    }
    if (k < line.length - 1) {
      const next = new THREE.Vector3(line[k + 1]!.x - b.x, line[k + 1]!.y - b.y, line[k + 1]!.z - b.z).normalize();
      mitres.push({ at: b, normal: next.add(dir).normalize() });
    }
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const f = i / n;
      let normal = dir.clone();
      if (i === n && k < line.length - 1) {
        const next = new THREE.Vector3(line[k + 1]!.x - b.x, line[k + 1]!.y - b.y, line[k + 1]!.z - b.z).normalize();
        normal = dir.clone().add(next).normalize();
      }
      out.push({ at: a.clone().lerp(b, f), s: s + length * f, normal, dir, mitres });
    }
    s += length;
  }
  return out;
}

/** A ring's points: round the axis in the plane ⟂ dir (u = +x, v = dir × u), slid along dir onto the station's plane. */
function ringPoints(st: Station, radius: number): THREE.Vector3[] {
  const v = st.dir.clone().cross(X).normalize();
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j <= AROUND; j++) {
    const th = (j / AROUND) * Math.PI * 2;
    const p = st.at.clone().addScaledVector(X, Math.cos(th) * radius).addScaledVector(v, Math.sin(th) * radius);
    const t = st.at.clone().sub(p).dot(st.normal) / st.dir.dot(st.normal);
    p.addScaledVector(st.dir, t);
    // Never past the leg's own mitres: the inner side of a bend stops where the next leg's wall begins.
    for (const m of st.mitres) {
      const over = p.clone().sub(m.at).dot(m.normal);
      if (over > 0) p.addScaledVector(st.dir, -over / st.dir.dot(m.normal));
    }
    pts.push(p);
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

/** The light rings: a bright band every RING_SPACING metres, kept off the corners. */
function ringGeometry(line: readonly Vec3[], radius: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sts = stations(line, 0.5);
  const corners: number[] = [];
  for (let k = 1, s = 0; k < line.length - 1; k++) {
    s += Math.hypot(line[k]!.x - line[k - 1]!.x, line[k]!.y - line[k - 1]!.y, line[k]!.z - line[k - 1]!.z);
    corners.push(s);
  }
  const end = sts[sts.length - 1]!.s;
  for (let s = RING_SPACING; s < end - 0.5; s += RING_SPACING) {
    if (corners.some((c) => Math.abs(c - s) < SHAFT_RADIUS + 0.4)) continue;
    const st = sts.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
    const half = 0.09;
    const a: Station = { ...st, at: st.at.clone().addScaledVector(st.dir, -half), normal: st.dir };
    const b: Station = { ...st, at: st.at.clone().addScaledVector(st.dir, half), normal: st.dir };
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
      // Guide tracks at the sides (u ≈ 0.25 and 0.75: the ±v directions — down a level leg, port and starboard).
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

// ---- The housing in the pen hall (M1: "the only new thing drawn in the pen hall") ----

/**
 * Where the shaft meets the hall's ceiling above the cradle: a steel collar round the tube, COLLAR_DEPTH below the
 * ceiling, a flange on the ceiling, a dark lip at the bottom with a ring of amber lamps, and four hanger struts.
 */
function housing(rooms: Rooms, interior: Interior): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shaft-housing';
  const seat = rooms.shaft[rooms.shaft.length - 1]!;
  const top = interior.pen.max.y;
  const bottom = top - COLLAR_DEPTH;
  const steel = makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: 0x8b9298 }));
  const dark = makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: 0x2c3136 }));
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffb648 });
  const at = (m: THREE.Mesh, y: number) => {
    m.position.set(seat.x, y, seat.z);
    g.add(m);
    return m;
  };
  // The skin, open-ended, seen from the hall.
  at(new THREE.Mesh(new THREE.CylinderGeometry(COLLAR_OUTER, COLLAR_OUTER, COLLAR_DEPTH, 40, 1, true), steel), top - COLLAR_DEPTH / 2);
  // The flange on the ceiling, facing down.
  at(new THREE.Mesh(new THREE.RingGeometry(COLLAR_OUTER, COLLAR_OUTER + 1.1, 40).rotateX(Math.PI / 2), dark), top - 0.02);
  // The lip: an annulus between the tube and the skin, facing down; amber lamps round it.
  at(new THREE.Mesh(new THREE.RingGeometry(SHAFT_RADIUS, COLLAR_OUTER, 40).rotateX(Math.PI / 2), dark), bottom);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const r = (SHAFT_RADIUS + COLLAR_OUTER) / 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), lamp);
    bulb.position.set(seat.x + Math.cos(a) * r, bottom - 0.03, seat.z + Math.sin(a) * r);
    g.add(bulb);
  }
  // Hazard bands: a yellow ring a hand's width above the lip.
  const yellow = makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: 0xd8a722 }));
  at(new THREE.Mesh(new THREE.CylinderGeometry(COLLAR_OUTER + 0.01, COLLAR_OUTER + 0.01, 0.25, 40, 1, true), yellow), bottom + 0.3);
  // Four hanger struts from the ceiling to the collar's skin.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.6), steel);
    strut.position.set(seat.x + Math.cos(a) * (COLLAR_OUTER + 0.55), top - 0.55, seat.z + Math.sin(a) * (COLLAR_OUTER + 0.55));
    strut.lookAt(seat.x + Math.cos(a) * COLLAR_OUTER, bottom + 0.6, seat.z + Math.sin(a) * COLLAR_OUTER);
    g.add(strut);
  }
  return g;
}
