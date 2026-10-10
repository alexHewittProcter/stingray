import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHAIR_RADIUS, DAIS_HEIGHT } from '../sim/rooms';
import {
  CHAIR_FOOTPLATE_Y, CHAIR_HEAD_BAR_Y, CHAIR_LOWEST_Y, CHAIR_POLE_RADIUS, CHAIR_POLE_TOP_Y, CHAIR_POLE_Z, CHAIR_SEAT,
  createInjectorChair,
} from './injector-chair';
import { INJECTOR_CHAIR_NAME, createRooms } from './rooms';
import { ROOMS } from '../sim/rooms';
import { TROY_SEAT } from './troy';

// Phase 4, D2: the chair on its pole. "The whole chair fits inside a 0.6 m radius … (footplate included) so it passes
// the hatch and the port" — about the chair's vertical axis (the shaft's, and the port's and hatch's centre; see
// injector-chair.ts for why not the pole's own axis, which stands inside the same circle).

const chair = createInjectorChair();
chair.updateMatrixWorld(true);

function vertices(o: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  o.updateMatrixWorld(true);
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const p = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) out.push(new THREE.Vector3().fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld));
  });
  return out;
}

describe('the injector chair on its pole (phase 4, D2)', () => {
  const all = vertices(chair);

  it('fits inside CHAIR_RADIUS (0.6 m) of its vertical axis, footplate, pole and head bar included', () => {
    expect(CHAIR_RADIUS).toBe(0.6);
    expect(all.length).toBeGreaterThan(200);
    const reach = Math.max(...all.map((p) => Math.hypot(p.x, p.z)));
    expect(reach).toBeLessThanOrEqual(CHAIR_RADIUS);
  });

  it('hangs: nothing below CHAIR_LOWEST_Y, which clears the station dais', () => {
    expect(Math.min(...all.map((p) => p.y))).toBeCloseTo(CHAIR_LOWEST_Y, 6);
    expect(CHAIR_LOWEST_Y).toBeGreaterThan(DAIS_HEIGHT + 0.01);
  });

  it('has a chrome pole (r 0.05–0.08) behind the back, from the seat up through the head bar, 1.2 m on above it', () => {
    expect(CHAIR_POLE_RADIUS).toBeGreaterThanOrEqual(0.05);
    expect(CHAIR_POLE_RADIUS).toBeLessThanOrEqual(0.08);
    expect(CHAIR_POLE_Z).toBeGreaterThan(0.3); // behind the sitter (who faces −Z)
    expect(CHAIR_POLE_TOP_Y - CHAIR_HEAD_BAR_Y).toBeCloseTo(1.2, 6);
    // The topmost thing drawn is the pole's cap, on the pole's axis.
    const top = all.reduce((a, b) => (b.y > a.y ? b : a));
    expect(top.y).toBeCloseTo(CHAIR_POLE_TOP_Y, 6);
    expect(Math.hypot(top.x, top.z - CHAIR_POLE_Z)).toBeLessThan(0.08);
    // Something drawn on the pole's line at the head bar's height, between the seat and the top.
    const ray = new THREE.Raycaster(new THREE.Vector3(0, CHAIR_HEAD_BAR_Y, 2), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(chair, true).length).toBeGreaterThan(0);
  });

  it('has no column or carriage under the seat: nothing within 0.2 m of the axis between the footplate and the seat pan', () => {
    const under = all.filter((p) => Math.hypot(p.x, p.z) < 0.2 && p.y > CHAIR_FOOTPLATE_Y + 0.01 && p.y < 0.37);
    expect(under).toEqual([]);
  });

  it('keeps the seat point (CHAIR_SEAT) on the cushion and Troy\'s soles on the footplate', () => {
    const ray = new THREE.Raycaster(new THREE.Vector3(CHAIR_SEAT.x, 2, CHAIR_SEAT.z), new THREE.Vector3(0, -1, 0));
    // The head bar and pole are behind the seat: straight down onto its centre the first thing hit is the cushion.
    expect(2 - ray.intersectObject(chair, true)[0]!.distance).toBeCloseTo(CHAIR_SEAT.y, 6);
    expect(CHAIR_SEAT.y - TROY_SEAT.y).toBeCloseTo(CHAIR_FOOTPLATE_Y, 2);
    const plate = new THREE.Raycaster(new THREE.Vector3(0, 1, -0.45), new THREE.Vector3(0, -1, 0));
    const hit = plate.intersectObject(chair, true).find((h) => 1 - h.distance < 0.3)!;
    expect(1 - hit.distance).toBeCloseTo(CHAIR_FOOTPLATE_Y, 6);
  });

  it("the station's chair keeps its M5 tag (userData.interactable = 'chair') and its name", () => {
    const view = createRooms(ROOMS);
    const troys = view.group.getObjectByName(INJECTOR_CHAIR_NAME)!;
    expect(troys.userData.interactable).toBe('chair');
  });
});
