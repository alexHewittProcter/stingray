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
