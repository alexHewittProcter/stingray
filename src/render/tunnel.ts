import * as THREE from 'three';
import { COAST_Z, type Interior } from '../sim/world';
import { cameraIndoors, makeInteriorMaterial } from './indoors';
import { DOOR_RING_DEPTH, type OceanDoor, beaconLevel, createOceanDoor } from './ocean-door';
import { Parts, bar, box } from './parts';
import { hazardTexture } from './pen-textures';
import { type TunnelPath, createTunnelPath } from './tunnel-path';
import { SECTION_ATLAS, boreWallTexture, sectionAtlasTexture } from './tunnel-textures';

// The launch tunnel (phase 2, L6), after the reference pack's interpretation notes ("restrained Marineville
// industrial design: repeating ribs, conduits, service lighting, occasional numbered sections"): a round, flooded
// bore swept along L1's centreline from the back of the ocean door's ring to Pen 3's south wall.
//
//   - The bore wall is the interior's shell (userData.interiorShell): a mitred tube about the centreline polyline,
//     its chords kept outside the drawn radius, so what you see is what you hit (interior.test.ts).
//   - Dressing inside it — ribs every BAY metres, service lamps on every rib, conduits and cable runs along the
//     upper walls, a walkway with a railing along the east side, the numbered section boards counting down to the
//     door — is not solid; L1 keeps the hull centre 5 m off the centreline.
//   - The ocean door (ocean-door.ts) is part of the tunnel: its ring, iris and beacons are always drawn (they are
//     the cliff's from the sea); the bore and its dressing are culled when the camera could not see them.
//
// Lighting: every lit material is an interior one (no sun, sky or caustics). The lamps are self-lit lenses with
// additive glows that the water absorbs; a few real point lights follow the camera from lamp to lamp, so the walls
// round the craft are lit in pools. The lights are in the scene from the start (intensity 0 when unused), so the
// scene's light count never changes.

const BAY = 7; // m between ribs
const SEGMENTS_ROUND = 48;
/** The wall's drawn radius: chords between the ring's vertices stay outside the bore's 13 m. */
const wallRadius = (r: number) => r / Math.cos(Math.PI / SEGMENTS_ROUND) + 0.01;
const RIB = { inner: 12.15, halfWidth: 0.45 };
const LAMP_STATION = 2 * BAY; // the real lights move between every other rib's lamp
const LIGHTS = 4;
const LIGHT_INTENSITY = 170; // candela
const LIGHT_RANGE = 46; // m: three's cut-off distance
const FLOOD_INTENSITY = 240; // candela: the door chamber's flood
/** How far out to sea the bore may still be seen through an open door. */
const SEEN_FROM = 600;

const DEG = Math.PI / 180;
const PIPES: ReadonlyArray<{ angle: number; radius: number; colour: number; name: string }> = [
  { angle: 49 * DEG, radius: 0.5, colour: 0xb5301d, name: 'red' },
  { angle: 55 * DEG, radius: 0.32, colour: 0xc9cdd0, name: 'silver' },
  { angle: 59.5 * DEG, radius: 0.32, colour: 0xc9cdd0, name: 'silver' },
  { angle: -50 * DEG, radius: 0.55, colour: 0x3c6c9a, name: 'blue' },
  { angle: -56.5 * DEG, radius: 0.3, colour: 0xd8a722, name: 'yellow' },
  { angle: -61 * DEG, radius: 0.16, colour: 0x1f2224, name: 'cable' },
  { angle: -63 * DEG, radius: 0.16, colour: 0x1f2224, name: 'cable' },
];
const PIPE_CENTRE = 11.55; // m from the axis: just inside the ribs' inner face
const BOARD = { angle: 80 * DEG, span: 18 * DEG, length: 5.4, radius: 12.96 };
const SIDE_LAMP_ANGLE = 100 * DEG;
const WALKWAY = { side: -10.85, up: -5.9, width: 1.7, thick: 0.25, rail: 1.1 };

export interface TunnelView {
  /** Interpolated door travel, 0 shut … 1 open. */
  door: number;
  /** The door is moving (its beacons flash). */
  doorMoving: boolean;
}

export interface Tunnel {
  /** Add this to the scene: the bore (culled), the door (always) and the tunnel's lights (always present). */
  readonly root: THREE.Group;
  /** The bore and its dressing: hidden when the camera could not see it. */
  readonly bore: THREE.Group;
  readonly door: OceanDoor;
  readonly path: TunnelPath;
  update(camera: THREE.Camera, view: TunnelView, timeSeconds: number): void;
}

// ---- Materials ----

const lambert = (colour: number, name: string, extra: THREE.MeshLambertMaterialParameters = {}) =>
  makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: colour, name, ...extra }));
const phong = (colour: number, name: string, shininess = 50) =>
  makeInteriorMaterial(new THREE.MeshPhongMaterial({ color: colour, name, shininess, specular: 0x555555 }));

// ---- The bore wall ----

/**
 * The wall: a tube about each segment of the centreline, the rings at the polyline's corners on the mitre plane
 * (the bisector), so every vertex is on the cylinder of each segment it bounds. u runs round from the crown toward
 * the path's `side`, v along the tunnel in bays.
 */
function boreWall(path: TunnelPath, s0: number, s1: number, radius: number): THREE.BufferGeometry {
  // The two ends are cut square to the world's z axis: flush with the back of the door's ring and with the pen's
  // south wall (the centreline's last segment is not quite square to it).
  const endPlane = new THREE.Vector3(0, 0, -1);
  // Ring stations: s0, every polyline corner between, s1 — with long straights split to BAY.
  const stations: number[] = [];
  const corners = path.segments.map((seg) => seg.s).filter((s) => s > s0 && s < s1);
  const marks = [s0, ...corners, s1];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i]!;
    const b = marks[i + 1]!;
    const n = Math.max(1, Math.ceil((b - a) / BAY));
    for (let k = 0; k < n; k++) stations.push(a + ((b - a) * k) / n);
  }
  stations.push(s1);

  const n = SEGMENTS_ROUND;
  const pos: number[] = [];
  const uv: number[] = [];
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  const r = wallRadius(radius);
  for (const s of stations) {
    const seg = path.segmentAt(Math.min(s, path.length - 1e-6));
    const corner = path.segments.find((g) => Math.abs(g.s - s) < 1e-6 && g !== path.segments[0]);
    const prev = corner ? path.segments[path.segments.indexOf(corner) - 1]! : null;
    path.pointAt(s, c);
    // The incoming segment's cylinder, cut by the corner's bisector plane (or square across a straight).
    const along = prev ?? seg;
    const end = s === s0 || s === s1;
    const normal = end ? endPlane : prev ? prev.dir.clone().add(seg.dir).normalize() : seg.dir;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      p.copy(c).addScaledVector(along.up, Math.cos(a) * r).addScaledVector(along.side, Math.sin(a) * r);
      // Slide along the incoming axis onto the mitre plane through the corner.
      const t = -p.clone().sub(c).dot(normal) / along.dir.dot(normal);
      p.addScaledVector(along.dir, t);
      pos.push(p.x, p.y, p.z);
      uv.push(i / n, s / BAY);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < stations.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + n + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A ring of square section about the axis (local XY plane, axis +Z): r from inner to outer, z ± half. */
function annulus(inner: number, outer: number, half: number, segments = SEGMENTS_ROUND): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry([
    new THREE.Vector2(outer, -half), new THREE.Vector2(inner, -half), new THREE.Vector2(inner, half),
    new THREE.Vector2(outer, half), new THREE.Vector2(outer, -half),
  ], segments);
  g.rotateX(Math.PI / 2);
  return g.toNonIndexed();
}

/** Arc lengths of every rib, from just behind the door's ring to just short of the pen wall. */
function ribStations(s0: number, s1: number): number[] {
  const out: number[] = [];
  for (let s = s0 + BAY / 2; s < s1 - 1; s += BAY) out.push(s);
  return out;
}

// ---- Dressing ----

/** Ribs: one instanced ring per rib, steel grey; those in the door chamber and either end hazard-yellow. */
function ribs(path: TunnelPath, stations: number[], chamberEnd: number): THREE.InstancedMesh {
  const geometry = annulus(RIB.inner, 12.98, RIB.halfWidth);
  const mesh = new THREE.InstancedMesh(geometry, phong(0xffffff, 'tunnel-rib', 30), stations.length);
  mesh.name = 'tunnel:ribs';
  const m = new THREE.Matrix4();
  const steel = new THREE.Color(0x737a80);
  const yellow = new THREE.Color(0xc79a22);
  stations.forEach((s, i) => {
    mesh.setMatrixAt(i, path.frameMatrix(s, 0, m));
    const hazard = s < chamberEnd ? i % 2 === 0 : i % 8 === 0;
    mesh.setColorAt(i, hazard ? yellow : steel);
  });
  return mesh;
}

/** Points along the tunnel at a fixed angle and radius, every `step` metres from s0 to s1. */
function runPoints(path: TunnelPath, s0: number, s1: number, angle: number, r: number, step = BAY / 2): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const n = Math.max(2, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) out.push(path.wallPoint(s0 + ((s1 - s0) * i) / n, angle, r));
  return out;
}

/** A pipe swept along the wall: a tube through points sampled along the path. */
function pipe(path: TunnelPath, s0: number, s1: number, angle: number, radius: number): THREE.BufferGeometry {
  const points = runPoints(path, s0, s1, angle, PIPE_CENTRE - (0.55 - radius));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, points.length * 2, radius, 8, false);
}

/** Conduits, their brackets on every rib, the walkway and its railing, lamp housings: merged per material. */
function dressing(path: TunnelPath, ribsAt: number[], s0: number, s1: number): { group: THREE.Group; lampSpots: { s: number; angle: number }[] } {
  const parts = new Parts();
  const mats = new Map<string, THREE.Material>();
  const mat = (colour: number, name: string, shininess = 40) => {
    const key = `${name}`;
    if (!mats.has(key)) mats.set(key, phong(colour, `tunnel-${name}`, shininess));
    return mats.get(key)!;
  };

  for (const p of PIPES) parts.add(mat(p.colour, `pipe-${p.name}`, p.name === 'silver' ? 80 : 30), pipe(path, s0 + 0.5, s1 - 0.5, p.angle, p.radius));

  // Brackets: a dark strap from each rib's inner face over each pipe group.
  const bracket = mat(0x2c3034, 'bracket', 20);
  const housing = mat(0x3a3f44, 'lamp-housing', 30);
  const m = new THREE.Matrix4();
  const lampSpots: { s: number; angle: number }[] = [];
  ribsAt.forEach((s, i) => {
    for (const [a0, a1] of [[46 * DEG, 62 * DEG], [-65 * DEG, -47 * DEG]] as const) {
      for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / 3) {
        const g = box(0.25, 1.1, 0.5, { x: 0, y: RIB.inner - 0.45, z: 0 });
        g.applyMatrix4(path.frameMatrix(s, a, m));
        parts.add(bracket, g);
      }
    }
    // A lamp at the crown of every rib, and a service lamp low on alternate walls every other rib.
    const crown = box(0.55, 0.9, 1.5, { x: 0, y: 12.5, z: BAY / 2 - 1.4 });
    crown.applyMatrix4(path.frameMatrix(s, 0, m));
    parts.add(housing, crown);
    lampSpots.push({ s: s + BAY / 2 - 1.4, angle: 0 });
    if (i % 2 === 0) {
      const a = (i % 4 === 0 ? 1 : -1) * SIDE_LAMP_ANGLE;
      const side = box(0.9, 0.9, 1.4, { x: 0, y: 12.75, z: BAY / 2 });
      side.applyMatrix4(path.frameMatrix(s, a, m));
      parts.add(housing, side);
      lampSpots.push({ s: s + BAY / 2, angle: a });
    }
  });

  // The walkway: a level steel deck along the east wall, brackets under it, a yellow railing on its open side.
  const deck = mat(0x5a5f62, 'deck', 10);
  const rail = mat(0xd8a722, 'rail', 30);
  const level = (s: number, side: number, up: number) => {
    const seg = path.segmentAt(s);
    return path.pointAt(s).addScaledVector(seg.up, up).addScaledVector(seg.side, side);
  };
  const deckRun = (side: number, up: number, w: number, h: number) => {
    for (let s = s0 + 2; s < s1 - 2; s += BAY) {
      const e = Math.min(s + BAY, s1 - 2);
      const g = bar(level(s, side, up), level(e, side, up), w, h);
      parts.add(deck, g);
    }
  };
  deckRun(WALKWAY.side, WALKWAY.up, WALKWAY.width, WALKWAY.thick);
  const edge = WALKWAY.side + WALKWAY.width / 2 - 0.1;
  for (const s of ribsAt) {
    parts.add(rail, bar(level(s, edge, WALKWAY.up), level(s, edge, WALKWAY.up + WALKWAY.rail), 0.12));
    parts.add(deck, bar(level(s, WALKWAY.side - 0.6, WALKWAY.up - 0.15), level(s, WALKWAY.side - 0.6, WALKWAY.up - 2.2), 0.3));
  }
  for (const h of [WALKWAY.rail, WALKWAY.rail / 2]) {
    for (let s = s0 + 2; s < s1 - 2; s += BAY) {
      const e = Math.min(s + BAY, s1 - 2);
      parts.add(rail, bar(level(s, edge, WALKWAY.up + h), level(e, edge, WALKWAY.up + h), 0.08));
    }
  }

  return { group: parts.build('tunnel-dressing'), lampSpots };
}

/** A curved board on the wall: a patch of the bore, `length` along the tunnel and `span` round it. */
function boardPatch(path: TunnelPath, s: number, angle: number, cell: number, flip: boolean): THREE.BufferGeometry {
  const { cols, rows } = SECTION_ATLAS;
  const u0 = (cell % cols) / cols;
  const v1 = 1 - Math.floor(cell / cols) / rows;
  const v0 = v1 - 1 / rows;
  const nA = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nA; j++) {
    // From the board's lower edge (further from the crown) to its upper edge.
    const t = j / nA;
    const a = Math.sign(angle) * (Math.abs(angle) + BOARD.span / 2 - BOARD.span * t);
    for (let i = 0; i <= 1; i++) {
      const along = s - BOARD.length / 2 + BOARD.length * i;
      path.wallPoint(along, a, BOARD.radius, p);
      pos.push(p.x, p.y, p.z);
      // Read left to right from inside: toward +dir on the `side` wall (angle > 0), toward −dir on the other.
      const u = flip ? 1 - i : i;
      uv.push(u0 + u / cols, v0 + t / rows);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nA; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The section boards: 10 … 1 counting down toward the door, the door chamber's board and Pen 3's. */
function boards(path: TunnelPath, s0: number, s1: number): THREE.Mesh {
  const pieces: THREE.BufferGeometry[] = [];
  const bayCentre = (k: number) => s0 + BAY + BAY * k;
  const bays = Math.floor((s1 - s0 - BAY) / BAY);
  const place = (s: number, cell: number) => {
    for (const side of [1, -1]) pieces.push(boardPatch(path, s, side * BOARD.angle, cell, side < 0));
  };
  place(bayCentre(0), 10); // OCEAN DOOR
  for (let n = 1; n <= 10; n++) place(bayCentre(2 + 3 * (n - 1)), n - 1);
  place(bayCentre(bays - 1), 11); // PEN 3
  const merged = new Parts();
  const atlas = sectionAtlasTexture();
  const material = lambert(atlas ? 0xffffff : 0x24292d, 'tunnel-boards', {
    map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  });
  merged.add(material, ...pieces);
  const mesh = merged.build('tunnel-boards').children[0] as THREE.Mesh;
  mesh.renderOrder = 1;
  return mesh;
}

// ---- Lamps: lenses, glows and the travelling lights ----

const GLOW_VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  attribute float flash;
  uniform float uScale;
  uniform float uFlash;
  uniform float uVisibility;
  varying vec3 vColour;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    // The water swallows the glow with distance, as it does every lit surface.
    float transmit = exp(-d * 2.1 / max(uVisibility, 1.0));
    float on = mix(1.0, uFlash, flash);
    vColour = tint * transmit * on;
    gl_PointSize = min(size * uScale / max(-mv.z, 0.5), 256.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColour;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).r;
    gl_FragColor = vec4(vColour * a, 1.0);
  }
`;

interface Glows {
  points: THREE.Points;
  update(camera: THREE.Camera, flash: number, visibility: number): void;
}

function glows(spots: { pos: THREE.Vector3; size: number; tint: THREE.Color; flash: boolean }[]): Glows {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(spots.flatMap((s) => [s.pos.x, s.pos.y, s.pos.z]), 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(spots.map((s) => s.size), 1));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(spots.flatMap((s) => [s.tint.r, s.tint.g, s.tint.b]), 3));
  g.setAttribute('flash', new THREE.Float32BufferAttribute(spots.map((s) => (s.flash ? 1 : 0)), 1));
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  let map: THREE.Texture;
  if (canvas) {
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(160,160,160,1)');
    grad.addColorStop(0.5, 'rgba(40,40,40,1)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    map = new THREE.CanvasTexture(canvas);
  } else {
    map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    map.needsUpdate = true;
  }
  const uniforms = { uScale: { value: 400 }, uFlash: { value: 1 }, uVisibility: { value: 300 }, uMap: { value: map } };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, material);
  points.name = 'tunnel:glows';
  points.renderOrder = 2;
  return {
    points,
    update(camera, flash, visibility) {
      const cam = camera as THREE.PerspectiveCamera;
      // Pixels across for a 1 m glow 1 m away: drawing-buffer height over the view's height at unit distance.
      const height = typeof window === 'undefined' ? 720 : window.innerHeight * Math.min(window.devicePixelRatio, 2);
      uniforms.uScale.value = height / (2 * Math.tan(((cam.fov ?? 58) * DEG) / 2));
      uniforms.uFlash.value = flash;
      uniforms.uVisibility.value = visibility;
    },
  };
}

// ---- Assembly ----

export function createTunnel(interior: Interior): Tunnel {
  const root = new THREE.Group();
  root.name = 'tunnel';
  const bore = new THREE.Group();
  bore.name = 'tunnel-bore';
  root.add(bore);

  const path = createTunnelPath(interior.tunnel.centreline);
  const mouth = interior.tunnel.centreline[0]!;
  const s0 = DOOR_RING_DEPTH; // the door's ring fills the bore's first metres, through the cliff's slab
  const s1 = path.length; // the pen's south wall
  const chamberEnd = path.segments[1]?.s ?? 70;

  // The wall: the interior's shell.
  const wallMap = boreWallTexture();
  const wall = new THREE.Mesh(
    boreWall(path, s0, s1, interior.tunnel.radius),
    lambert(wallMap ? 0xffffff : 0x8e918b, 'tunnel-wall', { map: wallMap, side: THREE.DoubleSide }),
  );
  wall.name = 'tunnel:wall';
  wall.userData.interiorShell = true;
  bore.add(wall);

  // Flanges where the bore meets the door's ring and the pen's wall: they cover the small step between radii.
  const hazard = hazardTexture();
  if (hazard) hazard.repeat.set(40, 1);
  const flangeMaterial = lambert(hazard ? 0xffffff : 0xd8a722, 'tunnel-flange', { map: hazard });
  const flanges = new Parts();
  const m = new THREE.Matrix4();
  flanges.add(flangeMaterial, annulus(12.3, 13.4, 0.35).applyMatrix4(path.frameMatrix(s0 + 0.35, 0, m)));
  flanges.add(flangeMaterial, annulus(12.3, 13.4, 0.35).applyMatrix4(path.frameMatrix(s1 - 0.35, 0, m)));
  bore.add(flanges.build('tunnel-flanges'));

  const ribsAt = ribStations(s0, s1);
  bore.add(ribs(path, ribsAt, chamberEnd));
  const dressed = dressing(path, ribsAt, s0, s1);
  bore.add(dressed.group, boards(path, s0, s1));

  // Lamp lenses (self-lit, instanced) and their glows; the chamber's warning beacons behind the door.
  const lens = new THREE.MeshBasicMaterial({ name: 'tunnel-lens' });
  lens.color.setRGB(2.4, 2.2, 1.8);
  const lensGeometry = new THREE.BoxGeometry(0.42, 0.06, 1.3);
  const lenses = new THREE.InstancedMesh(lensGeometry, lens, dressed.lampSpots.length);
  lenses.name = 'tunnel:lenses';
  const warm = new THREE.Color(1.0, 0.86, 0.62);
  const cool = new THREE.Color(0.7, 0.85, 1.0);
  const spots: Parameters<typeof glows>[0] = [];
  dressed.lampSpots.forEach((spot, i) => {
    const r = spot.angle === 0 ? 12.03 : 12.28;
    const mm = path.frameMatrix(spot.s, spot.angle, m).clone().multiply(new THREE.Matrix4().makeTranslation(0, r, 0));
    lenses.setMatrixAt(i, mm);
    lenses.setColorAt(i, spot.angle === 0 ? warm : cool);
    spots.push({ pos: path.wallPoint(spot.s, spot.angle, r - 0.3), size: spot.angle === 0 ? 2.6 : 2.0, tint: spot.angle === 0 ? warm.clone().multiplyScalar(0.5) : cool.clone().multiplyScalar(0.45), flash: false });
  });
  bore.add(lenses);

  const beaconMaterial = new THREE.MeshBasicMaterial({ name: 'tunnel-beacon' });
  const beaconHousing = lambert(0x3a3f44, 'tunnel-beacon-housing');
  const beaconParts = new Parts();
  const beaconLenses = new Parts();
  const amber = new THREE.Color(1.0, 0.62, 0.12);
  for (const [s, a] of [[s0 + 1.6, 50], [s0 + 1.6, -50], [s0 + 1.6, 130], [s0 + 1.6, -130], [chamberEnd - 3, 60], [chamberEnd - 3, -60]] as const) {
    const frame = path.frameMatrix(s, a * DEG, new THREE.Matrix4());
    beaconParts.add(beaconHousing, new THREE.CylinderGeometry(0.75, 0.9, 0.7, 12).translate(0, 12.55, 0).applyMatrix4(frame));
    beaconLenses.add(beaconMaterial, new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI).translate(0, 12.2, 0).applyMatrix4(frame));
    spots.push({ pos: path.wallPoint(s, a * DEG, 11.8), size: 7, tint: amber, flash: true });
  }
  bore.add(beaconParts.build('tunnel-beacons'), beaconLenses.build('tunnel-beacon-lenses'));

  const glow = glows(spots);
  bore.add(glow.points);

  // The travelling lights: LIGHTS point lights, each owning every LIGHTS-th lamp station; each sits on the station of
  // its own that is nearest the view's focus and fades out toward the edge of its reach, so none ever pops.
  const lights = new THREE.Group();
  lights.name = 'tunnel-lights';
  const lamps: THREE.PointLight[] = [];
  for (let i = 0; i < LIGHTS; i++) {
    const lamp = new THREE.PointLight(0xffe6c4, 0, LIGHT_RANGE, 2);
    lamps.push(lamp);
    lights.add(lamp);
  }
  // A flood in the door chamber, on whenever the bore is drawn: the door is lit from inside while the player waits
  // and watches it open, and the chamber shows lit from the sea through the open door.
  const flood = new THREE.PointLight(0xfff0dc, 0, LIGHT_RANGE, 2);
  path.wallPoint(s0 + 9, 0, 5, flood.position);
  lights.add(flood);
  root.add(lights);
  const stationS = (k: number) => s0 + BAY / 2 + k * LAMP_STATION;
  const stations = Math.floor((s1 - s0 - BAY / 2) / LAMP_STATION) + 1;

  const door = createOceanDoor(mouth);
  root.add(door.group);

  const focus = new THREE.Vector3();
  const look = new THREE.Vector3();
  return {
    root,
    bore,
    door,
    path,
    update(camera, view, time) {
      door.update(view.door, view.doorMoving, time);
      const indoors = cameraIndoors(camera.position);
      const toMouth = camera.position.distanceTo(focus.set(mouth.x, mouth.y, mouth.z));
      // L6: drawn whenever it could be seen — from inside, or from the sea through a door that is not shut.
      const visible = indoors || (view.door > 0 && toMouth < SEEN_FROM && camera.position.z > COAST_Z);
      bore.visible = visible;
      if (!visible) {
        for (const lamp of lamps) lamp.intensity = 0;
        flood.intensity = 0;
        return;
      }
      flood.intensity = FLOOD_INTENSITY;
      // The view's focus along the tunnel: a little ahead of the camera, the way it looks.
      camera.getWorldDirection(look);
      const sCam = path.project(camera.position);
      const seg = path.segmentAt(THREE.MathUtils.clamp(sCam, 0, s1));
      const ahead = look.dot(seg.dir) >= 0 ? 1 : -1;
      const sFocus = THREE.MathUtils.clamp(indoors ? sCam + ahead * 14 : s0 + 10, s0, s1);
      const reach = (LIGHTS * LAMP_STATION) / 2;
      for (let i = 0; i < LIGHTS; i++) {
        // This light's stations are k ≡ i (mod LIGHTS); take the one nearest the focus.
        const kNear = Math.round((sFocus - stationS(i)) / (LIGHTS * LAMP_STATION));
        const k = THREE.MathUtils.clamp(i + kNear * LIGHTS, 0, stations - 1);
        const s = stationS(k);
        const d = Math.abs(s - sFocus) / reach;
        const fade = 1 - THREE.MathUtils.smoothstep(d, 0.55, 1);
        path.wallPoint(s, 0, 4, lamps[i]!.position); // under the crown lamp, near the axis: even pools on both walls
        lamps[i]!.intensity = LIGHT_INTENSITY * fade;
      }
      const fog = (root.parent as THREE.Scene | null)?.fog;
      const visibility = fog instanceof THREE.Fog ? fog.far : 300;
      // The chamber's beacons: dim and steady while the door is still, flashing with the outside beacons while it moves.
      const flash = view.doorMoving ? beaconLevel(true, time) : 0.25;
      beaconMaterial.color.copy(amber).multiplyScalar(0.4 + 1.6 * flash);
      glow.update(camera, flash, visibility);
    },
  };
}
