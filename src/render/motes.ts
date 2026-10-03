import * as THREE from 'three';

// Drifting particles in the water around the camera: they give speed and depth something to read against.

const COUNT = 700;
const BOX = 160; // side of the cube of motes that follows the camera

export interface Motes {
  readonly points: THREE.Points;
  update(camera: THREE.Camera, timeSeconds: number): void;
}

export function createMotes(): Motes {
  const home = new Float32Array(COUNT * 3);
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT * 3; i++) home[i] = Math.random() * BOX;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xd8f0ff, size: 0.28, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  points.frustumCulled = false;

  const wrap = (v: number) => ((v % BOX) + BOX) % BOX;

  return {
    points,
    update(camera, time) {
      const c = camera.position;
      points.visible = c.y < 0;
      if (!points.visible) return;
      for (let i = 0; i < COUNT; i++) {
        // Each mote keeps its place in the world; the cube of visible ones wraps around the camera.
        const x = c.x + wrap((home[i * 3] ?? 0) - c.x) - BOX / 2;
        const y = c.y + wrap((home[i * 3 + 1] ?? 0) + time * 0.4 - c.y) - BOX / 2;
        const z = c.z + wrap((home[i * 3 + 2] ?? 0) - c.z) - BOX / 2;
        positions[i * 3] = x;
        positions[i * 3 + 1] = Math.min(y, -0.5);
        positions[i * 3 + 2] = z;
      }
      geometry.attributes.position!.needsUpdate = true;
    },
  };
}
