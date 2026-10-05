// Fixed-step accumulator: the sim only ever advances by `dt`, whatever the frame rate.

export interface Stepper {
  /** Feed real elapsed seconds; runs 0..maxSteps fixed steps. Returns alpha in [0, 1) for render interpolation. */
  advance(frameSeconds: number): number;
}

export function createStepper(step: (dt: number) => void, dt: number, maxSteps = 5): Stepper {
  let accumulator = 0;
  return {
    advance(frameSeconds: number): number {
      // A backgrounded tab comes back with a huge frame time: drop it instead of jumping.
      accumulator = Math.min(accumulator + Math.max(frameSeconds, 0), dt * maxSteps);
      // The epsilon keeps 60 frames of exactly `dt` producing 60 steps despite float error.
      while (accumulator >= dt - 1e-9) {
        step(dt);
        accumulator -= dt;
      }
      if (accumulator < 0) accumulator = 0;
      return accumulator / dt;
    },
  };
}

/**
 * How much time a drawn frame runs (T9): `sim` feeds the stepper, `effects` the water, particles, camera springs
 * and the rest of the presentation. Wall time is clamped to 0.1 s.
 *   - ?hold freezes both, so a screenshot shows exactly the scripted moment.
 *   - The pause menu freezes both too: the scene is still drawn but stands still, as if the film had stopped.
 *   - The title menu freezes only the sim: the craft sits on its cradle while the water and light stay alive.
 */
export function frameTimes(wallSeconds: number, gate: { hold: boolean; menu: 'title' | 'pause' | null }): { sim: number; effects: number } {
  const frame = Number.isFinite(wallSeconds) ? Math.min(Math.max(wallSeconds, 0), 0.1) : 0;
  if (gate.hold || gate.menu === 'pause') return { sim: 0, effects: 0 };
  if (gate.menu === 'title') return { sim: 0, effects: frame };
  return { sim: frame, effects: frame };
}
