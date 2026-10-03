import * as THREE from 'three';
import type { World } from '../sim/world';

const WATER_NEAR = new THREE.Color(0x1d6f8f);
const WATER_DEEP = new THREE.Color(0x041c2e);
const SKY = new THREE.Color(0x9fd0ee);
const TRENCH_DEPTH = 320;

export interface Sea {
  readonly group: THREE.Group;
  /** Match fog and background to where the camera is: under the surface or above it. */
  update(camera: THREE.Camera, scene: THREE.Scene, timeSeconds: number): void;
}

export function createSea(world: World): Sea {
  const group = new THREE.Group();
  const size = world.bounds.halfSize * 2 * 3;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1),
    new THREE.MeshPhongMaterial({
      color: 0x2f8fb5,
      specular: 0xffffff,
      shininess: 90,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    }),
  );
  surface.rotation.x = -Math.PI / 2;
  group.add(surface);

  // Placeholder bed until the heightfield lands with the ocean.
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x8a7f5a }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -70;
  group.add(bed);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(300, 800, 200);
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xbfe6ff, 0x12303f, 1.1));

  const fog = new THREE.Fog(WATER_NEAR.getHex(), 10, 400);
  const tint = new THREE.Color();

  return {
    group,
    update(camera, scene, timeSeconds) {
      scene.fog = fog;
      surface.position.y = Math.sin(timeSeconds * 0.6) * 0.15;
      const y = camera.position.y;
      if (y < 0) {
        const depth = Math.min(-y / TRENCH_DEPTH, 1);
        tint.copy(WATER_NEAR).lerp(WATER_DEEP, depth);
        fog.near = 10;
        fog.far = 400 - 150 * depth;
      } else {
        tint.copy(SKY);
        fog.near = 600;
        fog.far = 6000;
      }
      fog.color.copy(tint);
      scene.background = tint;
    },
  };
}
