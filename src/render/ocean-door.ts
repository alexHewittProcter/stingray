import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glow } from './glow';
import { makeInteriorMaterial } from './indoors';

// The ocean door, as in the series: a thick machined steel ring port set into the rock, with an iris door
// recessed inside it. Built about the mouth centre with +Z out to sea; z = 0 is the collider face. The ring may
// stand proud of the face by up to RING_FRONT (the sub's hull sphere stops 4 m short of the face); everything else
// stays at or behind it.
//
// Phase 2 (T4): the ring's bore is opened to the tunnel's (≥ 13 m, so no part of the ring is inside the interior
// volume) and runs back the full depth of the cliff's slab, where a back plate closes it to the tunnel. The door is
// a working iris of IRIS_LEAVES steel leaves, each turning on a pin set in the ring's body: driven by the launch
// state's `door` (0 shut … 1 open), the leaves swing out of the bore into the ring and the rock behind the face,
// and only clear the bore completely at door = 1, as the collider does. Each leaf is three instanced meshes — a
// seaward face lit by the sun, a tunnel-side face lit by Marineville's own lamps, and the edges — so the door reads
// from both sides.

export const DOOR_RING_RADIUS = 17; // outer radius: 34 m across
/** The ring's bore: a little over the tunnel's drawn 13 m, so the ring sits outside the interior volume. */
export const DOOR_BORE_RADIUS = 13.2;
/** The ring runs this far back from the face — the cliff's slab — where the tunnel's bore takes over. */
export const DOOR_RING_DEPTH = 12;

const RING_FRONT = 1.7;
/** The leaves' mid-plane, recessed in the bore (door-local z). */
export const IRIS_Z = -5;
const IRIS_LEAVES = 10;
// Each leaf, open, is a band round the ring from its pin: inner edge just outside the bore, outer edge hidden in
// the rock. Turning it LEAF.closed on its pin swings it across the bore; ten of them close it with no gap
// (checked in ocean-door.test.ts). The outer edge never reaches past LEAF.outer from the axis, where the cliff's
// dressed apron (cliff-face.ts) still stands in front of it.
const LEAF = { inner: 13.25, outer: 21, sweep: (80 * Math.PI) / 180, pin: 17, closed: (52 * Math.PI) / 180 };
const LEAF_THICKNESS = 0.12;
const LEAF_STAGGER = 0.15; // each leaf sits clear of the last (more than its thickness), so overlaps never cut through
const BOLT_COUNT = 36;
const BEACON_X = 21.5;
const FLASH_HZ = 1.4;

const STEEL = 0xbcc2c6;
const STEEL_DARK = 0x5d6066;
const DOOR_STEEL = 0x7d7680; // the TV door reads as a warm purple-grey
const BEACON_AMBER = 0xffd27a;
const GUIDE_LIGHT = 0xbfeaff;

export interface OceanDoor {
  readonly group: THREE.Group;
  /** The ring itself (its bore is part of the interior's shell). */
  readonly ring: THREE.Mesh;
  /** Pose the iris for the door's travel (0 shut … 1 open); the beacons flash while it moves. */
  update(door: number, moving: boolean, timeSeconds: number): void;
}

function smooth(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
}

/** The ring in profile, (radius, z): from the back plate, out over the face, into the bore and back to the plate. */
const RING_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [DOOR_RING_RADIUS, -DOOR_RING_DEPTH],
  [DOOR_RING_RADIUS, 0.2],
  [16.6, 1.15],
  [16.0, RING_FRONT - 0.05],
  [14.0, RING_FRONT],
  [13.55, RING_FRONT - 0.15],
  [13.3, 0.9],
  [DOOR_BORE_RADIUS, 0.2],
  [DOOR_BORE_RADIUS, -DOOR_RING_DEPTH],
  [DOOR_RING_RADIUS, -DOOR_RING_DEPTH],
];

/** Segments round the ring: its bore's chords stay outside DOOR_BORE_RADIUS · cos(π / n) > 13 m. */
const RING_SEGMENTS = 96;

function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); // lathe +Y → +Z, out to sea
  return geometry;
}

// ---- The iris ----

/** How far each leaf is turned on its pin for the door's travel: LEAF.closed when shut, 0 when open. */
export function leafTurn(door: number): number {
  return LEAF.closed * (1 - THREE.MathUtils.clamp(door, 0, 1));
}

/** A leaf's outline in the door's plane (leaf 0, open): an annular band from its pin round LEAF.sweep. */
function leafOutline(segments = 20): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (LEAF.sweep * i) / segments;
    out.push(new THREE.Vector2(LEAF.outer * Math.cos(a), LEAF.outer * Math.sin(a)));
  }
  for (let i = segments; i >= 0; i--) {
    const a = (LEAF.sweep * i) / segments;
    out.push(new THREE.Vector2(LEAF.inner * Math.cos(a), LEAF.inner * Math.sin(a)));
  }
  return out;
}

/** Leaf k's placement for a turn (pin-local → door-local): round the door's axis by k/N, then on its pin by `turn`. */
function leafMatrix(k: number, turn: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const spin = new THREE.Matrix4().makeRotationZ((k / IRIS_LEAVES) * Math.PI * 2);
  const toPin = new THREE.Matrix4().makeTranslation(LEAF.pin, 0, IRIS_Z + (k - (IRIS_LEAVES - 1) / 2) * LEAF_STAGGER);
  const onPin = new THREE.Matrix4().makeRotationZ(turn);
  return out.copy(spin).multiply(toPin).multiply(onPin);
}

/** Every leaf's outline in the door's plane (door-local x, y) for the door's travel — for tests. */
export function irisLeafOutlines(door: number): THREE.Vector2[][] {
  const turn = leafTurn(door);
  const outline = leafOutline().map((p) => new THREE.Vector3(p.x - LEAF.pin, p.y, 0));
  return Array.from({ length: IRIS_LEAVES }, (_, k) => {
    const m = leafMatrix(k, turn);
    return outline.map((p) => {
      const q = p.clone().applyMatrix4(m);
      return new THREE.Vector2(q.x, q.y);
    });
  });
}

/**
 * One leaf in pin-local coordinates (the pin at the origin), as three geometries: the seaward face (+Z), the
 * tunnel-side face (−Z) and the edges. UVs: u along the leaf from its pin end, v across from the inner edge.
 */
function leafGeometries(): { front: THREE.BufferGeometry; back: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  const n = 24;
  const half = LEAF_THICKNESS / 2;
  const plate = (z: number, facing: 1 | -1) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (LEAF.sweep * i) / n;
      for (const [j, r] of [[0, LEAF.inner], [1, LEAF.outer]] as const) {
        pos.push(r * Math.cos(a) - LEAF.pin, r * Math.sin(a), z);
        uv.push(i / n, j);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      // a = inner(i), a+1 = outer(i), a+2 = inner(i+1), a+3 = outer(i+1); counter-clockwise from +Z for the front.
      if (facing === 1) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // Edges: the outline extruded through the leaf's thickness.
  const outline = leafOutline(n).map((p) => new THREE.Vector2(p.x - LEAF.pin, p.y));
  const edgePos: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    edgePos.push(a.x, a.y, -half, b.x, b.y, -half, b.x, b.y, half, a.x, a.y, -half, b.x, b.y, half, a.x, a.y, half);
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  edge.computeVertexNormals();
  return { front: plate(half, 1), back: plate(-half, -1), edge };
}

/**
 * A leaf's face, as a DataTexture (no DOM), u along the leaf from its pin end, v across from its inner edge.
 * Seaward: brushed purple-grey steel with a seam along the inner edge, a row of rivets and grime in streaks.
 * Tunnel side: lighter grey with a yellow-and-black hazard band along the inner edge, so the shut iris shows a
 * hazard spiral to anyone waiting in the chamber.
 */
function leafTexture(side: 'sea' | 'inside'): THREE.DataTexture {
  const W = 256;
  const H = 32;
  const data = new Uint8Array(W * H * 4);
  const base = new THREE.Color(side === 'sea' ? DOOR_STEEL : 0x8e8f8a);
  const yellow = new THREE.Color(0xd9a91e);
  const black = new THREE.Color(0x1d1d1b);
  const c = new THREE.Color();
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      c.copy(base).multiplyScalar(0.8 + 0.3 * v); // each leaf catches the light toward its outer edge
      if (side === 'inside' && v > 0.08 && v < 0.24) c.copy(((u * 36 + v * 3) % 1) < 0.5 ? yellow : black);
      if (v < 0.06) c.multiplyScalar(0.55); // the seam along the inner edge
      const rivet = Math.abs(((u * 40) % 1) - 0.5) < 0.14 && Math.abs(v - (side === 'sea' ? 0.17 : 0.3)) < 0.05;
      if (rivet) c.multiplyScalar(1.4);
      const grime = Math.sin(u * 97) * Math.sin(u * 31 + v * 7);
      c.multiplyScalar(1 - 0.12 * smooth(grime));
      const k = (py * W + px) * 4;
      data[k] = Math.round(Math.min(c.r, 1) * 255);
      data[k + 1] = Math.round(Math.min(c.g, 1) * 255);
      data[k + 2] = Math.round(Math.min(c.b, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function iris(): { group: THREE.Group; pose(door: number): void } {
  const group = new THREE.Group();
  group.name = 'oceanDoor:iris';
  const { front, back, edge } = leafGeometries();
  const sea = new THREE.MeshStandardMaterial({ map: leafTexture('sea'), roughness: 0.45, metalness: 0.3, name: 'door-leaf-sea' });
  // Marineville's lamps are dim beside the sun: the inner face is painted lighter so it reads in the chamber.
  const inside = makeInteriorMaterial(new THREE.MeshLambertMaterial({ map: leafTexture('inside'), name: 'door-leaf-inside' }));
  inside.color.setScalar(1.8);
  const edges = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide, name: 'door-leaf-edge' });
  const meshes = [
    new THREE.InstancedMesh(front, sea, IRIS_LEAVES),
    new THREE.InstancedMesh(back, inside, IRIS_LEAVES),
    new THREE.InstancedMesh(edge, edges, IRIS_LEAVES),
  ];
  const tint = new THREE.Color();
  for (const mesh of meshes) {
    mesh.frustumCulled = false; // the instances move; the base geometry's bounds do not cover them
    for (let k = 0; k < IRIS_LEAVES; k++) mesh.setColorAt(k, tint.setScalar(0.88 + 0.06 * (k % 3)));
    group.add(mesh);
  }
  const m = new THREE.Matrix4();
  let posed = NaN;
  return {
    group,
    pose(door) {
      const turn = leafTurn(door);
      if (turn === posed) return;
      posed = turn;
      for (let k = 0; k < IRIS_LEAVES; k++) {
        leafMatrix(k, turn, m);
        for (const mesh of meshes) mesh.setMatrixAt(k, m);
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- The ring's fittings ----

/** Studs around the ring's face, merged into one mesh. */
function bolts(material: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < BOLT_COUNT; i++) {
    const a = (i / BOLT_COUNT) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.28, 0.32, 0.3, 6);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(Math.cos(a) * 14.9, Math.sin(a) * 14.9, RING_FRONT + 0.1);
    parts.push(bolt);
  }
  return new THREE.Mesh(mergeGeometries(parts), material);
}

/** Small housings on the ring's face at the diagonals: the iris rams. */
function rams(material: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ram = new THREE.BoxGeometry(1.6, 2.4, 0.5);
    ram.rotateZ(a);
    ram.translate(Math.cos(a) * 14.9, Math.sin(a) * 14.9, RING_FRONT + 0.2);
    parts.push(ram);
  }
  return new THREE.Mesh(mergeGeometries(parts), material);
}

/** Guide lights set round the bore's lip, and a beacon either side, so the way home shows through the murk. */
function lights(): { group: THREE.Group; lenses: THREE.MeshBasicMaterial; halos: THREE.SpriteMaterial[] } {
  const group = new THREE.Group();
  const dots: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    dots.push(new THREE.SphereGeometry(0.28, 8, 6).translate(Math.cos(a) * 13.75, Math.sin(a) * 13.75, RING_FRONT - 0.05));
  }
  group.add(new THREE.Mesh(mergeGeometries(dots), new THREE.MeshBasicMaterial({ color: GUIDE_LIGHT })));
  const ringGlow = glow(GUIDE_LIGHT, 40, 0.18);
  ringGlow.position.z = RING_FRONT + 1;
  group.add(ringGlow);

  const housingMaterial = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.5, metalness: 0.5 });
  const housing = new THREE.CylinderGeometry(1.1, 1.4, 4, 14);
  housing.rotateX(Math.PI / 2);
  const lenses = new THREE.MeshBasicMaterial({ color: BEACON_AMBER });
  const halos: THREE.SpriteMaterial[] = [];
  for (const side of [-1, 1]) {
    const beacon = new THREE.Group();
    beacon.position.set(side * BEACON_X, 0, 0);
    const body = new THREE.Mesh(housing, housingMaterial);
    body.position.z = -1.3;
    beacon.add(body);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), lenses);
    face.position.z = 0.72;
    beacon.add(face);
    const halo = glow(BEACON_AMBER, 16, 0.6);
    halo.position.z = 1.5;
    halos.push(halo.material);
    beacon.add(halo);
    group.add(beacon);
  }
  return { group, lenses, halos };
}

/** The beacons' brightness: steady while the door is still; flashing while it moves. */
export function beaconLevel(moving: boolean, timeSeconds: number): number {
  if (!moving) return 1;
  const phase = (((timeSeconds * FLASH_HZ) % 1) + 1) % 1;
  return phase < 0.5 ? 1.3 : 0.06;
}

export function createOceanDoor(mouth: { x: number; y: number; z: number }): OceanDoor {
  const group = new THREE.Group();
  group.name = 'oceanDoor';
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.5, metalness: 0.5 });

  const ring = new THREE.Mesh(lathe(RING_PROFILE, RING_SEGMENTS), steel);
  ring.name = 'oceanDoor:ring';
  ring.userData.interiorShell = true; // its bore is the interior's wall through the cliff's slab
  group.add(ring);
  // A machined groove ring across the face, and the dark slot round the bore the leaves run in.
  const groove = new THREE.Mesh(new THREE.TorusGeometry(15.6, 0.12, 6, 96), dark);
  groove.position.z = RING_FRONT - 0.02;
  const slot = new THREE.Mesh(
    new THREE.CylinderGeometry(DOOR_BORE_RADIUS - 0.03, DOOR_BORE_RADIUS - 0.03, IRIS_LEAVES * LEAF_STAGGER + 0.4, RING_SEGMENTS, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0b0c0d, side: THREE.BackSide }),
  );
  slot.rotation.x = Math.PI / 2;
  slot.position.z = IRIS_Z;
  slot.name = 'oceanDoor:slot';
  const leaves = iris();
  const lamps = lights();
  group.add(groove, slot, bolts(dark), rams(steel), leaves.group, lamps.group);
  leaves.pose(0);

  group.position.set(mouth.x, mouth.y, mouth.z);
  const amber = new THREE.Color(BEACON_AMBER);
  return {
    group,
    ring,
    update(door, moving, time) {
      leaves.pose(door);
      const level = beaconLevel(moving, time);
      lamps.lenses.color.copy(amber).multiplyScalar(level);
      for (const h of lamps.halos) h.opacity = 0.6 * Math.min(level, 1);
    },
  };
}
