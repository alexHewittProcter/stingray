import { describe, expect, it } from 'vitest';
import { type DebugHandle, SCRIPT_LIMITS, clampAdvance, onCentreline, runScript } from './debug';
import { MARINEVILLE } from './sim/world';

// The witnessing script runner: bounded, so no URL can freeze the tab, and its placement words land on the tunnel.

function fakeHandle() {
  const log = { presses: [] as string[], seconds: [] as number[], teleports: 0, throttle: [] as number[] };
  const handle = {
    press: (c: string) => log.presses.push(c),
    advance: (s: number) => log.seconds.push(s),
    teleport: () => { log.teleports++; },
    setInput: (i: { throttle?: number }) => log.throttle.push(i.throttle ?? NaN),
  } as unknown as DebugHandle;
  return { handle, log };
}

describe('runScript', () => {
  it('presses controls and advances in order', () => {
    const { handle, log } = fakeHandle();
    runScript('cradle, 8.2 ,engines,2.1,clamps,1,bogus', handle);
    expect(log.presses).toEqual(['cradle', 'engines', 'clamps']);
    expect(log.seconds).toEqual([8.2, 2.1, 1]);
  });

  it('clamps a huge advance and skips zero, negative and non-numbers', () => {
    const { handle, log } = fakeHandle();
    runScript('1e9,0,-5,NaN,Infinity,-Infinity,abc,3', handle);
    expect(log.seconds).toEqual([SCRIPT_LIMITS.secondsPerAdvance, 3]);
  });

  it('caps the total seconds a script may run', () => {
    const { handle, log } = fakeHandle();
    runScript(Array.from({ length: 20 }, () => '100').join(','), handle);
    expect(log.seconds.reduce((a, b) => a + b, 0)).toBe(SCRIPT_LIMITS.totalSeconds);
  });

  it('runs no more than the token limit', () => {
    const { handle, log } = fakeHandle();
    runScript(Array.from({ length: 200 }, () => 'door').join(','), handle);
    expect(log.presses.length).toBe(SCRIPT_LIMITS.tokens);
  });

  it('places the sub on the centreline and holds a clamped throttle', () => {
    const { handle, log } = fakeHandle();
    runScript('out=40,throttle=5,in=NaN', handle);
    expect(log.teleports).toBe(1);
    expect(log.throttle).toEqual([1]);
  });
});

describe('clampAdvance', () => {
  it('bounds the debug handle\'s advance', () => {
    expect(clampAdvance(1e9)).toBe(SCRIPT_LIMITS.secondsPerAdvance);
    expect(clampAdvance(Number.NaN)).toBe(0);
    expect(clampAdvance(-1)).toBe(0);
    expect(clampAdvance(2.5)).toBe(2.5);
  });
});

describe('onCentreline', () => {
  const m = MARINEVILLE.tunnelMouth;
  it('measures in from the mouth, facing out to sea or in to the pen', () => {
    const out = onCentreline(40, 'out');
    expect(out.pos).toEqual({ x: m.x, y: m.y, z: m.z - 40 });
    expect(Math.cos(out.yaw - MARINEVILLE.tunnelHeading)).toBeCloseTo(1, 9);
    const sea = onCentreline(-30, 'in');
    expect(sea.pos.z).toBeCloseTo(m.z + 30, 9);
    expect(Math.cos(sea.yaw)).toBeCloseTo(1, 9); // yaw 0 faces north, into the cliff
    const end = MARINEVILLE.interior.tunnel.centreline.at(-1)!;
    expect(onCentreline(1e6, 'in').pos).toEqual(end);
  });
});
