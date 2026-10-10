import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Game } from '../game/game';
import { ROOMS, TOWER_AXIS, inRoomBox } from '../sim/rooms';
import { controlRoom } from '../sim/session';
import { nearestWalkable, onFoot, walkable } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';
import { FIXED_DT as DT, createWorld } from '../sim/world';
import { yawOfView } from '../input/troy';
import { cameraBoxes, createFollowCamera, followConfine, troyAt } from './follow-camera';
import { type OrbitView, initialOrbit, orbitBy, orbitTakeYaw, orbitView, orbitZoom } from './orbit';

// M4: the follow camera — behind and above Troy, its heading following his facing only while he walks, the orbit
// about his pivot, and the walls: from anywhere he can stand and any orbit, the camera is inside the room he is in.

const camera = () => new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 8000);
const still = (x: number, y: number, z: number, yaw: number) => ({ pos: { x, y, z }, yaw, speed: 0 });
const forward = (c: THREE.Camera) => new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
const orbit = (yaw: number, pitch = 0, zoom = 1): OrbitView => ({ yaw, pitch, zoom, k: 1 });
/** A point on the control room's floor relative to the tower's axis (phase 4, D1: the rooms are re-based on it). */
const room = (dx: number, dz: number) => ({ x: TOWER_AXIS.x + dx, z: TOWER_AXIS.z + dz });
/** Open floor east of the station, with a whole boom's room on every side. */
const OPEN = room(4, 2.5);

/** Every walkable point of a 1 m grid over the rooms (M4's test). */
function walkableGrid(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  const seen = new Set<string>();
  for (const r of ROOMS.rooms) {
    for (let x = Math.ceil(r.min.x); x <= r.max.x; x++) {
      for (let z = Math.ceil(r.min.z); z <= r.max.z; z++) {
        const p = { x, y: r.min.y, z };
        const key = `${x},${z}`;
        if (seen.has(key) || !walkable(p, ROOMS)) continue;
        seen.add(key);
        out.push(p);
      }
    }
  }
  return out;
}

describe('the follow camera (M4)', () => {
  it('rests 3.6 m from a pivot 1.5 m above his feet, behind him, looking 18° down, fov 60', () => {
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    const s = ROOMS.start;
    follow.snap(still(s.pos.x, s.pos.y, s.pos.z, 0));
    const pivot = new THREE.Vector3(s.pos.x, s.pos.y + 1.5, s.pos.z);
    expect(c.position.distanceTo(pivot)).toBeCloseTo(T.followBoom, 6);
    // Facing north (yaw 0), behind is south (+z).
    expect(c.position.z).toBeGreaterThan(pivot.z);
    expect(c.position.x).toBeCloseTo(pivot.x, 6);
    const f = forward(c);
    expect(Math.asin(-f.y)).toBeCloseTo((18 * Math.PI) / 180, 6);
    expect(yawOfView(f)).toBeCloseTo(0, 6);
    expect(c.fov).toBe(60);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('the un-orbited view looks the way he faces (yaw %s)', (yaw) => {
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    follow.snap(still(OPEN.x, ROOMS.start.pos.y, OPEN.z, yaw));
    // Compared round the circle: π and −π are the same heading.
    expect(Math.abs(wrap(yawOfView(forward(c)) - yaw))).toBeLessThan(1e-6);
  });

  it('turns with him only while he walks, with a lag; standing still the heading holds', () => {
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    const t = still(OPEN.x, ROOMS.start.pos.y, OPEN.z, 0);
    follow.snap(t);
    // He turns on the spot (speed 0): the camera does not follow.
    t.yaw = 1;
    for (let k = 0; k < 120; k++) follow.update(t, DT);
    expect(follow.heading()).toBe(0);
    // Walking: after one lag time about 63 % of the turn, after several almost all of it.
    t.speed = 1;
    for (let k = 0; k < Math.round(T.followYawLag / DT); k++) follow.update(t, DT);
    expect(follow.heading()).toBeGreaterThan(0.55);
    expect(follow.heading()).toBeLessThan(0.7);
    for (let k = 0; k < 300; k++) follow.update(t, DT);
    expect(follow.heading()).toBeCloseTo(1, 3);
  });

  it('from every walkable 1 m grid point and 8 orbit yaws, the camera is inside the room he is in, ≥ 0.3 m in', () => {
    const points = walkableGrid();
    expect(points.length).toBeGreaterThan(150); // phase 4: the control room alone (phase 3's three rooms had > 300)
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    let shortened = 0;
    for (const p of points) {
      const boxes = cameraBoxes(ROOMS, p, 0.3);
      for (let k = 0; k < 8; k++) {
        for (const view of [orbit((k * Math.PI) / 4), orbit((k * Math.PI) / 4, 1.2, 1.8), orbit((k * Math.PI) / 4, -0.5, 1.8)]) {
          follow.snap(still(p.x, p.y, p.z, 0.3), view);
          const at = c.position;
          expect(inRoomBox(at, ROOMS)).toBe(true);
          expect(boxes.some((b) => at.x >= b.min.x && at.x <= b.max.x && at.y >= b.min.y && at.y <= b.max.y && at.z >= b.min.z && at.z <= b.max.z)).toBe(true);
          if (at.distanceTo(new THREE.Vector3(p.x, p.y + 1.5, p.z)) < T.followBoom * view.zoom - 0.01) shortened++;
        }
      }
    }
    // The walls did shorten booms (the test exercises them).
    expect(shortened).toBeGreaterThan(100);
  });

  it('never sees through a wall: the whole boom, pivot to camera, stays inside the room and clear of props', () => {
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    for (const p of walkableGrid()) {
      const inside = followConfine(ROOMS, p);
      for (let k = 0; k < 8; k++) {
        follow.snap(still(p.x, p.y, p.z, 0), orbit((k * Math.PI) / 4, 0.4, 1.5));
        const pivot = new THREE.Vector3(p.x, p.y + 1.5, p.z);
        if (!inside(pivot)) continue; // the walk then starts from the nearest inside point (covered above)
        for (let i = 0; i <= 20; i++) expect(inside(pivot.clone().lerp(c.position, i / 20))).toBe(true);
      }
    }
  });

  it('a boom the walls shortened lengthens again gradually, never in one jump', () => {
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    // By the control room's east wall, facing west: behind him the boom runs into the wall.
    const aisle = room(7.2, 2.5);
    const at = nearestWalkable(aisle.x, aisle.z, ROOMS);
    const t = { pos: at, yaw: Math.PI / 2, speed: 0 }; // facing west: the boom points east into the wall
    follow.snap(t);
    const pivot = new THREE.Vector3(at.x, at.y + 1.5, at.z);
    const short = c.position.distanceTo(pivot);
    expect(short).toBeLessThan(2);
    t.yaw = 0; // now the boom points south along the aisle, with room for all of it
    t.speed = 1;
    follow.update(t, DT);
    expect(c.position.distanceTo(pivot)).toBeLessThan(short + 0.1);
  });

  it('troyAt interpolates his feet and facing between steps (the short way round)', () => {
    const a = onFoot({ pos: { x: 0, y: 0, z: 0 }, yaw: 3 });
    const b = { ...onFoot({ pos: { x: 1, y: 0, z: -2 }, yaw: -3 }), speed: 2 };
    const t = troyAt(a, b, 0.5);
    expect(t.pos).toEqual({ x: 0.5, y: 0, z: -1 });
    expect(Math.abs(wrap(t.yaw - Math.PI))).toBeLessThan(1e-9);
    expect(t.speed).toBe(2);
  });
});

describe('walking with the follow camera (M3 + M4, as main.ts wires them)', () => {
  it('W held for 2 s walks him away from the camera, and the camera turns with him', () => {
    const world = createWorld(1964);
    // In the control room's east aisle, facing west; the camera behind him looks west too.
    const east = room(6, 7);
    const start = nearestWalkable(east.x, east.z, ROOMS);
    const game = new Game(world, { ...controlRoom(world, ROOMS), troy: onFoot({ pos: start, yaw: Math.PI / 2 }) });
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    follow.snap(troyAt(game.state.troy, game.state.troy, 1));
    expect(yawOfView(forward(c))).toBeCloseTo(Math.PI / 2, 6);
    // Orbit the camera round to look north (as J L or a drag would, then handed to the heading as he walks — main.ts),
    // then hold W: he turns and walks north, away from the camera, and the camera stays behind him.
    follow.turn(-Math.PI / 2);
    follow.update(troyAt(game.state.troy, game.state.troy, 1), DT);
    for (let k = 0; k < Math.round(2 / DT); k++) {
      game.cameraYaw = yawOfView(forward(c)); // main.ts: the last drawn frame's yaw
      game.step(new Set(['KeyW']), DT);
      follow.update(troyAt(game.lastState.troy, game.state.troy, 1), DT);
    }
    const troy = game.state.troy;
    expect(start.z - troy.pos.z).toBeGreaterThan(4); // north is −z
    // While he turns from west to north the heading starts after him (it follows his facing once he moves), so he ends
    // a little west of north — and the camera is square behind him.
    expect(Math.abs(troy.pos.x - start.x)).toBeLessThan(1.5);
    expect(Math.abs(wrap(troy.yaw))).toBeLessThan(0.4);
    expect(Math.abs(wrap(follow.heading() - troy.yaw))).toBeLessThan(0.02);
    expect(Math.abs(wrap(game.cameraYaw - troy.yaw))).toBeLessThan(0.02);
  });

  it('turning on the spot with D (camera fixed while he stands) and then walking: the heading follows his facing', () => {
    const world = createWorld(1964);
    const mid = room(0, 3.5);
    const start = nearestWalkable(mid.x, mid.z, ROOMS);
    const game = new Game(world, { ...controlRoom(world, ROOMS), troy: onFoot({ pos: start, yaw: 0 }) });
    const c = camera();
    const follow = createFollowCamera(c, ROOMS);
    follow.snap(troyAt(game.state.troy, game.state.troy, 1));
    // D: to the camera's right — east. He turns east and walks; the camera swings round behind him as he goes.
    for (let k = 0; k < Math.round(0.5 / DT); k++) {
      game.cameraYaw = yawOfView(forward(c));
      game.step(new Set(['KeyD']), DT);
      follow.update(troyAt(game.lastState.troy, game.state.troy, 1), DT);
    }
    expect(game.state.troy.pos.x).toBeGreaterThan(start.x + 0.5);
    expect(follow.heading()).toBeLessThan(-0.2); // turning right is −yaw
  });
});

describe('orbitTakeYaw (M4 on foot)', () => {
  it('hands over the visible yaw and keeps the pitch and zoom; an orbit with nothing else left comes to rest', () => {
    const swung = orbitBy(initialOrbit(), 0.8, 0);
    const a = orbitTakeYaw(swung);
    expect(a.yaw).toBeCloseTo(0.8, 12);
    expect(a.orbit).toEqual(initialOrbit());
    const lifted = orbitZoom(orbitBy(initialOrbit(), 0.8, 0.3), 200);
    const b = orbitTakeYaw(lifted);
    expect(b.yaw).toBeCloseTo(0.8, 12);
    expect(orbitView(b.orbit)).toMatchObject({ yaw: 0, pitch: orbitView(lifted).pitch, zoom: orbitView(lifted).zoom });
    expect(orbitTakeYaw(initialOrbit()).yaw).toBe(0);
  });
});

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
