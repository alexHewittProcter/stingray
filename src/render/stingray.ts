import * as THREE from 'three';

// Stingray, built from code to match goals/testbed-stingray/references/stingray.png.
//
// Conventions the simulation relies on:
//   - forward is local −Z (nose at z = −13), the ratchet drive at the stern (z up to +13)
//   - +Y is up, +X is starboard, origin at the hull's centre, units are metres
//   - overall length nose-to-drive is 26 m
//   - the drive is its own child object, spun about the Z axis by setDriveSpin()

export interface StingrayModel {
  readonly group: THREE.Group;
  /** The ratchet drive; rotates about its local Z axis (the hull's long axis). */
  readonly drive: THREE.Object3D;
  setDriveSpin(angleRadians: number): void;
}

// ---- Dimensions (metres) -------------------------------------------------------------------

const NOSE_Z = -13;
const STERN_Z = 13;

const HULL_TAIL_Z = 10.5; // hull tapers into (and ends inside) the drive
const HULL_HALF_WIDTH = 2.5;
const HULL_TOP = 1.8; // deck height above the hull axis
const HULL_BOTTOM = 2.3; // keel depth below the hull axis
const HULL_STATIONS = 96;
const HULL_SEGMENTS = 64;

const CABIN_START_Z = -5.2;
const CABIN_END_Z = 8.5;
const CABIN_CENTRE_Y = 1.45;
const CABIN_HALF_WIDTH = 1.6;
const CABIN_TOP = 1.75; // roof at y ≈ 3.2
const CABIN_BOTTOM = 0.8; // buried in the hull
const CABIN_STATIONS = 48;
const CABIN_SEGMENTS = 40;

const DRIVE_FRONT_Z = 10;
const DRIVE_LENGTH = STERN_Z - DRIVE_FRONT_Z;
const DRIVE_Y = 0.3;
const DRIVE_CORE_RADIUS = 1.45;
const DRIVE_FIN_RADIUS = 1.95;
const DRIVE_FIN_COUNT = 10;

const WINDOW_Y = 2.6;
const WINDOW_HEIGHT = 0.45;
const WINDOW_SPANS: ReadonlyArray<readonly [number, number]> = [
  [-2.8, -0.1],
  [0.1, 1.1],
  [1.3, 2.4],
  [2.6, 3.7],
  [3.9, 4.9],
];

const DOME_Z = -1.6;
const PERISCOPE_Z = -1.0;
const PERISCOPE_TOP_Y = 7.1;

// ---- Colours ---------------------------------------------------------------------------------

const WHITE = 0xf2f4f5;
const YELLOW = 0xf2c919;
const TEAL = 0x5fb8c9;
const FIN_TEAL = 0x3aa6b9;
const NAVY_RECESS = 0x0c1d3f;
const CABIN_BLUE = 0x1d3f86;
const DOME_BLUE = 0x2e6db4;
const GLASS = 0x0d1a2a;
const STERN_PLANE = 0xcfe3ea;
const DRIVE_CREAM = 0xeee6c6;
const DRIVE_FIN = 0xf6f0d8;
const DRIVE_HUB = 0xd8d2bc;
const MAST_GREY = 0xd8dde3;
const LETTERING = '#0f2350';

// ---- Profiles -------------------------------------------------------------------------------

interface Profile {
  max: number;
  /** Front taper: zero at `start`, full at `full`; (1 − u^power)^exponent. */
  front?: { start: number; full: number; power: number; exponent: number };
  /** Rear taper: full at `start`, `min` fraction at `end`, smoothstep in between. */
  rear?: { start: number; end: number; min: number };
}

function smoothstep(u: number): number {
  const t = Math.min(Math.max(u, 0), 1);
  return t * t * (3 - 2 * t);
}

function evaluate(p: Profile, z: number): number {
  let f = 1;
  if (p.front && z < p.front.full) {
    const u = Math.min((p.front.full - z) / (p.front.full - p.front.start), 1);
    f *= Math.pow(Math.max(1 - Math.pow(u, p.front.power), 0), p.front.exponent);
  }
  if (p.rear && z > p.rear.start) {
    const u = (z - p.rear.start) / (p.rear.end - p.rear.start);
    f *= 1 - (1 - p.rear.min) * smoothstep(u);
  }
  return p.max * f;
}

function lerpTable(table: ReadonlyArray<readonly [number, number]>, z: number): number {
  const first = table[0]!;
  if (z <= first[0]) return first[1];
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i]!;
    const [z0, v0] = table[i - 1]!;
    if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
  }
  return table[table.length - 1]![1];
}

// ---- Loft: a body of superellipse cross-sections along Z, with a painted livery --------------------

interface LoftSpec {
  zStart: number;
  zEnd: number;
  stations: number;
  segments: number;
  centreY: number;
  halfWidth: Profile;
  top: Profile;
  bottom: Profile;
  /** Superellipse exponents: >2 flattens that half (a flatter deck / roof). */
  topExponent: number;
  bottomExponent: number;
  colour(x: number, y: number, z: number): number;
}

interface Loft {
  geometry: THREE.BufferGeometry;
  /** The paint scheme, UV-mapped (u along the length, v around the girth). */
  livery: THREE.Texture;
  /** The surface point on the starboard side at (z, y), plus the outward normal's tilt from +X about Z. */
  side(z: number, y: number): { x: number; tilt: number };
}

/** Livery texture resolution per body: texels along the length × around the girth. */
const LIVERY_TEXELS = { along: 1024, around: 512 };

function loft(spec: LoftSpec): Loft {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ring = spec.segments;
  const ringVerts = ring + 1; // the seam vertex is duplicated so the livery UVs wrap cleanly

  // Cosine spacing: stations crowd the ends, where the curvature is.
  const zAt = (t: number): number => spec.zStart + ((1 - Math.cos(Math.PI * t)) / 2) * (spec.zEnd - spec.zStart);
  // Girth parameter v ∈ [0, 1] starts and ends at the keel (θ = −90°), where the seam is least seen.
  const thetaAt = (v: number): number => -Math.PI / 2 + v * Math.PI * 2;
  const point = (z: number, theta: number): [number, number] => {
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const upper = sin >= 0;
    const n = upper ? spec.topExponent : spec.bottomExponent;
    const h = evaluate(upper ? spec.top : spec.bottom, z);
    const x = evaluate(spec.halfWidth, z) * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n);
    const y = spec.centreY + h * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n);
    return [x, y];
  };

  for (let i = 0; i < spec.stations; i++) {
    const t = i / (spec.stations - 1);
    const z = zAt(t);
    for (let j = 0; j < ringVerts; j++) {
      const v = j / ring;
      const [x, y] = point(z, thetaAt(v));
      positions.push(x, y, z);
      uvs.push(t, v);
    }
  }

  for (let i = 0; i < spec.stations - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ringVerts + j;
      const b = a + 1;
      const c = a + ringVerts;
      const d = b + ringVerts;
      indices.push(a, b, c, b, d, c);
    }
  }

  // End caps (fans) close the body; at a pointed end the ring has collapsed so the cap is tiny.
  const capCentre = (station: number, t: number): number => {
    positions.push(0, spec.centreY, positions[station * ringVerts * 3 + 2]!);
    uvs.push(t, 0.5);
    return positions.length / 3 - 1;
  };
  const front = capCentre(0, 0);
  const rearStart = (spec.stations - 1) * ringVerts;
  const rear = capCentre(spec.stations - 1, 1);
  for (let j = 0; j < ring; j++) {
    indices.push(front, j + 1, j);
    indices.push(rear, rearStart + j, rearStart + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Weld the seam's shading: both copies of each seam vertex share the averaged normal.
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < spec.stations; i++) {
    const first = i * ringVerts;
    const last = first + ring;
    n.set(
      normals.getX(first) + normals.getX(last),
      normals.getY(first) + normals.getY(last),
      normals.getZ(first) + normals.getZ(last),
    ).normalize();
    normals.setXYZ(first, n.x, n.y, n.z);
    normals.setXYZ(last, n.x, n.y, n.z);
  }

  // Paint the livery texel by texel from the colour function: crisp stripe edges at any mesh
  // resolution, and a DataTexture needs no DOM (so this runs in node tests too).
  const { along, around } = LIVERY_TEXELS;
  const data = new Uint8Array(along * around * 4);
  for (let pv = 0; pv < around; pv++) {
    const theta = thetaAt((pv + 0.5) / around);
    for (let pu = 0; pu < along; pu++) {
      const z = zAt((pu + 0.5) / along);
      const [x, y] = point(z, theta);
      const hex = spec.colour(x, y, z);
      const k = (pv * along + pu) * 4;
      data[k] = (hex >> 16) & 0xff;
      data[k + 1] = (hex >> 8) & 0xff;
      data[k + 2] = hex & 0xff;
      data[k + 3] = 0xff;
    }
  }
  const livery = new THREE.DataTexture(data, along, around, THREE.RGBAFormat);
  livery.colorSpace = THREE.SRGBColorSpace;
  livery.magFilter = THREE.LinearFilter;
  livery.minFilter = THREE.LinearMipmapLinearFilter;
  livery.generateMipmaps = true;
  livery.anisotropy = 4;
  livery.needsUpdate = true;

  return {
    geometry,
    livery,
    side(z, y) {
      const w = evaluate(spec.halfWidth, z);
      const dy = y - spec.centreY;
      const upper = dy >= 0;
      const h = evaluate(upper ? spec.top : spec.bottom, z);
      const n = upper ? spec.topExponent : spec.bottomExponent;
      const s = Math.min(Math.abs(dy) / h, 0.999);
      const x = w * Math.pow(1 - Math.pow(s, n), 1 / n);
      // Gradient of |x/w|^n + |dy/h|^n is the outward normal.
      const nx = Math.pow(x, n - 1) / Math.pow(w, n);
      const ny = Math.sign(dy) * Math.pow(Math.abs(dy), n - 1) / Math.pow(h, n);
      return { x, tilt: Math.atan2(ny, nx) };
    },
  };
}

// ---- Hull and cabin --------------------------------------------------------------------------

/** Below this line the flank is white; above it the yellow stripe sweeps back from the nose. */
const YELLOW_LINE: ReadonlyArray<readonly [number, number]> = [
  [NOSE_Z, -0.3],
  [-4, 0.3],
  [HULL_TAIL_Z, 0.6],
];
/** Above this line (aft of the nose) the deck under the cabin is the light-blue/teal band. */
const TEAL_LINE: ReadonlyArray<readonly [number, number]> = [
  [-5.5, HULL_TOP + 0.1],
  [-2, 0.95],
  [HULL_TAIL_Z, 0.95],
];
/** The dark oval recess on the forward flank. */
const RECESS = { z: -6.6, y: -0.75, halfLength: 3.9, halfHeight: 0.65 };

function hullColour(x: number, y: number, z: number): number {
  const rz = (z - RECESS.z) / RECESS.halfLength;
  const ry = (y - RECESS.y) / RECESS.halfHeight;
  if (Math.abs(x) > 0.3 && rz * rz + ry * ry < 1) return NAVY_RECESS;
  if (z > -5.5 && y > lerpTable(TEAL_LINE, z)) return TEAL;
  if (y > lerpTable(YELLOW_LINE, z)) return YELLOW;
  return WHITE;
}

function cabinColour(_x: number, y: number, z: number): number {
  if (y < CABIN_CENTRE_Y + 0.45) return TEAL; // skirt where the cabin meets the deck
  if (z < -3.4 && y > 2.2) return GLASS; // forward windscreen
  return CABIN_BLUE;
}

function createHull(): Loft {
  return loft({
    zStart: NOSE_Z,
    zEnd: HULL_TAIL_Z,
    stations: HULL_STATIONS,
    segments: HULL_SEGMENTS,
    centreY: 0,
    halfWidth: {
      max: HULL_HALF_WIDTH,
      front: { start: NOSE_Z, full: -3, power: 2.2, exponent: 0.45 },
      rear: { start: 3, end: HULL_TAIL_Z, min: 0.35 },
    },
    top: {
      max: HULL_TOP,
      front: { start: NOSE_Z, full: -2, power: 2.2, exponent: 0.7 },
      rear: { start: 4, end: HULL_TAIL_Z, min: 0.55 },
    },
    bottom: {
      max: HULL_BOTTOM,
      front: { start: NOSE_Z, full: -5, power: 2, exponent: 0.6 },
      rear: { start: 1, end: HULL_TAIL_Z, min: 0.25 },
    },
    topExponent: 3,
    bottomExponent: 2.2,
    colour: hullColour,
  });
}

function createCabin(): Loft {
  return loft({
    zStart: CABIN_START_Z,
    zEnd: CABIN_END_Z,
    stations: CABIN_STATIONS,
    segments: CABIN_SEGMENTS,
    centreY: CABIN_CENTRE_Y,
    halfWidth: {
      max: CABIN_HALF_WIDTH,
      front: { start: CABIN_START_Z, full: -3, power: 2, exponent: 0.4 },
      rear: { start: 3, end: CABIN_END_Z, min: 0.05 },
    },
    top: {
      max: CABIN_TOP,
      front: { start: CABIN_START_Z, full: -2.5, power: 2, exponent: 0.5 },
      rear: { start: 3, end: CABIN_END_Z, min: 0.2 },
    },
    bottom: { max: CABIN_BOTTOM },
    topExponent: 3,
    bottomExponent: 2,
    colour: cabinColour,
  });
}

// ---- Helpers ---------------------------------------------------------------------------------

type Side = 1 | -1;
const SIDES: readonly Side[] = [1, -1];

function standard(colour: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.15, ...extra });
}

/**
 * A holder on a loft's surface at (z, y) on one side, oriented so its local +X is the outward
 * normal (tilted about Z). Children placed at small +X sit just proud of the surface.
 */
function onSurface(body: Loft, side: Side, z: number, y: number): THREE.Object3D {
  const { x, tilt } = body.side(z, y);
  const holder = new THREE.Object3D();
  holder.position.set(side * x, y, z);
  // Euler XYZ applies Z first: +X tilts to (cos t, sin t); for port the Y half-turn then
  // flips it to (−cos t, sin t), the port-side outward normal.
  holder.rotation.z = tilt;
  if (side < 0) holder.rotation.y = Math.PI;
  return holder;
}

/** A shape drawn in (u, v) = (z, y), extruded across X and centred on x = 0. */
function verticalPlate(points: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
  });
  geometry.rotateY(-Math.PI / 2); // shape u → +Z, extrusion → −X
  geometry.translate(thickness / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** A planform drawn in (u, v) = (span, z), extruded down across Y; thin horizontal plane. */
function horizontalPlate(points: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2); // shape v → +Z, extrusion → −Y
  geometry.translate(0, thickness / 2, 0);
  return geometry;
}

/**
 * Text painted on a transparent canvas. Returns null outside a browser (no `document`, e.g. in
 * the node test run), in which case the decal is simply omitted.
 */
function textTexture(text: string, width: number, height: number, font: string, colour: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = colour;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A flat decal facing its holder's +X; reads left-to-right from outside on either side. */
function decal(texture: THREE.Texture, width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.3,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mesh.rotation.y = Math.PI / 2; // plane normal +Z → +X; text runs toward −Z (left, seen from +X)
  return mesh;
}

// ---- Parts -----------------------------------------------------------------------------------

function addWindows(group: THREE.Group, cabin: Loft): void {
  const glass = standard(GLASS, { roughness: 0.12, metalness: 0.4, emissive: 0x0b2236 });
  for (const side of SIDES) {
    for (const [z0, z1] of WINDOW_SPANS) {
      const holder = onSurface(cabin, side, (z0 + z1) / 2, WINDOW_Y);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.06, WINDOW_HEIGHT, z1 - z0), glass);
      pane.position.x = 0.02;
      holder.add(pane);
      group.add(holder);
    }
  }
}

function addDomeAndPeriscope(group: THREE.Group): void {
  const roofY = CABIN_CENTRE_Y + CABIN_TOP;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), standard(DOME_BLUE));
  dome.scale.set(1.1, 0.75, 1.9);
  dome.position.set(0, roofY - 0.15, DOME_Z);
  group.add(dome);

  const baseY = roofY + 0.45;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.6, 16), standard(TEAL));
  collar.position.set(0, baseY + 0.2, PERISCOPE_Z);
  group.add(collar);

  const mastLength = PERISCOPE_TOP_Y - baseY;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, mastLength, 12), standard(MAST_GREY, { metalness: 0.5 }));
  mast.position.set(0, baseY + mastLength / 2, PERISCOPE_Z);
  group.add(mast);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), standard(MAST_GREY, { metalness: 0.5 }));
  head.rotation.x = Math.PI / 2;
  head.position.set(0, PERISCOPE_TOP_Y + 0.1, PERISCOPE_Z - 0.1);
  group.add(head);

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), standard(GLASS, { roughness: 0.1, metalness: 0.6 }));
  lens.rotation.y = Math.PI; // faces −Z (forward)
  lens.position.set(0, PERISCOPE_TOP_Y + 0.1, PERISCOPE_Z - 0.41);
  group.add(lens);
}

/** The tall swept tail fin, rising from the cabin's rear and overhanging the drive. */
const TAIL_FIN: ReadonlyArray<readonly [number, number]> = [
  [2.6, 2.0],
  [6.0, 3.9],
  [7.4, 4.3],
  [11.0, 4.45],
  [10.5, 4.0],
  [9.0, 0.9],
  [5.0, 0.9],
];
const TAIL_FIN_THICKNESS = 0.3;

function addTailFin(group: THREE.Group): void {
  const fin = new THREE.Mesh(verticalPlate(TAIL_FIN, TAIL_FIN_THICKNESS), standard(CABIN_BLUE));
  fin.name = 'tailFin';
  group.add(fin);

  const texture = textTexture('3', 128, 128, 'italic bold 112px Arial, sans-serif', '#ffffff');
  if (!texture) return;
  for (const side of SIDES) {
    const holder = new THREE.Object3D();
    holder.position.set(side * (TAIL_FIN_THICKNESS / 2 + 0.07), 3.45, 8.8);
    if (side < 0) holder.rotation.y = Math.PI;
    holder.add(decal(texture, 1.1, 1.1));
    group.add(holder);
  }
}

function addLettering(group: THREE.Group, hull: Loft): void {
  const texture = textTexture('STINGRAY', 512, 96, 'bold 78px "Arial Black", Arial, sans-serif', LETTERING);
  if (!texture) return;
  for (const side of SIDES) {
    const holder = onSurface(hull, side, 0.3, -1.1);
    const label = decal(texture, 4.2, 0.79);
    label.position.x = 0.06;
    holder.add(label);
    group.add(holder);
  }
}

function addEyePods(group: THREE.Group, hull: Loft): void {
  const podMaterial = standard(CABIN_BLUE);
  const eyeMaterial = standard(GLASS, { roughness: 0.08, metalness: 0.5, emissive: 0x16304a });
  for (const side of SIDES) {
    const holder = onSurface(hull, side, 5.5, 0.3);
    const pod = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), podMaterial);
    pod.scale.set(0.25, 0.42, 0.9);
    holder.add(pod);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), eyeMaterial);
    eye.position.set(0.14, 0, 0);
    holder.add(eye);
    group.add(holder);
  }
}

/** Small swept hydroplanes, low on the hull ahead of the stern, drooping outward. */
const HYDROPLANE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5],
  [2.1, 3.6],
  [2.1, 5.6],
  [0, 4.5],
];
const HYDROPLANE_ROOT = { x: 1.9, y: -1.0 };
const HYDROPLANE_ANHEDRAL = (35 * Math.PI) / 180;

/** The large swept stern planes, passing outside the drive's radius. */
const STERN_PLANE_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [0, 5.5],
  [3.45, 11.3],
  [3.45, 12.6],
  [0, 8.6],
];
const STERN_PLANE_ROOT = { x: 0.85, y: -0.4 };

function addPlanes(group: THREE.Group): void {
  const hydroMaterial = standard(FIN_TEAL, { side: THREE.DoubleSide });
  const sternMaterial = standard(STERN_PLANE, { side: THREE.DoubleSide });
  for (const side of SIDES) {
    const mirror = (pts: ReadonlyArray<readonly [number, number]>) =>
      pts.map(([u, v]) => [side * u, v] as const);

    const hydro = new THREE.Mesh(horizontalPlate(mirror(HYDROPLANE), 0.12), hydroMaterial);
    hydro.name = 'hydroplane';
    hydro.position.set(side * HYDROPLANE_ROOT.x, HYDROPLANE_ROOT.y, 0);
    hydro.rotation.z = -side * HYDROPLANE_ANHEDRAL;
    group.add(hydro);

    const stern = new THREE.Mesh(horizontalPlate(mirror(STERN_PLANE_SHAPE), 0.14), sternMaterial);
    stern.name = 'sternPlane';
    stern.position.set(side * STERN_PLANE_ROOT.x, STERN_PLANE_ROOT.y, 0);
    group.add(stern);
  }
}

/** The ratchet drive: a pale ribbed drum on the hull axis, spun about Z. */
function createDrive(): THREE.Group {
  const drive = new THREE.Group();
  drive.name = 'ratchetDrive';
  drive.position.set(0, DRIVE_Y, DRIVE_FRONT_Z + DRIVE_LENGTH / 2);

  const cream = standard(DRIVE_CREAM, { emissive: 0x2a2614, roughness: 0.35 });
  const hub = standard(DRIVE_HUB, { metalness: 0.5 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(DRIVE_CORE_RADIUS, DRIVE_CORE_RADIUS, DRIVE_LENGTH, 20), [
    cream, // side
    hub, // +Y cap → rear after rotation
    cream, // −Y cap → front
  ]);
  core.rotation.x = Math.PI / 2;
  drive.add(core);

  const finMaterial = standard(DRIVE_FIN, { emissive: 0x2a2614, roughness: 0.35 });
  const finDepth = DRIVE_FIN_RADIUS - DRIVE_CORE_RADIUS + 0.1;
  const finGeometry = new THREE.BoxGeometry(0.14, finDepth, DRIVE_LENGTH * 0.94);
  for (let i = 0; i < DRIVE_FIN_COUNT; i++) {
    const a = (i / DRIVE_FIN_COUNT) * Math.PI * 2;
    const fin = new THREE.Mesh(finGeometry, finMaterial);
    const r = DRIVE_FIN_RADIUS - finDepth / 2;
    fin.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    fin.rotation.z = a - Math.PI / 2; // box's local +Y points radially out
    drive.add(fin);
  }

  const ringGeometry = new THREE.CylinderGeometry(DRIVE_FIN_RADIUS, DRIVE_FIN_RADIUS, 0.22, 24, 1, true);
  const ringMaterial = standard(DRIVE_CREAM, { side: THREE.DoubleSide, roughness: 0.35 });
  for (const z of [-DRIVE_LENGTH / 2 + 0.11, DRIVE_LENGTH / 2 - 0.11]) {
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = z;
    drive.add(ring);
  }
  return drive;
}

// ---- Assembly --------------------------------------------------------------------------------

export function createStingray(): StingrayModel {
  const group = new THREE.Group();
  group.name = 'stingray';

  const hull = createHull();
  const hullMesh = new THREE.Mesh(hull.geometry, standard(0xffffff, { map: hull.livery, roughness: 0.4, metalness: 0.1 }));
  hullMesh.name = 'hull';
  group.add(hullMesh);

  const cabin = createCabin();
  const cabinMesh = new THREE.Mesh(cabin.geometry, standard(0xffffff, { map: cabin.livery, roughness: 0.4, metalness: 0.1 }));
  cabinMesh.name = 'cabin';
  group.add(cabinMesh);

  addWindows(group, cabin);
  addDomeAndPeriscope(group);
  addTailFin(group);
  addLettering(group, hull);
  addEyePods(group, hull);
  addPlanes(group);

  const drive = createDrive();
  group.add(drive);

  return {
    group,
    drive,
    setDriveSpin(angleRadians) {
      drive.rotation.z = angleRadians;
    },
  };
}
