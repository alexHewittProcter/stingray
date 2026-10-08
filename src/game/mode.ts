import { northOfFace } from '../sim/interior';
import type { GameState } from '../sim/launch';
import type { Vec3 } from '../sim/vec3';

// L4: the mode is derived, not switched. The session's one GameState (game.ts) is stepped the same way in every
// mode, so the mode decides presentation only — which camera rig, which HUD, whether the launch panel shows, which
// key mapping applies (phase 3, M3) — and entering a mode never resets anything. Switching modes never reloads the scene.
// Phase 2 implements 'piloting' and 'launch'; phase 3 'onFoot' and 'transport' (M7).
export type GameMode = 'piloting' | 'launch' | 'onFoot' | 'transport';

/** 'launch' while the hull centre is north of the cliff face (inside Marineville), 'piloting' otherwise. */
export function modeOf(hullCentre: Vec3): GameMode {
  return northOfFace(hullCentre) ? 'launch' : 'piloting';
}

/**
 * Phase 3, M7: the session's mode from the whole state — 'onFoot' while Troy walks, 'transport' while he rides the
 * chair, otherwise phase 2's modeOf(hull centre). Still derived, never set. (It lives here, beside modeOf, because
 * src/sim may not import from src/game; session.ts holds the stepper.)
 */
export function sessionMode(g: GameState): GameMode {
  if (g.troy.where === 'onFoot') return 'onFoot';
  if (g.troy.where === 'riding') return 'transport';
  return modeOf(g.sub.pos);
}

/** Which key mapping a mode reads (M3): Troy's on foot, none while riding, the sub's aboard. */
export function mappingOf(mode: GameMode): 'onFoot' | 'riding' | 'aboard' {
  return mode === 'onFoot' ? 'onFoot' : mode === 'transport' ? 'riding' : 'aboard';
}
