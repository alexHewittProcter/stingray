import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR_Y, ROOMS, SEAT, SHAFT_RADIUS } from '../sim/rooms';
import { createWorld } from '../sim/world';
import { TUBE_TOP_Y, createShaft, distanceToLine, inShaft, shaftLine } from './shaft';

// The drawn shaft (M6, T7; phase 4, D1): the tube runs straight down from the room's bore stub to the pen hall's
// ceiling over the seat, open at both ends, and its walls stand clear of the chair's path.

const interior = createWorld(1964).marineville.interior;
const line = shaftLine(ROOMS, interior);

describe('the drawn shaft (M6; phase 4, D1)', () => {
  it("is one vertical line from the control room's floor to the pen hall's ceiling, over the seat", () => {
    expect(line).toHaveLength(2);
    expect(line[0]).toEqual({ x: ROOMS.shaft[0]!.x, y: FLOOR_Y, z: ROOMS.shaft[0]!.z });
    expect(line[1]).toEqual({ x: SEAT.x, y: interior.pen.max.y, z: SEAT.z });
    expect([line[0]!.x, line[0]!.z]).toEqual([line[1]!.x, line[1]!.z]);
    expect(TUBE_TOP_Y).toBeLessThan(FLOOR_Y);
    expect(TUBE_TOP_Y).toBeGreaterThan(interior.pen.max.y);
  });

  it('every chair point above the hall is inside it, and the room and the open hall are not', () => {
    const [a, b] = ROOMS.shaft as [THREE.Vector3Like, THREE.Vector3Like];
    for (let f = 0.02; f < 1; f += 0.04) {
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      expect(inShaft(p, line), `y ${p.y}`).toBe(p.y < FLOOR_Y - 0.05 && p.y > interior.pen.max.y - 0.5);
    }
    expect(inShaft({ x: ROOMS.shaft[0]!.x, y: FLOOR_Y + 1, z: ROOMS.shaft[0]!.z }, line)).toBe(false);
    expect(inShaft({ x: ROOMS.shaft[0]!.x + 20, y: 50, z: ROOMS.shaft[0]!.z }, line)).toBe(false);
    expect(inShaft({ x: SEAT.x, y: SEAT.y + 2, z: SEAT.z }, line)).toBe(false); // the hall, over the sub
  });

  it("the tube's wall stands at SHAFT_RADIUS from the drawn line — clear of the chair — and ends plain at the ceiling", () => {
    const view = createShaft(ROOMS, interior);
    view.group.updateMatrixWorld(true);
    const tube = view.group.getObjectByName('shaft-tube') as THREE.Mesh;
    expect(tube).toBeTruthy();
    const pos = tube.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    let lowest = Infinity;
    let highest = -Infinity;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(tube.matrixWorld);
      lowest = Math.min(lowest, v.y);
      highest = Math.max(highest, v.y);
      expect(distanceToLine(v, line)).toBeCloseTo(SHAFT_RADIUS, 3);
    }
    expect(highest).toBeCloseTo(TUBE_TOP_Y, 6);
    expect(lowest).toBeCloseTo(interior.pen.max.y, 6);
    // Phase 3's hall housing (collar, flange, struts) is gone: the group is the tube and its light rings.
    const names: string[] = [];
    view.group.traverse((o) => { if (o !== view.group) names.push(o.name); });
    expect(names.sort()).toEqual(['shaft-rings', 'shaft-tube']);
  });
});
