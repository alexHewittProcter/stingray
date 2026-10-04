import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glow } from './glow';

// The things Stingray shoots at, and what it shoots: moored mines, Terror Fish and Sting missiles.
// Built in node-safe code (DataTextures, guarded glows) so they can be inspected outside the game.
// Visual bodies are matched to the sim's hit spheres (mine 2.5 m, fish 3 m).

// ---- Shared bits ----

function dataTexture(width: number, height: number, paint: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const hex = paint((px + 0.5) / width, (py + 0.5) / height);
      const k = (py * width + px) * 4;
      data[k] = (hex >> 16) & 0xff;
      data[k + 1] = (hex >> 8) & 0xff;
      data[k + 2] = hex & 0xff;
      data[k + 3] = 0xff;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function mix(a: number, b: number, t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - k) + ((b >> s) & 0xff) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A flat plate drawn in (z, y), extruded across X and centred on x = 0. */
function plate(points: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(thickness / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

// ---- Moored mine ----

const MINE_RED = 0xa9332b;
const MINE_BAND = 0xe9e4d8;
const MINE_METAL = 0x4a4f56;
const MINE_LAMP = 0xffe9a0;
const HORN_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  // (elevation, azimuth) in degrees: a ring above (the lamp mast takes the crown), one at the equator, a few below.
  [45, 0], [45, 90], [45, 180], [45, 270], [0, 45], [0, 135], [0, 225], [0, 315], [-45, 0], [-45, 120], [-45, 240],
];

export interface Mine {
  readonly group: THREE.Group;
  /** Bob on the mooring and blink the marker lamp. */
  animate(t: number): void;
}

let mineParts: ReturnType<typeof createMineParts> | null = null;

function createMineParts(r: number) {
  // The casing: red with a white band, crossed by riveted seams.
  const casingMap = dataTexture(128, 64, (u, v) => {
    const lat = (v - 0.5) * Math.PI; // −π/2 at the bottom
    let c = Math.abs(lat) < 0.18 ? MINE_BAND : MINE_RED;
    const seam = Math.abs(lat - 0.45) < 0.02 || Math.abs(lat + 0.45) < 0.02 || Math.abs((u * 6) % 1 - 0.5) < 0.012;
    if (seam) c = mix(c, 0x2a1210, 0.5);
    const rivet = (Math.abs(lat - 0.52) < 0.03 || Math.abs(lat + 0.52) < 0.03) && (u * 48) % 1 < 0.35;
    if (rivet) c = 0xc9c2b8;
    return mix(c, 0x3a1a14, 0.25 * Math.max(0, Math.sin(u * 37) * Math.sin(v * 23))); // grime
  });
  const casing = new THREE.MeshStandardMaterial({ map: casingMap, roughness: 0.55, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: MINE_METAL, roughness: 0.5, metalness: 0.5 });
  const tip = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.35, metalness: 0.6 });

  const horns: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3(1, 1, 1);
  for (const [el, az] of HORN_DIRECTIONS) {
    const e = THREE.MathUtils.degToRad(el);
    const a = THREE.MathUtils.degToRad(az);
    dir.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    q.setFromUnitVectors(up, dir);
    const horn = new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.45, 8);
    horn.translate(0, r * 1.15, 0);
    horns.push(horn.applyMatrix4(m.compose(new THREE.Vector3(), q, s)));
    const cap = new THREE.SphereGeometry(r * 0.1, 8, 6);
    cap.translate(0, r * 1.4, 0);
    caps.push(cap.applyMatrix4(m.compose(new THREE.Vector3(), q, s)));
  }

  // The chain: a few real links under the mine, then a cable-like run painted with links.
  const linkGeometry = new THREE.TorusGeometry(0.22, 0.07, 5, 10);
  const chainMap = dataTexture(8, 64, (u, v) => {
    const link = (v * 16) % 1;
    const edge = Math.abs(link - 0.5) > 0.38 || Math.abs(u - 0.5) > 0.3;
    return edge ? 0x2a2e33 : 0x6c6f70;
  });

  return {
    casing,
    metal,
    tip,
    body: new THREE.SphereGeometry(r, 28, 18),
    belt: new THREE.TorusGeometry(r * 1.0, r * 0.07, 6, 36),
    horns: mergeGeometries(horns),
    caps: mergeGeometries(caps),
    link: linkGeometry,
    chainMap,
    lampMast: new THREE.CylinderGeometry(0.1, 0.14, r * 0.5, 6),
    lamp: new THREE.SphereGeometry(r * 0.17, 12, 8),
    sinker: new THREE.CylinderGeometry(1.4, 1.8, 1.2, 10),
  };
}

/** A moored contact mine: red casing with a white belt and riveted seams, lead horns, a marker lamp, a chain to a sinker. */
export function createMine(radius: number, mooringDrop: number, phase: number): Mine {
  const parts = (mineParts ??= createMineParts(radius));
  const group = new THREE.Group();
  const float = new THREE.Group(); // everything that bobs
  group.add(float);

  float.add(new THREE.Mesh(parts.body, parts.casing));
  const belt = new THREE.Mesh(parts.belt, parts.metal);
  belt.rotation.x = Math.PI / 2;
  float.add(belt);
  float.add(new THREE.Mesh(parts.horns, parts.metal), new THREE.Mesh(parts.caps, parts.tip));

  const mast = new THREE.Mesh(parts.lampMast, parts.metal);
  mast.position.y = radius * 1.55;
  float.add(mast);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: MINE_LAMP, fog: false });
  const lamp = new THREE.Mesh(parts.lamp, lampMaterial);
  lamp.position.y = radius * 1.85;
  float.add(lamp);
  const lampGlow = glow(0xffd66a, radius * 7, 0.55);
  lampGlow.position.y = radius * 1.85;
  float.add(lampGlow);

  for (let i = 0; i < 4; i++) {
    const link = new THREE.Mesh(parts.link, parts.metal);
    link.position.y = -radius - 0.2 - i * 0.36;
    link.rotation.y = (i % 2) * (Math.PI / 2);
    float.add(link);
  }
  const runTop = radius + 1.5;
  const run = Math.max(mooringDrop - runTop, 0.5);
  const chainMap = parts.chainMap.clone();
  chainMap.repeat.set(1, run / 6);
  chainMap.needsUpdate = true;
  const chain = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, run, 5, 1, true),
    new THREE.MeshStandardMaterial({ map: chainMap, roughness: 0.6, metalness: 0.4 }),
  );
  chain.position.y = -runTop - run / 2;
  group.add(chain);
  const sinker = new THREE.Mesh(parts.sinker, parts.metal);
  sinker.position.y = -mooringDrop + 0.4;
  group.add(sinker);

  const BLINK_PERIOD = 1.6;
  return {
    group,
    animate(t) {
      float.position.y = Math.sin(t * 0.9 + phase) * 0.25;
      float.rotation.y = t * 0.08 + phase;
      const on = ((t + phase) % BLINK_PERIOD) / BLINK_PERIOD < 0.55;
      lampMaterial.color.setHex(on ? MINE_LAMP : 0x6a5a30);
      lampGlow.material.opacity = on ? 0.6 : 0.12;
    },
  };
}

// ---- Terror Fish ----

const FISH_BLUE = 0x3c5c9c;
const FISH_BLUE_LIGHT = 0x6f8fc0;
const FISH_HEAD = 0x4a3e3c;
const FISH_SPOT = 0xc0392b;
const FISH_RIVET = 0xe8c44a;
const FISH_BELLY = 0x8e9bab;
const FISH_FIN = 0x5d6f8a;
const EYE_GLOW = 0xe8f6ff;

/** Fish proportions as multiples of the hit radius: long, deep-bodied and side-flattened. */
const BODY = { halfLength: 1.15, halfHeight: 0.85, halfWidth: 0.42 };
/** The jutting lower jaw's half-axes, metres, for the 3 m fish. */
const JAW = { x: 1.02, y: 0.66, z: 1.26 };

/** The armour: blue scale rows riveted in yellow, a dark red-spotted head, a pale belly (u around the girth, v nose→tail). */
function fishSkin(): THREE.DataTexture {
  return dataTexture(256, 128, (u, v) => {
    const along = 1 - v; // 0 at the nose
    const bottom = Math.cos((u - 0.25) * Math.PI * 2); // 1 under the belly
    if (along < 0.3) {
      // The head: dark armour, red spots and a scatter of yellow rivets — laid out in the plane
      // facing the nose so they do not pinch together at the texture's pole.
      let c = mix(FISH_HEAD, 0x2e2828, bottom * 0.5);
      const px = along * Math.cos(u * Math.PI * 2);
      const py = along * Math.sin(u * Math.PI * 2);
      const spot = (k: number, size: number, salt: number) => {
        const fx = px * k + salt;
        const fy = py * k - salt;
        return Math.hypot(fx - Math.floor(fx) - 0.5, fy - Math.floor(fy) - 0.5) < size;
      };
      if (spot(14, 0.2, 0.3) && Math.sin(px * 91 + py * 57) > -0.2) c = FISH_SPOT;
      else if (spot(34, 0.14, 0.7)) c = FISH_RIVET;
      return c;
    }
    // Scales: rows of overlapping plates, each darker toward its trailing edge, offset row to row.
    const rows = 16;
    const cols = 14;
    const row = Math.floor(along * rows);
    const fu = (u * cols + (row % 2) * 0.5) % 1;
    const fv = (along * rows) % 1;
    let c = mix(FISH_BLUE_LIGHT, FISH_BLUE, fv);
    if (Math.abs(fu - 0.5) > 0.45) c = mix(c, 0x1d2a44, 0.6);
    if (fv < 0.12 && Math.abs(fu - 0.5) < 0.08) c = FISH_RIVET; // a rivet at each plate's head
    c = mix(c, FISH_BELLY, Math.max(bottom - 0.35, 0) * 1.2);
    return c;
  });
}

/** Reshape a sphere into the fish body: blunt armoured head, deep chest, tapering to the tail stock. */
function fishBodyGeometry(r: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 32, 20);
  geometry.rotateX(Math.PI / 2); // poles on ±Z
  geometry.rotateY(Math.PI); // the v = 1 pole (the nose) to −Z
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i); // −1 nose … +1 tail
    const taper = z > 0 ? 1 - 0.78 * z ** 1.4 : 1 - 0.18 * (-z) ** 3; // thin to the tail, blunt at the head
    const hump = 1 + 0.18 * Math.max(0, 1 - Math.abs(z + 0.25) * 2) * Math.max(y, 0); // a raised back behind the head
    p.setXYZ(
      i,
      x * BODY.halfWidth * r * taper,
      (y * BODY.halfHeight * taper * hump - 0.1 * z * z) * r,
      z * BODY.halfLength * r * (z < 0 ? 0.92 : 1),
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export interface TerrorFish {
  readonly group: THREE.Group;
  /** Swim: tail beat, fin scull and a body sway, from the time and a per-fish phase. */
  animate(t: number): void;
}

let fishParts: ReturnType<typeof createFishParts> | null = null;

function createFishParts(r: number) {
  const fin = new THREE.MeshStandardMaterial({ color: FISH_FIN, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2424, roughness: 0.6, metalness: 0.2 });
  const L = BODY.halfLength * r;
  const H = BODY.halfHeight * r;

  // The spiny dorsal sail: a saw-tooth top edge of spines raking back.
  const DORSAL_START = -0.55 * L;
  const SPINES = 9;
  const step = (1.25 * L) / SPINES;
  const dorsalPoints: Array<[number, number]> = [[DORSAL_START, 0]];
  for (let i = 0; i < SPINES; i++) {
    const z = DORSAL_START + i * step;
    const h = H * (0.8 - 0.4 * (i / SPINES));
    dorsalPoints.push([z + 0.7 * step, h], [z + step, h * 0.5]);
  }
  dorsalPoints.push([DORSAL_START + SPINES * step + 0.05 * L, 0]);

  // Teeth set round the front of the lower jaw's rim (the jaw is a half-ellipsoid, see JAW).
  const teeth: THREE.BufferGeometry[] = [];
  const TEETH = 13;
  for (let i = 0; i < TEETH; i++) {
    const a = -1.25 + (2.5 * i) / (TEETH - 1);
    const tooth = new THREE.ConeGeometry(0.06 * r, 0.2 * r, 4);
    tooth.translate(Math.sin(a) * JAW.x * 0.9, 0.08 * r, -Math.cos(a) * JAW.z * 0.9);
    teeth.push(tooth);
  }

  return {
    skin: new THREE.MeshStandardMaterial({ map: fishSkin(), roughness: 0.38, metalness: 0.45 }),
    fin,
    dark,
    body: fishBodyGeometry(r),
    dorsal: plate(dorsalPoints, 0.06 * r),
    // A forked tail, rooted at the tail stock (origin), drawn in (z, y).
    tail: plate([[0, 0.12 * r], [0.42 * r, 0.55 * r], [0.7 * r, 0.72 * r], [0.5 * r, 0.2 * r], [0.55 * r, 0], [0.5 * r, -0.2 * r], [0.7 * r, -0.72 * r], [0.42 * r, -0.55 * r], [0, -0.12 * r]], 0.05 * r),
    pectoral: plate([[0, 0], [0.55 * r, 0.12 * r], [0.75 * r, -0.12 * r], [0.35 * r, -0.3 * r]], 0.04 * r),
    ventral: plate([[0, 0], [0.4 * r, -0.35 * r], [0.55 * r, -0.3 * r], [0.45 * r, 0]], 0.04 * r),
    jaw: new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), // the lower half of a sphere
    teeth: mergeGeometries(teeth),
    eye: new THREE.SphereGeometry(0.27 * r, 20, 14),
    bezel: new THREE.TorusGeometry(0.27 * r, 0.045 * r, 8, 24),
    eyeLamp: new THREE.MeshStandardMaterial({ color: 0xf2f4f2, emissive: 0xc8dcea, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.3 }),
    pupil: new THREE.CircleGeometry(0.08 * r, 16),
    lens: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
}

/** A Terror Fish: an armoured blue-scaled mechanical fish with a great lamp eye and a red-spotted, toothed underbite. Nose along −Z. */
export function createTerrorFish(radius: number, phase: number): TerrorFish {
  const r = radius;
  const parts = (fishParts ??= createFishParts(r));
  const group = new THREE.Group();
  const sway = new THREE.Group(); // the whole body rolls and yaws a little as it swims
  group.add(sway);

  sway.add(new THREE.Mesh(parts.body, parts.skin));

  const dorsal = new THREE.Mesh(parts.dorsal, parts.fin);
  dorsal.position.y = BODY.halfHeight * r * 0.72;
  sway.add(dorsal);
  const ventral = new THREE.Mesh(parts.ventral, parts.fin);
  ventral.position.set(0, -BODY.halfHeight * r * 0.7, 0.3 * r);
  sway.add(ventral);

  // The underbite: a jutting red-spotted lower jaw with teeth, the mouth dark behind them.
  const jaw = new THREE.Mesh(parts.jaw, parts.skin);
  jaw.scale.set(JAW.x, JAW.y, JAW.z);
  jaw.position.set(0, -0.32 * r, -0.92 * r);
  jaw.rotation.x = -0.25;
  sway.add(jaw);
  const mouth = new THREE.Mesh(parts.jaw, parts.dark);
  mouth.scale.set(JAW.x * 0.88, JAW.y * 0.25, JAW.z * 0.88);
  mouth.position.set(0, -0.3 * r, -0.95 * r);
  mouth.rotation.x = Math.PI - 0.25;
  sway.add(mouth);
  const teeth = new THREE.Mesh(parts.teeth, new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.4 }));
  teeth.position.set(0, -0.32 * r, -0.92 * r);
  teeth.rotation.x = -0.25;
  sway.add(teeth);

  // The lamp eyes: a chrome-ringed glowing globe on each side of the head.
  for (const side of [-1, 1]) {
    const holder = new THREE.Object3D();
    holder.position.set(side * 0.35 * r, 0.22 * r, -0.72 * r);
    holder.rotation.y = side * (Math.PI / 2 + 0.35); // out to the side and a little forward
    const eye = new THREE.Mesh(parts.eye, parts.eyeLamp);
    eye.scale.z = 0.6;
    holder.add(eye);
    const bezel = new THREE.Mesh(parts.bezel, parts.fin);
    bezel.position.z = 0.05 * r;
    holder.add(bezel);
    const pupil = new THREE.Mesh(parts.pupil, parts.lens);
    pupil.position.z = 0.17 * r;
    holder.add(pupil);
    const eyeGlow = glow(EYE_GLOW, r * 3, 0.5);
    eyeGlow.position.z = 0.2 * r;
    holder.add(eyeGlow);
    sway.add(holder);

    const pectoral = new THREE.Mesh(parts.pectoral, parts.fin);
    pectoral.position.set(side * BODY.halfWidth * r * 0.9, -0.25 * r, -0.35 * r);
    pectoral.rotation.set(0, side * 0.5, side * 0.6);
    pectoral.name = side < 0 ? 'pectoralPort' : 'pectoralStarboard';
    sway.add(pectoral);
  }

  const tail = new THREE.Group();
  tail.position.z = BODY.halfLength * r * 0.95;
  tail.add(new THREE.Mesh(parts.tail, parts.fin));
  sway.add(tail);

  const pectorals = sway.children.filter((c) => c.name.startsWith('pectoral'));
  const TAIL_BEAT = 6; // rad/s
  return {
    group,
    animate(t) {
      const beat = Math.sin(t * TAIL_BEAT + phase);
      tail.rotation.y = beat * 0.45;
      sway.rotation.y = -beat * 0.06;
      sway.rotation.z = Math.sin(t * 1.3 + phase) * 0.06;
      for (const fin of pectorals) fin.rotation.x = Math.sin(t * 4 + phase) * 0.35;
    },
  };
}

// ---- Sting missile ----

const MISSILE_WHITE = 0xe4e7ea;
const MISSILE_RED = 0xc8402c;

let missileParts: ReturnType<typeof createMissileParts> | null = null;

function createMissileParts() {
  // Body: an ogive nose, a parallel body and a boat-tail, as one lathe; nose toward −Z.
  const profile: Array<[number, number]> = [
    [0.0, -1.7], [0.12, -1.55], [0.22, -1.3], [0.28, -0.95], [0.3, -0.6], [0.3, 0.9], [0.24, 1.25], [0.2, 1.3],
  ];
  const body = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, -z)), 14);
  body.rotateX(-Math.PI / 2); // lathe +Y → −Z, so the profile's z lands where it was drawn
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const finGeometry = plate([[0.5, 0.25], [1.25, 0.62], [1.3, 0.3], [1.1, 0.25]], 0.05);
    finGeometry.rotateZ((i * Math.PI) / 2 + Math.PI / 4);
    fins.push(finGeometry);
  }
  const band = new THREE.CylinderGeometry(0.31, 0.31, 0.25, 14, 1, true);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0, -0.75);
  const jet = new THREE.ConeGeometry(0.22, 2.2, 10, 1, true);
  jet.rotateX(Math.PI / 2); // tip toward +Z: the jet streams aft
  jet.translate(0, 0, 1.3 + 1.1);
  return {
    body,
    fins: mergeGeometries(fins),
    band,
    jet,
    white: new THREE.MeshStandardMaterial({ color: MISSILE_WHITE, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: MISSILE_RED, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }),
    jetMaterial: new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
}

export interface MissileModel {
  readonly group: THREE.Group;
  /** Flicker the exhaust. */
  animate(t: number): void;
}

/** A Sting missile: white with red fins and a red band, an ogive nose along −Z, and a pale exhaust jet. */
export function createMissileModel(): MissileModel {
  const parts = (missileParts ??= createMissileParts());
  const group = new THREE.Group();
  group.add(new THREE.Mesh(parts.body, parts.white), new THREE.Mesh(parts.fins, parts.red), new THREE.Mesh(parts.band, parts.red));
  const jet = new THREE.Mesh(parts.jet, parts.jetMaterial);
  group.add(jet);
  const flare = glow(0xdff4ff, 4.5, 0.7);
  flare.position.z = 1.5;
  group.add(flare);
  return {
    group,
    animate(t) {
      const flicker = 0.8 + 0.2 * Math.sin(t * 61) * Math.sin(t * 23);
      jet.scale.set(flicker, flicker, 0.7 + 0.5 * flicker);
      flare.scale.setScalar(4 + flicker * 1.5);
    },
  };
}
