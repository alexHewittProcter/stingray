import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LaunchState } from '../sim/launch';
import { standby } from '../sim/launch';
import { CHAIR_RADIUS, FLOOR_Y, ROOMS, SEAT, SHAFT_RADIUS } from '../sim/rooms';
import { createWorld } from '../sim/world';
import {
  BOARDING_SHUT, type Boarding, LID_LEAD, LID_SECONDS, POLE_SECONDS, PORT_Y, chairBelowPort, chairNearPort, poleWanted, stepBoarding,
} from './boarding';
import { CHAIR_POLE_TOP_Y } from './injector-chair';
import { createPen, shellMeshes } from './pen';
import {
  ANNULUS_TOP_Y, COLLAR_DEPTH, DUMMY_PORT_RADIUS, LONG_POLE_RADIUS, PORT_RADIUS, PORT_SPACING, TUBE_TOP_Y, createShaft,
  distanceToLine, inShaft, portsOf, shaftLine,
} from './shaft';

// The drawn shaft (M6, T7; phase 4, D1): the tube runs straight down from the room's bore stub to the pen hall's
// ceiling over the seat, its foot closing down in an annulus to the port (D3), and its walls stand clear of the chair's
// path. The ports, the lid, the long pole and the boarding state that drives them and the hatch (D3, T3).

const world = createWorld(1964);
const interior = world.marineville.interior;
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

  it("the tube's wall stands at SHAFT_RADIUS from the drawn line — clear of the chair — down to the annulus", () => {
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
    expect(lowest).toBeCloseTo(ANNULUS_TOP_Y, 5);
    expect(ANNULUS_TOP_Y).toBeGreaterThan(interior.pen.max.y);
  });

  it('closes its foot down in an annulus from SHAFT_RADIUS to the port at the hall ceiling (D1, D3)', () => {
    const view = createShaft(ROOMS, interior);
    view.group.updateMatrixWorld(true);
    const annulus = view.group.getObjectByName('shaft-annulus') as THREE.Mesh;
    const pos = annulus.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(annulus.matrixWorld);
      const r = Math.hypot(v.x - SEAT.x, v.z - SEAT.z);
      if (Math.abs(v.y - ANNULUS_TOP_Y) < 1e-4) expect(r).toBeCloseTo(SHAFT_RADIUS, 3);
      else {
        expect(v.y).toBeCloseTo(interior.pen.max.y, 4);
        expect(r).toBeCloseTo(PORT_RADIUS, 3);
      }
    }
  });
});

describe('the ports in the pen hall ceiling (phase 4, D3)', () => {
  const ports = portsOf(ROOMS, interior);
  const view = createShaft(ROOMS, interior);
  view.group.updateMatrixWorld(true);
  const boxOf = (name: string) => new THREE.Box3().setFromObject(view.group.getObjectByName(name)!);

  it("Troy's is real, r 0.8, at (SEAT.x, pen.max.y, SEAT.z); Phones's a dummy, r 0.5, 1.6 m west; they do not overlap", () => {
    expect(ports.troy).toEqual({ x: SEAT.x, y: interior.pen.max.y, z: SEAT.z, radius: 0.8 });
    expect(ports.phones).toEqual({ x: SEAT.x - 1.6, y: interior.pen.max.y, z: SEAT.z, radius: 0.5 });
    expect(ports.troy.radius + ports.phones.radius).toBeLessThan(ports.troy.x - ports.phones.x);
    expect(PORT_RADIUS).toBe(0.8);
    expect(DUMMY_PORT_RADIUS).toBe(0.5);
    expect(PORT_SPACING).toBe(1.6);
  });

  it('each has a short collar (≤ 0.6 m) under the ceiling, a flange and a lit ring at its lip, centred on its port', () => {
    expect(COLLAR_DEPTH).toBeLessThanOrEqual(0.6);
    for (const [p, name] of [[ports.troy, 'port-troy'], [ports.phones, 'port-phones']] as const) {
      const collar = boxOf(`${name}-collar`);
      expect(collar.max.y).toBeCloseTo(p.y, 4);
      expect(p.y - collar.min.y).toBeLessThanOrEqual(0.6);
      const c = collar.getCenter(new THREE.Vector3());
      expect(c.x).toBeCloseTo(p.x, 3);
      expect(c.z).toBeCloseTo(p.z, 3);
      const ring = view.group.getObjectByName(`${name}-ring`) as THREE.Mesh;
      expect(ring.material).toBeInstanceOf(THREE.MeshBasicMaterial); // self-lit
      expect(boxOf(`${name}-flange`).max.y).toBeLessThan(p.y);
    }
    // The dummy is shut for good: a disc across its lip.
    const lid = boxOf('port-phones-lid');
    expect(lid.max.x - lid.min.x).toBeCloseTo(2 * DUMMY_PORT_RADIUS, 2);
  });

  it("the pen hall's ceiling is open at Troy's port and solid at Phones's", () => {
    const pen = createPen(interior);
    pen.root.updateMatrixWorld(true);
    const ceiling = shellMeshes(pen.root).filter((m) => (m.material as THREE.Material).name === 'pen-ceiling');
    expect(ceiling).toHaveLength(1);
    const hits = (x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, interior.pen.max.y - 2, z), new THREE.Vector3(0, 1, 0)).intersectObjects(ceiling).length;
    expect(hits(ports.troy.x, ports.troy.z)).toBe(0);
    expect(hits(ports.troy.x + 0.7, ports.troy.z)).toBe(0); // within the port
    expect(hits(ports.phones.x, ports.phones.z)).toBe(1);
    expect(hits(ports.troy.x + 3, ports.troy.z + 3)).toBe(1);
  });

  it("Troy's lid swings open by the boarding state and shut again", () => {
    const leaf = view.group.getObjectByName('port-lid-west-hinge')!;
    view.update({ lid: 0, pole: 0, hatch: 0 }, null, 0);
    expect(leaf.rotation.z).toBe(0);
    view.update({ lid: 1, pole: 0, hatch: 1 }, null, 0);
    expect(leaf.rotation.z).toBeCloseTo(Math.PI / 2, 6);
    // Open, both leaves stand clear of the chair's 0.6 m circle about the axis.
    view.group.updateMatrixWorld(true);
    for (const n of ['port-lid-west', 'port-lid-east']) {
      const b = boxOf(n);
      expect(Math.min(Math.abs(b.min.x - SEAT.x), Math.abs(b.max.x - SEAT.x))).toBeGreaterThan(CHAIR_RADIUS);
    }
  });

  it('draws the long pole only toward a foot below the port, from inside the port down to it, at the foot\'s x/z', () => {
    const pole = view.group.getObjectByName('long-pole') as THREE.Mesh;
    view.update({ lid: 1, pole: 1, hatch: 1 }, null, 1);
    expect(pole.visible).toBe(false);
    view.update({ lid: 1, pole: 1, hatch: 1 }, { x: SEAT.x, y: interior.pen.max.y + 3, z: SEAT.z - 0.48 }, 1); // above the port
    expect(pole.visible).toBe(false);
    const foot = { x: SEAT.x, y: SEAT.y + 1.57, z: SEAT.z - 0.48 };
    view.update({ lid: 1, pole: 1, hatch: 1 }, foot, 1);
    view.group.updateMatrixWorld(true);
    expect(pole.visible).toBe(true);
    pole.geometry.computeBoundingBox();
    const b = pole.geometry.boundingBox!.clone().applyMatrix4(pole.matrixWorld); // the rod alone, not its fitting
    expect(b.min.y).toBeCloseTo(foot.y, 3);
    expect(b.max.y).toBeGreaterThan(interior.pen.max.y);
    const c = b.getCenter(new THREE.Vector3());
    expect(c.x).toBeCloseTo(foot.x, 3);
    expect(c.z).toBeCloseTo(foot.z, 3);
    expect((b.max.x - b.min.x) / 2).toBeCloseTo(LONG_POLE_RADIUS, 2);
    // Inside the port: the pole's edge is within the port's radius of its centre.
    expect(Math.hypot(foot.x - SEAT.x, foot.z - SEAT.z) + LONG_POLE_RADIUS).toBeLessThan(PORT_RADIUS);
    // Half retracted, its foot is half way back up to the port; fully, it is gone.
    view.update({ lid: 1, pole: 0.5, hatch: 1 }, foot, 0.5);
    expect(view.poleFootY()).toBeCloseTo((interior.pen.max.y + foot.y) / 2, 4);
    view.update({ lid: 1, pole: 0, hatch: 1 }, foot, 0);
    expect(pole.visible).toBe(false);
    expect(view.poleFootY()).toBeNull();
  });
});

describe('the boarding machinery (phase 4, D3: derived from (troy, launch), no sim state)', () => {
  const docked = standby(world).launch;
  const lowering: LaunchState = { ...docked, cradleDir: 1 };
  const afloat: LaunchState = { ...docked, cradle: 1, cradleDir: 0 };
  const raising: LaunchState = { ...docked, cradle: 0.4, cradleDir: -1 };
  const aboard = { where: 'aboard' as const };
  const riding = { where: 'riding' as const };
  const onFoot = { where: 'onFoot' as const };
  const DT = 1 / 60;
  const run = (b: Boarding, troy: { where: 'aboard' | 'riding' | 'onFoot' }, l: LaunchState, seconds: number, chairY = 0) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) b = stepBoarding(b, troy, l, chairY, DT);
    return b;
  };

  it("the pole's predicate is D3's: riding, or aboard with the sub docked and raised", () => {
    expect(poleWanted(onFoot, docked)).toBe(false);
    expect(poleWanted(riding, docked)).toBe(true);
    expect(poleWanted(aboard, docked)).toBe(true);
    for (const l of [lowering, afloat, raising]) expect(poleWanted(aboard, l)).toBe(false);
    expect(CHAIR_POLE_TOP_Y + PORT_Y).toBeCloseTo(PORT_Y + 2.7, 9); // boarding.ts restates the chair's pole top
    expect(chairBelowPort(PORT_Y - CHAIR_POLE_TOP_Y - 0.01)).toBe(true);
    expect(chairBelowPort(PORT_Y - CHAIR_POLE_TOP_Y + 0.01)).toBe(false);
  });

  it('a jump snaps it: docked aboard — lid open, pole down, hatch open; afloat — all shut; on foot — all shut', () => {
    expect(stepBoarding(BOARDING_SHUT, aboard, docked, 0, DT, true)).toEqual({ lid: 1, pole: 1, hatch: 1 });
    expect(stepBoarding({ lid: 1, pole: 1, hatch: 1 }, aboard, afloat, 0, DT, true)).toEqual({ lid: 0, pole: 0, hatch: 0 });
    expect(stepBoarding({ lid: 1, pole: 1, hatch: 1 }, onFoot, docked, 0, DT, true)).toEqual({ lid: 0, pole: 0, hatch: 0 });
  });

  it('when the cradle sets off the pole retracts over 1.5 s, then the lid (0.6 s) and the hatch (0.4 s) shut behind it', () => {
    let b = stepBoarding(BOARDING_SHUT, aboard, docked, 0, DT, true);
    b = run(b, aboard, lowering, 0.75);
    expect(b.pole).toBeCloseTo(0.5, 1);
    expect(b.lid).toBe(1);
    expect(b.hatch).toBe(1);
    b = run(b, aboard, lowering, 0.8);
    expect(b.pole).toBe(0);
    b = run(b, aboard, afloat, 0.7);
    expect(b).toEqual({ lid: 0, pole: 0, hatch: 0 });
  });

  it('on docking the lid opens first, then the pole comes back down; the hatch opens with the lid', () => {
    let b: Boarding = { ...BOARDING_SHUT };
    b = run(b, aboard, raising, 1);
    expect(b).toEqual({ lid: 0, pole: 0, hatch: 0 });
    b = run(b, aboard, docked, 0.3);
    expect(b.lid).toBeGreaterThan(0.3);
    expect(b.pole).toBe(0);
    b = run(b, aboard, docked, 0.4);
    expect(b.lid).toBe(1);
    expect(b.hatch).toBe(1);
    b = run(b, aboard, docked, 1.6);
    expect(b.pole).toBe(1);
  });

  it('riding: the lid and the hatch open as the chair nears the port, and stay shut while it is high in the tube', () => {
    let b: Boarding = { ...BOARDING_SHUT };
    b = run(b, riding, docked, 1, 60);
    expect(b).toEqual({ lid: 0, pole: 0, hatch: 0 });
    b = run(b, riding, docked, 0.6, PORT_Y + LID_LEAD - 1);
    expect(b.lid).toBe(1);
    expect(b.hatch).toBe(1);
    expect(b.pole).toBe(0); // the chair's pole top is still above the port
    b = stepBoarding(b, riding, docked, SEAT.y, DT);
    expect(b.pole).toBe(1); // down to the chair: the lock-in hands over with it already down
    expect(chairNearPort(PORT_Y + LID_LEAD + 0.1)).toBe(false);
    // On foot nothing at the pen is open.
    b = run(b, onFoot, docked, 1);
    expect(b).toEqual({ lid: 0, pole: 0, hatch: 0 });
  });

  it('the timings are D3\'s', () => {
    expect([LID_SECONDS, POLE_SECONDS]).toEqual([0.6, 1.5]);
  });
});
