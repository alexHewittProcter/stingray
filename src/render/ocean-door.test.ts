import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DOOR_BORE_RADIUS, beaconLevel, irisLeafOutlines } from './ocean-door';

// The iris (L2, L6): what you see is what you hit — the door's leaves close the whole bore when shut, never clear it
// before the door is fully open (the collider stays until door = 1), and are out of the bore at door = 1. The leaves
// never reach past the cliff's dressed apron round the ring, where the rock stands in front of them.

function inside(poly: THREE.Vector2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Points on a grid over the bore's disc. */
function boreGrid(step = 0.25): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let x = -DOOR_BORE_RADIUS; x <= DOOR_BORE_RADIUS; x += step) {
    for (let y = -DOOR_BORE_RADIUS; y <= DOOR_BORE_RADIUS; y += step) if (x * x + y * y < DOOR_BORE_RADIUS ** 2) out.push(new THREE.Vector2(x, y));
  }
  return out;
}

const covered = (leaves: THREE.Vector2[][], p: THREE.Vector2) => leaves.some((leaf) => inside(leaf, p.x, p.y));

describe('the ocean door iris', () => {
  const grid = boreGrid();

  it('closes the whole bore when shut', () => {
    const leaves = irisLeafOutlines(0);
    expect(grid.filter((p) => !covered(leaves, p)).slice(0, 3)).toEqual([]);
  });

  it('keeps a leaf across the bore until the door is fully open, and opens wider as it travels', () => {
    let last = -1;
    for (const door of [0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.98]) {
      const leaves = irisLeafOutlines(door);
      const open = grid.filter((p) => !covered(leaves, p)).length / grid.length;
      expect(open, `door ${door}`).toBeLessThan(1);
      expect(open, `door ${door}`).toBeGreaterThan(last);
      last = open;
    }
  });

  it('clears the bore at door = 1', () => {
    const leaves = irisLeafOutlines(1);
    for (const leaf of leaves) for (const p of leaf) expect(p.length()).toBeGreaterThan(DOOR_BORE_RADIUS);
  });

  it('never swings a leaf out past the rock round the ring', () => {
    for (const door of [0, 0.25, 0.5, 0.75, 1]) {
      for (const leaf of irisLeafOutlines(door)) for (const p of leaf) expect(p.length()).toBeLessThanOrEqual(21.01);
    }
  });

  it('holds its beacons steady while still and flashes them while moving', () => {
    expect(beaconLevel(false, 0.1)).toBe(beaconLevel(false, 0.5));
    const levels = new Set(Array.from({ length: 20 }, (_, i) => beaconLevel(true, i * 0.1)));
    expect(levels.size).toBeGreaterThan(1);
  });
});
