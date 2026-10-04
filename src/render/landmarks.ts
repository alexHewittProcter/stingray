import * as THREE from 'three';
import { ARCH, CLIFF_TOP, COAST_Z, type Collider, type World } from '../sim/world';
import { hash3, mulberry32 } from './random';
import { Growth, KELP_HEIGHT, hullGeometry, ribsGeometry, strataBox, towerGeometry, type WreckFrame } from './natural';

// Landmark scenery. Solid shapes are drawn inside their colliders, so what you see is what you hit.

function landmark(world: World, id: string) {
  const found = world.landmarks.find((l) => l.id === id);
  if (!found) throw new Error(`landmark missing: ${id}`);
  return found;
}

const boxes = (colliders: readonly Collider[]) =>
  colliders.filter((c): c is Extract<Collider, { kind: 'box' }> => c.kind === 'box');

// ---- The Marineville cliff and the ocean door ----

const CLIFF_DEPTH = 420;
const FLUTE_DEPTH = 12; // m the flutes are cut back (north) from the collider face

function cliff(world: World): THREE.Group {
  const group = new THREE.Group();
  const width = world.bounds.halfSize * 2 + 200;
  const height = CLIFF_TOP + CLIFF_DEPTH;
  const geometry = new THREE.PlaneGeometry(width, height, 520, 24);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    // Vertical flutes, as on the series' rock face: columns of varying depth, roughened along their height.
    const column = hash3(Math.floor(x / 9), 1, 0);
    const cut = FLUTE_DEPTH * (0.25 + 0.75 * column) * (0.7 + 0.3 * hash3(Math.floor(x / 9), Math.floor(y / 30), 2));
    position.setZ(i, -cut);
    col.setHex(0x6c7466).lerp(new THREE.Color(0x4d5a3e), hash3(Math.floor(x / 20), Math.floor(y / 25), 5) * 0.8);
    col.multiplyScalar(0.55 + 0.6 * (1 - cut / FLUTE_DEPTH) + 0.15 * hash3(x, y, 9));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const face = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  face.position.set(0, CLIFF_TOP - height / 2, COAST_Z);
  group.add(face);

  // The land on top, running north out of sight.
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 700),
    new THREE.MeshLambertMaterial({ color: 0x7c9a58 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, CLIFF_TOP, COAST_Z - 350);
  group.add(top);

  group.add(oceanDoor(world));
  return group;
}

// The series' ocean door: a round steel port set in the rock, shut by a domed door.
function oceanDoor(world: World): THREE.Group {
  const group = new THREE.Group();
  const steel = new THREE.MeshPhongMaterial({ color: 0x9aa3a8, specular: 0xffffff, shininess: 60 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x6f6a72, specular: 0xaabbcc, shininess: 40 });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(13, 3, 14, 48), steel);
  group.add(ring);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(13, 14.5, 3, 48, 1, true), steel);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = -1.5;
  group.add(collar);
  // The door: a shallow dome bulging seaward, split by a seam like the series' two-leaf door.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(12.2, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dome.rotation.x = Math.PI / 2;
  dome.scale.set(1, 0.28, 1);
  dome.position.z = -1.2;
  group.add(dome);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 24, 0.6), steel);
  seam.position.z = 2.1;
  group.add(seam);

  // A beacon either side, so the way home shows through the murk.
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    lamp.position.set(side * 19, 0, 1);
    group.add(lamp);
  }

  const m = world.marineville.tunnelMouth;
  group.position.set(m.x, m.y, m.z + 0.5);
  return group;
}

// ---- Arch, stacks, wreck, kelp ----

/** Marks a landmark's solid meshes with its id, so they can be checked against that landmark's colliders. */
function tagSolid<T extends THREE.Object3D>(object: T, id: World['landmarks'][number]['id']): T {
  object.traverse((o) => {
    if (o.userData.solid) o.userData.landmark = id;
  });
  return object;
}

const ARCH_OPTIONS = { layer: 7, sides: 24, inset: 0.12, squareness: 3.5, moss: 0.55, jag: 0.3, grain: 9 };

/** Weathered stratified rock: two tapering pillars under a slab-built lintel, weed hanging into the opening. */
function arch(world: World): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(world.seed ^ 0xa4c4);
  const growth = new Growth(world.seed, rand);
  const ledges: THREE.Vector3[] = [];
  const floor = world.seabedHeight(ARCH.x, ARCH.z);
  const spring = floor + ARCH.openingHeight;
  for (const c of boxes(landmark(world, 'arch').colliders)) {
    if (c.min.y < spring - 0.01) {
      group.add(strataBox(c, world.seed, { ...ARCH_OPTIONS, profile: (t) => 1 - 0.22 * t, rand }, ledges));
      footGrowth(world, growth, c, rand);
      continue;
    }
    // The lintel: a full-width upper bed on two corbels that step in over the opening, so its underside arches.
    const corbelTop = c.min.y + (c.max.y - c.min.y) * 0.4;
    const upper = { kind: 'box' as const, min: { ...c.min, y: corbelTop }, max: c.max };
    group.add(strataBox(upper, world.seed, { ...ARCH_OPTIONS, layer: 5, sides: 34, squareness: 5, profile: (t) => 0.92 + 0.08 * t, rand }, ledges));
    for (const side of [-1, 1]) {
      const inner = ARCH.x + side * ARCH.openingHalfWidth * 0.45;
      const outer = side < 0 ? c.min.x : c.max.x;
      const corbel = {
        kind: 'box' as const,
        min: { x: Math.min(inner, outer), y: c.min.y, z: c.min.z },
        max: { x: Math.max(inner, outer), y: corbelTop, z: c.max.z },
      };
      group.add(strataBox(corbel, world.seed, { ...ARCH_OPTIONS, layer: 3, sides: 24, squareness: 3, profile: (t) => 0.85 + 0.15 * t, rand }));
    }
  }
  growth.onLedges(ledges, 0.6, 1.2);
  // Weed hanging from the lintel's underside marks the opening from a distance; it is soft, so it may hang into it.
  for (let i = 0; i < 26; i++) {
    const x = ARCH.x + (rand() - 0.5) * ARCH.openingHalfWidth * 2;
    const z = ARCH.z + (rand() - 0.5) * (ARCH.depth - 4);
    const at = new THREE.Vector3(x, spring + 0.05, z);
    const roll = rand();
    if (roll < 0.35) growth.place('kelp', at, 0.6 + rand() * 0.4, (4 + rand() * 5) / KELP_HEIGHT, true, 0.2);
    else if (roll < 0.7) growth.place('frond', at, 1 + rand() * 0.6, 1.2 + rand() * 0.8, true, 0.3);
    else growth.place('bush', at, 0.7 + rand() * 0.4, 0.8 + rand() * 0.5, true, 0.3);
  }
  group.add(growth.build());
  return tagSolid(group, 'arch');
}

/** Moss, coral and weed crowding the foot of a rock, where silt and growth gather. */
function footGrowth(world: World, growth: Growth, c: Extract<Collider, { kind: 'box' }>, rand: () => number): void {
  const cx = (c.min.x + c.max.x) / 2;
  const cz = (c.min.z + c.max.z) / 2;
  const hx = (c.max.x - c.min.x) / 2;
  const hz = (c.max.z - c.min.z) / 2;
  const count = Math.round((hx + hz) * 1.6);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const out = 0.95 + rand() * 0.35;
    const x = cx + Math.cos(a) * hx * out;
    const z = cz + Math.sin(a) * hz * out;
    const at = new THREE.Vector3(x, world.seabedHeight(x, z) - 0.1, z);
    const roll = rand();
    if (roll < 0.45) growth.place('mound', at, 1.2 + rand() * 2, 0.8 + rand() * 1.4);
    else if (roll < 0.65) growth.place('coral', at, 0.9 + rand() * 0.9, 1 + rand() * 1.4);
    else if (roll < 0.85) growth.place('frond', at, 0.8 + rand() * 0.6, 0.8 + rand() * 0.5);
    else growth.place('bush', at, 0.6 + rand() * 0.5, 0.6 + rand() * 0.5);
  }
}

/** Sea stacks: tall columns of strata, each slab cut back differently, so they read as ledged and wind-worn. */
function stacks(world: World): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(world.seed ^ 0x57ac);
  const growth = new Growth(world.seed, rand);
  for (const c of boxes(landmark(world, 'stacks').colliders)) {
    const ledges: THREE.Vector3[] = [];
    const phase = rand() * Math.PI * 2;
    const waist = (t: number) => 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(t * 7 + phase)) - 0.12 * t;
    group.add(strataBox(c, world.seed, { layer: 8, sides: 18, inset: 0.14, squareness: 2.8, profile: waist, moss: 0.5, jag: 0.3, grain: 5, rand }, ledges));
    growth.onLedges(ledges, 0.45, 1.1);
    footGrowth(world, growth, c, rand);
    // A few kelp ribbons at each foot give the columns a soft, moving edge.
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const x = (c.min.x + c.max.x) / 2 + Math.cos(a) * 9.5;
      const z = (c.min.z + c.max.z) / 2 + Math.sin(a) * 9.5;
      growth.place('kelp', new THREE.Vector3(x, world.seabedHeight(x, z) - 0.2, z), 0.8, (12 + rand() * 18) / KELP_HEIGHT, false, 0.1);
    }
  }
  group.add(growth.build());
  return tagSolid(group, 'stacks');
}

const WRECK_FRAME: Omit<WreckFrame, 'axisY'> = { halfLength: 29, radius: 6.1, roll: 0.15, towerX: 10 };
const TOWER = { height: 8, length: 6, width: 2.4 };

/** A submarine lying in the silt, listing, holed on its flank with its frames bared, grown over with weed. */
function wreck(world: World): THREE.Group {
  const group = new THREE.Group();
  const l = landmark(world, 'wreck');
  const frame: WreckFrame = { ...WRECK_FRAME, axisY: l.pos.y + 3.4 };
  const rand = mulberry32(world.seed ^ 0x3eec);

  // Everything solid is built in the hull's frame (axis along x), then the whole frame lists by its roll.
  const hull = new THREE.Group();
  hull.position.set(l.pos.x, frame.axisY, l.pos.z);
  hull.rotation.x = frame.roll;
  const plating = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const rust = new THREE.MeshLambertMaterial({ color: 0x5e3e2e, flatShading: true });
  const solid = (mesh: THREE.Mesh) => {
    mesh.userData.solid = true;
    hull.add(mesh);
    return mesh;
  };
  solid(new THREE.Mesh(hullGeometry(frame, world.seed), plating));
  solid(new THREE.Mesh(ribsGeometry(frame), rust));
  const tower = solid(new THREE.Mesh(towerGeometry(TOWER.height, TOWER.length, TOWER.width), rust));
  tower.position.set(frame.towerX, frame.radius * 0.88 - 0.3, 0);
  const rudder = solid(new THREE.Mesh(new THREE.BoxGeometry(2.6, 6.4, 0.3), rust));
  rudder.position.set(-frame.halfLength + 1.6, 0, 0);
  group.add(hull);
  hull.updateMatrixWorld(true);

  // Weed and coral settle along the upper hull and the deck; kelp rises from the silt beside it.
  const growth = new Growth(world.seed, rand);
  const onHull = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    const u = rand() * 1.7 - 0.85;
    const a = Math.PI / 2 + (rand() - 0.5) * 1.6;
    const r = frame.radius * (u > 0.55 ? Math.sqrt(1 - ((u - 0.55) / 0.45) ** 2) : 1);
    onHull.set(u * frame.halfLength, Math.min(Math.sin(a) * r, frame.radius * 0.88) - 0.15, Math.cos(a) * r);
    if (Math.abs(onHull.x - frame.towerX) < TOWER.length / 2 && Math.abs(onHull.z) < TOWER.width) continue;
    const at = onHull.clone().applyMatrix4(hull.matrixWorld);
    const roll = rand();
    if (roll < 0.5) growth.place('mound', at, 0.8 + rand() * 1.2, 0.4 + rand() * 0.7);
    else if (roll < 0.75) growth.place('coral', at, 0.5 + rand() * 0.6, 0.5 + rand() * 0.8);
    else growth.place('frond', at, 0.5 + rand() * 0.4, 0.5 + rand() * 0.4);
  }
  footGrowth(world, growth, boxes(l.colliders)[0]!, rand);
  for (let i = 0; i < 9; i++) {
    const x = l.pos.x + (rand() - 0.5) * 70;
    const z = l.pos.z + (rand() < 0.5 ? -1 : 1) * (9 + rand() * 8);
    growth.place('kelp', new THREE.Vector3(x, world.seabedHeight(x, z) - 0.2, z), 0.8, (10 + rand() * 16) / KELP_HEIGHT, false, 0.1);
  }
  group.add(growth.build());
  group.add(debris(world, l.pos.x, l.pos.z, rand));
  return tagSolid(group, 'wreck');
}

/** Torn plates scattered on the silt around the wreck: low and free-standing, well under the hull clearance. */
function debris(world: World, cx: number, cz: number, rand: () => number): THREE.InstancedMesh {
  const COUNT = 26;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.12, 1),
    new THREE.MeshLambertMaterial({ color: 0x6e4430, flatShading: true }),
    COUNT,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < COUNT; i++) {
    const a = rand() * Math.PI * 2;
    const d = 12 + rand() * 28;
    const x = cx + Math.cos(a) * d * 1.4;
    const z = cz + Math.sin(a) * d * 0.6;
    q.setFromEuler(e.set((rand() - 0.5) * 0.8, rand() * Math.PI, (rand() - 0.5) * 0.8));
    const w = 1.5 + rand() * 3;
    m.compose(new THREE.Vector3(x, world.seabedHeight(x, z) + 0.1, z), q, new THREE.Vector3(w, 1, w * (0.4 + rand() * 0.5)));
    mesh.setMatrixAt(i, m);
  }
  mesh.computeBoundingSphere();
  return mesh;
}

/** The kelp forest: hundreds of tall ribbons, densest at its heart, over a floor of fronds and moss. */
function kelp(world: World): THREE.Group {
  const l = landmark(world, 'kelp');
  const rand = mulberry32(world.seed ^ 0x6e1f);
  const growth = new Growth(world.seed, rand);
  const RADIUS = 105;
  const at = (r: number) => {
    const a = rand() * Math.PI * 2;
    const x = l.pos.x + r * Math.cos(a);
    const z = l.pos.z + r * Math.sin(a);
    return new THREE.Vector3(x, world.seabedHeight(x, z) - 0.2, z);
  };
  for (let i = 0; i < 900; i++) {
    const r = RADIUS * Math.pow(rand(), 0.65);
    const h = (18 + rand() * 30) * (1 - 0.45 * (r / RADIUS));
    growth.place('kelp', at(r), 0.8 + rand() * 0.5, h / KELP_HEIGHT, false, 0.12);
  }
  for (let i = 0; i < 700; i++) {
    const p = at(RADIUS * 1.1 * Math.sqrt(rand()));
    if (rand() < 0.6) growth.place('frond', p, 0.8 + rand() * 0.6, 0.8 + rand() * 0.6);
    else growth.place('mound', p, 1 + rand() * 1.6, 0.6 + rand() * 1.2);
  }
  return growth.build();
}

export function createLandmarks(world: World): THREE.Group {
  const group = new THREE.Group();
  group.add(cliff(world), arch(world), stacks(world), wreck(world), kelp(world));
  return group;
}

