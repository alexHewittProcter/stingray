import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { onCentreline } from '../debug';
import { confineCamera, northOfFace } from '../sim/interior';
import { createWorld } from '../sim/world';
import { createCameraRig } from './camera-rig';
import type { ChaseTarget } from './chase-camera';
import {
  DRIVE_RETURN_SECONDS, ELEVATION_MAX, PITCH_MAX, PITCH_MIN, RETURN_SECONDS, ZOOM_MAX, ZOOM_MIN, type OrbitState,
  initialOrbit, orbitBy, orbitDrag, orbitFromParam, orbitPosition, orbitRecenter, orbitRelease, orbitTick, orbitView, orbitZoom,
} from './orbit';

const world = createWorld(1964);
const interior = world.marineville.interior;
const DT = 1 / 60;
const camera = () => new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 8000);
const target = (x: number, y: number, z: number, yaw: number): ChaseTarget => ({ pos: { x, y, z }, yaw, pitch: 0, speed: 0 });
const tick = (s: OrbitState, seconds: number, driving: boolean) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) s = orbitTick(s, DT, driving);
  return s;
};

describe('the orbit state', () => {
  it('starts untouched', () => {
    expect(orbitView(initialOrbit()).k).toBe(0);
  });

  it('a drag accumulates; pitch and zoom are clamped', () => {
    let s = orbitDrag(initialOrbit(), 50, 0);
    s = orbitDrag(s, 50, 0);
    expect(s.yaw).toBeCloseTo(-100 * 0.006, 9);
    expect(s.dragging).toBe(true);
    expect(s.weight).toBe(1);
    expect(orbitDrag(s, 0, 100000).pitch).toBe(PITCH_MAX);
    expect(orbitDrag(s, 0, -100000).pitch).toBe(PITCH_MIN);
    let z = s;
    for (let i = 0; i < 50; i++) z = orbitZoom(z, 500);
    expect(z.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 50; i++) z = orbitZoom(z, -500);
    expect(z.zoom).toBe(ZOOM_MIN);
  });

  it('yaw goes all the way round (wrapped, never stuck)', () => {
    let s = initialOrbit();
    for (let i = 0; i < 100; i++) s = orbitBy(s, 0.2, 0);
    expect(Math.abs(s.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('release holds the view, however long nothing happens', () => {
    const s = tick(orbitRelease(orbitDrag(initialOrbit(), 120, 40)), 30, false);
    expect(s.dragging).toBe(false);
    expect(s.weight).toBe(1);
    expect(s.returning).toBe(false);
  });

  it('driving starts the return after DRIVE_RETURN_SECONDS, not while dragging', () => {
    const held = orbitRelease(orbitDrag(initialOrbit(), 120, 40));
    expect(tick(held, DRIVE_RETURN_SECONDS - 0.2, true).returning).toBe(false);
    expect(tick(held, DRIVE_RETURN_SECONDS + 0.05, true).returning).toBe(true);
    expect(tick(orbitDrag(initialOrbit(), 120, 40), 10, true).returning).toBe(false);
    // A pause in the driving starts the count again.
    const half = tick(tick(held, 1.5, true), 0.1, false);
    expect(tick(half, 1.5, true).returning).toBe(false);
  });

  it('re-centring blends back to zero over RETURN_SECONDS, smoothly, then is untouched', () => {
    let s = orbitRecenter(orbitRelease(orbitDrag(initialOrbit(), 200, 0)));
    let k = orbitView(s).k;
    for (let t = 0; t < RETURN_SECONDS - 0.1; t += DT) {
      s = orbitTick(s, DT, false);
      const next = orbitView(s).k;
      expect(next).toBeLessThan(k);
      expect(k - next).toBeLessThan(0.05);
      k = next;
    }
    expect(k).toBeGreaterThan(0);
    s = tick(s, 0.2, false);
    expect(s).toEqual(initialOrbit());
  });

  it('a drag during the return takes over from where the view had got to', () => {
    let s = orbitRecenter(orbitRelease(orbitDrag(initialOrbit(), 200, 0)));
    s = tick(s, RETURN_SECONDS / 2, false);
    const seen = orbitView(s).yaw;
    s = orbitDrag(s, 0, 0.001);
    expect(s.returning).toBe(false);
    expect(orbitView(s).yaw).toBeCloseTo(seen, 6);
  });

  it('?orbit=yaw,pitch[,zoom] reads degrees; nonsense is ignored', () => {
    const s = orbitFromParam('90,30,1.5')!;
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(s.pitch).toBeCloseTo(Math.PI / 6, 9);
    expect(s.zoom).toBe(1.5);
    expect(orbitFromParam('x,1')).toBeNull();
    expect(orbitFromParam(null)).toBeNull();
  });
});

describe('orbitPosition', () => {
  const focus = { x: 0, y: 0, z: 0 };
  it('at k = 0 gives the position back exactly', () => {
    expect(orbitPosition({ x: 3, y: 4, z: 5 }, focus, { yaw: 2, pitch: 1, zoom: 1.5, k: 0 })).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('keeps the boom length (zoom 1) and swings the azimuth', () => {
    const p = orbitPosition({ x: 0, y: 0, z: 10 }, focus, { yaw: Math.PI / 2, pitch: 0, zoom: 1, k: 1 });
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('holds the elevation within its limits', () => {
    const p = orbitPosition({ x: 0, y: 0, z: 10 }, focus, { yaw: 0, pitch: 3, zoom: 1, k: 1 });
    expect(Math.atan2(p.y, Math.hypot(p.x, p.z))).toBeCloseTo(ELEVATION_MAX, 9);
  });
});

describe('the camera rig, orbited', () => {
  it('with zero offset is the normal camera exactly (pen camera, then chase at sea)', () => {
    for (const [t, clamps] of [[target(interior.cradle.pos.x, interior.cradle.raisedY, interior.cradle.pos.z, interior.cradle.yawOut), 'locked'], [target(120, -30, -700, 0.4), 'released']] as const) {
      const a = camera();
      const b = camera();
      const ra = createCameraRig(a, world);
      const rb = createCameraRig(b, world);
      const view = orbitView(initialOrbit());
      ra.snap(t, clamps);
      rb.snap(t, clamps, view);
      for (let i = 0; i < 60; i++) {
        t.pos.z += 0.1;
        ra.update(t, clamps, DT);
        rb.update(t, clamps, DT, view);
      }
      expect(a.position.distanceTo(b.position)).toBe(0);
      expect(a.quaternion.angleTo(b.quaternion)).toBe(0);
    }
  });

  const sweep = (t: ChaseTarget, clamps: 'locked' | 'released', check: (c: THREE.PerspectiveCamera) => void) => {
    for (let yaw = -Math.PI; yaw < Math.PI; yaw += Math.PI / 8) {
      for (const pitch of [PITCH_MIN, -0.2, 0, 0.5, 1, PITCH_MAX]) {
        for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
          const c = camera();
          const rig = createCameraRig(c, world);
          const view = { yaw, pitch, zoom, k: 1 };
          rig.snap(t, clamps, view);
          rig.update(t, clamps, DT, view);
          check(c);
        }
      }
    }
  };

  const looksAt = (c: THREE.PerspectiveCamera, t: ChaseTarget) => {
    const to = new THREE.Vector3(t.pos.x, t.pos.y + 1.5, t.pos.z).sub(c.position).normalize();
    return new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).dot(to);
  };

  it('on the cradle in Pen 3, every angle stays inside the interior volume, looking at the craft', () => {
    const cr = interior.cradle;
    for (const y of [cr.raisedY, cr.loweredY]) {
      const t = target(cr.pos.x, y, cr.pos.z, cr.yawOut);
      sweep(t, 'locked', (c) => {
        expect(northOfFace(c.position)).toBe(true);
        expect(confineCamera(c.position, interior).normal).toBeNull();
        expect(looksAt(c, t)).toBeGreaterThan(0.999);
      });
    }
  });

  it('in the tunnel, every angle stays inside the bore', () => {
    for (const metres of [40, 120, 220]) {
      const at = onCentreline(metres, 'out');
      const t = target(at.pos.x, at.pos.y, at.pos.z, at.yaw);
      sweep(t, 'released', (c) => {
        expect(confineCamera(c.position, interior).normal).toBeNull();
        expect(looksAt(c, t)).toBeGreaterThan(0.999);
      });
    }
  });

  it('at sea beside the cliff, it never goes behind the face, and stays above the seabed', () => {
    const t = target(300, -30, -1090, Math.PI);
    sweep(t, 'released', (c) => {
      expect(northOfFace(c.position)).toBe(false);
      expect(c.position.y).toBeGreaterThanOrEqual(world.seabedHeight(c.position.x, c.position.z) + 3 - 1e-9);
    });
  });
});
