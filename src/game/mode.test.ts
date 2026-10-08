import { describe, expect, it } from 'vitest';
import { oceanStart, standby } from '../sim/launch';
import { ROOMS } from '../sim/rooms';
import { controlRoom } from '../sim/session';
import { COAST_Z, createWorld } from '../sim/world';
import { mappingOf, modeOf, sessionMode } from './mode';

const W = createWorld(1964);

describe('the session mode (M7)', () => {
  it("is 'onFoot' while Troy walks, 'transport' while he rides, otherwise phase 2's modeOf the hull centre", () => {
    const room = controlRoom(W, ROOMS);
    expect(sessionMode(room)).toBe('onFoot');
    expect(sessionMode({ ...room, troy: { ...room.troy, where: 'riding', ride: 0.5 } })).toBe('transport');
    expect(sessionMode(standby(W))).toBe('launch');
    expect(sessionMode(oceanStart(W))).toBe('piloting');
    // Wherever the sub is, Troy on foot is on foot.
    expect(sessionMode({ ...oceanStart(W), troy: room.troy })).toBe('onFoot');
  });

  it('leaves modeOf(pos) as it was', () => {
    expect(modeOf({ x: 0, y: -40, z: COAST_Z - 0.01 })).toBe('launch');
    expect(modeOf({ x: 0, y: -40, z: COAST_Z })).toBe('piloting');
  });

  it("maps 'launch' and 'piloting' to the one aboard mapping, so crossing the mouth changes no keys (M3)", () => {
    expect(mappingOf('launch')).toBe(mappingOf('piloting'));
    expect(new Set((['onFoot', 'transport', 'launch'] as const).map(mappingOf)).size).toBe(3);
  });
});
