import * as THREE from 'three';
import type { World } from '../sim/world';
import { causticUniforms } from './caustics';
import { createLightShafts } from './light-shafts';
import { NOISE_GLSL, SKY_GLSL, createSky } from './sky';
import {
  AIR_VISIBILITY, SKY_HORIZON, SUN_DIRECTION, WATER_GLSL, displayVector, installWaterFog, waterAt, type WaterState,
} from './water-look';

// The sea: the moving surface, the sky above it, the light and the water's colour around the camera.

// The surface mesh is a polar grid centred under the camera: fine close in, coarse toward the horizon.
const GRID_SEGMENTS = 160;
const GRID_INNER = 0.8; // m, radius of the first ring
const GRID_GROWTH = 1.035; // each ring this much wider than the last
const GRID_OUTER = 6000; // m

const SUN_INTENSITY = 2.4;
const HEMI_INTENSITY = 1.15;

export interface Sea {
  readonly group: THREE.Group;
  /** Match fog, sky and light to where the camera is: under the surface or above it. */
  update(camera: THREE.Camera, scene: THREE.Scene, timeSeconds: number): void;
}

function polarGrid(): THREE.BufferGeometry {
  const radii = [0];
  for (let r = GRID_INNER; r < GRID_OUTER; r *= GRID_GROWTH) radii.push(r);
  radii.push(GRID_OUTER);
  const positions: number[] = [];
  for (const r of radii) {
    for (let s = 0; s < GRID_SEGMENTS; s++) {
      const a = (s / GRID_SEGMENTS) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const index: number[] = [];
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let s = 0; s < GRID_SEGMENTS; s++) {
      const a = ring * GRID_SEGMENTS + s;
      const b = ring * GRID_SEGMENTS + ((s + 1) % GRID_SEGMENTS);
      index.push(a, a + GRID_SEGMENTS, b, b, a + GRID_SEGMENTS, b + GRID_SEGMENTS);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

// Swell: a few long sine waves summed, ≈ 0.45 m at most, each faded out where the grid is too coarse for it.
const WAVES_GLSL = /* glsl */ `
const vec4 WAVES[4] = vec4[4](
  // direction x, direction z, wavelength (m), amplitude (m)
  vec4(0.80, 0.60, 47.0, 0.2),
  vec4(0.17, 0.99, 26.0, 0.12),
  vec4(0.96, -0.28, 15.0, 0.07),
  vec4(-0.45, 0.89, 9.5, 0.05)
);

// Height in x, slope (dh/dx, dh/dz) in yz.
vec3 swell(vec2 p, float t, float dist) {
  vec3 h = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 w = WAVES[i];
    float k = 6.2831853 / w.z;
    float omega = sqrt(9.81 * k);
    float a = w.w * (1.0 - smoothstep(w.z * 5.0, w.z * 9.0, dist));
    float phase = k * dot(w.xy, p) - omega * t + float(i) * 1.7;
    h.x += a * sin(phase);
    h.yz += a * k * cos(phase) * w.xy;
  }
  return h;
}
`;

interface Surface {
  mesh: THREE.Mesh;
  uniforms: { uTime: THREE.IUniform<number>; uHorizon: THREE.IUniform<THREE.Vector3>; uVisibility: THREE.IUniform<number> };
}

function createSurface(): Surface {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIRECTION.clone() },
    uHorizon: { value: new THREE.Vector3() },
    uVisibility: { value: 400 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vSlope;
      varying float vHeight;
      ${WAVES_GLSL}
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 h = swell(world.xz, uTime, length(position.xz));
        world.y += h.x;
        vWorld = world.xyz;
        vSlope = h.yz;
        vHeight = h.x;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uHorizon;
      uniform float uVisibility;
      varying vec3 vWorld;
      varying vec2 vSlope;
      varying float vHeight;
      ${WATER_GLSL}
      ${SKY_GLSL}
      ${NOISE_GLSL}

      // Choppy detail for glints and shimmer: the gradient of two drifting noise layers, each faded out
      // once it is too fine for the pixel it lands on (otherwise it shimmers into moiré).
      vec2 noiseSlope(vec2 p) {
        const float e = 0.12;
        float n = swNoise(p);
        return vec2(swNoise(p + vec2(e, 0.0)) - n, swNoise(p + vec2(0.0, e)) - n) / e;
      }
      vec2 ripples(vec2 p, float t, float footprint) {
        vec2 s = vec2(0.0);
        float scale = 0.18; // cycles per metre
        float amp = cameraPosition.y < 0.0 ? 0.022 : 0.07; // seen from below, gentler or it reads as ice
        for (int i = 0; i < 4; i++) {
          float fade = 1.0 - smoothstep(0.06, 0.2, scale * footprint);
          vec2 drift = vec2(cos(float(i) * 2.1), sin(float(i) * 2.1)) * t * (0.35 + 0.15 * float(i));
          s += amp * fade * noiseSlope(p * scale + drift + float(i) * 17.0);
          scale *= 2.3;
          amp *= 0.78;
        }
        return s;
      }

      void main() {
        vec3 ray = vWorld - cameraPosition;
        float dist = length(ray);
        vec3 v = ray / dist;
        vec2 footprint = fwidth(vWorld.xz);
        vec2 slope = vSlope + ripples(vWorld.xz, uTime, max(footprint.x, footprint.y));
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 colour;
        float alpha = 1.0;

        if (cameraPosition.y >= vWorld.y) {
          // From above: deep blue body, the sky in the reflections, a sun glint and some whitecaps.
          float cosi = max(dot(-v, n), 0.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
          vec3 r = reflect(v, n);
          r.y = abs(r.y);
          float shade = 0.85 + 0.6 * vHeight;
          colour = mix(SW_SEA_BODY * shade, skyGradient(r, uSunDir), fresnel);
          float glint = max(dot(r, uSunDir), 0.0);
          // Broken into glitter: the smooth normals alone would give broad, flat patches of glare.
          float glitter = smoothstep(0.5, 0.8, swNoise(vWorld.xz * 1.6 + vec2(uTime * 0.9, -uTime * 0.6)));
          colour += SUN_COLOUR * (pow(glint, 700.0) * 1.3 * (0.15 + 0.85 * glitter) + pow(glint, 60.0) * 0.2);

          // Whitecaps: broken flecks of foam on the higher crests, in scattered patches.
          float patches = smoothstep(0.62, 0.85, swNoise(vWorld.xz * 0.025 + vec2(uTime * 0.02, 0.0)));
          float flecks = swNoise(vWorld.xz * 0.45 + vec2(0.0, uTime * 0.15)) * 0.6 + swNoise(vWorld.xz * 1.7 - uTime * 0.2) * 0.4;
          float crest = smoothstep(0.05, 0.35, vHeight);
          float foam = smoothstep(0.42, 0.6, flecks * crest * patches + crest * patches * 0.15)
            * (1.0 - smoothstep(120.0, 700.0, dist)) * 0.3;
          colour = mix(colour, vec3(0.9, 0.94, 0.97), foam);

          // Far off, the sea settles into one colour that meets the sky in a clean line.
          float far = smoothstep(300.0, 4500.0, dist);
          colour = mix(colour, SEA_HORIZON, far);
          alpha = clamp(mix(0.6, 1.0, fresnel) + foam + smoothstep(40.0, 250.0, dist), 0.0, 1.0);
        } else {
          // From below: Snell's window — the bright sky squeezed into a cone overhead, mirror-dark outside it.
          colour = swWaterScatter(reflect(v, -n), uHorizon, cameraPosition.y) * 1.25;
          vec3 out_ = refract(v, -n, 1.333);
          if (dot(out_, out_) > 0.0) {
            float fresnel = 0.02 + 0.98 * pow(1.0 - out_.y, 5.0);
            vec3 sky = skyGradient(out_, uSunDir) * vec3(0.78, 1.0, 1.02) * 1.15;
            sky += SUN_COLOUR * pow(max(dot(out_, uSunDir), 0.0), 60.0) * 1.8;
            colour = mix(sky, colour, fresnel);
          }
          // Thin bright wrinkles where the ripples catch the light.
          float wrinkle = 1.0 - abs(2.0 * swNoise(vWorld.xz * 0.22 + slope * 3.0 + uTime * 0.25) - 1.0);
          colour += vec3(0.16, 0.28, 0.3) * pow(wrinkle, 10.0) * (1.0 - smoothstep(15.0, 90.0, dist));
          colour = swThroughWater(colour, ray, uHorizon, uVisibility);
        }
        gl_FragColor = vec4(colour, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(polarGrid(), material);
  mesh.frustumCulled = false;
  // First among the transparent things: it writes depth, so spray above it and motes below sort correctly against it.
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}

export function createSea(_world: World): Sea {
  installWaterFog();
  const group = new THREE.Group();

  const sky = createSky();
  group.add(sky.mesh);

  const surface = createSurface();
  group.add(surface.mesh);

  const shafts = createLightShafts();
  group.add(shafts.mesh);

  const sun = new THREE.DirectionalLight(0xfff4e2, SUN_INTENSITY);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xcfe6ff, 0x1b2c38, HEMI_INTENSITY));

  const fog = new THREE.Fog(0x000000, 100, 400);
  const water: WaterState = { colour: new THREE.Color(), visibility: 400, litRadius: 150 };
  const haze = new THREE.Color(SKY_HORIZON);
  const horizon = new THREE.Vector3();

  return {
    group,
    update(camera, scene, time) {
      scene.fog = fog;
      const y = camera.position.y;
      waterAt(Math.max(-y, 0), water);
      if (y < 0) {
        fog.color.copy(water.colour);
        fog.near = water.litRadius;
        fog.far = water.visibility;
      } else {
        fog.color.copy(haze);
        fog.near = 1;
        fog.far = AIR_VISIBILITY;
      }
      scene.background = fog.color;
      displayVector(water.colour, horizon);

      sky.update(camera, horizon, time);
      surface.mesh.position.set(camera.position.x, 0, camera.position.z);
      surface.uniforms.uTime.value = time;
      surface.uniforms.uHorizon.value.copy(horizon);
      surface.uniforms.uVisibility.value = water.visibility;
      shafts.update(camera, time);
      causticUniforms.uCausticTime.value = time;
    },
  };
}
