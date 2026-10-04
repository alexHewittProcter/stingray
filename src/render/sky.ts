import * as THREE from 'three';
import { SEA_HORIZON, SKY_HORIZON, SKY_ZENITH, SUN_DIRECTION, WATER_GLSL, glslColour } from './water-look';

// The backdrop: above water, a painted-looking 1960s sky with a sun and drifting cumulus;
// below, the water's own gradient — bright toward the surface, near-black beneath.

const DOME_RADIUS = 4000; // inside the camera's far plane

/** Sky colour along a direction, without clouds (cheap enough for the sea's reflections). */
export const SKY_GLSL = /* glsl */ `
const vec3 SKY_ZENITH = ${glslColour(SKY_ZENITH)};
const vec3 SKY_HORIZON = ${glslColour(SKY_HORIZON)};
const vec3 SEA_HORIZON = ${glslColour(SEA_HORIZON)};
const vec3 SUN_COLOUR = vec3(1.0, 0.96, 0.86);

vec3 skyGradient(vec3 dir, vec3 sunDir) {
  float h = max(dir.y, 0.0);
  vec3 c = mix(SKY_HORIZON, SKY_ZENITH, pow(h, 0.5));
  float s = max(dot(dir, sunDir), 0.0);
  return c + SUN_COLOUR * (0.18 * pow(s, 6.0) + 0.45 * pow(s, 90.0));
}
`;

/** Value noise and fbm for the clouds and the sea's foam. */
export const NOISE_GLSL = /* glsl */ `
float swHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float swNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(swHash(i), swHash(i + vec2(1.0, 0.0)), u.x),
             mix(swHash(i + vec2(0.0, 1.0)), swHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float swFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * swNoise(p);
    p = turn * p;
    a *= 0.5;
  }
  return v;
}
`;

export interface Sky {
  readonly mesh: THREE.Mesh;
  /** horizon = the water colour at the camera (display space), used when the camera is under water. */
  update(camera: THREE.Camera, horizon: THREE.Vector3, timeSeconds: number): void;
}

export function createSky(): Sky {
  const uniforms = {
    uSunDir: { value: SUN_DIRECTION.clone() },
    uHorizon: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uHorizon;
      uniform float uTime;
      varying vec3 vDir;
      ${WATER_GLSL}
      ${SKY_GLSL}
      ${NOISE_GLSL}

      vec3 clouds(vec3 dir, vec3 sky) {
        // A curved cloud layer: flattening toward the horizon without blowing up to infinity there.
        vec2 p = dir.xz / (dir.y + 0.2) * 1.15 + vec2(uTime * 0.004, uTime * 0.0015);
        // Puffs: big soft lumps, a little fine detail at the edges only.
        float d = swFbm(p) + 0.12 * (swNoise(p * 0.5 + 9.0) - 0.5);
        float cover = smoothstep(0.55, 0.66, d) * smoothstep(-0.01, 0.05, dir.y);
        // Lit from the sun's side, grey underneath: compare density a step toward the sun.
        float toward = swFbm(p + normalize(uSunDir.xz) * 0.1);
        float lit = clamp(0.8 + (d - toward) * 4.0, 0.0, 1.0);
        vec3 cloud = mix(vec3(0.58, 0.62, 0.69), vec3(0.98, 0.98, 0.96), lit);
        return mix(sky, cloud, cover * 0.95);
      }

      void main() {
        vec3 dir = normalize(vDir);
        vec3 c;
        if (cameraPosition.y < 0.0) {
          c = swWaterScatter(dir, uHorizon, cameraPosition.y);
        } else if (dir.y < 0.0) {
          c = SEA_HORIZON;
        } else {
          c = clouds(dir, skyGradient(dir, uSunDir));
          float s = dot(dir, uSunDir);
          c = mix(c, vec3(1.0, 0.99, 0.94), smoothstep(0.9990, 0.9994, s));
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // drawn first; everything else covers it

  return {
    mesh,
    update(camera, horizon, time) {
      mesh.position.copy(camera.position);
      uniforms.uHorizon.value.copy(horizon);
      uniforms.uTime.value = time;
    },
  };
}
