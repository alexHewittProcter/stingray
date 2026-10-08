import { describe, expect, it } from 'vitest';
import { INTERACTABLES, type Interactable, LINE_SECONDS, USE_CONE, USE_RADIUS, lineAt, nearestUsable } from './interactables';
import { FLOOR_Y, ROOMS, SEAT } from './rooms';
import { type TroyState, aboard, onFoot, walkable } from './troy';

// M5: what Troy can use, from where, facing which way.

const troyAt = (x: number, z: number, yaw: number): TroyState => onFoot({ pos: { x, y: FLOOR_Y, z }, yaw });
const EAST = -Math.PI / 2; // forward(yaw) = (−sin yaw, −cos yaw): yaw −π/2 faces +x
const say = (id: string, x: number, z: number, radius = USE_RADIUS): Interactable =>
  ({ id, pos: { x, y: FLOOR_Y, z }, radius, prompt: id, use: { kind: 'say', line: id } });

describe('nearestUsable (M5)', () => {
  it('finds one in range and in front; not out of range', () => {
    const list = [say('a', 2, 0)];
    expect(nearestUsable(troyAt(0, 0, EAST), list)?.id).toBe('a');
    expect(nearestUsable(troyAt(2 - USE_RADIUS - 0.01, 0, EAST), list)).toBeNull();
    expect(nearestUsable(troyAt(2 - USE_RADIUS + 0.01, 0, EAST), list)?.id).toBe('a');
  });

  it('rejects one outside 60° of his facing, accepts one just inside', () => {
    const list = [say('a', 2, 0)];
    expect(nearestUsable(troyAt(0, 0, 0), list)).toBeNull(); // facing north, it is 90° to his right
    expect(nearestUsable(troyAt(0, 0, Math.PI / 2), list)).toBeNull(); // facing west, it is behind him
    expect(nearestUsable(troyAt(0, 0, EAST + USE_CONE - 0.01), list)?.id).toBe('a');
    expect(nearestUsable(troyAt(0, 0, EAST - USE_CONE + 0.01), list)?.id).toBe('a');
    expect(nearestUsable(troyAt(0, 0, EAST + USE_CONE + 0.01), list)).toBeNull();
  });

  it('takes the nearest of those in range and facing, skipping a nearer one behind him', () => {
    const list = [say('far', 2, 0), say('near', 1, 0.2), say('behind', -0.5, 0)];
    expect(nearestUsable(troyAt(0, 0, EAST), list)?.id).toBe('near');
    expect(nearestUsable(troyAt(0, 0, EAST), [list[0]!, list[2]!])?.id).toBe('far');
  });

  it('measures range on the floor plane (height does not count)', () => {
    const high = { ...say('a', 2, 0), pos: { x: 2, y: FLOOR_Y + 5, z: 0 } };
    expect(nearestUsable(troyAt(0, 0, EAST), [high])?.id).toBe('a');
  });

  it("honours an interactable's own facing: he must face within 60° of it too", () => {
    const fronted: Interactable = { ...say('a', 0, -1), facing: 0 };
    expect(nearestUsable(troyAt(0, 0, 0), [fronted])?.id).toBe('a');
    expect(nearestUsable(troyAt(0, -2, Math.PI), [fronted])).toBeNull(); // in front of him, but from the wrong side
  });

  it('is null unless he is on foot', () => {
    const list = [say('a', 2, 0)];
    const t = troyAt(0, 0, EAST);
    expect(nearestUsable({ ...t, where: 'riding' }, list)).toBeNull();
    expect(nearestUsable({ ...t, where: 'aboard' }, list)).toBeNull();
    expect(nearestUsable(aboard(SEAT))).toBeNull();
  });
});

describe('INTERACTABLES (M5)', () => {
  it("has exactly one ride: the injector chair at ROOMS.chair.pos, 'Sit — injector chair'", () => {
    const rides = INTERACTABLES.filter((i) => i.use.kind === 'ride');
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({ id: 'chair', prompt: 'Sit — injector chair', pos: ROOMS.chair.pos });
  });

  it('has three to five says in the control room, each with a one-sentence line and a prompt', () => {
    const says = INTERACTABLES.filter((i) => i.use.kind === 'say');
    expect(says.length).toBeGreaterThanOrEqual(3);
    expect(says.length).toBeLessThanOrEqual(5);
    const room = ROOMS.rooms.find((r) => r.id === 'controlRoom')!;
    for (const s of says) {
      const line = s.use.kind === 'say' ? s.use.line : '';
      expect(line.length).toBeGreaterThan(10);
      expect(line.match(/[.!?](\s|$)/g)?.length, line).toBe(1);
      expect(s.prompt.length).toBeGreaterThan(0);
      expect(s.pos.x).toBeGreaterThanOrEqual(room.min.x);
      expect(s.pos.x).toBeLessThanOrEqual(room.max.x);
      expect(s.pos.z).toBeGreaterThanOrEqual(room.min.z);
      expect(s.pos.z).toBeLessThanOrEqual(room.max.z);
    }
  });

  it('has unique ids, the default radius, and is data only (no functions)', () => {
    expect(new Set(INTERACTABLES.map((i) => i.id)).size).toBe(INTERACTABLES.length);
    for (const i of INTERACTABLES) expect(i.radius).toBe(USE_RADIUS);
    expect(JSON.parse(JSON.stringify(INTERACTABLES))).toEqual(INTERACTABLES);
  });

  it('every one can be used from some walkable spot (a 0.25 m grid and 16 facings)', () => {
    for (const it of INTERACTABLES) {
      let reachable = false;
      for (let dx = -USE_RADIUS; dx <= USE_RADIUS && !reachable; dx += 0.25) {
        for (let dz = -USE_RADIUS; dz <= USE_RADIUS && !reachable; dz += 0.25) {
          const p = { x: it.pos.x + dx, y: FLOOR_Y, z: it.pos.z + dz };
          if (!walkable(p, ROOMS)) continue;
          for (let k = 0; k < 16 && !reachable; k++) {
            reachable = nearestUsable(onFoot({ pos: p, yaw: (k / 16) * 2 * Math.PI }))?.id === it.id;
          }
        }
      }
      expect(reachable, it.id).toBe(true);
    }
  });

  it('nothing is usable from the start, as he stands', () => {
    expect(nearestUsable(onFoot(ROOMS.start))).toBeNull();
  });
});

describe('lineAt (M5: the HUD compares, the sim does not time it)', () => {
  it('shows the line before until, not at or after it, and nothing with no line', () => {
    const hud = { line: { text: 'hello', until: 10 } };
    expect(lineAt(hud, 10 - LINE_SECONDS)).toBe('hello');
    expect(lineAt(hud, 9.99)).toBe('hello');
    expect(lineAt(hud, 10)).toBeNull();
    expect(lineAt({ line: null }, 0)).toBeNull();
  });
});
