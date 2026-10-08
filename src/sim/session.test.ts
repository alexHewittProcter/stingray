import { describe, expect, it } from 'vitest';
import { INTERACTABLES, type Interactable, LINE_SECONDS, lineAt, nearestUsable } from './interactables';
import { type GameState, LAUNCH_CONTROLS, type Press, REFUSAL, oceanStart, standby, stepGame } from './launch';
import { ROOMS, SEAT } from './rooms';
import { controlRoom, docked, stepSession } from './session';
import { NO_INPUT, type SubInput } from './sub';
import { STAND_STILL, type TroyInput, aboard, onFoot } from './troy';
import { COAST_Z, FIXED_DT as DT, createWorld } from './world';

const W = createWorld(1964);
const FULL: SubInput = { throttle: 1, yaw: 0.5, pitch: 0.3, boost: true, fire: true };
const step = (g: GameState, i: SubInput = NO_INPUT, p: Press | null = null, t: TroyInput = STAND_STILL) =>
  stepSession(g, i, t, p, DT, W, ROOMS);
/** At sea, released and drivable, but with Troy standing in the control room. */
const emptyAtSea = (): GameState => ({ ...oceanStart(W), troy: onFoot(ROOMS.start) });

describe('the seam (M7)', () => {
  it("fills Troy aboard and no HUD line in phase 2's starting states, and stepGame passes them through untouched", () => {
    for (const g of [standby(W), oceanStart(W)]) {
      expect(g.troy).toEqual(aboard(SEAT));
      expect(g.hud).toEqual({ line: null });
      const marked = { ...g, troy: onFoot(ROOMS.start), hud: { line: { text: 'x', until: 3 } } };
      const next = stepGame(marked, FULL, null, DT, W);
      expect(next.troy).toBe(marked.troy);
      expect(next.hud).toBe(marked.hud);
    }
  });

  it("is phase 2's stepGame exactly while Troy is aboard, for every launch press and none", () => {
    const states = [standby(W), oceanStart(W), { ...oceanStart(W), sub: { ...oceanStart(W).sub, pos: { x: 0, y: -40, z: COAST_Z + 30 } } }];
    for (const g of states) {
      for (const p of [null, ...LAUNCH_CONTROLS]) {
        expect(step(g, FULL, p)).toEqual(stepGame(g, FULL, p, DT, W));
      }
    }
  });

  it('gives the sub NO_INPUT while Troy is not aboard', () => {
    let a = emptyAtSea();
    let b = emptyAtSea();
    for (let k = 0; k < 120; k++) {
      a = step(a, FULL);
      b = stepGame(b, NO_INPUT, null, DT, W);
    }
    expect(a).toEqual(b);
    expect(a.combat.missiles).toEqual([]);
  });

  it("refuses every launch press 'Not aboard' while Troy is not aboard — a debug press must not lower an empty sub", () => {
    for (const control of LAUNCH_CONTROLS) {
      const g = controlRoom(W, ROOMS);
      const pressed = step(g, NO_INPUT, control);
      expect(pressed.launch.refusal).toEqual({ control, reason: REFUSAL.notAboard, age: 0 });
      expect({ ...pressed, launch: { ...pressed.launch, refusal: null } }).toEqual(step(g));
      // It ages as phase 2's refusals do.
      expect(step(pressed).launch.refusal?.age).toBeCloseTo(DT, 12);
    }
  });

  it('holds a clamped standby sub with nobody in it exactly still, while combat runs', () => {
    const start = controlRoom(W, ROOMS);
    let g = start;
    for (let k = 0; k < 600; k++) g = step(g, FULL, k % 50 === 0 ? 'cradle' : null);
    expect(g.sub).toEqual(start.sub);
    expect({ ...g.launch, refusal: null }).toEqual(start.launch);
    expect(g.combat.t).toBeCloseTo(start.combat.t + 10, 9);
  });

  it("refuses 'leave' 'Dock first' unless aboard, docked and raised; accepts it then (the ride up is T9's)", () => {
    const leave = (g: GameState) => step(g, NO_INPUT, 'leave').launch.refusal;
    expect(leave(oceanStart(W))).toEqual({ control: 'leave', reason: REFUSAL.notDocked, age: 0 });
    expect(leave(controlRoom(W, ROOMS))).toEqual({ control: 'leave', reason: REFUSAL.notDocked, age: 0 });
    const lowering = step(standby(W), NO_INPUT, 'cradle');
    expect(docked(lowering.launch)).toBe(false);
    expect(leave(lowering)).toEqual({ control: 'leave', reason: REFUSAL.notDocked, age: 0 });
    expect(docked(standby(W).launch)).toBe(true);
    expect(leave(standby(W))).toBeNull();
  });

  it("never passes 'use' or 'leave' to stepGame", () => {
    for (const g of [standby(W), controlRoom(W, ROOMS)]) {
      expect(step(g, NO_INPUT, 'use')).toEqual(step(g));
    }
    expect(step(standby(W), NO_INPUT, 'leave')).toEqual(step(standby(W)));
  });

  it('walks Troy on foot, and the sub and machinery do not notice', () => {
    const start = controlRoom(W, ROOMS);
    let g = start;
    const north: TroyInput = { move: { x: 0, z: -1 }, use: false };
    for (let k = 0; k < 60; k++) g = step(g, NO_INPUT, null, north);
    expect(g.troy.where).toBe('onFoot');
    expect(g.troy.pos.z).toBeLessThan(start.troy.pos.z - 1);
    expect(g.sub).toEqual(start.sub);
    expect(g.launch).toEqual(start.launch);
  });

  it("starts the game's control room as standby with Troy standing at ROOMS.start, keeping combat if given", () => {
    const g = controlRoom(W, ROOMS);
    expect({ ...g, troy: standby(W).troy }).toEqual(standby(W));
    expect(g.troy).toEqual(onFoot(ROOMS.start));
    const later = step(standby(W));
    expect(controlRoom(W, ROOMS, later.combat).combat.t).toBe(later.combat.t);
  });
});

describe("'use' (M5)", () => {
  // Facing the wall map's face (x −8.4) from 1.2 m east of it, facing west (yaw π/2).
  const atWallMap = (): GameState => ({ ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: -7.2, y: ROOMS.start.pos.y, z: -1250 }, yaw: Math.PI / 2 }) });
  const wallMap = INTERACTABLES.find((i) => i.id === 'wallMap')!;
  const lineOf = (i: Interactable) => (i.use.kind === 'say' ? i.use.line : '');

  it('near a say sets hud.line with until = combat.t + LINE_SECONDS, and nothing else differs from no press', () => {
    const g = atWallMap();
    expect(nearestUsable(g.troy)?.id).toBe('wallMap');
    const used = step(g, NO_INPUT, 'use');
    expect(used.hud.line).toEqual({ text: lineOf(wallMap), until: used.combat.t + LINE_SECONDS });
    expect(used.launch.refusal).toBeNull();
    expect({ ...used, hud: { line: null } }).toEqual(step(g));
  });

  it('out of range, or facing away, does nothing', () => {
    const far = controlRoom(W, ROOMS);
    expect(step(far, NO_INPUT, 'use')).toEqual(step(far));
    const away = atWallMap();
    const turned = { ...away, troy: { ...away.troy, yaw: -Math.PI / 2 } };
    expect(step(turned, NO_INPUT, 'use')).toEqual(step(turned));
  });

  it('the line is still there one step later, and the HUD drops it once LINE_SECONDS have run', () => {
    let g = step(atWallMap(), NO_INPUT, 'use');
    const set = g.hud.line;
    g = step(g);
    expect(g.hud.line).toBe(set);
    expect(lineAt(g.hud, g.combat.t)).toBe(lineOf(wallMap));
    // Shown for LINE_SECONDS of combat time, ± one step (combat.t accumulates DT in floating point).
    let shown = 1;
    while (lineAt(g.hud, g.combat.t) !== null && shown < 1000) {
      shown++;
      g = step(g);
    }
    expect(Math.abs(shown - LINE_SECONDS / DT)).toBeLessThanOrEqual(1);
    expect(g.hud.line).toBe(set); // the sim never clears it; the HUD just stops showing it
  });

  it('a second use replaces the line and restarts its clock', () => {
    let g = step(atWallMap(), NO_INPUT, 'use');
    for (let k = 0; k < 30; k++) g = step(g);
    const again = step(g, NO_INPUT, 'use');
    expect(again.hud.line!.until).toBeCloseTo(again.combat.t + LINE_SECONDS, 12);
  });

  it('at the chair a ride use does nothing until M6 (T7): Troy stays on foot, the state as with no press', () => {
    const c = ROOMS.chair;
    const g = { ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z + 1 }, yaw: c.yaw }) };
    expect(nearestUsable(g.troy)?.id).toBe('chair');
    const used = step(g, NO_INPUT, 'use');
    expect(used.troy.where).toBe('onFoot');
    expect(used).toEqual(step(g));
  });

  it('aboard, use does nothing (nothing is usable)', () => {
    expect(step(standby(W), NO_INPUT, 'use')).toEqual(step(standby(W)));
  });
});
