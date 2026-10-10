import { describe, expect, it } from 'vitest';
import { type GameState, REFUSAL, oceanStart, standby } from '../sim/launch';
import type { Vec3 } from '../sim/vec3';
import { COAST_Z, FIXED_DT as DT, createWorld } from '../sim/world';
import { ROOMS } from '../sim/rooms';
import { controlRoom } from '../sim/session';
import { onFoot } from '../sim/troy';
import { Game } from './game';
import { type Lamp, MODE_HOLD, type PanelMemory, type PanelView, initialMemory, panelView, remember } from './panel';

const W = createWorld(1964);
const I = W.marineville.interior;
const NOTHING = new Set<string>();
const at = (pos: Vec3, yaw: number) => ({ pos, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, medium: 'submerged' as const });

/** A session as main.ts runs it: the game stepped, the panel's memory updated every step (as every frame). */
class Session {
  readonly game: Game;
  memory: PanelMemory;
  constructor(start: GameState) {
    this.game = new Game(W, start);
    this.memory = initialMemory(start);
  }
  run(seconds: number): void {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      this.game.step(NOTHING, DT);
      this.memory = remember(this.memory, this.game.state);
    }
  }
  press(control: Parameters<Game['press']>[0]): void {
    this.game.press(control);
    this.run(DT);
  }
  place(pos: Vec3, yaw = Math.PI): void {
    this.game.place(at(pos, yaw));
    this.memory = remember(this.memory, this.game.state);
  }
  get view(): PanelView {
    return panelView(this.game.state, this.memory, I);
  }
}

// Phase 3 (M7, M9): phase 2's assertions are about its four controls; the fifth (LEAVE SEAT, M6b) has its own below.
const four = (v: PanelView) => v.controls.filter((c) => c.control !== 'leave');
const lamps = (v: PanelView): Record<string, Lamp> => Object.fromEntries(four(v).map((c) => [c.control, c.lamp]));
const words = (v: PanelView): string[] => four(v).map((c) => c.word);
const nextOf = (v: PanelView) => v.controls.find((c) => c.next)?.control ?? null;

describe('the launch panel through a full launch (L6)', () => {
  it('lamps, levers, words, status and the prompt at every stage, standby to the open sea', () => {
    const s = new Session(standby(W));

    // Standby: only the cradle can be pressed.
    let v = s.view;
    expect(lamps(v)).toEqual({ cradle: 'amber', engines: 'dark', clamps: 'dark', door: 'dark' });
    expect(words(v)).toEqual(['RAISED', 'OFF', 'LOCKED', 'SHUT']);
    expect(four(v).map((c) => c.key)).toEqual(['1', '2', '3', '4']);
    expect(four(v).map((c) => c.lever)).toEqual([0, 0, 0, 0]);
    expect(v.status).toBe('STINGRAY ON STANDBY — PEN 3');
    expect(v.prompt).toBe('Press 1 — lower the cradle');
    expect(nextOf(v)).toBe('cradle');

    // Lowering: the cradle's lamp pulses amber and its lever follows the travel.
    s.press('cradle');
    s.run(4);
    v = s.view;
    expect(v.controls[0]).toMatchObject({ lamp: 'amber', moving: true, word: 'LOWERING', pressable: false });
    expect(v.controls[0]!.lever).toBeCloseTo(4 / 8 + DT / 8, 6);
    expect(v.status).toBe('CRADLE LOWERING');
    expect(v.prompt).toBeNull();

    // Lowered and submerged: the cradle is green, the engines are next.
    s.run(4);
    v = s.view;
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'amber', clamps: 'dark', door: 'dark' });
    expect(v.controls[0]!.lever).toBe(1);
    expect(v.status).toBe('STINGRAY SUBMERGED — ENGINES OFF');
    expect(v.prompt).toBe('Press 2 — start the engines');

    // Engines starting.
    s.press('engines');
    v = s.view;
    expect(v.controls[1]).toMatchObject({ lamp: 'amber', moving: true, word: 'STARTING', lever: 1 });
    expect(v.status).toBe('ENGINES STARTING');
    expect(v.prompt).toBeNull();

    // Running: ready to release.
    s.run(2);
    v = s.view;
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'green', clamps: 'amber', door: 'dark' });
    expect(words(v)).toEqual(['LOWERED', 'RUNNING', 'LOCKED', 'SHUT']);
    expect(v.status).toBe('ENGINES RUNNING — READY TO RELEASE');
    expect(v.prompt).toBe('Press 3 — release the clamps');

    // Released, away in the pen. Phase 4 D6: the door's request range (340 m) reaches the cradle (296 m), so the
    // door is the next step from here — a boosting sub asks now and finds it open.
    s.press('clamps');
    v = s.view;
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'green', clamps: 'green', door: 'amber' });
    // The clamps (re-locking while still over the cradle) show green, not amber; the door is the amber one.
    expect(v.controls.filter((c) => c.pressable).map((c) => c.control)).toEqual(['clamps', 'door']);
    expect(v.status).toBe('STINGRAY AWAY — PEN 3');
    expect(v.prompt).toBe('Press 4 — open the ocean door');

    // At the pen's north end, out of door range: drive into the tunnel.
    s.place({ x: 0, y: -14, z: -1446 });
    v = s.view;
    expect(v.status).toBe('STINGRAY AWAY — PEN 3');
    expect(v.prompt).toBe('W to drive, A / D to steer — into the tunnel');
    expect(lamps(v).door).toBe('dark');

    // In the tunnel, within range of the door: request it.
    s.place({ x: 0, y: -40, z: COAST_Z - 150 });
    v = s.view;
    expect(v.status).toBe('LAUNCH TUNNEL — OCEAN DOOR 150 M');
    expect(v.prompt).toBe('Press 4 — open the ocean door');
    s.place({ x: 0, y: -40, z: COAST_Z - 60 });
    v = s.view;
    expect(lamps(v).door).toBe('amber');
    expect(v.status).toBe('LAUNCH TUNNEL — OCEAN DOOR 60 M');
    expect(v.prompt).toBe('Press 4 — open the ocean door');

    s.press('door');
    s.run(2.5);
    v = s.view;
    expect(v.controls[3]).toMatchObject({ lamp: 'amber', moving: true, word: 'OPENING', pressable: false });
    expect(v.controls[3]!.lever).toBeCloseTo(0.5 + DT / 5, 6);
    expect(v.status).toBe('OCEAN DOOR OPENING');
    expect(v.prompt).toBe('The ocean door is opening — drive on through');

    s.run(2.5);
    v = s.view;
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'green', clamps: 'green', door: 'green' });
    expect(v.status).toBe('OCEAN DOOR OPEN — CLEAR TO LAUNCH');
    expect(v.prompt).toBe('Door open — W to drive out to sea');

    // Out through the mouth: the sea HUD, only the door control (still in range), and no more prompts.
    s.game.override = { throttle: 1 };
    s.run(8);
    expect(s.game.state.sub.pos.z).toBeGreaterThan(COAST_Z + MODE_HOLD);
    expect(s.memory).toEqual({ shown: 'piloting', trip: 'home', launched: true });
    v = s.view;
    expect(v.status).toBeNull();
    expect(v.prompt).toBeNull();
    expect(v.controls.map((c) => c.control)).toEqual(['door']);
    expect(v.controls[0]!.lamp).toBe('green');

    // Return to Pen 3 (phase 3: no longer R, which goes to the control room — M9): back to standby — docked, and
    // the prompts stay gone for the session.
    s.game.override = {};
    s.game.toStandby();
    s.run(DT);
    v = s.view;
    expect(s.memory).toEqual({ shown: 'launch', trip: 'out', launched: true });
    expect(v.status).toBe('STINGRAY DOCKED — PEN 3');
    expect(v.prompt).toBeNull();
    expect(lamps(v)).toEqual({ cradle: 'amber', engines: 'dark', clamps: 'dark', door: 'dark' });
    expect(nextOf(v)).toBe('cradle'); // the quiet marker stays; only the prompt line goes
  });

  it('the prompt names exactly one amber lamp at every prompted step of the launch', () => {
    const s = new Session(standby(W));
    const seen: string[] = [];
    const check = () => {
      const v = s.view;
      if (v.prompt && seen[seen.length - 1] !== v.prompt) seen.push(v.prompt);
      const next = nextOf(v);
      if (next && v.prompt?.startsWith('Press')) expect(four(v).filter((c) => c.lamp === 'amber').map((c) => c.control)).toEqual([next]);
    };
    check();
    s.press('cradle'); s.run(8); check();
    s.press('engines'); s.run(2); check();
    s.press('clamps'); check();
    s.place({ x: 0, y: -40, z: COAST_Z - 60 }); check();
    s.press('door'); check(); s.run(5); check();
    // Phase 4 D6: the door is requestable from the cradle, so its prompt follows the release directly.
    expect(seen).toEqual([
      'Press 1 — lower the cradle',
      'Press 2 — start the engines',
      'Press 3 — release the clamps',
      'Press 4 — open the ocean door',
      'The ocean door is opening — drive on through',
      'Door open — W to drive out to sea',
    ]);
  });
});

describe('refusals on the panel (L3, L6)', () => {
  it('a refused press flashes its lamp red and shows the reason for exactly refusalShow (3 s)', () => {
    const s = new Session(standby(W));
    s.press('engines');
    let v = s.view;
    expect(v.refusal).toEqual({ control: 'engines', reason: REFUSAL.lowerCradle });
    expect(lamps(v)).toEqual({ cradle: 'amber', engines: 'red', clamps: 'dark', door: 'dark' });
    s.run(2.9);
    expect(s.view.refusal).toEqual({ control: 'engines', reason: REFUSAL.lowerCradle });
    s.run(0.2);
    v = s.view;
    expect(v.refusal).toBeNull();
    expect(lamps(v).engines).toBe('dark');

    // The boundary itself, on the state's age.
    const g = s.game.state;
    const aged = (age: number): GameState => ({ ...g, launch: { ...g.launch, refusal: { control: 'clamps', reason: REFUSAL.lowerCradle, age } } });
    expect(panelView(aged(2.999), s.memory, I).refusal).not.toBeNull();
    expect(panelView(aged(3), s.memory, I).refusal).toBeNull();
  });

  it('a press on a moving cradle is refused and shown', () => {
    const s = new Session(standby(W));
    s.press('cradle');
    s.press('cradle');
    expect(s.view.refusal).toEqual({ control: 'cradle', reason: REFUSAL.cradleMoving });
    expect(s.view.controls[0]!.lamp).toBe('red');
  });

  it('at sea a refused press shows its control and reason briefly, though the panel is otherwise hidden', () => {
    const s = new Session(oceanStart(W));
    // Phase 1's spawn is 60 m off the mouth — within door range, so the door control shows there.
    expect(s.view.controls.map((c) => c.control)).toEqual(['door']);
    s.place({ x: 200, y: -40, z: -800 }, 0);
    expect(s.view.controls).toEqual([]);
    s.press('door');
    let v = s.view;
    expect(v.controls.map((c) => c.control)).toEqual(['door']);
    expect(v.refusal).toEqual({ control: 'door', reason: REFUSAL.outOfRange });
    s.run(3.1);
    v = s.view;
    expect(v.controls).toEqual([]);
    expect(v.refusal).toBeNull();
  });
});

describe('the panel at sea (L6)', () => {
  it('shows only the door control, and only within door range', () => {
    const s = new Session(oceanStart(W));
    s.place({ x: 0, y: -40, z: COAST_Z + 60 }, 0);
    let v = s.view;
    expect(s.memory.shown).toBe('piloting');
    expect(v.status).toBeNull();
    expect(v.prompt).toBeNull();
    expect(v.controls.map((c) => c.control)).toEqual(['door']);
    expect(v.controls[0]).toMatchObject({ lamp: 'amber', word: 'SHUT', pressable: true, next: true });

    // Phase 4 D6: the request range is 340 m.
    s.place({ x: 0, y: -40, z: COAST_Z + 339 }, 0);
    expect(s.view.controls.map((c) => c.control)).toEqual(['door']);
    s.place({ x: 0, y: -40, z: COAST_Z + 341 }, 0);
    expect(s.view.controls).toEqual([]);
    s.place({ x: 200, y: -40, z: -800 }, 0);
    v = s.view;
    expect(v.controls).toEqual([]);
    expect(v.status).toBeNull();
  });

  it('holds the presented mode until the hull centre is 2 m past the face, either way', () => {
    let m: PanelMemory = { shown: 'launch', trip: 'out', launched: false };
    const g = oceanStart(W);
    const atZ = (z: number): GameState => ({ ...g, sub: { ...g.sub, pos: { x: 0, y: -40, z } } });
    m = remember(m, atZ(COAST_Z + 1.9));
    expect(m.shown).toBe('launch');
    m = remember(m, atZ(COAST_Z + 2.1));
    expect(m.shown).toBe('piloting');
    m = remember(m, atZ(COAST_Z - 1.9));
    expect(m.shown).toBe('piloting');
    m = remember(m, atZ(COAST_Z - 2.1));
    expect(m.shown).toBe('launch');
  });

  // Phase 3 (M7's amendment list, M9): R now goes to the control room, where no panel shows; Return to Pen 3
  // (toStandby) is the way to standby, and the prompts begin there.
  it('?start=ocean begins on the way home with no prompts; after R no panel; prompts begin in standby until a launch reaches the sea', () => {
    const s = new Session(oceanStart(W));
    expect(s.memory).toEqual({ shown: 'piloting', trip: 'home', launched: false });
    s.game.restartNow();
    s.run(DT);
    expect(s.view).toMatchObject({ controls: [], prompt: null, status: null, refusal: null });
    s.game.toStandby();
    s.run(DT);
    expect(s.view.prompt).toBe('Press 1 — lower the cradle');
    expect(s.view.status).toBe('STINGRAY ON STANDBY — PEN 3');
  });
});

describe('the panel by session mode (phase 3, M9)', () => {
  it('is hidden while Troy is on foot — no controls, status or prompt — and phase 2\'s once he is aboard', () => {
    const s = new Session(controlRoom(W, ROOMS));
    expect(s.memory.shown).toBe('offBoard');
    s.run(1);
    expect(s.view).toMatchObject({ controls: [], prompt: null, status: null, refusal: null });
    // Aboard in the pen (as lock-in will leave him, T7): the standby panel, z-based as phase 2's.
    s.game.toStandby();
    s.run(DT);
    expect(s.memory.shown).toBe('launch');
    expect(s.view.controls.map((c) => c.key)).toEqual(['1', '2', '3', '4', '5']);
    expect(s.view.prompt).toBe('Press 1 — lower the cradle');
    // And off again on R.
    s.game.restartNow();
    s.run(DT);
    expect(s.memory.shown).toBe('offBoard');
    expect(s.view.controls).toEqual([]);
  });

  it('is hidden while he rides the chair', () => {
    const riding = { ...standby(W), troy: { ...onFoot(ROOMS.start), where: 'riding' as const } };
    expect(initialMemory(riding).shown).toBe('offBoard');
    expect(panelView(riding, initialMemory(riding), I).controls).toEqual([]);
  });

  it('a press refused "Not aboard" (a debug press on foot) shows its control and reason briefly, as phase 2\'s refusals do', () => {
    const s = new Session(controlRoom(W, ROOMS));
    s.press('cradle');
    expect(s.view.controls.map((c) => c.control)).toEqual(['cradle']);
    expect(s.view.refusal).toEqual({ control: 'cradle', reason: REFUSAL.notAboard });
    s.run(3.1);
    expect(s.view.controls).toEqual([]);
  });
});

describe('the panel on the return (L6)', () => {
  it('coming home: away in the tunnel, lock, engines off, raise, docked', () => {
    const s = new Session(oceanStart(W));
    // Back in through the open door, then up the tunnel: the door closes behind.
    s.game.press('door');
    s.place({ x: 0, y: -40, z: COAST_Z + 40 }, 0);
    s.run(5.1);
    expect(s.game.state.launch.door).toBe(1);
    s.place({ x: 0, y: -40, z: COAST_Z - 60 }, 0);
    let v = s.view;
    expect(s.memory.trip).toBe('home');
    expect(v.status).toBe('OCEAN DOOR OPEN — PEN 3 182 M'); // phase 4 D6: 110 m of chamber + the 172 m straight incline
    // Cradle lowered and Stingray away: green, not pressable.
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'green', clamps: 'green', door: 'green' });
    expect(v.controls[0]!.pressable).toBe(false);

    // Phase 4 D6: the door stays open the length of the tunnel (its close range, 280 m, is past the pen's wall) …
    s.place({ x: 0, y: -14, z: COAST_Z - 200 }, 0);
    s.run(DT);
    v = s.view;
    expect(v.status).toBe('OCEAN DOOR OPEN — PEN 3 40 M');
    expect(s.view.prompt).toBeNull();
    // … and the tower starts it closing once the hull is in the pen beyond that range.
    s.place({ x: 0, y: -14, z: -1385 }, 0);
    s.run(DT);
    expect(s.view.status).toBe('OCEAN DOOR CLOSING BEHIND YOU');
    s.run(5.1);
    expect(s.game.state.launch.door).toBe(0);

    // In the pen, short of the cradle.
    s.place({ x: 0, y: -14, z: -1380 }, 0);
    v = s.view;
    expect(v.status).toBe('STINGRAY IN PEN 3 — DOCKING');
    expect(lamps(v).clamps).toBe('green');

    // Over the cradle and lined up (either heading): lock is the next step.
    s.place({ x: 2, y: -14, z: -1395 }, 0);
    v = s.view;
    expect(v.controls[2]).toMatchObject({ lamp: 'amber', pressable: true, next: true, word: 'RELEASED' });
    expect(v.status).toBe('OVER THE CRADLE — READY TO LOCK');

    s.press('clamps');
    v = s.view;
    expect(v.controls[2]).toMatchObject({ word: 'LOCKING', lamp: 'amber', moving: true });
    expect(v.status).toBe('CLAMPS LOCKING');
    s.run(1);
    v = s.view;
    expect(v.status).toBe('CLAMPS LOCKED — ENGINES RUNNING');
    expect(v.controls[2]).toMatchObject({ word: 'LOCKED', lever: 0 });
    expect(nextOf(v)).toBe('engines');
    expect(lamps(v)).toEqual({ cradle: 'green', engines: 'amber', clamps: 'green', door: 'dark' });

    s.press('engines');
    v = s.view;
    expect(v.status).toBe('ENGINES STOPPED — READY TO RAISE');
    expect(nextOf(v)).toBe('cradle');
    expect(lamps(v)).toEqual({ cradle: 'amber', engines: 'green', clamps: 'green', door: 'dark' });

    s.press('cradle');
    v = s.view;
    expect(v.status).toBe('CRADLE RAISING');
    expect(v.controls[0]).toMatchObject({ lamp: 'amber', moving: true, word: 'RAISING' });

    s.run(8);
    v = s.view;
    expect(s.memory.trip).toBe('out');
    expect(v.status).toBe('STINGRAY ON STANDBY — PEN 3'); // started at sea: no launch from the pen yet
    expect(v.prompt).toBe('Press 1 — lower the cradle');
  });

  it('after a launch, every step home has its prompt and exactly one amber lamp — door range at sea to docked', () => {
    const s = new Session(standby(W));
    s.press('cradle'); s.run(8);
    s.press('engines'); s.run(2);
    s.press('clamps');
    // Out at sea (a launch reached the sea), then back toward the mouth with the door shut.
    s.place({ x: 0, y: -40, z: COAST_Z + 360 }, 0); // beyond the 340 m request range (D6)
    expect(s.memory).toMatchObject({ trip: 'home', launched: true });
    expect(s.view.controls).toEqual([]); // out of door range: nothing on show
    const seen: string[] = [];
    const check = () => {
      const v = s.view;
      if (v.prompt && seen[seen.length - 1] !== v.prompt) seen.push(v.prompt);
      const next = nextOf(v);
      if (v.prompt?.startsWith('Press')) {
        expect(next, v.prompt).not.toBeNull();
        expect(four(v).filter((c) => c.lamp === 'amber').map((c) => c.control), v.prompt).toEqual([next]);
      }
    };
    s.place({ x: 0, y: -40, z: COAST_Z + 100 }, 0); check();
    s.press('door'); check(); s.run(2); check(); s.run(3.1); check();
    s.place({ x: 0, y: -40, z: COAST_Z - 40 }, 0); check();
    s.place({ x: 0, y: -14, z: -1385 }, 0); check(); // beyond the 280 m close range (D6)
    s.run(5.1); check(); // the tower shuts the door behind her
    expect(s.game.state.launch.door).toBe(0);
    s.place({ x: 1, y: -14, z: -1394 }, Math.PI); check();
    s.press('clamps'); check(); s.run(1); check();
    s.press('engines'); check();
    s.press('cradle'); check(); s.run(8.1); check();
    expect(seen).toEqual([
      'Press 4 — request the ocean door',
      'The ocean door is opening — wait for it, then drive in',
      'Door open — drive in through the mouth',
      'Follow the tunnel to Pen 3',
      'Settle over the cradle — guide on the right',
      'Press 3 — lock the clamps',
      'Press 2 — stop the engines',
      'Press 1 — raise the cradle',
    ]);
    expect(s.view.status).toBe('STINGRAY DOCKED — PEN 3');
    expect(s.view.prompt).toBeNull(); // the way out again: no first-time prompts once a launch has reached the sea
  });

  it('a sub just launched, heading away from an open door, is not told to drive in', () => {
    const s = new Session(standby(W));
    s.press('cradle'); s.run(8);
    s.press('engines'); s.run(2);
    s.press('clamps');
    s.game.press('door');
    s.place({ x: 0, y: -40, z: COAST_Z + 30 }, Math.PI);
    s.run(5.1);
    expect(s.game.state.launch.door).toBe(1);
    expect(s.memory).toMatchObject({ shown: 'piloting', trip: 'home' });
    expect(s.view.prompt).toBeNull();
    s.place({ x: 0, y: -40, z: COAST_Z + 30 }, 0); // turned for home
    expect(s.view.prompt).toBe('Door open — drive in through the mouth');
  });
});

describe('the panel steps aside while driving (T8)', () => {
  it('is full size on the cradle and compact from release, through the tunnel and at sea, until locked again', () => {
    const s = new Session(standby(W));
    expect(s.view.compact).toBe(false);
    s.press('cradle');
    s.run(8.2);
    expect(s.view.compact).toBe(false);
    s.press('engines');
    s.run(2.1);
    expect(s.view.compact).toBe(false);
    s.press('clamps');
    expect(s.view.compact).toBe(true);
    s.place({ x: 0, y: -40, z: COAST_Z - 40 });
    expect(s.view.compact).toBe(true);
    // At sea in door range: the door-only panel, compact.
    s.place({ x: 0, y: -40, z: COAST_Z + 60 }, 0);
    expect(s.view.controls.map((c) => c.control)).toEqual(['door']);
    expect(s.view.compact).toBe(true);
    // R: back on the cradle, full size.
    s.game.restartNow();
    s.run(DT);
    expect(s.view.compact).toBe(false);
  });

  it('does not flash the homeward words in the doorway on the way out', () => {
    const s = new Session(standby(W));
    s.press('cradle'); s.run(8.2); s.press('engines'); s.run(2.1); s.press('clamps');
    s.place({ x: 0, y: -40, z: COAST_Z - 30 });
    s.press('door');
    s.run(5.2);
    s.game.override = { throttle: 0.4 };
    const seen = new Set<string>();
    for (let k = 0; k < 600 && s.game.state.sub.pos.z < COAST_Z + 10; k++) {
      s.run(DT);
      const v = s.view;
      if (v.prompt) seen.add(v.prompt);
      if (v.status) seen.add(v.status);
    }
    expect(s.game.state.sub.pos.z).toBeGreaterThan(COAST_Z + 10);
    expect([...seen].filter((w) => /PEN 3|Pen 3/.test(w))).toEqual([]);
  });
});


describe('the fifth control, 5 · LEAVE SEAT (phase 3, M9, M6b)', () => {
  const leave = (v: PanelView) => v.controls.find((c) => c.control === 'leave');

  it('stands fifth in the pen, lit amber only when docked and raised; dark while the cradle moves or is down', () => {
    const s = new Session(standby(W));
    let v = s.view;
    expect(v.controls.map((c) => c.control)).toEqual(['cradle', 'engines', 'clamps', 'door', 'leave']);
    expect(leave(v)).toEqual({
      control: 'leave', key: '5', label: 'LEAVE SEAT', lamp: 'amber', moving: false, lever: 0, word: 'READY', pressable: true, next: false,
    });
    s.press('cradle');
    expect(leave(s.view)).toMatchObject({ lamp: 'dark', pressable: false, word: 'SEATED' }); // lowering
    s.run(8);
    expect(s.game.state.launch.cradle).toBe(1);
    expect(leave(s.view)).toMatchObject({ lamp: 'dark', pressable: false }); // lowered
    s.press('engines'); s.run(2);
    s.press('clamps');
    v = s.view;
    expect(s.game.state.launch.clamps).toBe('released');
    expect(leave(v)).toMatchObject({ lamp: 'dark', pressable: false }); // released
  });

  it('a refused leave shows red with "Dock first" for refusalShow, as phase 2\'s refusals do — in the pen and at sea', () => {
    const pen = new Session(standby(W));
    pen.press('cradle');
    pen.press('leave');
    expect(pen.view.refusal).toEqual({ control: 'leave', reason: REFUSAL.notDocked });
    expect(leave(pen.view)!.lamp).toBe('red');
    pen.run(3.1);
    expect(pen.view.refusal).toBeNull();

    // At sea the panel shows only the door within its range: the fifth control appears for its refusal's 3 s alone.
    const sea = new Session(oceanStart(W));
    expect(leave(sea.view)).toBeUndefined();
    sea.press('leave');
    const v = sea.view;
    expect(v.refusal).toEqual({ control: 'leave', reason: REFUSAL.notDocked });
    expect(leave(v)).toMatchObject({ lamp: 'red', pressable: false });
    sea.run(3.1);
    expect(leave(sea.view)).toBeUndefined();
  });

  it('goes with the rest of the panel once he leaves the seat (riding up, then on foot)', () => {
    const s = new Session(standby(W));
    s.press('leave');
    expect(s.game.state.troy.where).toBe('riding');
    expect(s.view.controls).toEqual([]);
    s.run(10.1);
    expect(s.game.state.troy.where).toBe('onFoot');
    expect(s.view.controls).toEqual([]);
  });
});
