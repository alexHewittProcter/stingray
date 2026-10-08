import { describe, expect, it } from 'vitest';
import { type DebugHandle, SCRIPT_LIMITS, clampAdvance, nearCradle, onCentreline, runScript } from './debug';
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

describe('placement near the cradle and steering holds (T6)', () => {
  function placingHandle() {
    const state = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, medium: 'submerged' as const };
    const inputs: Array<Record<string, number>> = [];
    const handle = {
      press: () => {},
      advance: () => {},
      state: () => state,
      teleport: (pos: typeof state.pos, yaw?: number) => { state.pos = { ...pos }; state.yaw = yaw ?? state.yaw; },
      setInput: (i: Record<string, number>) => inputs.push(i),
    } as unknown as DebugHandle;
    return { handle, state, inputs };
  }

  it('dock=M puts the sub on the pen axis at the lowered cradle height, facing the cradle; dx/dy/dz/turn nudge it', () => {
    const c = MARINEVILLE.interior.cradle;
    const { handle, state } = placingHandle();
    runScript('dock=20', handle);
    expect(state.pos).toEqual({ x: c.pos.x, y: c.loweredY, z: c.pos.z + 20 });
    expect(state.yaw).toBe(0);
    runScript('dock=-10', handle);
    expect(state.pos.z).toBe(c.pos.z - 10);
    expect(state.yaw).toBe(Math.PI);
    runScript('dock=0,dx=2,dy=-3,dz=1e9,turn=90', handle);
    expect(state.pos).toEqual({ x: c.pos.x + 2, y: c.loweredY - 3, z: c.pos.z + 100 });
    expect(state.yaw).toBeCloseTo(Math.PI / 2, 12);
    expect(nearCradle(1e9).pos.z).toBe(c.pos.z + 1e9); // the script clamps; nearCradle itself does not
  });

  it('steer= and climb= hold the turn and pitch axes, clamped to ±1', () => {
    const { handle, inputs } = placingHandle();
    runScript('steer=0.5,climb=-7,throttle=2', handle);
    expect(inputs).toEqual([{ yaw: 0.5 }, { pitch: -1 }, { throttle: 1 }]);
  });

  it('fire= and boost= hold the trigger and the boost, 0 letting go', () => {
    const { handle, inputs } = placingHandle();
    runScript('fire=1,boost=1,fire=0,fire=x', handle);
    expect(inputs).toEqual([{ fire: true }, { boost: true }, { fire: false }]);
  });
});

describe('walk=x:z (phase 3, M10)', () => {
  it('teleports Troy with a colon pair, alongside the comma words; malformed pairs are skipped', () => {
    const walks: Array<[number, number]> = [];
    const seconds: number[] = [];
    const handle = {
      walkTo: (x: number, z: number) => walks.push([x, z]),
      advance: (s: number) => seconds.push(s),
    } as unknown as DebugHandle;
    runScript('walk=5.2:-1262,2,walk=-3:-1275,walk=1,walk=a:2,walk=1:2:3', handle);
    expect(walks).toEqual([[5.2, -1262], [-3, -1275]]);
    expect(seconds).toEqual([2]);
  });
});

describe('use (phase 3, M10)', () => {
  it("queues 'use' through the handle's use(), in order with the other words", () => {
    const log: string[] = [];
    const handle = {
      use: () => log.push('use'),
      walkTo: () => log.push('walk'),
      advance: (s: number) => log.push(String(s)),
    } as unknown as DebugHandle;
    runScript('walk=1:2,use,1', handle);
    expect(log).toEqual(['walk', 'use', '1']);
  });
});

describe('leave (phase 3, M10)', () => {
  it("queues 'leave' through the handle's leave(), in order with the other words", () => {
    const log: string[] = [];
    const handle = {
      use: () => log.push('use'),
      leave: () => log.push('leave'),
      advance: (s: number) => log.push(String(s)),
    } as unknown as DebugHandle;
    runScript('leave,12,use,leave', handle);
    expect(log).toEqual(['leave', '12', 'use', 'leave']);
  });
});
