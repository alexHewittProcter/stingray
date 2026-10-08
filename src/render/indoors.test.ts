import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOMS, SHAFT_RUN_Y } from '../sim/rooms';
import { COAST_Z, MARINEVILLE } from '../sim/world';
import { cameraIndoors, inRooms, indoorAmount, oceanInView } from './indoors';
import { VIEW_PRESETS, viewParam } from '../debug';
import { createRooms, walls } from './rooms';

const I = MARINEVILLE.interior;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const eye = (p: { x: number; y: number; z: number }) => v(p.x, p.y + 1.6, p.z);

const PEN_AND_BORE: Array<[string, THREE.Vector3]> = [
  ['the pen hall', v(0, 5, -1395)],
  ["the pen camera's place", v(I.cradle.pos.x + 27, I.cradle.raisedY + 1.6, I.cradle.pos.z + 4)],
  ['the pen ceiling corner', v(31.5, 19.5, -1449.5)],
  ['just inside the mouth', v(0, -40, COAST_Z - 1)],
  ...I.tunnel.centreline.filter((_, k) => k > 0 && k % 6 === 0).map((p, k): [string, THREE.Vector3] => [`the bore ${k}`, v(p.x, p.y + 10, p.z)]),
];

const ROOM_POINTS: Array<[string, THREE.Vector3]> = [
  ['the start', eye(ROOMS.start.pos)],
  ['the chair', eye(ROOMS.chair.pos)],
  ...ROOMS.rooms.map((r, k): [string, THREE.Vector3] => [`room ${k} (${r.id})`, v((r.min.x + r.max.x) / 2, r.min.y + 1.5, (r.min.z + r.max.z) / 2)]),
];

describe('the indoors switches (phase 3, Global constraints)', () => {
  it.each(PEN_AND_BORE)('counts %s as indoors, as phase 2 did', (_, p) => {
    expect(cameraIndoors(p)).toBe(true);
    expect(inRooms(p)).toBe(false);
    expect(oceanInView(p, 0)).toBe(false);
  });

  it.each(ROOM_POINTS)('counts %s as in the rooms and not indoors: the ocean side stays drawn through the windows', (_, p) => {
    expect(cameraIndoors(p)).toBe(false);
    expect(inRooms(p)).toBe(true);
    expect(oceanInView(p, 0)).toBe(true);
    expect(indoorAmount(p)).toBe(0);
  });

  it('counts the open sea, the air over the grounds and the shaft\'s closed tube as neither', () => {
    for (const p of [v(0, -40, -800), v(0, 60, -1200), v(0, 30, -1300), v(0, SHAFT_RUN_Y, -1300), v(0, SHAFT_RUN_Y, -1290)]) {
      expect(cameraIndoors(p)).toBe(false);
      expect(inRooms(p)).toBe(false);
    }
  });

  it('keeps the outdoor fade as it was inside Marineville', () => {
    expect(indoorAmount(v(0, -40, COAST_Z + 10))).toBe(0);
    expect(indoorAmount(v(0, -40, COAST_Z - 15))).toBeCloseTo(0.5, 9);
    expect(indoorAmount(v(0, 5, -1395))).toBe(1);
  });
});

describe('the greybox rooms (T1)', () => {
  it('are drawn only while the camera is in them, and their one lamp never leaves the scene', () => {
    const view = createRooms(ROOMS);
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(eye(ROOMS.start.pos));
    view.update(camera);
    expect(view.group.visible).toBe(true);
    expect(view.lamp.intensity).toBeGreaterThan(0);
    expect(view.lamp.parent).toBeNull(); // not a child of the group: hiding the group never drops it
    camera.position.set(0, 5, -1395);
    view.update(camera);
    expect(view.group.visible).toBe(false);
    expect(view.lamp.intensity).toBe(0);
  });

  it('draws no wall inside any room box (the doorways are open), every wall touching its own room', () => {
    for (const room of ROOMS.rooms) {
      for (const w of walls(room, ROOMS.rooms)) {
        for (const r of ROOMS.rooms) {
          const overlaps = w.min.x < r.max.x - 1e-9 && w.max.x > r.min.x + 1e-9 && w.min.z < r.max.z - 1e-9 && w.max.z > r.min.z + 1e-9
            && w.min.y < r.max.y - 1e-9 && w.max.y > r.min.y + 1e-9;
          expect(overlaps, `${room.id} wall vs ${r.id}`).toBe(false);
        }
      }
    }
  });
});

describe('the rooms\' ?view= presets (M10)', () => {
  it.each(Object.keys(VIEW_PRESETS))('puts the camera for ?view=%s inside the rooms, looking at a point inside them', (name) => {
    const n = viewParam(name)!;
    expect(n.length).toBe(6);
    expect(inRooms(v(n[0]!, n[1]!, n[2]!))).toBe(true);
    expect(inRooms(v(n[3]!, n[4]!, n[5]!))).toBe(true);
  });

  it('still reads the six-number form, and ignores anything else', () => {
    expect(viewParam('1,2,3,4,5,6')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(viewParam('1,2,3')).toBeNull();
    expect(viewParam('nowhere')).toBeNull();
    expect(viewParam(null)).toBeNull();
  });
});
