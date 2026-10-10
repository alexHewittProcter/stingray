import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOMS, SEAT, SHAFT_RADIUS, TOWER_AXIS } from '../sim/rooms';
import { CLIFF_TOP, COAST_Z, MARINEVILLE } from '../sim/world';
import { TOWER, TOWER_NAME, createMarineville } from './marineville';

// Phase 4 (D1): the control tower is drawn where the rooms are — plumb over Troy's seat in Pen 3 — so it can never
// again be moved without the rooms (landmarks.test.ts covers the sea's landmarks only; this pins the tower).

const marineville = createMarineville();
marineville.updateMatrixWorld(true);
const tower = marineville.getObjectByName(TOWER_NAME)!;

describe('the control tower (phase 4, D1)', () => {
  it('stands on TOWER_AXIS: its drawn axis is the rooms\' axis, in the world frame', () => {
    expect(tower).toBeDefined();
    const at = tower.getWorldPosition(new THREE.Vector3());
    expect(at.x).toBeCloseTo(TOWER_AXIS.x, 9);
    expect(at.z).toBeCloseTo(TOWER_AXIS.z, 9);
    expect(at.y).toBeCloseTo(CLIFF_TOP, 9); // on the clifftop
    expect(TOWER.z).toBeCloseTo(TOWER_AXIS.z - COAST_Z, 9);
  });

  it('stands over the pen, ≈ 290 m behind the cliff face — plumb over the seat and the cradle', () => {
    const pen = MARINEVILLE.interior.pen;
    expect(TOWER_AXIS.z).toBeGreaterThan(pen.min.z);
    expect(TOWER_AXIS.z).toBeLessThan(pen.max.z);
    expect(COAST_Z - TOWER_AXIS.z).toBeGreaterThan(280);
    expect(COAST_Z - TOWER_AXIS.z).toBeLessThan(300);
    expect(TOWER_AXIS.z).toBe(SEAT.z);
  });

  it("holds the shaft inside its stalk: the chair's tube within the stalk's 4.2 m top radius of the drawn axis", () => {
    const at = tower.getWorldPosition(new THREE.Vector3());
    const c = ROOMS.chair.pos;
    expect(Math.hypot(c.x - at.x, c.z - at.z) + SHAFT_RADIUS).toBeLessThanOrEqual(4.2);
  });

  it("draws the control room's floor level inside the gallery: the drum's top under the floor, the roof above the room", () => {
    // The drum's top (drumBottom + drumHeight above the clifftop) is the gallery's foot; the room's floor is just above it.
    const galleryFoot = CLIFF_TOP + TOWER.drumBottom + TOWER.drumHeight;
    const room = ROOMS.rooms[0]!;
    expect(room.min.y).toBeGreaterThan(galleryFoot);
    expect(room.min.y - galleryFoot).toBeLessThan(1);
    expect(room.max.y).toBeLessThan(galleryFoot + 5);
  });
});
