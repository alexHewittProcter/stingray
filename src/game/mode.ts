import { northOfFace } from '../sim/interior';
import type { Vec3 } from '../sim/vec3';

// Phase 2 implements 'piloting' and 'launch'; the other names are reserved for phase 3.
// L4: the mode is derived, not switched. The session's one GameState (game.ts) is stepped the same way in every
// mode, so the mode decides presentation only — which camera rig, which HUD, whether the launch panel shows —
// and entering a mode never resets anything. Switching modes never reloads the scene.
export type GameMode = 'piloting' | 'launch' | 'onFoot' | 'transport';

/** 'launch' while the hull centre is north of the cliff face (inside Marineville), 'piloting' otherwise. */
export function modeOf(hullCentre: Vec3): GameMode {
  return northOfFace(hullCentre) ? 'launch' : 'piloting';
}
