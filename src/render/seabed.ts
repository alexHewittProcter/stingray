import * as THREE from 'three';
import type { World } from '../sim/world';
import { createDressing } from './dressing';
import { createFish } from './fish';
import { fbm2, noise2 } from './noise';
import { plantMaterials } from './plants';
import { chainPatch, onSceneryFrame } from './sway';

// The seabed as the series dressed it: a carpet of moss and weed in ochres and greens over grey-blue rock.
// The mesh is sampled from the same seabedHeight() the collision uses; the cushion texture and the colour
// patches are what make it read as growth rather than sand.

const TILE = 300; // m: tiles let the camera skip the ground behind it
const STEP = 6; // m between vertices
const TEXTURE_METRES = 11; // one repeat of the moss-cushion texture

const COVER = [0x4a6a2c, 0x5d7a34, 0x7d7a35, 0xa08a3c, 0x3f5a28, 0x8c7a38].map((h) => new THREE.Color(h));
const RUST = new THREE.Color(0x9a4f2e);
const TEAL = new THREE.Color(0x3f8a7c);
const SILT = new THREE.Color(0x6e6c58);
const ROCK = new THREE.Color(0x5a6a80);
const ROCK_PALE = new THREE.Color(0x8b98a8);
const DEEP = new THREE.Color(0x24344a);
const BRIGHTEN = 1.15; // the cushion texture averages a little under 1

export function createSeabed(world: World): THREE.Group {
  const group = new THREE.Group();
  const size = world.bounds.halfSize * 2 + 600;
  const tiles = Math.ceil(size / TILE);
  const { ground } = plantMaterials(world.seed);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: ground.map, bumpMap: ground.bump, bumpScale: 2.5 });
  triplanar(material);
  const meshes: THREE.Mesh[] = [];
  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) {
      const cx = -size / 2 + (i + 0.5) * TILE;
      const cz = -size / 2 + (j + 0.5) * TILE;
      meshes.push(new THREE.Mesh(tileGeometry(world, cx, cz), material));
    }
  }
  group.add(...meshes);
  // Tiles wholly past the fog's far edge would draw as flat fog colour: skip them.
  onSceneryFrame((camera, range) => {
    for (const mesh of meshes) {
      const sphere = mesh.geometry.boundingSphere!;
      mesh.visible = sphere.center.distanceTo(camera.position) - sphere.radius < range;
    }
  });
  group.add(createDressing(world), createFish(world));
  return group;
}

function tileGeometry(world: World, cx: number, cz: number): THREE.BufferGeometry {
  const segments = TILE / STEP;
  const geometry = new THREE.PlaneGeometry(TILE, TILE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(cx, 0, cz);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  const bed = world.seabedHeight;
  const d = 1.5; // m: finite-difference span for the normal
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = bed(x, z);
    position.setY(i, y);
    // Normals from the heightfield itself, so neighbouring tiles shade without seams.
    n.set(bed(x - d, z) - bed(x + d, z), 2 * d, bed(x, z - d) - bed(x, z + d)).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    uv.setXY(i, x / TEXTURE_METRES, z / TEXTURE_METRES);
    groundColour(c, world.seed, x, y, z, 1 - n.y);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The cushion texture is projected from all three axes and blended by the surface normal, so the trench walls
 * keep its scale instead of smearing it into streaks; the bump fades out on the steeps for the same reason.
 */
function triplanar(material: THREE.Material): void {
  chainPatch(material, 'triplanar-ground', (shader) => {
    shader.uniforms.uGroundScale = { value: 1 / TEXTURE_METRES };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;\nuniform float uGroundScale;',
      )
      .replace(
        '#include <bumpmap_pars_fragment>',
        THREE.ShaderChunk.bumpmap_pars_fragment.replace(/bumpScale \*/g, 'bumpScale * smoothstep(0.72, 0.92, vGroundNormal.y) *'),
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 groundW = pow(abs(normalize(vGroundNormal)), vec3(4.0));
          groundW /= groundW.x + groundW.y + groundW.z;
          vec3 groundP = vGroundPos * uGroundScale;
          diffuseColor *= texture2D(map, groundP.zy) * groundW.x + texture2D(map, groundP.xz) * groundW.y
            + texture2D(map, groundP.xy) * groundW.z;
        #endif
        // Strata on steep faces: layers a few metres thick, each its own shade, with a dark seam beneath.
        float groundSteep = 1.0 - smoothstep(0.5, 0.8, vGroundNormal.y);
        float groundLayer = vGroundPos.y / 3.6 + 0.6 * sin(vGroundPos.x * 0.031 + vGroundPos.z * 0.023);
        float groundShade = 0.7 + 0.45 * fract(sin(floor(groundLayer) * 12.9898) * 43758.5453);
        float groundSeam = smoothstep(0.0, 0.12, fract(groundLayer));
        diffuseColor.rgb *= mix(1.0, groundShade * mix(0.45, 1.0, groundSeam), groundSteep);`,
      );
  });
}

const rock = new THREE.Color();

/** Growth on the flats in broad patches; bare stratified rock on the steeps; everything darkens into the deep. */
function groundColour(c: THREE.Color, seed: number, x: number, y: number, z: number, steep: number): void {
  const broad = fbm2(x / 160, z / 160, seed + 101, 3);
  const local = fbm2(x / 38, z / 38, seed + 103, 3);
  const pick = THREE.MathUtils.clamp(broad * 1.4 - 0.2 + (local - 0.5) * 0.9, 0, 0.999) * (COVER.length - 1);
  const k = Math.floor(pick);
  c.copy(COVER[k]!).lerp(COVER[k + 1]!, pick - k);
  // Occasional beds of rust-red and teal growth, and threads of bare silt between patches.
  const accent = fbm2(x / 55 + 40, z / 55, seed + 107, 2);
  if (accent > 0.62) c.lerp(RUST, (accent - 0.62) * 2.2);
  else if (accent < 0.3) c.lerp(TEAL, (0.3 - accent) * 1.6);
  const silt = fbm2(x / 24, z / 24, seed + 109, 2);
  if (silt > 0.66) c.lerp(SILT, (silt - 0.66) * 2);

  // Steep ground is bare grey-blue rock (its strata are drawn per pixel, in the shader: walls are too steep for
  // the vertex grid to carry bands).
  const rockiness = THREE.MathUtils.smoothstep(steep, 0.12, 0.3);
  c.lerp(DEEP, THREE.MathUtils.clamp((-y - 160) / 200, 0, 0.55) * (1 - rockiness));
  if (rockiness > 0) {
    rock.copy(ROCK).lerp(ROCK_PALE, noise2(x / 50, z / 50, seed + 113) * 0.5);
    c.lerp(rock, rockiness);
  }
  c.multiplyScalar(BRIGHTEN * (0.85 + 0.3 * local));
}
