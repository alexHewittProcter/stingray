import * as THREE from 'three';
import { mulberry32 } from './random';
import { SUN_DIRECTION } from './water-look';

// God rays: soft additive ribbons slanting down from the surface along the refracted sunlight,
// scattered in a tile that wraps around the camera. They fade out with the camera's depth.

const COUNT = 46;
const TILE = 380; // m: side of the square of shafts that wraps around the camera
const SHAFT_COLOUR = new THREE.Vector3(0.55, 0.85, 0.9);
const FULL_STRENGTH_DEPTH = 15; // m
const GONE_DEPTH = 190; // m
const WATER_IOR = 1.333;

/** Direction sunlight travels once it has refracted into the water (downward). */
function refractedSunlight(): THREE.Vector3 {
  const horizontal = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z);
  const sinWater = horizontal / WATER_IOR;
  const cosWater = Math.sqrt(1 - sinWater * sinWater);
  // A little extra slant reads better on screen than the true refracted angle.
  const lean = (sinWater / cosWater) * 1.35;
  return new THREE.Vector3(-SUN_DIRECTION.x / horizontal * lean, -1, -SUN_DIRECTION.z / horizontal * lean).normalize();
}

export interface LightShafts {
  readonly mesh: THREE.Mesh;
  update(camera: THREE.Camera, timeSeconds: number): void;
}

export function createLightShafts(): LightShafts {
  const rand = mulberry32(0x5a7f);
  const corners = new Float32Array(COUNT * 4 * 2);
  const shafts = new Float32Array(COUNT * 4 * 4);
  const index: number[] = [];
  const quad = [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const;
  for (let i = 0; i < COUNT; i++) {
    const x = rand() * TILE;
    const z = rand() * TILE;
    const length = 70 + rand() * 110;
    const width = 3 + rand() * 13;
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      corners.set(quad[c]!, v * 2);
      shafts.set([x, z, length, width], v * 4);
    }
    const v = i * 4;
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 4 * 3), 3));
  geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('shaft', new THREE.BufferAttribute(shafts, 4));
  geometry.setIndex(index);

  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
    uAxis: { value: refractedSunlight() },
    uColour: { value: SHAFT_COLOUR },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 corner;
      attribute vec4 shaft;
      uniform float uTime;
      uniform vec3 uAxis;
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      const float TILE = ${TILE.toFixed(1)};
      void main() {
        vec2 base = cameraPosition.xz + mod(shaft.xy - cameraPosition.xz, TILE) - TILE * 0.5;
        vSeed = fract(shaft.x * 0.137 + shaft.y * 0.071);
        vec3 axis = normalize(uAxis + 0.05 * vec3(sin(uTime * 0.11 + vSeed * 20.0), 0.0, cos(uTime * 0.09 + vSeed * 13.0)));
        vec3 p = vec3(base.x, 0.0, base.y) + axis * (corner.y * shaft.z);
        vec3 toCamera = cameraPosition - p;
        vec3 side = cross(axis, normalize(toCamera));
        float edgeOn = length(side); // a shaft seen end-on has no width to show
        side = edgeOn > 1e-3 ? side / edgeOn : vec3(1.0, 0.0, 0.0);
        p += side * corner.x * shaft.w * (0.5 + 0.4 * corner.y);
        float dist = length(cameraPosition - p);
        vFade = smoothstep(4.0, 30.0, dist) * (1.0 - smoothstep(110.0, TILE * 0.5, length(base - cameraPosition.xz))) * edgeOn;
        vUv = corner;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      uniform vec3 uColour;
      varying vec2 vUv;
      varying float vFade;
      varying float vSeed;
      void main() {
        float across = 1.0 - abs(vUv.x);
        across = across * across * (3.0 - 2.0 * across);
        float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.8);
        float flicker = 0.5 + 0.5 * sin(uTime * (0.35 + vSeed * 0.5) + vSeed * 40.0);
        float streaks = 0.65 + 0.35 * sin(vUv.x * 7.0 + vSeed * 30.0 + uTime * 0.2);
        float a = across * along * flicker * streaks * vFade * uStrength * 0.16;
        gl_FragColor = vec4(uColour * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(camera, time) {
      const depth = -camera.position.y;
      const strength = 1 - THREE.MathUtils.smoothstep(depth, FULL_STRENGTH_DEPTH, GONE_DEPTH);
      mesh.visible = depth > 0 && strength > 0;
      uniforms.uStrength.value = strength;
      uniforms.uTime.value = time;
    },
  };
}
