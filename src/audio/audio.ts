// The sound system (L7): the one thing main.ts creates. It hears each fixed step's (previous, current) pair from
// Game.onStep and turns it into one-shots, and once per drawn frame sets the continuous sounds from the current
// state. It reads sim state only; nothing here writes it, and src/sim does not know this exists.
//
// The AudioContext is created on the first key press or click (browsers block audio before a gesture); until
// then every call is a no-op. M mutes and unmutes, remembered across reloads.
//
// Phase 4 (S2, S3): it owns the score too. The cues (music-cues.ts, pure) are decided from the same step pairs, plus
// the discontinuities between them (a step whose `previous` is not the last state heard is the far side of a jump —
// R, the menu's jumps, a debug walkTo/teleport) and the menu (frame's `menu`, which main.ts also passes the moment a
// menu changes). They are tracked whether or not sound has started, so when the first gesture starts it the music
// for the state at hand begins (the title's fanfare). ?debug=music logs every command as it is decided.

import type { MenuKind } from '../game/menu';
import type { GameState } from '../sim/launch';
import { FIXED_DT } from '../sim/world';
import { type SoundEvent, listenerUnderwater, soundscape, stepEvents } from './cues';
import { type Ambience, createAmbience } from './ambience';
import { type Engine, createEngine } from './engine';
import { type Machinery, createMachinery } from './machinery';
import { LEVELS } from './levels';
import { type Mixer, createMixer } from './mixer';
import { type Music, createMusic } from './music';
import { type CueMemory, type MusicCommand, describeCommand, memoryOf, musicCues, musicIntensity, stateCue } from './music-cues';
import { musicOnLoad, readMuted, writeMuted, writeMusic } from './mute';
import type { SectionId } from './score';
import { type Weapons, createWeapons } from './weapons';

export interface Audio {
  /** One fixed step's pair (wire to Game.onStep). */
  step(previous: GameState, current: GameState): void;
  /**
   * Once per drawn frame — and whenever a menu opens, closes or jumps (main.ts showMenu), so the music hears the menu
   * the moment it changes. `menu`: which menu is up (S2: the title cue needs it).
   */
  frame(current: GameState, view: { menu: MenuKind | null }): void;
  readonly muted: boolean;
  /** Toggle the persisted mute, as M does (T9: the menu's Sound item). */
  toggleMute(): void;
  /** Start sound on a user gesture the window's own listeners did not hear (T9: menu keys are kept from the game). */
  gesture(): void;
  /** Silence everything while the pause menu is up (the context is suspended), and resume it after (T9). */
  setPaused(paused: boolean): void;
  /** S4: the Music switch (the menu's Music item; `stingray.music`, or off for the page with ?music=0). */
  readonly music: boolean;
  /** S4: the switch on or off, persisted: the music bus to LEVELS.musicBus or 0. */
  setMusic(on: boolean): void;
  /** S4: `window.__stingray.music` — hear a section on its own (starts sound if a gesture has not). */
  readonly score: { play(id: SectionId): void; stop(): void; playing(): SectionId | null };
}

interface Running {
  mixer: Mixer;
  engine: Engine;
  machinery: Machinery;
  ambience: Ambience;
  weapons: Weapons;
  music: Music;
}

/** A play waiting out a fade (the ALERT after the title's 4 s), on the audio clock — so a pause holds it too. */
interface Pending {
  command: MusicCommand & { kind: 'play' };
  at: number;
}

export function createAudio(win: Window): Audio {
  const store = storage(win);
  let muted = readMuted(store);
  let on: Running | null = null;
  let failed = false;
  let paused = false;
  let musicOn = musicOnLoad(store, new URLSearchParams(win.location.search));
  const logMusic = new URLSearchParams(win.location.search).get('debug') === 'music';

  // The cues' view of the session (S3): the last state and menu heard, and the one flag they remember.
  let heard: GameState | null = null;
  let heardMenu: MenuKind | null = null;
  let memory: CueMemory = { away: false };
  let pending: Pending | null = null;
  let steps = 0;

  const apply = (commands: MusicCommand[]) => {
    for (const c of commands) {
      if (logMusic) console.log(`[music] t=${(steps * FIXED_DT).toFixed(2)}s step ${steps}: ${describeCommand(c)}${on ? '' : ' (silent: no gesture yet)'}`);
      pending = null; // Any later command supersedes a play still waiting out a fade.
      if (!on) continue;
      if (c.kind === 'stop') on.music.stop(c.fade);
      else if (c.delay) pending = { command: c, at: on.mixer.ctx.currentTime + c.delay };
      else on.music.play(c.id, { then: c.then, ending: c.ending });
    }
  };
  const firePending = () => {
    if (!on || !pending || on.mixer.ctx.currentTime < pending.at) return;
    const c = pending.command;
    pending = null;
    if (logMusic) console.log(`[music] t=${(steps * FIXED_DT).toFixed(2)}s step ${steps}: ${describeCommand({ ...c, delay: undefined })} (the fade done)`);
    on.music.play(c.id, { then: c.then, ending: c.ending });
  };
  /** Hear a moment: the first one (or one after a discontinuity) by its state cue, the rest by their edges. */
  const hear = (g: GameState, menu: MenuKind | null, jumped: boolean) => {
    let commands: MusicCommand[];
    if (heard === null) {
      commands = stateCue({ g, menu }, true);
      memory = memoryOf(g);
    } else {
      const r = musicCues({ g: heard, menu: heardMenu }, { g, menu }, jumped, memory);
      commands = r.commands;
      memory = r.mem;
    }
    heard = g;
    heardMenu = menu;
    on?.music.setIntensity(musicIntensity(g));
    apply(commands);
  };

  const start = () => {
    if (on || failed) return;
    try {
      const w = win as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Context = w.AudioContext ?? w.webkitAudioContext;
      if (!Context) throw new Error('no Web Audio');
      const ctx = new Context();
      const mixer = createMixer(ctx, muted);
      const music = createMusic(mixer);
      music.setLevel(musicOn ? LEVELS.musicBus : 0, 0.01);
      on = {
        mixer, engine: createEngine(mixer), machinery: createMachinery(mixer), ambience: createAmbience(mixer), weapons: createWeapons(mixer), music,
      };
      if (paused) void ctx.suspend().catch(() => undefined);
      else void ctx.resume().catch(() => undefined);
      // Sound starts on the first gesture, mid-session: the music the state at hand calls for, from cold (the title's
      // fanfare, or the ALERT on foot).
      if (heard) {
        music.setIntensity(musicIntensity(heard));
        apply(stateCue({ g: heard, menu: heardMenu }, true));
      }
    } catch {
      failed = true; // No sound on this browser; the game plays on silent.
    }
  };

  const gesture = () => {
    start();
    if (on && on.mixer.ctx.state === 'suspended' && !win.document.hidden && !paused) void on.mixer.ctx.resume().catch(() => undefined);
  };
  const toggleMute = () => {
    muted = !muted;
    writeMuted(store, muted);
    on?.mixer.setMuted(muted);
  };
  win.addEventListener('keydown', (e) => {
    gesture();
    if (e.code === 'KeyM' && !e.repeat) toggleMute();
  });
  win.addEventListener('pointerdown', gesture);
  // A hidden tab stops drawing; stop the sound with it rather than hold the last frame's hum.
  win.document.addEventListener('visibilitychange', () => {
    if (!on) return;
    if (win.document.hidden) void on.mixer.ctx.suspend().catch(() => undefined);
    else if (!paused) void on.mixer.ctx.resume().catch(() => undefined);
  });

  return {
    step(previous, current) {
      steps += 1;
      // A step whose `previous` is not what was last heard starts on the far side of a jump (Game.set).
      if (heard !== null && previous !== heard) hear(previous, heardMenu, true);
      hear(current, heardMenu, false);
      firePending();
      if (!on) return;
      const underwater = listenerUnderwater(current);
      for (const e of stepEvents(previous, current)) play(on, e, underwater);
    },
    frame(current, { menu }) {
      if (current !== heard || menu !== heardMenu) hear(current, menu, heard !== null && current !== heard);
      firePending();
      if (!on) return;
      on.music.frame();
      const s = soundscape(current);
      const inside = s.ambience.tunnel + s.ambience.hall > 0;
      // Phase 3: the shaft rings like the halls; the rooms are smaller and dressed.
      const room = inside || s.shaft.level > 0 ? 0.55 : s.ambience.rooms > 0 ? 0.25 : s.underwater ? 0.18 : 0.06;
      on.mixer.setPlace(s.underwater, room);
      on.engine.update(s.engine);
      on.machinery.update(s);
      on.ambience.update(s);
    },
    get muted() {
      return muted;
    },
    toggleMute,
    gesture,
    setPaused(p) {
      if (p === paused) return;
      paused = p;
      if (!on) return;
      if (paused) void on.mixer.ctx.suspend().catch(() => undefined);
      else if (!win.document.hidden) void on.mixer.ctx.resume().catch(() => undefined);
    },
    get music() {
      return musicOn;
    },
    setMusic(v) {
      musicOn = v;
      writeMusic(store, v);
      on?.music.setLevel(v ? LEVELS.musicBus : 0);
    },
    score: {
      play(id) {
        start();
        pending = null;
        on?.music.play(id);
      },
      stop() {
        pending = null;
        on?.music.stop();
      },
      playing: () => on?.music.playing() ?? null,
    },
  };
}

function play(a: Running, e: SoundEvent, underwater: boolean): void {
  switch (e.kind) {
    case 'klaxon': return a.machinery.klaxon();
    case 'cradleStart': return a.machinery.cradleStart(e.dir);
    case 'cradleStop': return a.machinery.cradleStop();
    case 'engineStart': return a.engine.ignition();
    case 'engineStop': return a.engine.stop();
    case 'clampsRelease': return a.machinery.clamps(true);
    case 'clampsLock': return a.machinery.clamps(false);
    case 'hullUnder': return a.ambience.hullUnder();
    case 'hullOut': return a.ambience.hullOut();
    case 'doorStart': return a.machinery.doorStart(e.gain);
    case 'doorOpened': return a.machinery.doorOpened(e.gain);
    case 'doorSeal': return a.machinery.doorSeal(e.gain);
    case 'leap': return a.ambience.splash(e.speed, false);
    case 'reentry': return a.ambience.splash(e.speed, true);
    case 'missile': return a.weapons.missile();
    case 'detonation': return a.weapons.detonation(e.distance, e.gain, e.muffle, underwater);
    case 'refusal': return a.machinery.refusal();
    case 'chairStart': return a.machinery.chair(false);
    case 'lockIn': return a.machinery.chair(true);
    // M6b, reversed: the unlock is the lock-in's clunk; home at the station, the setting-off latch and hiss.
    case 'chairUnlock': return a.machinery.chair(true);
    case 'chairHome': return a.machinery.chair(false);
    case 'portLid': return a.machinery.portLid(e.open);
    case 'pole': return a.machinery.pole(e.extend);
  }
}

function storage(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}
