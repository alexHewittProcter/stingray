import * as THREE from 'three';
import { mulberry32 } from './random';

// Marine snow: soft specks drifting in the water around the camera — they give speed and depth something
// to read against. Each keeps its own place in the world; the box of them wraps around the camera on the GPU.

const COUNT = 1800;
const BOX = 150; // m: side of the cube of motes that follows the camera
const SINK = 0.25; // m/s: snow drifts slowly down
const POINT_SCALE = 900; // CSS pixels across for a 1 m mote 1 m away

export interface Motes {
  readonly points: THREE.Points;
  update(camera: THREE.Camera, timeSeconds: number): void;
}

export function createMotes(): Motes {
  const rand = mulberry32(0x0b5e);
  const home = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT * 2); // size (m), wobble phase
  for (let i = 0; i < COUNT; i++) {
    home.set([rand() * BOX, rand() * BOX, rand() * BOX], i * 3);
    // Mostly fine specks, a few larger flecks.
    seed.set([0.05 + Math.pow(rand(), 3) * 0.28, rand() * 100], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(home, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 2));

  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: POINT_SCALE * Math.min(window.devicePixelRatio, 2) },
    uBrightness: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 seed;
      uniform float uTime;
      uniform float uScale;
      varying float vAlpha;
      const float BOX = ${BOX.toFixed(1)};
      void main() {
        vec3 drift = vec3(
          sin(uTime * 0.21 + seed.y) * 0.8,
          -uTime * ${SINK.toFixed(2)} + sin(uTime * 0.17 + seed.y * 1.7) * 0.5,
          cos(uTime * 0.19 + seed.y * 0.6) * 0.8);
        vec3 p = cameraPosition + mod(position + drift - cameraPosition, BOX) - BOX * 0.5;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        // Fade out toward the box's edge so wrapping never pops; nothing above the surface.
        float edge = 1.0 - smoothstep(BOX * 0.32, BOX * 0.5, length(p - cameraPosition));
        vAlpha = edge * smoothstep(0.6, 3.0, dist) * step(p.y, -0.4);
        gl_PointSize = max(seed.x * uScale / max(dist, 0.5), 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBrightness;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float soft = 1.0 - smoothstep(0.1, 0.5, d);
        if (soft * vAlpha < 0.01) discard;
        gl_FragColor = vec4(vec3(0.78, 0.9, 0.92) * uBrightness, soft * vAlpha * 0.6);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    update(camera, time) {
      points.visible = camera.position.y < 0;
      uniforms.uTime.value = time;
      // Snow catches less light the deeper it is.
      uniforms.uBrightness.value = 0.45 + 0.55 * Math.exp(camera.position.y / 120);
    },
  };
}
