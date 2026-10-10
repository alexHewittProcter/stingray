import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONTROL_ROOM_PROPS, ROOMS, SHAFT_OPEN_TOP, SHAFT_RADIUS, STATION_CHAIRS, type Box } from '../sim/rooms';
import { CHAIR_FOOTPLATE_Y, CHAIR_SEAT, createInjectorChair } from './injector-chair';
import { BORE_RADIUS, INJECTOR_CHAIR_NAME, createRooms } from './rooms';
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

// Phase 4 (D2, T1 greybox): the injector station at the room's centre. The two checks above already run over every
// tagged mesh in the group — the station's included — so these add what is particular to it.

describe('the injector station (phase 4, D2 — greybox)', () => {
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

  it("leaves the bore open: no floor drawn across it, and its throat runs SHAFT_OPEN_TOP down into the tube — no cap (T7)", () => {
    const c = ROOMS.chair.pos;
    const across = shell.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < BORE_RADIUS - 0.1 && p.y > c.y - SHAFT_OPEN_TOP && p.y < c.y + 0.5);
    expect(across.slice(0, 3)).toEqual([]);
    const throat = shell.filter((p) => on(Math.hypot(p.x - c.x, p.z - c.z), BORE_RADIUS) && p.y < c.y - 0.5);
    expect(Math.min(...throat.map((p) => p.y))).toBeCloseTo(c.y - SHAFT_OPEN_TOP, 3);
    // render/shaft.ts draws the rest of the shaft: nothing closes the tube.
    const closing = shell.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < SHAFT_RADIUS - 0.1 && p.y < c.y - SHAFT_OPEN_TOP - 1.3); // below the flare
    expect(closing.slice(0, 3)).toEqual([]);
  });

  it("draws Phones's and Marina's chairs at their places on the dais", () => {
    const props = samples('roomProp');
    for (const [name, c] of Object.entries(STATION_CHAIRS)) {
      expect(props.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.1 && p.y > c.y + 0.3 && p.y < c.y + 0.6), name).toBe(true);
    }
  });

  it('keeps the station to a modest number of draw calls', () => {
    let meshes = 0;
    view.group.getObjectByName('station')!.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(20);
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
