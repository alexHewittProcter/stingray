import { describe, expect, it } from 'vitest';
import { MUSIC_KEY, MUTE_KEY, musicOnLoad, readMusic, readMuted, writeMusic, writeMuted } from './mute';

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

const broken = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('blocked');
  },
};

describe('mute persistence (L5, L7)', () => {
  it('defaults to unmuted and remembers the choice', () => {
    const store = memory();
    expect(readMuted(store)).toBe(false);
    writeMuted(store, true);
    expect(store.map.get(MUTE_KEY)).toBe('1');
    expect(readMuted(store)).toBe(true);
    writeMuted(store, false);
    expect(readMuted(store)).toBe(false);
  });

  it('survives storage that is missing or throws', () => {
    expect(readMuted(undefined)).toBe(false);
    expect(readMuted(broken)).toBe(false);
    expect(() => writeMuted(broken, true)).not.toThrow();
    expect(() => writeMuted(undefined, true)).not.toThrow();
  });
});

describe('the music switch (phase 4 S4)', () => {
  it('is stored under stingray.music, defaults to on, and remembers the choice', () => {
    const store = memory();
    expect(MUSIC_KEY).toBe('stingray.music');
    expect(readMusic(store)).toBe(true);
    writeMusic(store, false);
    expect(store.map.get(MUSIC_KEY)).toBe('0');
    expect(readMusic(store)).toBe(false);
    writeMusic(store, true);
    expect(readMusic(store)).toBe(true);
  });

  it('is separate from the mute', () => {
    const store = memory();
    writeMuted(store, true);
    expect(readMusic(store)).toBe(true);
    writeMusic(store, false);
    expect(readMuted(store)).toBe(true);
  });

  it('?music=0 starts the page off without touching the stored switch', () => {
    const store = memory();
    expect(musicOnLoad(store, new URLSearchParams('music=0'))).toBe(false);
    expect(store.map.has(MUSIC_KEY)).toBe(false);
    expect(musicOnLoad(store, new URLSearchParams(''))).toBe(true);
    writeMusic(store, false);
    expect(musicOnLoad(store, new URLSearchParams('music=1'))).toBe(false);
  });

  it('survives storage that is missing or throws (on)', () => {
    expect(readMusic(undefined)).toBe(true);
    expect(readMusic(broken)).toBe(true);
    expect(() => writeMusic(broken, false)).not.toThrow();
  });
});
