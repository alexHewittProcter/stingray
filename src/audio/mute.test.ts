import { describe, expect, it } from 'vitest';
import { MUTE_KEY, readMuted, writeMuted } from './mute';

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
