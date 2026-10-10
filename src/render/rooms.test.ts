import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rideProgressAt, RIDE_SECONDS } from '../sim/ride';
import { CHAIR_RADIUS, CONTROL_ROOM_PROPS, DAIS_HEIGHT, ROOMS, SEAT, SHAFT_OPEN_TOP, SHAFT_RADIUS, STATION_CHAIRS, type Box } from '../sim/rooms';
import { CHAIR_FOOTPLATE_Y, CHAIR_LOWEST_Y, CHAIR_POLE_TOP_Y, CHAIR_POLE_Z, CHAIR_SEAT, createInjectorChair } from './injector-chair';
import { BORE_RADIUS, INJECTOR_CHAIR_NAME, LID_SECONDS, TUBE_TOP_Y, createRooms, lidWanted } from './rooms';
import { TROY_SEAT } from './troy';

// What you see is what you hit, in the control room (M1 art, Global constraints "art respects colliders"): the drawn
// shell — walls, windows, floor, ceiling — lies on or outside every room box (as interior.test.ts checks the pen's
// shell), and every drawn piece of furniture lies inside a sim/rooms.ts props box (as landmarks.test.ts checks the
// rocks), so Troy and the camera never pass through anything drawn, nor stop at anything undrawn.

const EPSILON = 1e-3;
const view = createRooms(ROOMS);
view.group.updateMatrixWorld(true);
const control = ROOMS.rooms.find((r) => r.id === 'controlRoom')!;

/** Every triangle of the tagged meshes, in world space: its corners and edge midpoints (instances included). */
function samples(tag: 'roomShell' | 'roomProp'): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const instance = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  view.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData[tag]) return;
    const position = o.geometry.attributes.position as THREE.BufferAttribute;
    const index = o.geometry.index;
    const count = index ? index.count : position.count;
    const copies = o instanceof THREE.InstancedMesh ? o.count : 1;
    for (let c = 0; c < copies; c++) {
      if (o instanceof THREE.InstancedMesh) o.getMatrixAt(c, instance);
      else instance.identity();
      m.multiplyMatrices(o.matrixWorld, instance);
      const at = (k: number) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(m);
      for (let k = 0; k < count; k += 3) {
        const [a, b, d] = [at(k), at(k + 1), at(k + 2)];
        out.push(a, b, d, a.clone().lerp(b, 0.5), b.clone().lerp(d, 0.5), d.clone().lerp(a, 0.5));
      }
    }
  });
  return out;
}

const strictlyInside = (p: THREE.Vector3, b: Box) =>
  p.x > b.min.x + EPSILON && p.x < b.max.x - EPSILON
  && p.y > b.min.y + EPSILON && p.y < b.max.y - EPSILON
  && p.z > b.min.z + EPSILON && p.z < b.max.z - EPSILON;
const within = (p: THREE.Vector3, b: Box) =>
  p.x >= b.min.x - EPSILON && p.x <= b.max.x + EPSILON
  && p.y >= b.min.y - EPSILON && p.y <= b.max.y + EPSILON
  && p.z >= b.min.z - EPSILON && p.z <= b.max.z + EPSILON;

describe('the control room shell (M1 art)', () => {
  const shell = samples('roomShell');

  it('has a floor, a ceiling and a wall on every side of the room box', () => {
    const { min, max } = control;
    const inSpan = (p: THREE.Vector3) => p.x >= min.x - 0.3 && p.x <= max.x + 0.3 && p.z >= min.z - 0.3 && p.z <= max.z + 0.3;
    const on = (v: number, face: number) => Math.abs(v - face) < EPSILON;
    const near = shell.filter(inSpan);
    expect(near.some((p) => on(p.y, min.y))).toBe(true);
    expect(near.some((p) => on(p.y, max.y))).toBe(true);
    expect(near.some((p) => on(p.x, min.x))).toBe(true);
    expect(near.some((p) => on(p.x, max.x))).toBe(true);
    expect(near.some((p) => on(p.z, min.z))).toBe(true);
    expect(near.some((p) => on(p.z, max.z))).toBe(true);
  });

  it('draws every wall, window, floor and ceiling vertex on or outside every room box (the doorway stays open)', () => {
    expect(shell.length).toBeGreaterThan(1000);
    const inside = shell.filter((p) => ROOMS.rooms.some((r) => strictlyInside(p, r)));
    expect(inside.slice(0, 3)).toEqual([]);
  });
});

describe('the control room furniture (M1 art)', () => {
  const props = samples('roomProp');

  it('draws every piece inside one of the props colliders', () => {
    expect(props.length).toBeGreaterThan(1000);
    const outside = props.filter((p) => !ROOMS.props.some((b) => within(p, b)));
    expect(outside.slice(0, 3)).toEqual([]);
  });

  it('draws something in every named control-room collider — none is an invisible wall', () => {
    for (const [name, b] of Object.entries(CONTROL_ROOM_PROPS)) {
      expect(props.some((p) => strictlyInside(p, b)), name).toBe(true);
    }
  });

  it('keeps every control-room collider in the control room and on its floor', () => {
    for (const [name, b] of Object.entries(CONTROL_ROOM_PROPS)) {
      expect(b.min.y, name).toBe(control.min.y);
      expect(b.min.x >= control.min.x && b.max.x <= control.max.x && b.min.z >= control.min.z && b.max.z <= control.max.z, name).toBe(true);
      expect(b.max.y, name).toBeLessThanOrEqual(control.max.y);
    }
  });
});

describe('the rooms group (Global constraints)', () => {
  it('holds no lights (the light count never changes as the camera comes and goes)', () => {
    const lights: THREE.Object3D[] = [];
    view.group.traverse((o) => { if (o instanceof THREE.Light) lights.push(o); });
    expect(lights).toEqual([]);
  });

  it('keeps the dressed room to a modest number of draw calls', () => {
    const room = view.group.getObjectByName('controlRoom')!;
    let meshes = 0;
    room.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(40);
  });
});

// Phase 4 (D2; T1 greybox, T2 dressed): the injector station at the room's centre. The two checks above already run
// over every tagged mesh in the group — the station's included, the chairs, poles, sleeves and the shut lid — so these
// add what is particular to it.

describe('the injector station (phase 4, D2)', () => {
  const shell = samples('roomShell');
  const on = (v: number, face: number) => Math.abs(v - face) < EPSILON;

  it('stands the bore inside the dais: no walkable floor is cut by it', () => {
    const c = ROOMS.chair.pos;
    const d = CONTROL_ROOM_PROPS.station;
    expect(c.x - BORE_RADIUS).toBeGreaterThanOrEqual(d.min.x - 1e-9);
    expect(c.x + BORE_RADIUS).toBeLessThanOrEqual(d.max.x + 1e-9);
    expect(c.z - BORE_RADIUS).toBeGreaterThanOrEqual(d.min.z - 1e-9);
    expect(c.z + BORE_RADIUS).toBeLessThanOrEqual(d.max.z + 1e-9);
    expect(BORE_RADIUS).toBe(1.2); // D1
  });

  it("leaves the bore open below its lid: no shell across it, and its throat runs SHAFT_OPEN_TOP down into the tube — no cap (T7)", () => {
    const c = ROOMS.chair.pos;
    const across = shell.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < BORE_RADIUS - 0.1 && p.y > c.y - SHAFT_OPEN_TOP && p.y < c.y + 0.5);
    expect(across.slice(0, 3)).toEqual([]);
    const throat = shell.filter((p) => on(Math.hypot(p.x - c.x, p.z - c.z), BORE_RADIUS) && p.y < c.y - 0.5);
    expect(Math.min(...throat.map((p) => p.y))).toBeCloseTo(c.y - SHAFT_OPEN_TOP, 3);
    // render/shaft.ts draws the rest of the shaft: nothing closes the tube.
    const closing = shell.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < SHAFT_RADIUS - 0.1 && p.y < c.y - SHAFT_OPEN_TOP - 1.3); // below the flare
    expect(closing.slice(0, 3)).toEqual([]);
  });

  it('draws the three chairs at STATION_CHAIRS, seats over their points, hanging clear of the dais', () => {
    const props = samples('roomProp');
    for (const [name, c] of Object.entries(STATION_CHAIRS)) {
      expect(props.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.1 && p.y > c.y + 0.3 && p.y < c.y + 0.6), name).toBe(true);
      // Nothing of a chair (inside its CHAIR_RADIUS column) between the dais's top and its lowest point.
      const gap = props.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < CHAIR_RADIUS - 0.01 && p.y > c.y + DAIS_HEIGHT + 0.002 && p.y < c.y + CHAIR_LOWEST_Y - 0.002);
      expect(gap.slice(0, 3), name).toEqual([]);
    }
  });

  it("runs each chair's pole on up into a sleeve under a ceiling boss (drawn on the pole's line up to the ceiling)", () => {
    const props = samples('roomProp');
    const ceiling = control.max.y;
    for (const [name, c] of Object.entries(STATION_CHAIRS)) {
      const pole = { x: c.x, z: c.z - CHAIR_POLE_Z }; // the seat faces south (yaw π): the pole, behind it, is north
      const onLine = props.filter((p) => Math.hypot(p.x - pole.x, p.z - pole.z) < 0.12);
      expect(Math.max(...onLine.map((p) => p.y)), name).toBeCloseTo(ceiling, 3);
      // Unbroken: a ray across the pole's line hits something on it every 10 cm from the seat to the ceiling.
      for (let y = c.y + 0.5; y < ceiling - 0.01; y += 0.1) {
        const ray = new THREE.Raycaster(new THREE.Vector3(pole.x + 3, y, pole.z), new THREE.Vector3(-1, 0, 0));
        const on = ray.intersectObject(view.group, true).some((h) => Math.hypot(h.point.x - pole.x, h.point.z - pole.z) < 0.1);
        expect(on, `${name} ${(y - c.y).toFixed(1)}`).toBe(true);
      }
    }
    expect(CHAIR_POLE_TOP_Y).toBeLessThan(ceiling - ROOMS.chair.pos.y);
  });

  it("dresses the dais's front (the hazard band, the INJECTOR STATION plate) and the bay wall behind (maroon, gold rail, grille)", () => {
    const names = new Set<string>();
    view.group.getObjectByName('station')!.traverse((o) => {
      if (o instanceof THREE.Mesh) names.add((o.material as THREE.Material).type + ':' + ((o.material as THREE.MeshLambertMaterial).color?.getHexString() ?? ''));
    });
    expect(names.has('MeshLambertMaterial:7b3b35')).toBe(true); // STATION_MAROON
    const front = samples('roomProp').filter((p) => Math.abs(p.z - CONTROL_ROOM_PROPS.station.max.z) < EPSILON && p.y > ROOMS.chair.pos.y);
    expect(front.length).toBeGreaterThan(0);
  });

  it('keeps the station to a modest number of draw calls', () => {
    let meshes = 0;
    view.group.getObjectByName('station')!.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    // T1: 20. T2: + the bay wall's silver band and gold rail, the decal atlas, the lit ring — and the lid's two leaves,
    // each its own mesh because they swing. Phase 4 T3: + Troy's chair's pole above its head bar, its own mesh so it can
    // be hidden aboard (D3).
    expect(meshes).toBeLessThanOrEqual(23);
  });
});

describe("the bore's lid (phase 4, T2)", () => {
  const rooms = createRooms(ROOMS);
  rooms.group.updateMatrixWorld(true);
  const chair = rooms.group.getObjectByName(INJECTOR_CHAIR_NAME)!;
  const home = chair.parent!;
  const elsewhere = new THREE.Group(); // the scene, while riding (main.ts re-parents the chair)
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(ROOMS.start.pos.x, ROOMS.start.pos.y + 1.6, ROOMS.start.pos.z);
  const c = ROOMS.chair.pos;
  const leaves = ['bore-lid-west', 'bore-lid-east'].map((n) => rooms.group.getObjectByName(n) as THREE.Mesh);
  const frames = (seconds: number, at?: (t: number) => number) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      if (at) chair.position.y = at(t);
      rooms.update(camera, false, 1 / 60);
    }
  };
  const ride = (t: number) => c.y - rideProgressAt(t) * (c.y - SEAT.y);
  const goHome = () => {
    home.add(chair);
    chair.position.set(c.x, c.y, c.z);
    frames(1);
  };

  it('is wanted only while the chair is riding above the tube top', () => {
    expect(lidWanted(false, c.y)).toBe(false);
    expect(lidWanted(true, c.y)).toBe(true);
    expect(lidWanted(true, TUBE_TOP_Y + 0.1)).toBe(true);
    expect(lidWanted(true, TUBE_TOP_Y - 0.1)).toBe(false);
    expect(lidWanted(false, SEAT.y)).toBe(false); // aboard
  });

  it('is shut on foot: it covers the bore flush with the dais (Phones\'s chair overhangs a closed floor)', () => {
    goHome();
    expect(rooms.lid()).toBe(0);
    rooms.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(c.x - 0.3, c.y + 0.11, c.z + 0.7), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(leaves, false)[0];
    expect(hit).toBeDefined();
    expect(c.y + 0.11 - hit!.distance).toBeGreaterThan(c.y + DAIS_HEIGHT - 0.01);
    expect(c.y + 0.11 - hit!.distance).toBeLessThanOrEqual(c.y + DAIS_HEIGHT);
    // Phones's chair stands within the bore's circle — the reason for the lid (T1's hand-off).
    expect(Math.hypot(STATION_CHAIRS.phones.x - c.x, STATION_CHAIRS.phones.z - c.z)).toBeLessThan(BORE_RADIUS + CHAIR_RADIUS);
  });

  it('opens as the chair sets off (within LID_SECONDS) and never touches it on the way down; shuts below the tube top', () => {
    goHome();
    elsewhere.add(chair);
    chair.position.set(c.x, c.y, c.z);
    // The chair's drawn points in its own frame (it does not turn on the way down).
    const local: THREE.Vector3[] = [];
    chair.updateMatrixWorld(true);
    const inv = chair.matrixWorld.clone().invert();
    chair.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) local.push(new THREE.Vector3().fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
    });
    const hits: string[] = [];
    let opened = Infinity;
    for (let t = 0; t <= 1.2; t += 1 / 60) {
      chair.position.y = ride(t);
      rooms.update(camera, false, 1 / 60);
      if (rooms.lid() === 1 && opened === Infinity) opened = t;
      rooms.group.updateMatrixWorld(true);
      chair.updateMatrixWorld(true);
      for (const [k, leaf] of leaves.entries()) {
        const side = k === 0 ? -1 : 1;
        const R = BORE_RADIUS - 0.08;
        const toLeaf = leaf.matrixWorld.clone().invert().multiply(chair.matrixWorld);
        for (const p of local) {
          const q = p.clone().applyMatrix4(toLeaf);
          const xb = q.x + side * R;
          if (q.y > -0.03 && q.y < 0 && xb * xb + q.z * q.z < R * R && side * xb > 0) {
            hits.push(`${t.toFixed(3)} s leaf ${side}`);
            break;
          }
        }
      }
    }
    expect(hits.slice(0, 3)).toEqual([]);
    expect(opened).toBeLessThanOrEqual(LID_SECONDS + 1 / 30);
    // Below the tube's top it shuts behind the chair.
    const below = (() => { let t = 0; while (ride(t) > TUBE_TOP_Y) t += 1 / 60; return t; })();
    frames(below + LID_SECONDS + 0.1, (t) => ride(Math.min(RIDE_SECONDS, below + t)));
    expect(rooms.lid()).toBe(0);
    goHome();
  });

  it('opens again for the way up once the chair is above the tube top, and is shut when Troy stands up', () => {
    elsewhere.add(chair);
    chair.position.set(c.x, SEAT.y, c.z);
    frames(1);
    expect(rooms.lid()).toBe(0);
    chair.position.y = TUBE_TOP_Y + 3;
    frames(LID_SECONDS + 0.05);
    expect(rooms.lid()).toBe(1);
    goHome();
    expect(rooms.lid()).toBe(0);
  });
});

describe("Troy's injector chair (M8)", () => {
  const chairs: THREE.Object3D[] = [];
  view.group.traverse((o) => { if (o.userData.interactable === 'chair') chairs.push(o); });

  it("is one object, the only one tagged 'chair', standing at ROOMS.chair", () => {
    expect(chairs).toHaveLength(1);
    const chair = chairs[0]!;
    expect(chair.name).toBe(INJECTOR_CHAIR_NAME);
    expect(view.group.getObjectByName(INJECTOR_CHAIR_NAME)).toBe(chair);
    const at = chair.getWorldPosition(new THREE.Vector3());
    expect([at.x, at.y, at.z]).toEqual([ROOMS.chair.pos.x, ROOMS.chair.pos.y, ROOMS.chair.pos.z]);
  });

  it('faces the side Troy walks up from (its forward, −Z, opposite his facing at ROOMS.chair.yaw)', () => {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(chairs[0]!.getWorldQuaternion(new THREE.Quaternion()));
    const his = new THREE.Vector3(-Math.sin(ROOMS.chair.yaw), 0, -Math.cos(ROOMS.chair.yaw));
    expect(forward.dot(his)).toBeCloseTo(-1, 6);
  });

  it("seats Troy: CHAIR_SEAT is the cushion's top centre, and his soles land on the footplate", () => {
    const chair = createInjectorChair();
    chair.updateMatrixWorld(true);
    // Straight down onto the seat's centre from above: the first thing hit is the cushion's top.
    const ray = new THREE.Raycaster(new THREE.Vector3(CHAIR_SEAT.x, 2, CHAIR_SEAT.z), new THREE.Vector3(0, -1, 0));
    const cushion = 2 - ray.intersectObject(chair, true)[0]!.distance;
    expect(cushion).toBeCloseTo(CHAIR_SEAT.y, 6);
    expect(CHAIR_SEAT.y - TROY_SEAT.y).toBeCloseTo(CHAIR_FOOTPLATE_Y, 2);
    expect(new THREE.Box3().setFromObject(chair).min.y).toBeGreaterThanOrEqual(-1e-6); // nothing below its origin on the floor
  });
});
