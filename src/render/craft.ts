import * as THREE from 'three';
import type { SubInput, SubState } from '../sim/sub';
import type { Vec3 } from '../sim/vec3';
import type { ChaseTarget } from './chase-camera';
import type { Particles } from './particles';
import { createStingray } from './stingray';

// Draws the sub from sim state: interpolated pose, bank into turns, spinning drive, bubbles and spray.

const BANK_ANGLE = 0.42; // radians at full yaw input and cruise speed
const BANK_RATE = 5;
const DRIVE_SPIN_IDLE = 1.5; // rad/s
const DRIVE_SPIN_PER_SPEED = 0.55; // rad/s per m/s
const STERN_OFFSET = 12; // m behind the hull's centre

export interface Craft {
  readonly group: THREE.Group;
  /**
   * Pose the model between two sim states; returns what the chase camera should follow. The drive turns only while
   * running. `held`: the cradle's clamps hold her (T8) — crossing the surface on the cradle stirs the waterline gently
   * instead of throwing a leap's splash.
   */
  update(prev: SubState, next: SubState, alpha: number, input: SubInput, dtSeconds: number, running?: boolean, held?: boolean): ChaseTarget;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpAngle(a: number, b: number, t: number): number {
  const d = b - a;
  return a + (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * t;
}

export function createCraft(particles: Particles): Craft {
  const model = createStingray();
  const group = model.group;
  group.rotation.order = 'YXZ';

  let bank = 0;
  let spin = 0;
  let bubbleDebt = 0;
  let wasMedium: SubState['medium'] | null = null;
  const pos: Vec3 = { x: 0, y: 0, z: 0 };

  function splash(at: Vec3, speed: number): void {
    particles.emit({
      x: at.x, y: 0.5, z: at.z, count: 160, speed: [4, 10 + speed * 0.35], vy: 8 + speed * 0.2,
      life: [0.7, 1.6], size: 3.2, color: 0xe8f8ff, lift: -16,
    });
    particles.emit({
      x: at.x, y: -2, z: at.z, count: 80, speed: [2, 9], life: [0.8, 1.8], size: 2.2, color: 0xbfe8ff, lift: 5, underwater: true,
    });
  }

  /**
   * The cradle carries the hull through the surface at a walking pace (T8): a slow, faint stir along the waterline
   * from bow to stern and a few bubbles below it — nothing thrown into the air. Additive particles, so a dim colour
   * reads as a faint sheen rather than white foam.
   */
  function waterlineStir(at: Vec3, yaw: number): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (let k = -2; k <= 2; k++) {
      const along = k * 5;
      const x = at.x + fx * along;
      const z = at.z + fz * along;
      particles.emit({ x, y: 0.15, z, count: 6, speed: [0.4, 1.6], vy: 0.15, life: [1.4, 2.6], size: 0.9, color: 0x3c4c52, lift: -0.4 });
      particles.emit({ x, y: -1.2, z, count: 8, speed: [0.2, 0.9], life: [1.2, 2.4], size: 0.7, color: 0x5a7884, lift: 1.6, underwater: true });
    }
  }

  return {
    group,
    update(prev, next, alpha, input, dt, running = true, held = false) {
      pos.x = lerp(prev.pos.x, next.pos.x, alpha);
      pos.y = lerp(prev.pos.y, next.pos.y, alpha);
      pos.z = lerp(prev.pos.z, next.pos.z, alpha);
      const yaw = lerpAngle(prev.yaw, next.yaw, alpha);
      const pitch = lerp(prev.pitch, next.pitch, alpha);
      const speed = Math.hypot(next.vel.x, next.vel.y, next.vel.z);

      const airborne = next.medium === 'airborne';
      const wantBank = airborne ? 0 : input.yaw * BANK_ANGLE * Math.min(speed / 30, 1);
      bank += (wantBank - bank) * (1 - Math.exp(-BANK_RATE * dt));

      group.position.set(pos.x, pos.y, pos.z);
      group.rotation.set(pitch, yaw, bank);

      if (running) spin += (DRIVE_SPIN_IDLE + speed * DRIVE_SPIN_PER_SPEED) * (input.throttle < 0 ? -1 : 1) * dt;
      model.setDriveSpin(spin);

      // Bubbles stream from the drive while it is under water and working.
      if (running && !airborne && (input.throttle !== 0 || speed > 4)) {
        bubbleDebt += (8 + speed * 1.6) * dt;
        const count = Math.floor(bubbleDebt);
        bubbleDebt -= count;
        if (count > 0) {
          const c = Math.cos(pitch);
          particles.emit({
            x: pos.x + Math.sin(yaw) * c * STERN_OFFSET,
            y: Math.min(pos.y - Math.sin(pitch) * STERN_OFFSET, -0.3),
            z: pos.z + Math.cos(yaw) * c * STERN_OFFSET,
            count, speed: [0.5, 2.5 + speed * 0.05], life: [0.8, 2.2], size: 1.3, color: 0xcdefff, lift: 3.5, underwater: true,
          });
        }
      }

      // Spray when the hull breaks the surface, and again when it falls back in — unless the cradle is carrying her.
      if (wasMedium !== null && wasMedium !== next.medium && (airborne || wasMedium === 'airborne')) {
        if (held) waterlineStir(pos, yaw);
        else splash(pos, speed);
      }
      wasMedium = next.medium;

      return { pos, yaw, pitch, speed };
    },
  };
}
