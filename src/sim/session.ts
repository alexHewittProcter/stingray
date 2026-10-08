// The session's one step (phase 3, M7 — the seam; phase-1 amendment 5): Troy, then phase 2's stepGame, every fixed
// step in every mode. Pure and deterministic like the rest of src/sim. Phase 2's sim is not re-signed: stepGame,
// standby, oceanStart, released and modeOf(pos) keep their signatures, and this wraps them.
//
// Each step, in order: stepTroy (a no-op unless Troy is on foot) → the ride (M6: T7 builds it; until then a 'riding'
// Troy is passed through as he is) → stepGame for the sub, the machinery and combat. While Troy is not aboard the sub's
// input is NO_INPUT and a launch press is refused 'Not aboard', so a clamped standby sub with nobody in it stays exactly
// as it was. 'use' and 'leave' are handled here and never reach stepGame. Combat's clock and the targets run throughout.

import { INTERACTABLES, LINE_SECONDS, nearestUsable } from './interactables';
import { type GameState, type LaunchControl, type LaunchState, type Press, REFUSAL, standby, stepGame } from './launch';
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
  const troy = stepTroy(g.troy, troyInput, dt, rooms);
  // M6: the ride (sit, descent, lock-in, the way up) is T7's and T9's; until then a riding Troy stays where he is.

  const piloted = g.troy.where === 'aboard';
  const launchPress = pressed !== null && isLaunchControl(pressed) && piloted ? pressed : null;
  const next = stepGame({ ...g, troy }, piloted ? input : NO_INPUT, launchPress, dt, env);

  const reason = pressed === null || launchPress !== null ? null : refusalOf(pressed, g);
  if (reason === null) return pressed === 'use' ? applyUse(g, next) : next;
  return { ...next, launch: { ...next.launch, refusal: { control: pressed!, reason, age: 0 } } };
}

/**
 * M5: the step that consumes 'use' applies the Use of whatever is usable as the press is read — judged on Troy as the
 * step began, the state the HUD was showing its prompt for — or does nothing if nothing is (out of range, facing away,
 * not on foot). A use is never refused.
 *   - say → hud.line = { text, until } with until in combat.t seconds, LINE_SECONDS after the step that set it.
 *   - ride → M6's sit. TODO(M6, T7): Troy becomes where 'riding', rideDir 'down', ride 0, pos = rooms.shaft[0]; the sub
 *     is not touched. Until T7 a ride use does nothing — `next` comes back as stepped, troy.where still 'onFoot'.
 */
function applyUse(g: GameState, next: GameState): GameState {
  const target = nearestUsable(g.troy, INTERACTABLES);
  if (target === null) return next;
  switch (target.use.kind) {
    case 'say':
      return { ...next, hud: { line: { text: target.use.line, until: next.combat.t + LINE_SECONDS } } };
    case 'ride':
      return next; // TODO(M6, T7): the sit — see above.
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
