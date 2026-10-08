import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR_Y, ROOMS, SHAFT_RADIUS } from '../sim/rooms';
import { createWorld } from '../sim/world';
import { COLLAR_DEPTH, TUBE_TOP_Y, createShaft, distanceToLine, inShaft, shaftLine } from './shaft';

// The drawn shaft (M6, T7): the tube runs the chair's whole path from the lounge's bore stub to the housing's lip in
// the pen hall's ceiling, open at both ends, and its walls stand clear of the chair's path.

const interior = createWorld(1964).marineville.interior;
const line = shaftLine(ROOMS, interior);

describe('the drawn shaft (M6)', () => {
  it('follows the chair path from the lounge floor to the housing lip in the pen hall', () => {
    expect(line[0]).toEqual({ x: ROOMS.shaft[0]!.x, y: FLOOR_Y, z: ROOMS.shaft[0]!.z });
    expect(line.slice(1, -1)).toEqual(ROOMS.shaft.slice(1, -1));
    const seat = ROOMS.shaft.at(-1)!;
    expect(line.at(-1)).toEqual({ x: seat.x, y: interior.pen.max.y - COLLAR_DEPTH, z: seat.z });
    expect(TUBE_TOP_Y).toBeLessThan(FLOOR_Y);
  });

  it('every chair point is inside it, and the lounge and the open hall are not', () => {
    for (let k = 0; k < ROOMS.shaft.length - 1; k++) {
      const a = ROOMS.shaft[k]!;
      const b = ROOMS.shaft[k + 1]!;
      for (let f = 0.05; f < 1; f += 0.1) {
        const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
        if (p.y < interior.pen.max.y - COLLAR_DEPTH) continue; // the drop below the housing hangs in the hall
        expect(inShaft(p, line)).toBe(true);
      }
    }
    expect(inShaft({ x: ROOMS.shaft[0]!.x, y: FLOOR_Y + 1, z: ROOMS.shaft[0]!.z }, line)).toBe(false);
    expect(inShaft({ x: ROOMS.shaft[0]!.x + 20, y: 50, z: ROOMS.shaft[0]!.z }, line)).toBe(false);
  });

  it("the tube's wall stands at SHAFT_RADIUS from the drawn line — clear of the chair — and nothing is closed off", () => {
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
      // Mitred corners reach a little past the radius (away from the line); never inside it.
      const d = distanceToLine(v, line);
      expect(d).toBeGreaterThanOrEqual(SHAFT_RADIUS - 1e-3);
      expect(d).toBeLessThanOrEqual(SHAFT_RADIUS * Math.SQRT2 + 1e-3);
    }
    expect(highest).toBeLessThanOrEqual(TUBE_TOP_Y + 1e-6);
    expect(lowest).toBeGreaterThanOrEqual(interior.pen.max.y - COLLAR_DEPTH - 1e-6);
  });
});
