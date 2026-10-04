import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glow } from './glow';

// The ocean door, as in the series: a thick machined steel ring port set into the rock, with a
// domed iris door recessed inside it. Built about the mouth centre with +Z out to sea; z = 0 is
// the collider face. The ring may stand proud of the face by up to RING_FRONT (the sub's hull
// sphere stops 4 m short of the face); everything else stays at or behind it.

export const DOOR_RING_RADIUS = 17; // outer radius: 34 m across, inside the 40 × 24 m opening's reach

const RING_FRONT = 1.7;
const BORE_RADIUS = 11.6;
const SEAT_RADIUS = 10.8;
const SEAT_Z = -4.6;
const DOME_BULGE = 2.4;
const IRIS_LEAVES = 9;
const BOLT_COUNT = 36;
const BEACON_X = 21.5;

const STEEL = 0xbcc2c6;
const STEEL_DARK = 0x5d6066;
const DOOR_STEEL = 0x7d7680; // the TV door reads as a warm purple-grey
const BEACON_AMBER = 0xffd27a;
const GUIDE_LIGHT = 0xbfeaff;

function smooth(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
}

/** The ring in profile, (radius, z), from buried at the back outside, over the face, into the bore. */
const RING_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [DOOR_RING_RADIUS, -9],
  [DOOR_RING_RADIUS, 0.2],
  [16.6, 1.15],
  [16.0, RING_FRONT - 0.05],
  [12.7, RING_FRONT],
  [12.2, RING_FRONT - 0.15],
  [11.85, 0.9],
  [BORE_RADIUS, 0.2],
  [BORE_RADIUS, SEAT_Z + 1.2],
  [SEAT_RADIUS + 0.4, SEAT_Z + 1.0],
  [SEAT_RADIUS + 0.4, SEAT_Z],
  [SEAT_RADIUS - 0.2, SEAT_Z - 0.3],
];

function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); // lathe +Y → +Z, out to sea
  return geometry;
}

/**
 * The door's face: iris leaves spiralling in to a hub, a dark seam between each, a seating band at
 * the rim and grime in streaks. Painted into a DataTexture on the dome's sphere UVs (u around,
 * v from the rim to the pole), so it needs no DOM.
 */
function irisTexture(): THREE.DataTexture {
  const W = 512;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  const base = new THREE.Color(DOOR_STEEL);
  const c = new THREE.Color();
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H; // 0 at the rim, 1 at the pole
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const leaf = (((u * IRIS_LEAVES + (1 - v) * 1.4) % 1) + 1) % 1;
      c.copy(base);
      c.multiplyScalar(0.82 + 0.3 * leaf); // each leaf catches the light along its overlap
      if (leaf < 0.035 || leaf > 0.985) c.multiplyScalar(0.3); // the seam
      if (v < 0.06) c.multiplyScalar(0.55); // seating band
      if (v > 0.9) c.setHex(STEEL).multiplyScalar(v > 0.96 ? 0.6 : 1); // hub
      const grime = Math.sin(u * 211) * Math.sin(u * 73 + v * 5);
      c.multiplyScalar(1 - 0.12 * smooth(grime));
      const k = (py * W + px) * 4;
      data[k] = Math.round(Math.min(c.r, 1) * 255);
      data[k + 1] = Math.round(Math.min(c.g, 1) * 255);
      data[k + 2] = Math.round(Math.min(c.b, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** The domed door, bulging seaward from its seat inside the bore. */
function dome(): THREE.Mesh {
  const radius = (SEAT_RADIUS ** 2 + DOME_BULGE ** 2) / (2 * DOME_BULGE);
  const theta = Math.asin(SEAT_RADIUS / radius);
  const geometry = new THREE.SphereGeometry(radius, 72, 14, 0, Math.PI * 2, 0, theta);
  geometry.rotateX(Math.PI / 2); // pole → +Z
  geometry.translate(0, 0, SEAT_Z - radius * Math.cos(theta));
  const map = irisTexture();
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.3 }));
}

/** Studs around the ring's face, merged into one mesh. */
function bolts(material: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < BOLT_COUNT; i++) {
    const a = (i / BOLT_COUNT) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.28, 0.32, 0.3, 6);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(Math.cos(a) * 14.4, Math.sin(a) * 14.4, RING_FRONT + 0.1);
    parts.push(bolt);
  }
  return new THREE.Mesh(mergeGeometries(parts), material);
}

/** Small housings on the ring's face at the diagonals: the iris rams. */
function rams(material: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ram = new THREE.BoxGeometry(1.6, 2.4, 0.5);
    ram.rotateZ(a);
    ram.translate(Math.cos(a) * 14.4, Math.sin(a) * 14.4, RING_FRONT + 0.2);
    parts.push(ram);
  }
  return new THREE.Mesh(mergeGeometries(parts), material);
}

/** Guide lights set round the bore's lip, and a beacon either side, so the way home shows through the murk. */
function lights(): THREE.Group {
  const group = new THREE.Group();
  const lamp = new THREE.MeshBasicMaterial({ color: GUIDE_LIGHT });
  const lampGeometry = new THREE.SphereGeometry(0.28, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dot = new THREE.Mesh(lampGeometry, lamp);
    dot.position.set(Math.cos(a) * 12.55, Math.sin(a) * 12.55, RING_FRONT);
    group.add(dot);
  }
  const ringGlow = glow(GUIDE_LIGHT, 40, 0.18);
  ringGlow.position.z = RING_FRONT + 1;
  group.add(ringGlow);

  const housingMaterial = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.5, metalness: 0.5 });
  const housing = new THREE.CylinderGeometry(1.1, 1.4, 4, 14);
  housing.rotateX(Math.PI / 2);
  const lens = new THREE.MeshBasicMaterial({ color: BEACON_AMBER });
  for (const side of [-1, 1]) {
    const beacon = new THREE.Group();
    beacon.position.set(side * BEACON_X, 0, 0);
    const body = new THREE.Mesh(housing, housingMaterial);
    body.position.z = -1.3;
    beacon.add(body);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), lens);
    face.position.z = 0.72;
    beacon.add(face);
    const halo = glow(BEACON_AMBER, 16, 0.6);
    halo.position.z = 1.5;
    beacon.add(halo);
    group.add(beacon);
  }
  return group;
}

export function createOceanDoor(mouth: { x: number; y: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'oceanDoor';
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.5, metalness: 0.5 });

  group.add(new THREE.Mesh(lathe(RING_PROFILE, 96), steel));
  // A machined groove ring across the face.
  const groove = new THREE.Mesh(new THREE.TorusGeometry(15.6, 0.12, 6, 96), dark);
  groove.position.z = RING_FRONT - 0.02;
  group.add(groove);
  group.add(bolts(dark), rams(steel), dome(), lights());

  group.position.set(mouth.x, mouth.y, mouth.z);
  return group;
}
