import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOMS } from '../sim/rooms';
import { CLIFF_TOP, COAST_Z } from '../sim/world';
import { mulberry32 } from './random';
import { ROOMS_EXTERIOR_NAME } from './rooms';

// Marineville on the clifftop, so that surfacing has a view — after the series' establishing
// shot: the control tower's orange and blue-grey harlequin drum on its flared support, three
// accommodation blocks banded with yellow balconies, two round pavilions behind white railings,
// long low wings with saw-tooth roofs, trees, a road down to the cliff edge and a parapet.
// It is seen from the sea a few hundred metres off, so silhouette and colour lead; finer detail
// is painted into a few canvas textures. Built in its own frame: y = 0 is the clifftop, −Z inland.

const ORANGE = [232, 98, 42] as const;
const BLUE_GREY = [185, 201, 214] as const;
const BALCONY_YELLOW = '#e9b52c';
const WINDOW_DARK = '#25333f';
const WHITE = 0xebe8e0;
const CONCRETE = 0xa7aaa8;
const PILOTI = 0x3e4246;
const ROOF_GREY = 0x8f9aa3;
const PAVING = 0xb9b6ac;
const ROAD = 0x6f7275;

const TOWER = { z: -150, stalkTop: 42, drumRadius: 13, drumBottom: 47, drumHeight: 20 };
const BLOCKS = { xs: [-40, 0, 40], z: -112, width: 34, height: 28, depth: 15, floors: 5 };
const PAVILIONS = { xs: [-82, 82], z: -58, radius: 21 };
const WINGS = { xs: [-160, 160], z: -120, length: 110, height: 11, depth: 22, gables: 9 };

// ---- Canvas textures (browser only; elsewhere the faces fall back to flat colour) ----

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The control drum's harlequin: diamonds of orange and blue-grey, `cols` around and `rows` up, wrapping seamlessly. */
function harlequin(cols: number, rows: number): THREE.Texture | null {
  const cell = 40;
  const w = cols * cell;
  const h = rows * cell;
  return canvasTexture(w, h, (ctx) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x + y) / cell);
        const b = Math.floor((x - y + h) / cell);
        const [r, g, bl] = (a + b) % 2 === 0 ? ORANGE : BLUE_GREY;
        const k = (y * w + x) * 4;
        image.data[k] = r;
        image.data[k + 1] = g;
        image.data[k + 2] = bl;
        image.data[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

/** A band of glazing: white mullions over blue glass, optionally over a row of coloured panels. */
function glazing(bays: number, glass: string, panel: string | null): THREE.Texture | null {
  const w = 32;
  return canvasTexture(bays * w, 64, (ctx) => {
    ctx.fillStyle = '#eef0ee';
    ctx.fillRect(0, 0, bays * w, 64);
    for (let b = 0; b < bays; b++) {
      ctx.fillStyle = glass;
      ctx.fillRect(b * w + 4, 8, w - 8, panel ? 26 : 48);
      if (panel) {
        ctx.fillStyle = panel;
        ctx.fillRect(b * w + 3, 38, w - 6, 20);
      }
    }
  });
}

/** An accommodation block's long face: floors of yellow balcony fronts under dark windows. */
function blockFacade(floors: number, bays: number): THREE.Texture | null {
  const bw = 48;
  const fh = 64;
  return canvasTexture(bays * bw, floors * fh, (ctx) => {
    ctx.fillStyle = '#f0ede4';
    ctx.fillRect(0, 0, bays * bw, floors * fh);
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      for (let b = 0; b < bays; b++) {
        const x = b * bw;
        ctx.fillStyle = WINDOW_DARK;
        ctx.fillRect(x + 5, y + 8, bw - 10, 30);
        ctx.fillStyle = 'rgba(160,200,225,0.35)'; // sky in the glass
        ctx.fillRect(x + 5, y + 8, bw - 10, 8);
        ctx.fillStyle = (b + f) % 3 === 0 ? '#f0c64a' : BALCONY_YELLOW;
        ctx.fillRect(x + 4, y + 38, bw - 8, 18);
      }
      ctx.fillStyle = '#d8d4c8';
      ctx.fillRect(0, y + 56, bays * bw, 8); // floor slab
    }
  });
}

/** A low wing's long face: a row of windows with the odd red door. */
function windowStrip(): THREE.Texture | null {
  return canvasTexture(256, 32, (ctx) => {
    ctx.fillStyle = '#efece4';
    ctx.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 16; i++) {
      const door = i % 5 === 2;
      ctx.fillStyle = door ? '#b8382c' : WINDOW_DARK;
      ctx.fillRect(i * 16 + 3, door ? 10 : 8, 10, door ? 22 : 12);
    }
  });
}

function lambert(colour: number, map: THREE.Texture | null = null): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: map ? 0xffffff : colour, map });
}

// ---- Buildings ----

function controlTower(white: THREE.Material, concrete: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const { drumRadius: r, drumBottom, drumHeight, stalkTop } = TOWER;

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6, stalkTop, 20), concrete);
  stalk.position.y = stalkTop / 2;
  group.add(stalk);
  // The flared support: a thin saucer opening out under the drum, dark beneath.
  const flareProfile: Array<[number, number]> = [
    [4.2, stalkTop - 8],
    [9, stalkTop + 1.2],
    [20, stalkTop + 3.2],
    [24, stalkTop + 3.6],
    [24, stalkTop + 4.2],
    [r, stalkTop + 4.6],
  ];
  const flare = new THREE.Mesh(
    new THREE.LatheGeometry(flareProfile.map(([x, y]) => new THREE.Vector2(x, y)), 40),
    new THREE.MeshLambertMaterial({ color: 0x9aa2a8, side: THREE.DoubleSide }),
  );
  group.add(flare);
  const flareRim = new THREE.Mesh(new THREE.CylinderGeometry(24.2, 24.2, 0.7, 40, 1, true), white);
  flareRim.position.y = stalkTop + 3.9;
  group.add(flareRim);

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, drumHeight, 48, 1, true), lambert(0xd88a5a, harlequin(18, 5)));
  drum.position.y = drumBottom + drumHeight / 2;
  group.add(drum);
  const sill = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.5, r + 0.5, 1, 48), white);
  sill.position.y = drumBottom;
  group.add(sill);

  // The glazed gallery on top, its roof, and the masts.
  const galleryHeight = 5;
  const galleryY = drumBottom + drumHeight;
  const gallery = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.4, r + 0.4, galleryHeight, 48, 1, true),
    lambert(0x9fc4dc, glazing(36, '#6f9cc0', null)),
  );
  gallery.position.y = galleryY + galleryHeight / 2;
  group.add(gallery);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.8, r + 0.8, 1.2, 48), white);
  band.position.y = galleryY;
  group.add(band);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(r - 2, r + 1, 1.6, 48), white);
  roof.position.y = galleryY + galleryHeight + 0.8;
  group.add(roof);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 9, 6), concrete);
  mast.position.set(3, galleryY + galleryHeight + 6, 0);
  group.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), white);
  dish.rotation.x = -Math.PI / 2.4;
  dish.position.set(-4, galleryY + galleryHeight + 2.6, 2);
  group.add(dish);

  group.add(roomsExterior(white, concrete));
  group.position.z = TOWER.z;
  return group;
}

/**
 * Phase 3 (M1 art; T4's rough-in, dressed by T5): what the tower's shell needs for Troy's rooms beyond the gallery,
 * dressed to match the tower — the enclosed bridge the corridor runs in, out of the gallery's north side and west,
 * white with a window band and a grey roof; the Standby Lounge's annexe north of the drum, a small drum of its own in
 * the tower's orange-and-blue-grey harlequin under a glazed band and a white roof (TV_marineville_exterior_01); and the
 * concrete column under the lounge's chair that leg 1 of the injector shaft runs down to the clifftop, with a flared
 * collar under the annexe echoing the tower's. Built in the tower's frame from sim/rooms.ts. render/rooms.ts hides it
 * while the camera is in the rooms (its faces would otherwise stand in the doorways); from outside it is seen only
 * round the back of the drum, inland of it.
 */
function roomsExterior(white: THREE.Material, concrete: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = ROOMS_EXTERIOR_NAME; // render/rooms.ts finds it by this name
  const oz = COAST_Z + TOWER.z; // world z of the tower's axis
  const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y - CLIFF_TOP, z - oz);
  const skin = 0.45; // m outside the room boxes (their own walls are 0.2)
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, at: THREE.Vector3) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(at);
    group.add(mesh);
    return mesh;
  };
  const slab = (min: THREE.Vector3, max: THREE.Vector3, material: THREE.Material) =>
    add(new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z), material, min.clone().add(max).multiplyScalar(0.5));
  const glazingNorth = -(TOWER.drumRadius - 2); // the bridge starts inside the gallery's glazing
  const roofGrey = lambert(ROOF_GREY);
  const glassBand = (bays: number) => lambert(0x9fc4dc, glazing(bays, '#6f9cc0', null));

  // The bridge: one white volume per corridor leg, a window band along it and a grey roof cap over it.
  const lounge = ROOMS.rooms.find((r) => r.id === 'lounge')!;
  for (const room of ROOMS.rooms) {
    if (room.id !== 'corridor') continue;
    const min = local(room.min.x - skin, room.min.y - skin - 0.6, room.min.z - skin);
    const max = local(room.max.x + skin, room.max.y + skin, room.max.z + skin);
    max.z = Math.min(max.z, glazingNorth);
    min.x = Math.max(min.x, local(lounge.max.x, 0, 0).x); // the west leg ends at the annexe
    slab(min, max, white);
    const y = room.min.y - CLIFF_TOP;
    const long = max.x - min.x > max.z - min.z ? 'x' : 'z';
    const length = long === 'x' ? max.x - min.x : max.z - min.z;
    const band = long === 'x'
      ? new THREE.BoxGeometry(length, 1.3, max.z - min.z + 0.1)
      : new THREE.BoxGeometry(max.x - min.x + 0.1, 1.3, length);
    add(band, glassBand(Math.max(2, Math.round(length / 1.6))), new THREE.Vector3((min.x + max.x) / 2, y + 1.65, (min.z + max.z) / 2));
    slab(new THREE.Vector3(min.x - 0.2, max.y, min.z - 0.2), new THREE.Vector3(max.x + 0.2, max.y + 0.3, max.z + 0.2), roofGrey);
    // A blue-grey fascia under the floor line, as the drum's lower edge.
    slab(new THREE.Vector3(min.x - 0.05, min.y, min.z - 0.05), new THREE.Vector3(max.x + 0.05, min.y + 0.35, max.z + 0.05), lambert(0xb9c9d6));
  }

  // The annexe: a drum round the lounge's box, harlequin below, a glazed band (on its south-west half, where the
  // lounge's windows are; white on the bay side), a white sill and cornice, a roof.
  const cx = (lounge.min.x + lounge.max.x) / 2;
  const cz = (lounge.min.z + lounge.max.z) / 2;
  const centre = local(cx, lounge.min.y, cz); // y: the lounge's floor
  const r = Math.hypot((lounge.max.x - lounge.min.x) / 2, (lounge.max.z - lounge.min.z) / 2) + skin;
  const skirt = 3.2; // m of harlequin under the floor
  const drumHeight = skirt + 1.3;
  const drum = add(new THREE.CylinderGeometry(r, r, drumHeight, 40, 1, true), lambert(0xd88a5a, harlequin(12, 3)),
    new THREE.Vector3(centre.x, centre.y - skirt + drumHeight / 2, centre.z));
  drum.name = 'annexe-drum';
  add(new THREE.CircleGeometry(r, 40).rotateX(Math.PI / 2), roofGrey, new THREE.Vector3(centre.x, centre.y - skirt, centre.z));
  add(new THREE.CylinderGeometry(r + 0.4, r + 0.4, 0.6, 40), white, new THREE.Vector3(centre.x, centre.y - skirt, centre.z));
  add(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.5, 40), white, new THREE.Vector3(centre.x, centre.y + 1.2, centre.z));
  // The band: glass facing south and west (θ = 0 is +z, south; −π/2 is −x, west), white panels the rest of the way.
  const bandY = centre.y + 1.45;
  const bandH = 2.3;
  const glassFrom = -Math.PI / 2 - 0.5;
  const glassLength = Math.PI / 2 + 1.1;
  add(new THREE.CylinderGeometry(r + 0.1, r + 0.1, bandH, 40, 1, true, glassFrom, glassLength), glassBand(14), new THREE.Vector3(centre.x, bandY + bandH / 2, centre.z));
  add(new THREE.CylinderGeometry(r + 0.1, r + 0.1, bandH, 40, 1, true, glassFrom + glassLength, Math.PI * 2 - glassLength), white, new THREE.Vector3(centre.x, bandY + bandH / 2, centre.z));
  const cornice = bandY + bandH;
  add(new THREE.CylinderGeometry(r + 0.5, r + 0.5, 0.9, 40), white, new THREE.Vector3(centre.x, cornice + 0.45, centre.z));
  add(new THREE.CylinderGeometry(r - 1.5, r + 0.3, 1.0, 40), white, new THREE.Vector3(centre.x, cornice + 1.4, centre.z));

  // The column under the chair (leg 1 of the shaft): concrete, from the clifftop to a flared collar under the annexe.
  const chair = ROOMS.chair.pos;
  const foot = local(chair.x, CLIFF_TOP, chair.z);
  const underside = centre.y - skirt;
  const height = underside - 3 - foot.y;
  add(new THREE.CylinderGeometry(2.4, 2.9, height, 24), concrete, new THREE.Vector3(foot.x, foot.y + height / 2, foot.z));
  const collar = new THREE.LatheGeometry([
    new THREE.Vector2(2.4, 0), new THREE.Vector2(3.4, 1.8), new THREE.Vector2(5.2, 2.8), new THREE.Vector2(5.2, 3.0), new THREE.Vector2(2.4, 3.0),
  ], 32);
  add(collar, new THREE.MeshLambertMaterial({ color: 0x9aa2a8, side: THREE.DoubleSide }), new THREE.Vector3(foot.x, underside - 3, foot.z));
  return group;
}

function accommodationBlock(white: THREE.Material, facade: THREE.Material, roof: THREE.Material): THREE.Group {
  const { width, height, depth, floors } = BLOCKS;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [white, white, roof, roof, facade, facade]);
  body.position.y = height / 2 + 2;
  group.add(body);
  // A recessed ground floor, as on the model.
  const base = new THREE.Mesh(new THREE.BoxGeometry(width - 3, 2, depth - 3), new THREE.MeshLambertMaterial({ color: PILOTI }));
  base.position.y = 1;
  group.add(base);
  // Balcony slabs proud of the long faces at each floor, and white end fins.
  const ledges: THREE.BufferGeometry[] = [];
  for (let f = 0; f <= floors; f++) {
    const ledge = new THREE.BoxGeometry(width + 0.8, 0.45, depth + 2.2);
    ledge.translate(0, 2 + (f * height) / floors, 0);
    ledges.push(ledge);
  }
  for (const side of [-1, 1]) {
    const fin = new THREE.BoxGeometry(0.8, height + 1, depth + 2.4);
    fin.translate((side * (width + 0.8)) / 2, 2 + height / 2, 0);
    ledges.push(fin);
  }
  group.add(new THREE.Mesh(mergeGeometries(ledges), white));
  const plant = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), roof);
  plant.position.set(width * 0.2, height + 3.5, 0);
  group.add(plant);
  return group;
}

/** A round pavilion: dark pilotis under a white deck with a railing, a glazed upper ring and a roof. */
function pavilion(white: THREE.Material, glazed: THREE.Material, withDome: boolean): THREE.Group {
  const group = new THREE.Group();
  const r = PAVILIONS.radius;

  const core = new THREE.Mesh(new THREE.CylinderGeometry(r - 7, r - 7, 6, 32), new THREE.MeshLambertMaterial({ color: PILOTI }));
  core.position.y = 3;
  group.add(core);
  const pillars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const pillar = new THREE.BoxGeometry(1.4, 6, 1.4);
    pillar.translate(Math.cos(a) * (r - 3), 3, Math.sin(a) * (r - 3));
    pillars.push(pillar);
  }
  group.add(new THREE.Mesh(mergeGeometries(pillars), lambert(0x8a8f92)));

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.5, r, 1.6, 48), white);
  deck.position.y = 6.8;
  group.add(deck);
  // The railing: two rails on posts around the deck's edge.
  const rail: THREE.BufferGeometry[] = [];
  for (const y of [8.3, 9.2]) {
    const ring = new THREE.TorusGeometry(r + 1.2, 0.12, 4, 64);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    rail.push(ring);
  }
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const post = new THREE.BoxGeometry(0.18, 1.7, 0.18);
    post.translate(Math.cos(a) * (r + 1.2), 8.4, Math.sin(a) * (r + 1.2));
    rail.push(post);
  }
  group.add(new THREE.Mesh(mergeGeometries(rail), white));

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(r - 4, r - 4, 5.5, 40, 1, true), glazed);
  upper.position.y = 7.6 + 2.75;
  group.add(upper);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(r - 2.5, r - 3.5, 1.2, 40), white);
  roof.position.y = 13.7;
  group.add(roof);
  if (withDome) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
    dome.scale.y = 0.7;
    dome.position.y = 14.3;
    group.add(dome);
  }
  return group;
}

/** A long low wing with a saw-tooth roofline of gables. */
function wing(white: THREE.Material, strip: THREE.Material, roof: THREE.Material): THREE.Group {
  const { length, height, depth, gables } = WINGS;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), [white, white, roof, white, strip, strip]);
  body.position.y = height / 2;
  group.add(body);
  const step = length / gables;
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(step, 0), new THREE.Vector2(step, 5.5)]);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < gables; i++) {
    const gable = new THREE.ExtrudeGeometry(shape, { depth: depth - 2, bevelEnabled: false });
    gable.translate(-length / 2 + i * step, height, -(depth - 2) / 2);
    parts.push(gable);
  }
  group.add(new THREE.Mesh(mergeGeometries(parts), roof));
  return group;
}

// ---- Grounds ----

function grounds(white: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(150, 0.3, 110), lambert(PAVING));
  plaza.position.set(0, 0.15, -100);
  group.add(plaza);
  const road = new THREE.Mesh(new THREE.BoxGeometry(12, 0.35, 50), lambert(ROAD));
  road.position.set(0, 0.18, -26);
  group.add(road);

  // Low white kerbs either side of the road.
  const walls: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const kerb = new THREE.BoxGeometry(1, 1, 46);
    kerb.translate(side * 7.5, 0.5, -28);
    walls.push(kerb);
  }
  group.add(new THREE.Mesh(mergeGeometries(walls), white));
  return group;
}

const TREE_COUNT = 70;

function clearOfBuildings(x: number, z: number): boolean {
  if (Math.abs(x) < 70 && z < -85 && z > -175) return false;
  if (Math.abs(x) < 12 && z > -60) return false;
  if (PAVILIONS.xs.some((px) => Math.hypot(x - px, z - PAVILIONS.z) < PAVILIONS.radius + 5)) return false;
  return !(Math.abs(Math.abs(x) - 160) < 58 && Math.abs(z - WINGS.z) < 14);
}

/** Round-crowned trees and a few poplars, instanced. */
function trees(): THREE.Group {
  const rand = mulberry32(0x1964);
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunk.translate(0, 0.5, 0);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), TREE_COUNT);
  const trunks = new THREE.InstancedMesh(trunk, lambert(0x5a4632), TREE_COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let n = 0; n < TREE_COUNT; ) {
    const x = (rand() * 2 - 1) * 230;
    const z = -8 - rand() * 190;
    if (!clearOfBuildings(x, z)) continue;
    const poplar = rand() < 0.25;
    const h = poplar ? 9 + rand() * 5 : 4 + rand() * 4;
    const w = poplar ? 1.8 + rand() : 3 + rand() * 2.5;
    trunks.setMatrixAt(n, m.compose(p.set(x, 0, z), q, s.set(1, h * 0.45, 1)));
    crowns.setMatrixAt(n, m.compose(p.set(x, h * 0.45 + (poplar ? h * 0.35 : w * 0.7), z), q, s.set(w, poplar ? h * 0.45 : w * 0.85, w)));
    crowns.setColorAt(n, tint.setHSL(0.24 + rand() * 0.08, 0.45 + rand() * 0.2, 0.26 + rand() * 0.12));
    n++;
  }
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return group;
}

export function createMarineville(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'marineville';
  const white = lambert(WHITE);
  const roof = lambert(ROOF_GREY);

  group.add(controlTower(white, lambert(CONCRETE)));

  const facade = lambert(0xe2c27a, blockFacade(BLOCKS.floors, 7));
  for (const x of BLOCKS.xs) {
    const block = accommodationBlock(white, facade, roof);
    block.position.set(x, 0, BLOCKS.z);
    group.add(block);
  }

  const glazed = lambert(0xd9b043, glazing(30, '#3e6b8c', BALCONY_YELLOW));
  PAVILIONS.xs.forEach((x, i) => {
    const p = pavilion(white, glazed, i === 1);
    p.position.set(x, 0, PAVILIONS.z);
    group.add(p);
  });

  const strip = lambert(WHITE, windowStrip());
  for (const x of WINGS.xs) {
    const w = wing(white, strip, roof);
    w.position.set(x, 0, WINGS.z);
    group.add(w);
  }

  group.add(grounds(white), trees());
  group.position.set(0, CLIFF_TOP, COAST_Z);
  return group;
}
