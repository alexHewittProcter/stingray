import * as THREE from 'three';
import { glowMaterial, halo } from './glow';
import type { Particles } from './particles';

// Combat spectacle, Anderson-style: the white cloud a Sting missile leaves at the nose, and
// detonations with a flash, a light, an expanding shock bubble, flung debris, a sediment
// cloud when near the bed and bubbles that linger. Every effect is pooled; nothing allocates
// per frame. Cosmetic only: Math.random is fine here.

const PUFFS = 96;
const LAUNCH_PUFFS = 14;
const BLASTS = 8;
const DEBRIS = 120;

const FLASH_LIFE = 0.45;
const RING_LIFE = 0.7;
const LIGHT_LIFE = 0.7;
const LIGHT_PEAK = 60_000; // candela: a brief, strong wash over everything near
const DEBRIS_SINK = 7; // m/s² — chunks fall through the water
const SEDIMENT_REACH = 14; // m above the bed within which a blast stirs it up

const rand = (a: number, b: number) => a + Math.random() * (b - a);

let ringTexture: THREE.Texture | null = null;

/** A bright thin rim fading inward: the shock bubble seen edge-on from any side. */
function ring(): THREE.Texture {
  if (ringTexture) return ringTexture;
  if (typeof document === 'undefined') return (ringTexture = halo());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ringTexture = new THREE.CanvasTexture(canvas);
  return ringTexture;
}

interface Puff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  opacity: number;
}

interface Blast {
  flash: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  ring: THREE.Sprite;
  /** Seconds since the blast; it is spent once past both lives. */
  age: number;
  scale: number;
}

interface Chunk {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  size: number;
  life: number;
}

export interface Effects {
  readonly group: THREE.Group;
  /** The cloud at the nose as a missile leaves: `at` the launch point, `dir` the missile's unit heading. */
  launch(x: number, y: number, z: number, dx: number, dy: number, dz: number): void;
  /** A detonation; `big` for a target destroyed, `bedBelow` the seabed height under it. */
  detonate(x: number, y: number, z: number, big: boolean, bedBelow: number): void;
  update(dtSeconds: number): void;
}

export function createEffects(particles: Particles): Effects {
  const group = new THREE.Group();
  group.name = 'effects';

  const puffs: Puff[] = Array.from({ length: PUFFS }, () => {
    const material = new THREE.SpriteMaterial({ map: halo(), transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    group.add(sprite);
    return { sprite, material, vel: new THREE.Vector3(), life: 0, maxLife: 1, size0: 1, size1: 1, opacity: 0 };
  });
  let nextPuff = 0;

  const flashGeometry = new THREE.SphereGeometry(1, 16, 12);
  const blasts: Blast[] = Array.from({ length: BLASTS }, () => {
    const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    const glow = new THREE.Sprite(glowMaterial(0xffd890, 0));
    const shock = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ring(), color: 0xd8f2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    for (const o of [flash, glow, shock]) {
      o.visible = false;
      group.add(o);
    }
    return { flash, flashMaterial, glow, ring: shock, age: Infinity, scale: 1 };
  });
  let nextBlast = 0;

  const light = new THREE.PointLight(0xffd0a0, 0, 180, 2);
  group.add(light);
  let lightLife = 0;

  const chunkGeometry = new THREE.DodecahedronGeometry(1, 0);
  const debris = new THREE.InstancedMesh(chunkGeometry, new THREE.MeshStandardMaterial({ color: 0x3e4048, roughness: 0.6, metalness: 0.5, flatShading: true }), DEBRIS);
  debris.frustumCulled = false;
  const chunks: Chunk[] = Array.from({ length: DEBRIS }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    axis: new THREE.Vector3(0, 1, 0),
    spin: 0,
    size: 0,
    life: 0,
  }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < DEBRIS; i++) debris.setMatrixAt(i, hidden);
  group.add(debris);
  let nextChunk = 0;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  function puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, size0: number, size1: number, life: number, colour: number, opacity: number): void {
    const p = puffs[nextPuff]!;
    nextPuff = (nextPuff + 1) % PUFFS;
    p.sprite.position.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.life = p.maxLife = life;
    p.size0 = size0;
    p.size1 = size1;
    p.opacity = opacity;
    p.material.color.setHex(colour);
    p.sprite.visible = true;
  }

  function fling(x: number, y: number, z: number, speed: number, size: number): void {
    const c = chunks[nextChunk]!;
    nextChunk = (nextChunk + 1) % DEBRIS;
    c.pos.set(x, y, z);
    c.vel.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
    c.axis.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    c.spin = rand(-8, 8);
    c.size = size * rand(0.4, 1.2);
    c.life = rand(1.6, 3);
  }

  return {
    group,
    launch(x, y, z, dx, dy, dz) {
      const wet = y < 0;
      // The cloud billows out round the nose and hangs there as the missile streaks away.
      for (let i = 0; i < LAUNCH_PUFFS; i++) {
        const back = rand(-1, 4);
        const spread = 5;
        puff(
          x - dx * back + rand(-1.5, 1.5),
          y - dy * back + rand(-1.5, 1.5),
          z - dz * back + rand(-1.5, 1.5),
          dx * rand(1, 7) + rand(-spread, spread),
          dy * rand(1, 7) + rand(-spread, spread) + (wet ? 1.5 : 0),
          dz * rand(1, 7) + rand(-spread, spread),
          rand(3, 5),
          rand(14, 22),
          rand(2, 3.4),
          wet ? 0xd6e6ef : 0xf2f2f0,
          rand(0.45, 0.6),
        );
      }
      particles.emit({ x, y, z, count: 50, speed: [2, 12], life: [0.6, 1.6], size: 2.2, color: 0xcfeaff, lift: 4, underwater: wet });
    },
    detonate(x, y, z, big, bedBelow) {
      const b = blasts[nextBlast]!;
      nextBlast = (nextBlast + 1) % BLASTS;
      b.age = 0;
      b.scale = big ? 1 : 0.6;
      for (const o of [b.flash, b.glow, b.ring]) {
        o.position.set(x, y, z);
        o.visible = true;
      }
      light.position.set(x, y, z);
      lightLife = LIGHT_LIFE;

      const wet = y < 0;
      particles.emit({ x, y, z, count: big ? 110 : 50, speed: [10, big ? 40 : 24], life: [0.25, 0.8], size: 3.6, color: 0xffb347, lift: 0 });
      particles.emit({ x, y, z, count: big ? 40 : 15, speed: [14, big ? 45 : 28], life: [0.15, 0.4], size: 5, color: 0xfff4d0, lift: 0 });
      // Bubbles that linger and rise long after the flash.
      particles.emit({ x, y, z, count: big ? 170 : 70, speed: [2, 14], life: [1.2, 4], size: 2.4, color: wet ? 0xd6f1ff : 0xe8e8e8, lift: wet ? 5 : -9, underwater: wet });

      for (let i = 0; i < (big ? 14 : 5); i++) fling(x, y, z, big ? 26 : 16, big ? 0.55 : 0.3);
      // Smoke-white water churned up, and sediment if the bed is close.
      for (let i = 0; i < (big ? 10 : 4); i++) {
        puff(x + rand(-2, 2), y + rand(-2, 2), z + rand(-2, 2), rand(-6, 6), rand(-2, 6), rand(-6, 6), 5, big ? rand(20, 30) : rand(10, 16), rand(2, 3.5), wet ? 0xc9dde6 : 0xd8d8d8, 0.45);
      }
      if (wet && y - bedBelow < SEDIMENT_REACH) {
        for (let i = 0; i < (big ? 10 : 6); i++) {
          const a = rand(0, Math.PI * 2);
          const v = rand(3, 9);
          puff(x + rand(-3, 3), bedBelow + rand(0.5, 3), z + rand(-3, 3), Math.cos(a) * v, rand(0.5, 2.5), Math.sin(a) * v, 5, rand(16, 26), rand(3, 4.5), 0x8e7d5e, 0.55);
        }
      }
    },
    update(dt) {
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.sprite.visible = false;
          continue;
        }
        const k = 1 - p.life / p.maxLife;
        p.sprite.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-1.8 * dt));
        p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * (1 - (1 - k) ** 2));
        p.material.opacity = p.opacity * Math.min(k / 0.08, 1) * (1 - k) ** 1.3;
      }

      for (const b of blasts) {
        if (b.age > RING_LIFE) continue;
        b.age += dt;
        const k = Math.min(b.age / FLASH_LIFE, 1);
        b.flash.scale.setScalar((4 + 18 * Math.sqrt(k)) * b.scale);
        b.flashMaterial.opacity = 0.95 * (1 - k) ** 2;
        b.glow.scale.setScalar(90 * b.scale * (0.6 + 0.4 * k));
        b.glow.material.opacity = 0.9 * (1 - k);
        // The shock bubble outruns the flash and lasts a little longer.
        const kr = Math.min(b.age / RING_LIFE, 1);
        b.ring.scale.setScalar(4 + 44 * b.scale * Math.sqrt(kr));
        b.ring.material.opacity = 0.9 * (1 - kr);
        if (b.age > RING_LIFE) b.flash.visible = b.glow.visible = b.ring.visible = false;
      }

      if (lightLife > 0) {
        lightLife = Math.max(lightLife - dt, 0);
        light.intensity = LIGHT_PEAK * (lightLife / LIGHT_LIFE) ** 2;
      }

      let moved = false;
      for (let i = 0; i < DEBRIS; i++) {
        const c = chunks[i]!;
        if (c.life <= 0) continue;
        c.life -= dt;
        moved = true;
        if (c.life <= 0) {
          debris.setMatrixAt(i, hidden);
          continue;
        }
        c.vel.multiplyScalar(Math.exp(-1.5 * dt));
        c.vel.y -= DEBRIS_SINK * dt;
        c.pos.addScaledVector(c.vel, dt);
        q.setFromAxisAngle(c.axis, c.spin * c.life);
        debris.setMatrixAt(i, m.compose(c.pos, q, s.setScalar(c.size * Math.min(c.life * 2, 1))));
      }
      if (moved) debris.instanceMatrix.needsUpdate = true;
    },
  };
}
