// The port, the pole and the hatch (phase 4, D3): what the boarding machinery should show, derived from (troy, launch)
// each frame — "Nothing here is sim state … no new field in GameState". Pure (no three.js, no DOM): render/shaft.ts
// draws the port's lid and the long pole from it, render/stingray.ts the hatch, main.ts steps this once a frame, and
// audio/cues.ts hears the same transitions (D4 "Sound").
//
//   - The **lid** on Troy's port is "open while the chair is in the hall or the pole is down, and shut otherwise":
//     riding, it opens LID_LEAD metres before the chair reaches the port (it must be open by the time the chair
//     arrives — the chair is still at cruise there) and shuts once the chair has gone LID_LEAD back up past it; aboard
//     it is open while the sub is docked or the pole is still out.
//   - The **pole** (the long one, from the port down): "drawn from the port down to the chair's head bar while riding,
//     and from the port down to the cabin roof while Troy is aboard with the sub docked and raised" — pole =
//     riding || (aboard && docked(launch)). Riding it is wherever the chair is (`pole` here is 1 once the chair's pole
//     top is below the port, so the lock-in hands over with the pole already down); aboard it "retracts up through
//     the port over 1.5 s" when the cradle sets off (docked goes false — the sim's cradleDir is the trigger) and the
//     lid shuts behind it; on docking it comes back down the same way, once the lid has opened.
//   - The **hatch** "opens as the chair enters the hall (the port's lid timing) and shuts once the pole has
//     retracted": it wants what the lid wants.

import { docked } from '../sim/session';
import type { LaunchState } from '../sim/launch';
import type { TroyState } from '../sim/troy';
import { MARINEVILLE } from '../sim/world';

/** The pen hall's ceiling, where Troy's port is (D3: `(SEAT.x, interior.pen.max.y, SEAT.z)`). */
export const PORT_Y = MARINEVILLE.interior.pen.max.y;
/** The port lid's swing, either way (D3: "animated over 0.6 s render-side"). */
export const LID_SECONDS = 0.6;
/** The pole's retract / extend (D3: "over 1.5 s"). */
export const POLE_SECONDS = 1.5;
/** The hatch's swing, either way (phase 3's). */
export const HATCH_SECONDS = 0.4;
/**
 * Riding, the lid opens while the chair's seat point is within this many metres above the port: at the port the chair
 * is still at its cruise (≈ 16.7 m/s — the port is passed at ≈ 0.87 of the ride, before the 1 s ease-out), so the
 * 0.6 s lid needs ≥ 10 m; 14 m gives it ≈ 0.25 s in hand.
 */
export const LID_LEAD = 14;
/** The chair's pole top above its origin (render/injector-chair.ts CHAIR_POLE_TOP_Y — restated to keep this pure). */
const CHAIR_POLE_TOP = 2.7;

/** The machinery as drawn: each 0 (shut / retracted) … 1 (open / down), linear in time (the views ease the drawing). */
export interface Boarding {
  lid: number;
  pole: number;
  hatch: number;
}

export const BOARDING_SHUT: Readonly<Boarding> = Object.freeze({ lid: 0, pole: 0, hatch: 0 });

/** D3's pole predicate: riding, or aboard with the sub docked and raised (phase 3's `docked`, re-used). */
export function poleWanted(troy: Pick<TroyState, 'where'>, launch: LaunchState): boolean {
  return troy.where === 'riding' || (troy.where === 'aboard' && docked(launch));
}

/** Riding, the chair (its seat point at y) is close enough above the port — or below it — for the lid to be open. */
export function chairNearPort(chairY: number): boolean {
  return chairY < PORT_Y + LID_LEAD;
}

/** The riding chair's pole top is below the port: the long pole is down from the port to it. */
export function chairBelowPort(chairY: number): boolean {
  return chairY + CHAIR_POLE_TOP < PORT_Y;
}

/**
 * One drawn frame: the machinery eased toward what (troy, launch) want. `chairY` is the drawn chair's seat point (the
 * frame's interpolated troy.pos.y while riding; unused otherwise). `snap` (a jump: R, the menu, ?start=) sets every
 * part straight to its wanted state.
 */
export function stepBoarding(
  b: Boarding, troy: Pick<TroyState, 'where'>, launch: LaunchState, chairY: number, dt: number, snap = false,
): Boarding {
  if (troy.where === 'riding') {
    const want = chairNearPort(chairY) ? 1 : 0;
    // The pole is wherever the chair is; noted here so the lock-in hands over with the pole already down.
    const pole = chairBelowPort(chairY) ? 1 : 0;
    return snap
      ? { lid: want, pole, hatch: want }
      : { lid: ease(b.lid, want, dt, LID_SECONDS), pole, hatch: ease(b.hatch, want, dt, HATCH_SECONDS) };
  }
  if (troy.where === 'aboard') {
    const isDocked = docked(launch);
    if (snap) {
      const v = isDocked ? 1 : 0;
      return { lid: v, pole: v, hatch: v };
    }
    // Down: the lid opens first, then the pole extends through it. Up: the pole retracts, then the lid shuts behind it.
    const pole = ease(b.pole, isDocked && b.lid >= 1 ? 1 : 0, dt, POLE_SECONDS);
    const want = isDocked || pole > 0 ? 1 : 0;
    return { lid: ease(b.lid, want, dt, LID_SECONDS), pole, hatch: ease(b.hatch, want, dt, HATCH_SECONDS) };
  }
  // On foot the chair is home at the station; everything at the pen shuts.
  return snap ? { ...BOARDING_SHUT } : { lid: ease(b.lid, 0, dt, LID_SECONDS), pole: 0, hatch: ease(b.hatch, 0, dt, HATCH_SECONDS) };
}

/** Move v toward want at 1 / seconds per second. */
function ease(v: number, want: number, dt: number, seconds: number): number {
  return v + Math.sign(want - v) * Math.min(Math.abs(want - v), Math.max(0, dt) / seconds);
}

/** The drawn ease of a linear 0…1 (smoothstep). */
export function smooth(v: number): number {
  const k = Math.min(1, Math.max(0, v));
  return k * k * (3 - 2 * k);
}
