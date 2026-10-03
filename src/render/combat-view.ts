import * as THREE from 'three';
import type { CombatState, Target } from '../sim/combat';
import type { World } from '../sim/world';
import type { Particles } from './particles';

// Draws the combat state: mine buoys, Terror Fish, missiles with bubble trails, and detonations.

export interface CombatView {
  readonly group: THREE.Group;
  update(combat: CombatState, dtSeconds: number): void;
}

const MISSILE_POOL = 24;
const FLASH_POOL = 8;
const FLASH_LIFE = 0.4;

// ---- Targets ----

function glow(color: number, size: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

/** A moored mine: red and white, spiked, with a bright marker lamp that reads through the water. */
function createBuoy(target: Target, world: World): THREE.Group {
  const group = new THREE.Group();
  const r = target.radius;
  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), new THREE.MeshPhongMaterial({ color: 0xc8362e, shininess: 50 }));
  group.add(body);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, r * 0.16, 8, 24), new THREE.MeshPhongMaterial({ color: 0xf2f0e8 }));
  band.rotation.x = Math.PI / 2;
  group.add(band);
  const spike = new THREE.ConeGeometry(r * 0.14, r * 0.7, 6);
  const metal = new THREE.MeshPhongMaterial({ color: 0x3a3f46 });
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]] as const) {
    const s = new THREE.Mesh(spike, metal);
    const dir = new THREE.Vector3(x, y, z).normalize();
    s.position.copy(dir).multiplyScalar(r * 1.25);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(s);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2a8, fog: false }));
  lamp.position.y = r * 1.25;
  group.add(lamp);
  const halo = glow(0xffe27a, r * 7);
  halo.position.y = r * 1.25;
  group.add(halo);

  // Mooring chain down to the bed.
  const drop = target.pos.y - world.seabedHeight(target.pos.x, target.pos.z);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, drop, 5), metal);
  chain.position.y = -drop / 2;
  group.add(chain);
  return group;
}

/** A Terror Fish: armoured mechanical fish with one glaring lamp eye and a red maw. Nose along local -Z. */
function createTerrorFish(target: Target): THREE.Group {
  const group = new THREE.Group();
  const r = target.radius;
  const scales = new THREE.MeshPhongMaterial({ color: 0x4f6f8a, specular: 0xbfd8ee, shininess: 70, flatShading: true });
  const dark = new THREE.MeshPhongMaterial({ color: 0x2c3a4a, flatShading: true });

  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), scales);
  body.scale.set(0.62, 0.95, 1.9);
  group.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * 1.5, 4), dark);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.set(0.16, 1, 1);
  tail.position.z = r * 2.35;
  group.add(tail);
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.75, 4), dark);
    fin.position.set(0, r * 0.95, -r * 0.7 + i * r * 0.45);
    fin.rotation.x = 0.5;
    group.add(fin);
  }
  for (const side of [-1, 1]) {
    const pectoral = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, r * 0.9, 4), dark);
    pectoral.position.set(side * r * 0.6, -r * 0.35, -r * 0.2);
    pectoral.rotation.z = side * 1.9;
    pectoral.scale.set(1, 1, 0.25);
    group.add(pectoral);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    eye.position.set(side * r * 0.5, r * 0.3, -r * 1.15);
    group.add(eye);
    const halo = glow(0xdff4ff, r * 4.5);
    halo.position.copy(eye.position);
    group.add(halo);
  }
  const maw = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 10, 8), new THREE.MeshBasicMaterial({ color: 0xb3261e }));
  maw.scale.set(1, 0.55, 0.8);
  maw.position.set(0, -r * 0.3, -r * 1.65);
  group.add(maw);
  return group;
}

// ---- Missiles ----

function createMissile(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.6, 8), new THREE.MeshPhongMaterial({ color: 0xd9dde2, shininess: 80 }));
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffd23c }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -1.75;
  group.add(tip);
  const flare = glow(0xfff0b0, 5);
  flare.position.z = 1.6;
  group.add(flare);
  group.visible = false;
  return group;
}

export function createCombatView(world: World, initial: CombatState, particles: Particles): CombatView {
  const group = new THREE.Group();

  const targets = new Map<string, THREE.Group>();
  const wasAlive = new Map<string, boolean>();
  const lastPos = new Map<string, THREE.Vector3>();
  for (const t of initial.targets) {
    const mesh = t.kind === 'buoy' ? createBuoy(t, world) : createTerrorFish(t);
    mesh.position.set(t.pos.x, t.pos.y, t.pos.z);
    targets.set(t.id, mesh);
    wasAlive.set(t.id, t.alive);
    lastPos.set(t.id, mesh.position.clone());
    group.add(mesh);
  }

  const missiles = Array.from({ length: MISSILE_POOL }, createMissile);
  group.add(...missiles);

  const flashes = Array.from({ length: FLASH_POOL }, () => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    mesh.visible = false;
    group.add(mesh);
    return { mesh, life: 0 };
  });
  let nextFlash = 0;

  const ahead = new THREE.Vector3();
  let seenMissiles = 0;
  let lastT = initial.t;

  function explode(x: number, y: number, z: number, big: boolean): void {
    const flash = flashes[nextFlash];
    nextFlash = (nextFlash + 1) % FLASH_POOL;
    if (flash) {
      flash.mesh.position.set(x, y, z);
      flash.mesh.visible = true;
      flash.life = FLASH_LIFE;
    }
    const wet = y < 0;
    particles.emit({ x, y, z, count: big ? 90 : 45, speed: [8, big ? 34 : 22], life: [0.25, 0.7], size: 3.4, color: 0xffb347, lift: 0 });
    particles.emit({ x, y, z, count: big ? 140 : 70, speed: [2, 14], life: [0.9, 2.4], size: 2.4, color: wet ? 0xd6f1ff : 0xe8e8e8, lift: wet ? 6 : -9, underwater: wet });
    if (big) particles.emit({ x, y, z, count: 40, speed: [6, 20], life: [0.8, 1.8], size: 1.6, color: 0x8a8f96, lift: -6 });
  }

  return {
    group,
    update(combat, dt) {
      const stepped = combat.t !== lastT;
      lastT = combat.t;

      for (const t of combat.targets) {
        const mesh = targets.get(t.id);
        if (!mesh) continue;
        const alive = wasAlive.get(t.id);
        if (alive && !t.alive) explode(mesh.position.x, mesh.position.y, mesh.position.z, true);
        wasAlive.set(t.id, t.alive);
        mesh.visible = t.alive;
        if (!t.alive) continue;
        if (t.kind === 'drone') {
          // Face the way it swims.
          const last = lastPos.get(t.id);
          if (last && (last.x !== t.pos.x || last.z !== t.pos.z)) {
            ahead.set(t.pos.x * 2 - last.x, t.pos.y, t.pos.z * 2 - last.z);
            mesh.position.set(t.pos.x, t.pos.y, t.pos.z);
            mesh.lookAt(ahead);
            mesh.rotateY(Math.PI); // lookAt points +Z at the target; the fish's nose is -Z
            last.set(t.pos.x, t.pos.y, t.pos.z);
          }
          mesh.rotation.z = Math.sin(combat.t * 5 + t.pos.x) * 0.08;
        } else {
          mesh.position.y = t.pos.y + Math.sin(combat.t * 0.9 + t.pos.x) * 0.25;
        }
      }

      for (let i = 0; i < missiles.length; i++) {
        const mesh = missiles[i]!;
        const m = combat.missiles[i];
        mesh.visible = Boolean(m);
        if (!m) continue;
        mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
        ahead.set(m.pos.x + m.vel.x, m.pos.y + m.vel.y, m.pos.z + m.vel.z);
        mesh.lookAt(ahead);
        mesh.rotateY(Math.PI);
        if (m.pos.y < 0) {
          particles.emit({ x: m.pos.x, y: m.pos.y, z: m.pos.z, count: 3, speed: [0.5, 3], life: [0.5, 1.3], size: 1.1, color: 0xe6f6ff, lift: 3, underwater: true });
        }
      }

      // A burst of bubbles at the nose for each new launch (the series fires in a cloud).
      if (stepped) {
        const fresh = combat.missiles.filter((m) => m.age < 0.05);
        if (fresh.length > 0 && combat.missiles.length >= seenMissiles) {
          for (const m of fresh) {
            particles.emit({ x: m.pos.x, y: m.pos.y, z: m.pos.z, count: 60, speed: [2, 12], life: [0.6, 1.6], size: 2.6, color: 0xcfeaff, lift: 4, underwater: m.pos.y < 0 });
          }
        }
        seenMissiles = combat.missiles.length;
        for (const d of combat.detonations) explode(d.x, d.y, d.z, false);
      }

      for (const f of flashes) {
        if (f.life <= 0) continue;
        f.life -= dt;
        const k = 1 - Math.max(f.life, 0) / FLASH_LIFE;
        f.mesh.scale.setScalar(3 + 16 * k);
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        if (f.life <= 0) f.mesh.visible = false;
      }
    },
  };
}
