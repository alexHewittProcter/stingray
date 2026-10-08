import * as THREE from 'three';
import type { TroyState } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';

// Troy, drawn (phase 3, T1 placeholder — T3 replaces this with M8's model and procedural animation): a grey capsule the
// size of the sim's (radius 0.4 m, 1.8 m tall, feet at the origin) with a small block on the front to show his facing.
// Shown at troy.pos while he is on foot, hidden otherwise.

export interface TroyView {
  readonly group: THREE.Group;
  /** Place him for a drawn frame: interpolated alpha of the way from the previous step's state to this one. */
  pose(t: TroyState, alpha: number, previous?: TroyState): void;
}

export function createTroy(): TroyView {
  const group = new THREE.Group();
  group.name = 'troy';
  const r = T.troyRadius;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r, T.troyHeight - 2 * r, 6, 16),
    new THREE.MeshLambertMaterial({ color: 0xa9adb2 }),
  );
  body.position.y = T.troyHeight / 2;
  group.add(body);
  // Facing: −Z is forward at yaw 0, as for the sub.
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0xb5301d }));
  visor.position.set(0, T.troyHeight - 0.25, -r);
  group.add(visor);
  group.visible = false;

  return {
    group,
    pose(t, alpha, previous) {
      group.visible = t.where === 'onFoot';
      if (!group.visible) return;
      const p = previous && previous.where === 'onFoot' ? previous : t;
      group.position.set(
        p.pos.x + (t.pos.x - p.pos.x) * alpha,
        p.pos.y + (t.pos.y - p.pos.y) * alpha,
        p.pos.z + (t.pos.z - p.pos.z) * alpha,
      );
      const turn = Math.atan2(Math.sin(t.yaw - p.yaw), Math.cos(t.yaw - p.yaw));
      group.rotation.y = p.yaw + turn * alpha;
    },
  };
}
