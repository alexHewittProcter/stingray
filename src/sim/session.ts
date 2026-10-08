// The session's one step (phase 3, M7 — the seam; phase-1 amendment 5): Troy, then phase 2's stepGame, every fixed
// step in every mode. Pure and deterministic like the rest of src/sim. Phase 2's sim is not re-signed: stepGame,
// standby, oceanStart, released and modeOf(pos) keep their signatures, and this wraps them.
//
// Each step, in order: stepTroy (a no-op unless Troy is on foot) → stepRide (M6, ride.ts: a no-op unless he is riding;
// it ends the descent aboard, the lock-in) → stepGame for the sub, the machinery and combat. While Troy is not aboard the sub's
// input is NO_INPUT and a launch press is refused 'Not aboard', so a clamped standby sub with nobody in it stays exactly
// as it was. 'use' and 'leave' are handled here and never reach stepGame. Combat's clock and the targets run throughout.

import { INTERACTABLES, LINE_SECONDS, nearestUsable } from './interactables';
import { type GameState, type LaunchControl, type LaunchState, type Press, REFUSAL, standby, stepGame } from './launch';
import { sit, stepRide } from './ride';
import type { Rooms } from './rooms';
import { NO_INPUT, type SubInput } from './sub';
import { type TroyInput, onFoot, stepTroy } from './troy';
import type { World } from './world';

export type { HudLines, Press } from './launch';

const LAUNCH_PRESSES: readonly Press[] = ['cradle', 'engines', 'clamps', 'door'];

const isLaunchControl = (p: Press): p is LaunchControl => LAUNCH_PRESSES.includes(p);

export function stepSession(
  g: GameState, input: SubInput, troyInput: TroyInput, pressed: Press | null, dt: number, env: World, rooms: Rooms,
): GameState {
  // M6: the ride — the descent and the lock-in (the way up, M6b, is T9's). The sub is never touched by it.
  const troy = stepRide(stepTroy(g.troy, troyInput, dt, rooms), dt, rooms, env.marineville.interior.cradle.yawOut);

  const piloted = g.troy.where === 'aboard';
  const launchPress = pressed !== null && isLaunchControl(pressed) && piloted ? pressed : null;
  const next = stepGame({ ...g, troy }, piloted ? input : NO_INPUT, launchPress, dt, env);

  const reason = pressed === null || launchPress !== null ? null : refusalOf(pressed, g);
  if (reason === null) return pressed === 'use' ? applyUse(g, next, rooms) : next;
  return { ...next, launch: { ...next.launch, refusal: { control: pressed!, reason, age: 0 } } };
}

/**
 * M5: the step that consumes 'use' applies the Use of whatever is usable as the press is read — judged on Troy as the
 * step began, the state the HUD was showing its prompt for — or does nothing if nothing is (out of range, facing away,
 * not on foot). A use is never refused.
 *   - say → hud.line = { text, until } with until in combat.t seconds, LINE_SECONDS after the step that set it.
 *   - ride → M6's sit (ride.ts sit): Troy becomes where 'riding', rideDir 'down', ride 0, pos = rooms.shaft[0], facing
 *     the way the seat faces; the sub is not touched. The descent starts on the next step.
 */
function applyUse(g: GameState, next: GameState, rooms: Rooms): GameState {
  const target = nearestUsable(g.troy, INTERACTABLES);
  if (target === null) return next;
  switch (target.use.kind) {
    case 'say':
      return { ...next, hud: { line: { text: target.use.line, until: next.combat.t + LINE_SECONDS } } };
    case 'ride':
      return { ...next, troy: sit(next.troy, rooms) };
  }
}

/**
 * Why a press stepSession handles itself is refused, or null if it is accepted. An accepted 'use' is applied by
 * applyUse (M5); an accepted 'leave' does nothing yet (T9's, the way back up).
 */
function refusalOf(p: Press, g: GameState): string | null {
  if (isLaunchControl(p)) return REFUSAL.notAboard; // M6: launch controls need a pilot
  if (p === 'leave') return g.troy.where === 'aboard' && docked(g.launch) ? null : REFUSAL.notDocked;
  return null; // 'use' (M5): never refused — applyUse does it, or nothing
}

/** M6b: raised and still on the cradle with the clamps locked — phase 2's dock complete. */
export function docked(l: LaunchState): boolean {
  return l.clamps === 'locked' && l.cradle === 0 && l.cradleDir === 0;
}

/** The game's start (M7, M9): Troy standing in the control room, the sub in standby. Keeps combat if given. */
export function controlRoom(env: World, rooms: Rooms, combat?: GameState['combat']): GameState {
  return { ...standby(env, combat), troy: onFoot(rooms.start) };
}
