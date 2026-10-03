import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Stingray, built from code. Visible appearance follows the TV frames (silver-grey lower hull,
// yellow stripe, light-blue deck, navy cabin, tall blue tail fin with the "3"); hidden geometry
// (the plan view, the twin swept fins, the stern) follows the licensed top view and the side art
// in goals/testbed-stingray/references/.
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
const HULL_STATIONS = 104;
const HULL_SEGMENTS = 72;

const CABIN_START_Z = -5.2;
const CABIN_END_Z = 8.5;
const CABIN_CENTRE_Y = 1.45;
const CABIN_HALF_WIDTH = 1.6;
const CABIN_TOP = 1.75; // roof at y ≈ 3.2
const CABIN_BOTTOM = 0.8; // buried in the hull
const CABIN_STATIONS = 56;
const CABIN_SEGMENTS = 48;

const DRIVE_FRONT_Z = 9.1;
const DRIVE_LENGTH = STERN_Z - DRIVE_FRONT_Z;
const DRIVE_Y = 0.35;
const DRIVE_CORE_RADIUS = 1.42;
const DRIVE_FIN_RADIUS = 2.0;
const DRIVE_FIN_COUNT = 12;
const DRIVE_VANE_COUNT = 9;

const WINDOW_Y = 2.6;
const WINDOW_HEIGHT = 0.46;
const WINDOW_SPANS: ReadonlyArray<readonly [number, number]> = [
  [-2.8, -0.1],
  [0.1, 1.1],
  [1.3, 2.4],
  [2.6, 3.7],
  [3.9, 4.9],
];
/** White pinstripes along the cabin, either side of the window band. */
const CABIN_PINSTRIPES = [WINDOW_Y + 0.4, WINDOW_Y - 0.38, CABIN_CENTRE_Y + 0.5];
const PINSTRIPE_HALF = 0.035;

const DOME_Z = -1.6;
const PERISCOPE_Z = -1.0;
const PERISCOPE_TOP_Y = 7.1;

// ---- Colours ---------------------------------------------------------------------------------

/** The lower hull: silver with a blue cast, as the TV model reads (whiter than the TV, so it stays readable in blue water). */
const SILVER = 0xc6cfd8;
const SILVER_KEEL = 0x8f9daf;
const PANEL_LINE = 0x7c8794;
const YELLOW = 0xf0c419;
const LIGHT_BLUE = 0x5db7dc;
const NAVY_PIN = 0x14285a;
const NAVY_RECESS = 0x0b1b3c;
const CABIN_BLUE = 0x1c3c88;
const FIN_BLUE = 0x2752a6;
const DOME_BLUE = 0x4ea8da;
const PIN_WHITE = 0xeef3f6;
const GLASS = 0x0d1a2a;
const DRIVE_PEARL = 0xe9e5d3;
const DRIVE_FIN = 0xf3efdf;
const DRIVE_DISH = 0x9ea6ae;
const METAL = 0xb9c2cb;
const WINDOW_FRAME = 0x7d8896;
const DARK_METAL = 0x2a323c;
const EXHAUST_GLOW = 0x7fd8ff;
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

function mixHex(a: number, b: number, t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  const ch = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
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
  /** Surface height for the bump map, 0 (an engraved panel line) to 1 (the skin). */
  relief?(x: number, y: number, z: number): number;
}

interface Loft {
  geometry: THREE.BufferGeometry;
  /** The paint scheme, UV-mapped (u along the length, v around the girth). */
  livery: THREE.Texture;
  /** Engraved panel lines, on the same UVs; null when the spec has no relief. */
  bump: THREE.Texture | null;
  /** The surface point on the starboard side at (z, y), plus the outward normal's tilt from +X about Z. */
  side(z: number, y: number): { x: number; tilt: number };
}

/** Livery texture resolution per body: texels along the length × around the girth. */
const LIVERY_TEXELS = { along: 1024, around: 512 };

function dataTexture(data: Uint8Array<ArrayBuffer>, width: number, height: number, srgb: boolean): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

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
  const paint = new Uint8Array(along * around * 4);
  const relief = spec.relief ? new Uint8Array(along * around * 4) : null;
  for (let pv = 0; pv < around; pv++) {
    const theta = thetaAt((pv + 0.5) / around);
    for (let pu = 0; pu < along; pu++) {
      const z = zAt((pu + 0.5) / along);
      const [x, y] = point(z, theta);
      const hex = spec.colour(x, y, z);
      const k = (pv * along + pu) * 4;
      paint[k] = (hex >> 16) & 0xff;
      paint[k + 1] = (hex >> 8) & 0xff;
      paint[k + 2] = hex & 0xff;
      paint[k + 3] = 0xff;
      if (relief && spec.relief) {
        const h = Math.round(spec.relief(x, y, z) * 255);
        relief[k] = relief[k + 1] = relief[k + 2] = h;
        relief[k + 3] = 0xff;
      }
    }
  }

  return {
    geometry,
    livery: dataTexture(paint, along, around, true),
    bump: relief ? dataTexture(relief, along, around, false) : null,
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

/** Below this line the flank is silver; above it the yellow stripe sweeps back from the nose. */
const YELLOW_LINE: ReadonlyArray<readonly [number, number]> = [
  [NOSE_Z, -0.3],
  [-4, 0.3],
  [HULL_TAIL_Z, 0.6],
];
/** The navy pinstripe under the yellow, then the light-blue band beneath it (the TV close-up). */
const UNDER_STRIPE = { pin: 0.07, band: 0.3 };
/** Above this line (aft of the nose) the deck under the cabin is the light-blue band. */
const DECK_LINE: ReadonlyArray<readonly [number, number]> = [
  [-5.5, HULL_TOP + 0.1],
  [-2, 0.95],
  [HULL_TAIL_Z, 0.95],
];
/** The dark oval recess on the forward flank, with a light-blue lip. */
const RECESS = { z: -6.6, y: -0.75, halfLength: 3.9, halfHeight: 0.65, lip: 0.16 };
/** Hull panel seams: frames at these stations, and one long seam low on the flank. */
const PANEL_FRAMES = [-9.6, -2.4, 3.1, 7.2];
const PANEL_SEAM_Y = -1.55;
const PANEL_LINE_HALF = 0.03;

function recessDistance(y: number, z: number): number {
  const rz = (z - RECESS.z) / RECESS.halfLength;
  const ry = (y - RECESS.y) / RECESS.halfHeight;
  return Math.sqrt(rz * rz + ry * ry);
}

function onPanelLine(x: number, y: number, z: number, yellowY: number): boolean {
  if (y > yellowY - UNDER_STRIPE.band || Math.abs(x) < 0.2) return false;
  if (Math.abs(y - PANEL_SEAM_Y) < PANEL_LINE_HALF && z > -10.5 && z < 9) return true;
  return z > -11 && PANEL_FRAMES.some((f) => Math.abs(z - f) < PANEL_LINE_HALF);
}

function hullColour(x: number, y: number, z: number): number {
  const recess = recessDistance(y, z);
  if (Math.abs(x) > 0.3 && recess < 1) return NAVY_RECESS;
  if (Math.abs(x) > 0.3 && recess < 1 + RECESS.lip) return LIGHT_BLUE;
  if (z > -5.5 && y > lerpTable(DECK_LINE, z)) return LIGHT_BLUE;
  const yellowY = lerpTable(YELLOW_LINE, z);
  if (y > yellowY) return YELLOW;
  if (y > yellowY - UNDER_STRIPE.pin) return NAVY_PIN;
  if (y > yellowY - UNDER_STRIPE.band) return LIGHT_BLUE;
  if (onPanelLine(x, y, z, yellowY)) return PANEL_LINE;
  // Silver, darkening toward the keel the way the TV model's underside falls into shadow.
  return mixHex(SILVER, SILVER_KEEL, (-0.8 - y) / 1.4);
}

function hullRelief(x: number, y: number, z: number): number {
  const recess = recessDistance(y, z);
  if (Math.abs(x) > 0.3 && recess < 1) return 0.35; // the recess sits back from the skin
  return onPanelLine(x, y, z, lerpTable(YELLOW_LINE, z)) ? 0 : 1;
}

function cabinColour(_x: number, y: number, z: number): number {
  if (CABIN_PINSTRIPES.some((p) => Math.abs(y - p) < PINSTRIPE_HALF) && z > -4.2) return PIN_WHITE;
  if (y < CABIN_CENTRE_Y + 0.5) return LIGHT_BLUE; // skirt where the cabin meets the deck
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
    relief: hullRelief,
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

/** The model's shared paint and metal finishes. */
function createFinishes() {
  return {
    metal: standard(METAL, { roughness: 0.3, metalness: 0.55 }),
    frame: standard(WINDOW_FRAME, { roughness: 0.4, metalness: 0.5 }),
    darkMetal: standard(DARK_METAL, { roughness: 0.5, metalness: 0.4 }),
    lightBlue: standard(LIGHT_BLUE, { roughness: 0.4 }),
    cabinBlue: standard(CABIN_BLUE, { roughness: 0.35 }),
    finBlue: standard(FIN_BLUE, { roughness: 0.4 }),
    silver: standard(SILVER, { roughness: 0.32, metalness: 0.35 }),
    recess: standard(NAVY_RECESS, { roughness: 0.6 }),
  };
}
type Finishes = ReturnType<typeof createFinishes>;

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
function verticalPlate(points: ReadonlyArray<readonly [number, number]>, thickness: number, bevel = 0.05): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geometry.rotateY(-Math.PI / 2); // shape u → +Z, extrusion → −X
  geometry.translate(thickness / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** A planform drawn in (u, v) = (span, z), extruded down across Y; a thin horizontal plane. */
function horizontalPlate(points: ReadonlyArray<readonly [number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: thickness * 0.5,
    bevelSegments: 1,
  });
  geometry.rotateX(Math.PI / 2); // shape v → +Z, extrusion → −Y
  geometry.translate(0, thickness / 2, 0);
  return geometry;
}

const mirrored = (points: ReadonlyArray<readonly [number, number]>, side: Side) =>
  points.map(([u, v]) => [side * u, v] as const);

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

/**
 * The cabin glass: dark blue with a pale reflection streak and the faint shapes of the crew
 * seats and lit consoles behind it. Painted into a DataTexture so it needs no DOM.
 */
function windowTexture(): THREE.DataTexture {
  const W = 96;
  const H = 24;
  const data = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H; // 0 at the bottom of the pane
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      let colour = mixHex(0x0a1626, 0x1d3550, v); // glass, lighter toward the top
      if (Math.abs(((u * 7) % 1) - 0.5) < 0.16 && v < 0.55) colour = mixHex(colour, 0x7a2a26, 0.55); // seat backs
      if (v < 0.22 && (u * 13) % 1 < 0.5) colour = mixHex(colour, 0xd8b05a, 0.45); // console lamps
      if (Math.abs(u * 0.6 + v - 0.9) < 0.05) colour = mixHex(colour, 0xbfd9ea, 0.55); // a reflection streak
      const k = (py * W + px) * 4;
      data[k] = (colour >> 16) & 0xff;
      data[k + 1] = (colour >> 8) & 0xff;
      data[k + 2] = colour & 0xff;
      data[k + 3] = 0xff;
    }
  }
  return dataTexture(data, W, H, true);
}

function addWindows(group: THREE.Group, cabin: Loft, f: Finishes): void {
  const interior = windowTexture();
  const glass = standard(0xffffff, { map: interior, roughness: 0.1, metalness: 0.3, emissive: 0x2a3c50, emissiveMap: interior });
  for (const side of SIDES) {
    for (const [z0, z1] of WINDOW_SPANS) {
      const holder = onSurface(cabin, side, (z0 + z1) / 2, WINDOW_Y);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, WINDOW_HEIGHT + 0.1, z1 - z0 + 0.1), f.frame);
      holder.add(frame);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.06, WINDOW_HEIGHT, z1 - z0), glass);
      pane.position.x = 0.03;
      holder.add(pane);
      group.add(holder);
    }
  }
}

/** The light-blue hatch dome behind the windscreen, its bezel, and the periscope rising from it. */
function addDomeAndPeriscope(group: THREE.Group, f: Finishes): void {
  const roofY = CABIN_CENTRE_Y + CABIN_TOP;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), standard(DOME_BLUE, { roughness: 0.3 }));
  dome.scale.set(1.1, 0.8, 1.9);
  dome.position.set(0, roofY - 0.15, DOME_Z);
  group.add(dome);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), f.metal);
  bezel.rotation.x = Math.PI / 2;
  bezel.scale.set(1.12, 1.92, 1);
  bezel.position.set(0, roofY - 0.1, DOME_Z);
  group.add(bezel);
  const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 24), f.cabinBlue);
  hatch.rotation.x = Math.PI / 2;
  hatch.scale.set(1, 1.5, 1);
  hatch.position.set(0, roofY + 0.5, DOME_Z - 0.95);
  group.add(hatch);

  // Periscope: a flared light-blue collar, a banded mast and a forward-looking head.
  const baseY = roofY + 0.5;
  const collar = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0.48, 0), new THREE.Vector2(0.36, 0.25), new THREE.Vector2(0.24, 0.62), new THREE.Vector2(0.2, 0.7)], 16),
    f.lightBlue,
  );
  collar.position.set(0, baseY - 0.05, PERISCOPE_Z);
  group.add(collar);

  const mastLength = PERISCOPE_TOP_Y - baseY;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, mastLength, 12), f.metal);
  mast.position.set(0, baseY + mastLength / 2, PERISCOPE_Z);
  group.add(mast);
  const bandGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12);
  for (const y of [baseY + 1.0, baseY + 2.2]) {
    const band = new THREE.Mesh(bandGeometry, f.darkMetal);
    band.position.set(0, y, PERISCOPE_Z);
    group.add(band);
  }

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.75, 14), f.metal);
  head.position.set(0, PERISCOPE_TOP_Y + 0.15, PERISCOPE_Z);
  group.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), f.metal);
  cap.position.set(0, PERISCOPE_TOP_Y + 0.52, PERISCOPE_Z);
  group.add(cap);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.3), f.metal);
  hood.position.set(0, PERISCOPE_TOP_Y + 0.2, PERISCOPE_Z - 0.26);
  group.add(hood);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), standard(GLASS, { roughness: 0.05, metalness: 0.6, emissive: 0x1a3550 }));
  lens.rotation.y = Math.PI; // faces −Z (forward)
  lens.position.set(0, PERISCOPE_TOP_Y + 0.2, PERISCOPE_Z - 0.42);
  group.add(lens);
}

/** The tall swept tail fin, rising from the cabin's rear and overhanging the drive. */
const TAIL_FIN: ReadonlyArray<readonly [number, number]> = [
  [3.4, 2.9],
  [5.6, 4.25],
  [7.0, 5.15],
  [8.2, 5.4],
  [11.4, 5.55],
  [11.0, 5.15],
  [9.6, 2.6],
  [9.0, 1.0],
  [5.0, 1.0],
];
const TAIL_FIN_THICKNESS = 0.32;
/** The white pinstripe along the fin's leading and top edges. */
const TAIL_FIN_EDGE: ReadonlyArray<readonly [number, number]> = [
  [3.6, 3.15], [5.6, 4.4], [7.0, 5.3], [8.2, 5.55], [11.2, 5.6], [8.2, 5.45], [7.0, 5.2], [5.6, 4.3],
];

/**
 * The twin light-blue fins above the cabin's rear (the side art's swept light-blue piece and the
 * plan view's V): drawn in (z, height above the root), canted outboard.
 */
const TWIN_FIN: ReadonlyArray<readonly [number, number]> = [
  [1.4, 0],
  [3.4, 0.55],
  [5.6, 1.35],
  [7.4, 2.05],
  [7.0, 1.55],
  [6.6, 0.5],
  [6.4, -0.7],
  [4.0, -0.35],
];
const TWIN_FIN_ROOT = { x: 0.62, y: 3.05 };
const TWIN_FIN_CANT = 0.42; // radians outboard of vertical

function addFins(group: THREE.Group, f: Finishes): void {
  const fin = new THREE.Mesh(verticalPlate(TAIL_FIN, TAIL_FIN_THICKNESS, 0.06), f.finBlue);
  fin.name = 'tailFin';
  group.add(fin);
  group.add(new THREE.Mesh(verticalPlate(TAIL_FIN_EDGE, TAIL_FIN_THICKNESS + 0.06, 0), standard(PIN_WHITE)));

  const twinGeometry = verticalPlate(TWIN_FIN, 0.18, 0.05);
  for (const side of SIDES) {
    const twin = new THREE.Mesh(twinGeometry, f.lightBlue);
    twin.name = 'twinFin';
    twin.position.set(side * TWIN_FIN_ROOT.x, TWIN_FIN_ROOT.y, 0);
    twin.rotation.z = -side * TWIN_FIN_CANT;
    group.add(twin);
  }

  const texture = textTexture('3', 128, 128, 'italic bold 116px Arial, sans-serif', '#ffffff');
  if (!texture) return;
  for (const side of SIDES) {
    const holder = new THREE.Object3D();
    holder.position.set(side * (TAIL_FIN_THICKNESS / 2 + 0.08), 3.75, 8.3);
    if (side < 0) holder.rotation.y = Math.PI;
    holder.add(decal(texture, 1.7, 1.7));
    group.add(holder);
  }
}

function addLettering(group: THREE.Group, hull: Loft): void {
  const texture = textTexture('STINGRAY', 512, 96, 'bold 80px "Arial Black", Arial, sans-serif', LETTERING);
  if (!texture) return;
  for (const side of SIDES) {
    const holder = onSurface(hull, side, 0.4, -0.55);
    const label = decal(texture, 4.4, 0.83);
    label.position.x = 0.06;
    holder.add(label);
    group.add(holder);
  }
}

/** The "eye" pods aft on the flanks: navy lozenges carrying a lamp in a chrome bezel, with a gill slot below. */
function addEyePods(group: THREE.Group, hull: Loft, f: Finishes): void {
  const podGeometry = new THREE.SphereGeometry(1, 20, 12);
  const eyeGeometry = new THREE.SphereGeometry(0.24, 14, 8);
  const eyeMaterial = standard(0xcfe9ff, { roughness: 0.05, metalness: 0.3, emissive: 0x4b86b0 });
  const bezelGeometry = new THREE.TorusGeometry(0.26, 0.05, 6, 20);
  const gillGeometry = new THREE.SphereGeometry(1, 12, 6);
  for (const side of SIDES) {
    const holder = onSurface(hull, side, 5.2, 0.55);
    const pod = new THREE.Mesh(podGeometry, f.cabinBlue);
    pod.scale.set(0.28, 0.42, 1.05);
    holder.add(pod);
    const bezel = new THREE.Mesh(bezelGeometry, f.metal);
    bezel.rotation.y = Math.PI / 2;
    bezel.position.set(0.2, 0, -0.15);
    holder.add(bezel);
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.scale.x = 0.7;
    eye.position.set(0.17, 0, -0.15);
    holder.add(eye);
    group.add(holder);

    const gillHolder = onSurface(hull, side, 5.6, -0.65);
    const gill = new THREE.Mesh(gillGeometry, f.recess);
    gill.scale.set(0.08, 0.14, 0.55);
    gill.rotation.x = -0.25;
    gillHolder.add(gill);
    group.add(gillHolder);
  }
}

/** Find the nose surface's z at a given (x, y): the first station whose cross-section reaches x. */
function noseSurfaceZ(hull: Loft, x: number, y: number): number {
  let lo = NOSE_Z;
  let hi = -6;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (hull.side(mid, y).x < x) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Twin missile ports either side of the nose tip, each a dark bore in a chrome ring. */
const PORT = { x: 0.42, y: -0.4 };

function addMissilePorts(group: THREE.Group, hull: Loft, f: Finishes): void {
  const bore = new THREE.CircleGeometry(0.2, 14);
  const rim = new THREE.TorusGeometry(0.21, 0.055, 6, 16);
  const boreMaterial = standard(0x05080d, { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const side of SIDES) {
    const z = noseSurfaceZ(hull, PORT.x, PORT.y);
    const ahead = noseSurfaceZ(hull, PORT.x + 0.1, PORT.y);
    const holder = new THREE.Object3D();
    holder.position.set(side * PORT.x, PORT.y, z - 0.02);
    // Face forward, turned outboard to follow the nose's curve.
    holder.rotation.y = Math.PI - side * Math.atan2(ahead - z, 0.1);
    holder.add(new THREE.Mesh(bore, boreMaterial));
    const ring = new THREE.Mesh(rim, f.metal);
    ring.position.z = 0.02;
    holder.add(ring);
    group.add(holder);
  }
}

/** Small swept hydroplanes, low on the hull ahead of the stern, drooping outward, each with a chrome rod at the tip. */
const HYDROPLANE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5],
  [2.1, 3.6],
  [2.25, 5.6],
  [0, 4.5],
];
const HYDROPLANE_ROOT = { x: 1.9, y: -1.0 };
const HYDROPLANE_ANHEDRAL = (35 * Math.PI) / 180;

/** The large swept stern planes, like a ray's tail flukes, passing outside the drive's radius. */
const STERN_PLANE_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [0, 6.0],
  [1.6, 8.2],
  [3.0, 10.6],
  [3.65, 11.9],
  [3.75, 12.85],
  [3.2, 12.4],
  [1.4, 10.6],
  [0, 9.6],
];
const STERN_PLANE_ROOT = { x: 0.85, y: -0.45 };
const STERN_PLANE_DIHEDRAL = 0.05;
const STERN_WINGLET: ReadonlyArray<readonly [number, number]> = [[11.9, 0], [12.9, 0.05], [12.9, 0.75], [12.3, 0.3]];

function addPlanes(group: THREE.Group, f: Finishes): void {
  const rodGeometry = new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8);
  rodGeometry.rotateX(Math.PI / 2);
  const winglet = verticalPlate(STERN_WINGLET, 0.1, 0.03);
  for (const side of SIDES) {
    const hydro = new THREE.Mesh(horizontalPlate(mirrored(HYDROPLANE, side), 0.12), f.lightBlue);
    hydro.name = 'hydroplane';
    hydro.position.set(side * HYDROPLANE_ROOT.x, HYDROPLANE_ROOT.y, 0);
    hydro.rotation.z = -side * HYDROPLANE_ANHEDRAL;
    const rod = new THREE.Mesh(rodGeometry, f.metal);
    rod.position.set(side * 2.2, 0, 4.9);
    hydro.add(rod);
    group.add(hydro);

    const stern = new THREE.Mesh(horizontalPlate(mirrored(STERN_PLANE_SHAPE, side), 0.14), f.silver);
    stern.name = 'sternPlane';
    stern.position.set(side * STERN_PLANE_ROOT.x, STERN_PLANE_ROOT.y, 0);
    stern.rotation.z = side * STERN_PLANE_DIHEDRAL;
    const tip = new THREE.Mesh(winglet, f.lightBlue);
    tip.position.x = side * 3.55;
    stern.add(tip);
    group.add(stern);
  }
}

/** Light-blue collar fairing the hull's tail into the front of the drive. */
function addDriveCollar(group: THREE.Group, f: Finishes): void {
  const collar = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(0.95, -0.9), new THREE.Vector2(1.18, -0.35), new THREE.Vector2(1.25, 0.1), new THREE.Vector2(1.05, 0.25)],
      28,
    ),
    f.lightBlue,
  );
  collar.rotation.x = Math.PI / 2; // lathe +Y → +Z: the wide end meets the drive
  collar.position.set(0, DRIVE_Y, DRIVE_FRONT_Z - 0.2);
  group.add(collar);
}

/**
 * One ratchet-drive rib: drawn in (r, z) — rising from a faired front, running the drum's
 * length and curling down into the rear dish — then turned so r is local +Y and z is local +Z.
 * Each rib object sits RIB_ORIGIN off the axis, so it visibly travels as the drive turns.
 */
const RIB_ORIGIN = 1.7;
const RIB_THICKNESS = 0.2;

function ribGeometry(): THREE.BufferGeometry {
  const h = DRIVE_LENGTH / 2;
  const shape = new THREE.Shape();
  shape.moveTo(1.3, -h + 0.15);
  shape.quadraticCurveTo(1.55, -h, DRIVE_FIN_RADIUS - 0.15, -h + 0.85);
  shape.lineTo(DRIVE_FIN_RADIUS, h - 1.1);
  shape.quadraticCurveTo(DRIVE_FIN_RADIUS + 0.02, h - 0.1, 1.45, h - 0.05);
  shape.lineTo(1.15, h - 0.25);
  shape.lineTo(1.3, -h + 0.15);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: RIB_THICKNESS,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  // (r, z, extrusion) → (extrusion, r, z): r becomes radial +Y, the extrusion the tangent.
  geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(-RIB_THICKNESS / 2, -RIB_ORIGIN, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** The stator vanes in the drive's rear dish, twisted like a turbine's, as one merged geometry. */
function vaneGeometry(rearZ: number): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const vanes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DRIVE_VANE_COUNT; i++) {
    const a = ((i + 0.5) / DRIVE_VANE_COUNT) * Math.PI * 2;
    const vane = new THREE.BoxGeometry(0.06, 0.55, 0.3);
    e.set(0, 0.6, a - Math.PI / 2, 'ZYX');
    vane.applyMatrix4(m.compose(p.set(Math.cos(a) * 0.82, Math.sin(a) * 0.82, rearZ - 0.3), q.setFromEuler(e), s));
    vanes.push(vane);
  }
  return mergeGeometries(vanes);
}

/**
 * The ratchet drive: a pearl drum crowned with curling ribs. Its rear face — what the chase camera
 * sees — is a dished stator of twisted vanes around a dark exhaust throat with a lit inner ring.
 */
function createDrive(): THREE.Group {
  const drive = new THREE.Group();
  drive.name = 'ratchetDrive';
  drive.position.set(0, DRIVE_Y, DRIVE_FRONT_Z + DRIVE_LENGTH / 2);
  const h = DRIVE_LENGTH / 2;

  // The drum and its rear dish in one lathe: (radius, z) from the faired front into the throat.
  const profile: Array<[number, number]> = [
    [0.9, -h],
    [1.25, -h + 0.25],
    [DRIVE_CORE_RADIUS, -h + 0.7],
    [DRIVE_CORE_RADIUS, h - 0.45],
    [1.36, h - 0.12],
    [1.22, h],
    [1.08, h - 0.08],
    [0.8, h - 0.42],
    [0.58, h - 0.46],
    [0.5, h - 0.3],
    [0.42, h - 0.12],
    [0.34, h - 0.12],
    [0.3, h - 0.4],
  ];
  const lathe = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 36);
  lathe.rotateX(Math.PI / 2); // lathe +Y → +Z (toward the stern)
  const core = new THREE.Mesh(lathe, standard(DRIVE_PEARL, { emissive: 0x2a2818, roughness: 0.3, metalness: 0.1 }));
  core.name = 'driveCore';
  drive.add(core); // children[0]

  const ribMaterial = standard(DRIVE_FIN, { emissive: 0x2c2a1c, roughness: 0.28, metalness: 0.08 });
  const rib = ribGeometry();
  for (let i = 0; i < DRIVE_FIN_COUNT; i++) {
    const a = (i / DRIVE_FIN_COUNT) * Math.PI * 2;
    const fin = new THREE.Mesh(rib, ribMaterial);
    fin.position.set(Math.cos(a) * RIB_ORIGIN, Math.sin(a) * RIB_ORIGIN, 0);
    fin.rotation.z = a - Math.PI / 2; // local +Y points radially out
    drive.add(fin); // children[1..]
  }

  const dishMetal = standard(DRIVE_DISH, { metalness: 0.5, roughness: 0.35 });
  drive.add(new THREE.Mesh(vaneGeometry(h), dishMetal));

  // The exhaust throat: dark inside, with a pale lit ring where the jet leaves.
  const throat = new THREE.Mesh(new THREE.CircleGeometry(0.31, 20), standard(0x05090f, { roughness: 1 }));
  throat.position.z = h - 0.38;
  drive.add(throat);
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.27, 20), new THREE.MeshBasicMaterial({ color: EXHAUST_GLOW }));
  glow.position.z = h - 0.36;
  drive.add(glow);

  // Bands: a chrome hoop over the ribs' front, and the rear rim.
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.07, 6, 40), standard(METAL, { roughness: 0.3, metalness: 0.55 }));
  hoop.position.z = -h + 0.55;
  drive.add(hoop);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 40), dishMetal);
  rim.position.z = h - 0.07;
  drive.add(rim);
  return drive;
}

// ---- Assembly --------------------------------------------------------------------------------

export function createStingray(): StingrayModel {
  const group = new THREE.Group();
  group.name = 'stingray';
  const finishes = createFinishes();

  const hull = createHull();
  const hullMesh = new THREE.Mesh(
    hull.geometry,
    standard(0xffffff, { map: hull.livery, bumpMap: hull.bump, bumpScale: 1.5, roughness: 0.34, metalness: 0.28 }),
  );
  hullMesh.name = 'hull';
  group.add(hullMesh);

  const cabin = createCabin();
  const cabinMesh = new THREE.Mesh(cabin.geometry, standard(0xffffff, { map: cabin.livery, roughness: 0.3, metalness: 0.15 }));
  cabinMesh.name = 'cabin';
  group.add(cabinMesh);

  addWindows(group, cabin, finishes);
  addDomeAndPeriscope(group, finishes);
  addFins(group, finishes);
  addLettering(group, hull);
  addEyePods(group, hull, finishes);
  addMissilePorts(group, hull, finishes);
  addPlanes(group, finishes);
  addDriveCollar(group, finishes);

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
