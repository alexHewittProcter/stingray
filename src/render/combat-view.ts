import * as THREE from 'three';
import type { CombatState } from '../sim/combat';
import type { World } from '../sim/world';
import { createEffects } from './effects';
import type { Particles } from './particles';
import { createMine, createMissileModel, createTerrorFish, type MissileModel } from './targets';

// Draws the combat state: moored mines, Terror Fish, Sting missiles with their exhaust and
// bubble trails, the launch cloud at the nose and the detonations.

export interface CombatView {
  readonly group: THREE.Group;
  update(combat: CombatState, dtSeconds: number): void;
}

const MISSILE_POOL = 24;
const TRAIL_PER_FRAME = 3;

interface TargetView {
  readonly group: THREE.Group;
  animate(t: number): void;
  readonly kind: 'buoy' | 'drone';
  wasAlive: boolean;
  readonly last: THREE.Vector3;
}

export function createCombatView(world: World, initial: CombatState, particles: Particles): CombatView {
  const group = new THREE.Group();
  const effects = createEffects(particles);
  group.add(effects.group);

  const targets = new Map<string, TargetView>();
  initial.targets.forEach((t, i) => {
    const phase = i * 1.7;
    const view =
      t.kind === 'buoy'
        ? createMine(t.radius, t.pos.y - world.seabedHeight(t.pos.x, t.pos.z), phase)
        : createTerrorFish(t.radius, phase);
    view.group.position.set(t.pos.x, t.pos.y, t.pos.z);
    targets.set(t.id, { group: view.group, animate: view.animate, kind: t.kind, wasAlive: t.alive, last: view.group.position.clone() });
    group.add(view.group);
  });

  const missiles: MissileModel[] = Array.from({ length: MISSILE_POOL }, () => {
    const model = createMissileModel();
    model.group.visible = false;
    group.add(model.group);
    return model;
  });

  const ahead = new THREE.Vector3();
  let lastT = initial.t;

  function blast(x: number, y: number, z: number, big: boolean): void {
    effects.detonate(x, y, z, big, world.seabedHeight(x, z));
  }

  return {
    group,
    update(combat, dt) {
      const stepped = combat.t - lastT;
      lastT = combat.t;

      for (const t of combat.targets) {
        const view = targets.get(t.id);
        if (!view) continue;
        const mesh = view.group;
        if (view.wasAlive && !t.alive) blast(mesh.position.x, mesh.position.y, mesh.position.z, true);
        view.wasAlive = t.alive;
        mesh.visible = t.alive;
        if (!t.alive) continue;
        view.animate(combat.t);
        if (view.kind === 'drone') {
          // Face the way it swims.
          const last = view.last;
          if (last.x !== t.pos.x || last.z !== t.pos.z) {
            ahead.set(t.pos.x * 2 - last.x, t.pos.y, t.pos.z * 2 - last.z);
            mesh.position.set(t.pos.x, t.pos.y, t.pos.z);
            mesh.lookAt(ahead);
            mesh.rotateY(Math.PI); // lookAt points +Z at the target; the fish's nose is −Z
            last.set(t.pos.x, t.pos.y, t.pos.z);
          }
        }
      }

      for (let i = 0; i < missiles.length; i++) {
        const model = missiles[i]!;
        const m = combat.missiles[i];
        model.group.visible = Boolean(m);
        if (!m) continue;
        model.group.position.set(m.pos.x, m.pos.y, m.pos.z);
        ahead.set(m.pos.x + m.vel.x, m.pos.y + m.vel.y, m.pos.z + m.vel.z);
        model.group.lookAt(ahead);
        model.group.rotateY(Math.PI);
        model.animate(combat.t + i);
        if (m.pos.y < 0) {
          particles.emit({ x: m.pos.x, y: m.pos.y, z: m.pos.z, count: TRAIL_PER_FRAME, speed: [0.5, 3], life: [0.6, 1.6], size: 1.2, color: 0xe6f6ff, lift: 3, underwater: true });
        }
      }

      if (stepped > 0) {
        // A cloud at the nose for each missile launched since the last frame (the series fires in a cloud).
        for (const m of combat.missiles) {
          if (m.age > stepped + 1e-6) continue;
          const speed = Math.hypot(m.vel.x, m.vel.y, m.vel.z) || 1;
          const dx = m.vel.x / speed;
          const dy = m.vel.y / speed;
          const dz = m.vel.z / speed;
          const back = m.age * speed;
          effects.launch(m.pos.x - dx * back, m.pos.y - dy * back, m.pos.z - dz * back, dx, dy, dz);
        }
        for (const d of combat.detonations) blast(d.x, d.y, d.z, false);
      }

      effects.update(dt);
    },
  };
}
