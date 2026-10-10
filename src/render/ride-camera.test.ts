import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RIDE_SECONDS, rideProgressAt, rideTimeAt } from '../sim/ride';
import { ROOMS, SHAFT_OPEN_TOP, SHAFT_RADIUS, shaftLength } from '../sim/rooms';
import { TUNING as T } from '../sim/tuning';
import { createWorld } from '../sim/world';
import { PORT_Y } from './boarding';
import { BORE_RADIUS } from './rooms';
import { boomRise, createRideCamera, rideWallRadius, wallRadiusAtY } from './ride-camera';
import { ANNULUS_TOP_Y, COLLAR_DEPTH, PORT_RADIUS, shaftLine } from './shaft';

// The ride camera (phase 3 M4; phase 4 D4): the wall it is held inside learns the port, and the boom never clips the
// annulus's cone or the collar — tested with the chair at every height of the ride, both ways.

const interior = createWorld(1964).marineville.interior;
const line = shaftLine(ROOMS, interior);
const TOP = ROOMS.shaft[0]!;
const LENGTH = shaftLength(ROOMS.shaft);
const COLLAR_FOOT = PORT_Y - COLLAR_DEPTH;
const DT = 1 / 60;

/** The rig's pose for the frame (main.ts runs the rig first): the pen camera, behind and above the cradle. */
function rigPose(camera: THREE.PerspectiveCamera) {
  camera.position.set(TOP.x + 6, 12, TOP.z + 14);
  camera.lookAt(TOP.x, 6, TOP.z);
  camera.fov = 60;
}

const offAxis = (p: THREE.Vector3) => Math.hypot(p.x - TOP.x, p.z - TOP.z);

/** Every point on the segment a→b at the shaft's narrow heights (annulus, collar) is inside the drawn wall. */
function worstPoke(a: THREE.Vector3, b: THREE.Vector3): number {
  let worst = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i <= 200; i++) {
    p.lerpVectors(a, b, i / 200);
    if (p.y > ANNULUS_TOP_Y + 0.5 || p.y < COLLAR_FOOT) continue;
    worst = Math.max(worst, offAxis(p) - wallRadiusAtY(p.y));
  }
  return worst;
}

describe('the ride camera\'s wall (phase 4 D4)', () => {
  it('rideHold is 0.8 s; the ride is 6 s', () => {
    expect(T.rideHold).toBe(0.8);
    expect(RIDE_SECONDS).toBe(6);
  });

  it('radiusAt learns the port: the bore, the tube, the annulus tapering to the port, the collar, the hall widening', () => {
    expect(rideWallRadius(0, TOP.y)).toBe(BORE_RADIUS);
    expect(rideWallRadius(SHAFT_OPEN_TOP, TOP.y)).toBe(BORE_RADIUS);
    expect(rideWallRadius(SHAFT_OPEN_TOP + 1.2, TOP.y)).toBeCloseTo(SHAFT_RADIUS, 12);
    expect(rideWallRadius(TOP.y - 50, TOP.y)).toBe(SHAFT_RADIUS); // the tube, at y 50
    // By height below the tube.
    expect(ANNULUS_TOP_Y).toBeCloseTo(21.2, 9);
    expect(PORT_Y).toBe(20);
    expect(wallRadiusAtY(ANNULUS_TOP_Y)).toBe(SHAFT_RADIUS);
    expect(wallRadiusAtY(ANNULUS_TOP_Y + 3)).toBe(SHAFT_RADIUS);
    expect(wallRadiusAtY((ANNULUS_TOP_Y + PORT_Y) / 2)).toBeCloseTo((SHAFT_RADIUS + PORT_RADIUS) / 2, 9);
    expect(wallRadiusAtY(PORT_Y)).toBeCloseTo(PORT_RADIUS, 12);
    expect(wallRadiusAtY(PORT_Y - 0.2)).toBe(PORT_RADIUS);
    expect(wallRadiusAtY(COLLAR_FOOT)).toBe(PORT_RADIUS);
    expect(COLLAR_FOOT).toBeCloseTo(19.55, 9);
    expect(wallRadiusAtY(COLLAR_FOOT - 0.25)).toBeGreaterThan(PORT_RADIUS);
    expect(wallRadiusAtY(COLLAR_FOOT - 1.5)).toBeCloseTo((PORT_RADIUS + SHAFT_RADIUS) / 2, 9); // widening over 3 m
    expect(wallRadiusAtY(COLLAR_FOOT - 3)).toBe(SHAFT_RADIUS);
    // Narrowing all the way down the annulus, never wider than the tube.
    for (let y = ANNULUS_TOP_Y; y > PORT_Y; y -= 0.05) expect(wallRadiusAtY(y - 0.05)).toBeLessThan(wallRadiusAtY(y));
    // The arc-length form follows the height form below the bore.
    expect(rideWallRadius(TOP.y - PORT_Y, TOP.y)).toBeCloseTo(PORT_RADIUS, 12);
  });

  it('boomRise keeps the whole boom inside the wall: rideRise in the tube, closing in on the axis through the port', () => {
    const s = (y: number) => TOP.y - y; // arc length at height y
    expect(boomRise(s(50) - T.rideBoom, s(50), TOP.y)).toBe(T.rideRise);
    for (let yChair = ANNULUS_TOP_Y + 3; yChair > COLLAR_FOOT - 3; yChair -= 0.05) {
      const sChair = s(yChair);
      const sCam = sChair - T.rideBoom;
      const rise = boomRise(sCam, sChair, TOP.y);
      expect(rise).toBeGreaterThanOrEqual(0);
      expect(rise).toBeLessThanOrEqual(T.rideRise);
      // A point a fraction g of the way from the camera to the chair is (1 − g)·rise off the axis.
      for (let g = 0; g < 1; g += 0.01) {
        const y = TOP.y - (sCam + g * (sChair - sCam));
        expect((1 - g) * rise, `chair y ${yChair.toFixed(2)}, g ${g.toFixed(2)}`).toBeLessThanOrEqual(wallRadiusAtY(y) - T.rideWallInset + 1e-6);
      }
    }
    // With the camera in the collar it is within the port's radius less the inset.
    expect(boomRise(s(19.8), s(16.8), TOP.y)).toBeLessThanOrEqual(PORT_RADIUS - T.rideWallInset);
  });
});

describe('the ride camera through the port (phase 4 D4)', () => {
  /** Drive the camera through the ride at 60 fps, `times` in order, the rig's pose set before each frame. */
  function ride(times: number[]) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const rc = createRideCamera(camera, ROOMS, interior, line);
    rigPose(camera);
    rc.begin(null);
    const frames: Array<{ t: number; pos: THREE.Vector3; chair: THREE.Vector3; quat: THREE.Quaternion }> = [];
    for (const t of times) {
      rigPose(camera);
      rc.update(t);
      const yChair = TOP.y - rideProgressAt(t) * LENGTH;
      frames.push({ t, pos: camera.position.clone(), chair: new THREE.Vector3(TOP.x, yChair, TOP.z), quat: camera.quaternion.clone() });
    }
    return frames;
  }
  const n = Math.round(RIDE_SECONDS / DT);
  const DOWN = Array.from({ length: n + 1 }, (_, k) => k * DT);

  it('with the chair at every height, neither the camera nor its boom to the chair (or to Troy) clips the annulus or the collar', () => {
    let narrow = 0;
    for (const f of ride(DOWN)) {
      if (f.pos.y <= ANNULUS_TOP_Y + 0.5 && f.pos.y >= COLLAR_FOOT) {
        narrow++;
        expect(offAxis(f.pos), `t ${f.t.toFixed(3)}`).toBeLessThanOrEqual(wallRadiusAtY(f.pos.y) - 0.2);
      }
      expect(worstPoke(f.pos, f.chair), `t ${f.t.toFixed(3)} to the chair`).toBeLessThanOrEqual(0);
      expect(worstPoke(f.pos, f.chair.clone().setY(f.chair.y + 1.3)), `t ${f.t.toFixed(3)} to Troy`).toBeLessThanOrEqual(0);
    }
    expect(narrow).toBeGreaterThan(3); // the camera does pass through the port's heights
  });

  it('the port is passed inside the final blend, and the camera moves smoothly every frame (no rolled or jumped frame)', () => {
    const passPort = rideTimeAt((TOP.y - PORT_Y) / LENGTH);
    expect(passPort).toBeGreaterThan(RIDE_SECONDS - T.rideBlend);
    expect(passPort).toBeCloseTo(4.84, 1);
    const frames = ride(DOWN);
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1]!;
      const b = frames[k]!;
      // The catch-up (rideCatchUp after the hold) swoops down onto the chair's boom faster than the chair falls (it
      // must close the hold's gap): ≈ 40 m/s at its fastest. Nothing faster than 60 m/s — no jumped frame.
      expect(a.pos.distanceTo(b.pos), `t ${b.t.toFixed(3)}`).toBeLessThan(1);
      // No sudden turn: under 12° a frame (the hold's quick turn onto the chair is the fastest).
      expect(a.quat.angleTo(b.quat), `t ${b.t.toFixed(3)}`).toBeLessThan((12 * Math.PI) / 180);
      // No roll: the camera's right vector stays level once the hold is over (it looks down a vertical shaft, its
      // "up" the way the chair faces) — a rolled frame would tilt it.
      // The view banks a few degrees at most (the boom's rideSide offset, the blend's slerp onto the rig's level pose),
      // and never changes its bank suddenly between two frames.
      if (b.t > T.rideHold) {
        const tilt = (q: THREE.Quaternion) => new THREE.Vector3(1, 0, 0).applyQuaternion(q).y;
        const blending = b.t > RIDE_SECONDS - T.rideBlend;
        expect(Math.abs(tilt(b.quat)), `t ${b.t.toFixed(3)}`).toBeLessThan(blending ? 0.4 : 0.15);
        expect(Math.abs(tilt(b.quat) - tilt(a.quat)), `t ${b.t.toFixed(3)}`).toBeLessThan(0.03);
      }
    }
  });

  it('the ascent reverses it: the same poses with the clock run backwards', () => {
    const down = ride(DOWN);
    const up = ride([...DOWN].reverse()).reverse();
    for (let k = 0; k < down.length; k++) {
      if (down[k]!.t < T.rideHold) continue; // the hold eases from `begin`'s pose, which differs by direction
      expect(up[k]!.pos.distanceTo(down[k]!.pos)).toBeLessThan(1e-9);
    }
  });
});
