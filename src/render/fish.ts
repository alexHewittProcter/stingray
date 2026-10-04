import * as THREE from 'three';
import type { World } from '../sim/world';
import { mulberry32 } from './random';
import { chainPatch, sceneryTime } from './sway';

// Background life: small schools circling the landmarks. Purely cosmetic and swum entirely in the vertex shader —
// each fish carries its school's loop and its own place in it, so the CPU never touches them after creation.

interface School {
  /** Centre of the loop: x, z, and height above the bed. */
  x: number;
  z: number;
  above: number;
  /** Loop radii (east-west, north-south), metres. */
  rx: number;
  rz: number;
  count: number;
  /** Fish length, metres. */
  size: number;
  color: number;
}

// Loops are placed clear of the solid landmarks: beside the arch's opening, east of the stacks, over the wreck.
const SCHOOLS: School[] = [
  { x: -150, z: -790, above: 22, rx: 28, rz: 16, count: 40, size: 0.8, color: 0xb8c8d4 },
  { x: 235, z: -760, above: 30, rx: 26, rz: 70, count: 45, size: 0.7, color: 0xe2c24a },
  { x: 100, z: -500, above: 26, rx: 40, rz: 22, count: 36, size: 0.9, color: 0xd8873a },
  { x: -250, z: -600, above: 14, rx: 50, rz: 40, count: 40, size: 0.7, color: 0xa8d0c8 },
  { x: 10, z: -960, above: 20, rx: 30, rz: 22, count: 30, size: 0.8, color: 0xe2c24a },
  { x: 0, z: -250, above: 60, rx: 70, rz: 30, count: 45, size: 0.9, color: 0x9fb8c8 },
  { x: 420, z: -320, above: 25, rx: 40, rz: 30, count: 30, size: 0.8, color: 0xd8873a },
  { x: -520, z: -900, above: 22, rx: 35, rz: 30, count: 30, size: 0.7, color: 0xb8c8d4 },
  { x: -60, z: -680, above: 35, rx: 22, rz: 18, count: 8, size: 2.2, color: 0x7f97a8 },
];

/** A small fish along +x: a diamond-section body and a forked tail, about 1 m long. */
function fishGeometry(): THREE.BufferGeometry {
  const nose = [0.5, 0, 0];
  const top = [0.02, 0.17, 0];
  const belly = [0.02, -0.14, 0];
  const left = [0.05, 0, 0.08];
  const right = [0.05, 0, -0.08];
  const tail = [-0.32, 0, 0];
  const finTop = [-0.55, 0.16, 0];
  const finBottom = [-0.55, -0.14, 0];
  const tris = [
    [nose, top, left], [nose, left, belly], [nose, belly, right], [nose, right, top],
    [tail, left, top], [tail, belly, left], [tail, right, belly], [tail, top, right],
    [tail, finTop, finBottom], [tail, finBottom, finTop],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

export function createFish(world: World): THREE.InstancedMesh {
  const total = SCHOOLS.reduce((n, s) => n + s.count, 0);
  const geometry = fishGeometry();
  const loop = new Float32Array(total * 4); // centre x, y, z; fish length
  const path = new Float32Array(total * 4); // radius x, radius z, angular speed (signed), phase
  const offset = new Float32Array(total * 2); // across the loop, and up
  const rand = mulberry32(world.seed ^ 0xf15e);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geometry, material, total);
  const tint = new THREE.Color();
  let i = 0;
  for (const s of SCHOOLS) {
    const y = world.seabedHeight(s.x, s.z) + s.above;
    const direction = rand() < 0.5 ? -1 : 1;
    const speed = (3 + rand() * 2) / ((s.rx + s.rz) / 2); // rad/s: a few m/s along the loop
    const lead = rand() * Math.PI * 2;
    for (let k = 0; k < s.count; k++, i++) {
      loop.set([s.x, y, s.z, s.size * (0.8 + rand() * 0.4)], i * 4);
      // Schoolmates keep close: a small lead or lag on the loop, and a little offset across and up.
      path.set([s.rx, s.rz, direction * speed, lead + rand() * 0.45], i * 4);
      offset.set([(rand() - 0.5) * 7, (rand() - 0.5) * 5], i * 2);
      mesh.setColorAt(i, tint.setHex(s.color).multiplyScalar(0.85 + rand() * 0.3));
    }
  }
  geometry.setAttribute('aLoop', new THREE.InstancedBufferAttribute(loop, 4));
  geometry.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 2));
  mesh.frustumCulled = false; // the instance matrices stay identity: the shader places every fish
  swimShader(material);
  return mesh;
}

/** Places each fish on its school's loop, faces it along the loop and wags its tail. */
function swimShader(material: THREE.Material): void {
  chainPatch(material, 'fish-swim', (shader) => {
    shader.uniforms.uSceneryTime = sceneryTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSceneryTime;
        attribute vec4 aLoop;
        attribute vec4 aPath;
        attribute vec2 aOffset;
        vec3 fishFwd;
        vec3 fishSide;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float fishA = aPath.w + uSceneryTime * aPath.z;
        float fishWave = sin(uSceneryTime * 0.4 + aPath.w * 5.0);
        // The loop's tangent, in the direction of travel.
        fishFwd = normalize(vec3(-sin(fishA) * aPath.x, 0.08 * fishWave, cos(fishA) * aPath.y) * sign(aPath.z));
        fishSide = normalize(cross(fishFwd, vec3(0.0, 1.0, 0.0)));
        vec3 fishUp = cross(fishSide, fishFwd);
        vec3 objectNormal = normal.x * fishFwd + normal.y * fishUp + normal.z * fishSide;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 fishP = position * aLoop.w;
        fishP.z += sin(uSceneryTime * 9.0 + aPath.w * 40.0) * 0.14 * aLoop.w * smoothstep(0.1, -0.6, position.x);
        float fishR = 1.0 + aOffset.x / max(aPath.x, aPath.y);
        vec3 transformed = aLoop.xyz
          + vec3(cos(fishA) * aPath.x * fishR, aOffset.y + 2.0 * fishWave, sin(fishA) * aPath.y * fishR)
          + fishP.x * fishFwd + fishP.y * fishUp + fishP.z * fishSide;`,
      );
  });
}
