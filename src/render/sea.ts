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

  const surfaceMaterial = new THREE.MeshPhongMaterial({
    color: 0x2f8fb5,
    specular: 0xffffff,
    shininess: 90,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), surfaceMaterial);
  surface.rotation.x = -Math.PI / 2;
  group.add(surface);

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
      // From above the sea hides what lies beneath; from below the surface is a bright ceiling.
      surfaceMaterial.opacity = camera.position.y >= 0 ? 0.94 : 0.6;
      surfaceMaterial.color.setHex(camera.position.y >= 0 ? 0x1f6f96 : 0x8fd6ee);
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
