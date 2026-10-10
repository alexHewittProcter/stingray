// Phase 4 (T6): audio.ts's cue tracking — the jumps it infers from Game's step pairs and the menu it hears from frame —
// with no Web Audio (the commands are read from the ?debug=music log, which runs before any gesture).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game/game';
import type { MenuKind } from '../game/menu';
import { ROOMS } from '../sim/rooms';
import { controlRoom } from '../sim/session';
import { createWorld } from '../sim/world';
import { createAudio } from './audio';

const W = createWorld(1964);

function fakeWindow(search: string) {
  const map = new Map<string, string>();
  return {
    location: { search },
    addEventListener: () => undefined,
    document: { hidden: false, addEventListener: () => undefined },
    localStorage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) },
    map,
  };
}

function setUp(search = '?debug=music') {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((s: string) => void lines.push(s.replace(/^\[music\] t=[\d.]+s step \d+: /, '').replace(/ \(silent: no gesture yet\)$/, '')));
  const win = fakeWindow(search);
  const audio = createAudio(win as unknown as Window);
  const game = new Game(W, controlRoom(W, ROOMS));
  game.onStep = (a, b) => audio.step(a, b);
  const held = new Set<string>();
  const frame = (menu: MenuKind | null = null) => audio.frame(game.state, { menu });
  const run = (seconds: number, menu: MenuKind | null = null) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) game.step(held, 1 / 60);
    frame(menu);
  };
  return { lines, audio, game, frame, run, win, held };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audio.ts: the cues as the game drives them', () => {
  it('the title from cold, the fade on Start, then the ALERT once the fade is done', () => {
    const t = setUp();
    t.frame('title');
    expect(t.lines).toEqual(["title: play('FANFARE', { then: 'MARCH' })"]);
    t.game.toControlRoom(); // "Start in the control room": a jump, and the menu closes (main.ts showMenu → frame)
    t.frame(null);
    expect(t.lines.slice(1)).toEqual(['titleEnd: stop(4)', "alert: play('ALERT', { after 4 s })"]);
    t.run(1); // stepping on: no jump is seen twice
    expect(t.lines.length).toBe(3);
  });

  it('a jump between steps (R, walkTo) is stop(0.2) then the state cue, heard once', () => {
    const t = setUp();
    t.frame(null);
    t.run(0.5);
    t.game.walkTo(ROOMS.chair.pos.x, ROOMS.chair.pos.z + 1.6);
    t.run(0.5);
    expect(t.lines).toEqual(["alert: play('ALERT')", 'jump: stop(0.2)', "alert: play('ALERT')"]);
    t.held.add('KeyR');
    t.run(0.1);
    t.held.clear();
    t.run(0.1);
    expect(t.lines.slice(3)).toEqual(['jump: stop(0.2)', "alert: play('ALERT')"]);
  });

  it('sit and lock-in through Game, then the pause menu changes nothing', () => {
    const t = setUp();
    t.frame(null);
    t.game.walkTo(ROOMS.chair.pos.x, ROOMS.chair.pos.z + 1.6);
    t.run(0.2);
    t.game.press('use');
    t.run(7);
    t.frame('pause');
    t.frame(null);
    expect(t.lines.slice(3)).toEqual(["sit: play('ROLL')", "lockIn: play('MARCH')"]);
  });

  it('?music=0 starts with the switch off and stores nothing; setMusic persists', () => {
    const t = setUp('?music=0');
    expect(t.audio.music).toBe(false);
    expect(t.win.map.has('stingray.music')).toBe(false);
    t.audio.setMusic(true);
    expect(t.win.map.get('stingray.music')).toBe('1');
    expect(t.audio.score.playing()).toBe(null);
  });

  it('without ?debug=music nothing is logged', () => {
    const t = setUp('');
    t.frame('title');
    expect(t.lines).toEqual([]);
  });
});
