// The sound system (L7): the one thing main.ts creates. It hears each fixed step's (previous, current) pair from
// Game.onStep and turns it into one-shots, and once per drawn frame sets the continuous sounds from the current
// state. It reads sim state only; nothing here writes it, and src/sim does not know this exists.
//
// The AudioContext is created on the first key press or click (browsers block audio before a gesture); until
// then every call is a no-op. M mutes and unmutes, remembered across reloads.

import type { GameState } from '../sim/launch';
import { type SoundEvent, listenerUnderwater, soundscape, stepEvents } from './cues';
import { type Ambience, createAmbience } from './ambience';
import { type Engine, createEngine } from './engine';
import { type Machinery, createMachinery } from './machinery';
import { type Mixer, createMixer } from './mixer';
import { readMuted, writeMuted } from './mute';
import { type Weapons, createWeapons } from './weapons';

export interface Audio {
  /** One fixed step's pair (wire to Game.onStep). */
  step(previous: GameState, current: GameState): void;
  /** Once per drawn frame. */
  frame(current: GameState): void;
  readonly muted: boolean;
  /** Toggle the persisted mute, as M does (T9: the menu's Sound item). */
  toggleMute(): void;
  /** Start sound on a user gesture the window's own listeners did not hear (T9: menu keys are kept from the game). */
  gesture(): void;
  /** Silence everything while the pause menu is up (the context is suspended), and resume it after (T9). */
  setPaused(paused: boolean): void;
}

interface Running {
  mixer: Mixer;
  engine: Engine;
  machinery: Machinery;
  ambience: Ambience;
  weapons: Weapons;
}

export function createAudio(win: Window): Audio {
  const store = storage(win);
  let muted = readMuted(store);
  let on: Running | null = null;
  let failed = false;
  let paused = false;

  const start = () => {
    if (on || failed) return;
    try {
      const w = win as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Context = w.AudioContext ?? w.webkitAudioContext;
      if (!Context) throw new Error('no Web Audio');
      const ctx = new Context();
      const mixer = createMixer(ctx, muted);
      on = { mixer, engine: createEngine(mixer), machinery: createMachinery(mixer), ambience: createAmbience(mixer), weapons: createWeapons(mixer) };
      if (paused) void ctx.suspend().catch(() => undefined);
      else void ctx.resume().catch(() => undefined);
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
      if (!on) return;
      const underwater = listenerUnderwater(current);
      for (const e of stepEvents(previous, current)) play(on, e, underwater);
    },
    frame(current) {
      if (!on) return;
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
    // M6b, reversed: the unlock is the lock-in's clunk; home in the lounge, the setting-off latch and hiss.
    case 'chairUnlock': return a.machinery.chair(true);
    case 'chairHome': return a.machinery.chair(false);
  }
}

function storage(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}
