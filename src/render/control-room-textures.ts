import * as THREE from 'three';
import { mulberry32 } from './random';

// The WASP control room's painted surfaces (phase 3, T4 — M1 art), drawn on canvases in code (no image files), after
// 02_MARINEVILLE_CONTROL_ROOM/: the tiled floor with its red bands, the perforated grey wall behind the World
// Videophone, and one decal atlas holding everything flat that is painted on a prop or a wall — the world map, the
// Videophone's sunburst panel, the locator compass's dial, the Action Area screen, the inclined chart and every label
// (05_ART_DIRECTION "Marineville / WASP": visible labels, bold blue/red/green/yellow on grey). One atlas means one
// material, so every decal in the room is a single draw call. In a test (no DOM) each function returns null and the
// meshes fall back to flat colour.

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The floor, one canvas over the whole 18 m square: large mauve-grey tiles, grout lines, two red bands (ref 1). */
export function controlFloorTexture(): THREE.CanvasTexture | null {
  const size = 1024;
  return canvasTexture(size, size, (ctx) => {
    const rand = mulberry32(0x5a0e);
    const tiles = 12; // 1.5 m tiles over 18 m
    const t = size / tiles;
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < tiles; j++) {
        const l = 62 + rand() * 6;
        ctx.fillStyle = `hsl(${300 + rand() * 30}, ${6 + rand() * 4}%, ${l}%)`;
        ctx.fillRect(i * t, j * t, t, t);
        // A faint scuff on some tiles.
        if (rand() < 0.3) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath();
          ctx.ellipse(i * t + rand() * t, j * t + rand() * t, 6 + rand() * 18, 3 + rand() * 6, rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = 'rgba(70,60,70,0.55)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= tiles; k++) {
      ctx.beginPath(); ctx.moveTo(k * t, 0); ctx.lineTo(k * t, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * t); ctx.lineTo(size, k * t); ctx.stroke();
    }
    // Two red bands (ref 1's floor stripes), running diagonally across the room.
    ctx.strokeStyle = '#a3322b';
    ctx.lineWidth = 12;
    for (const off of [0.22, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(size * off, size);
      ctx.lineTo(size * (off + 0.55), 0);
      ctx.stroke();
    }
  });
}

/** The grey perforated wall behind the World Videophone (ref 2): dots on grey, tiling every metre. */
export function meshWallTexture(): THREE.CanvasTexture | null {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#9a9c9c';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#6d7070';
    for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  });
  if (tex) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- The decal atlas ----

const ATLAS_W = 2048;
const ATLAS_H = 1024;

/** A region of the atlas, in pixels: x, y (top-left), w, h. */
type Rect = readonly [number, number, number, number];

/** Where each decal is painted in the atlas. */
export const DECALS = Object.freeze({
  map: [0, 0, 1024, 384] as Rect,
  videophone: [1024, 0, 512, 384] as Rect,
  compass: [1536, 0, 256, 256] as Rect,
  actionScreen: [1792, 0, 256, 256] as Rect,
  chart: [1024, 384, 512, 256] as Rect,
  banner: [0, 400, 1024, 64] as Rect,
  locatorSign: [0, 480, 512, 96] as Rect,
  loungeSign: [512, 480, 512, 96] as Rect,
  actionSign: [1536, 256, 512, 96] as Rect,
  fireSign: [1536, 352, 256, 96] as Rect,
  shorePlate: [0, 592, 512, 96] as Rect,
  hydrophones: [512, 592, 512, 96] as Rect,
  sonar: [0, 704, 512, 96] as Rect,
  power: [512, 704, 512, 96] as Rect,
  launch: [1024, 640, 512, 96] as Rect,
  comms: [1536, 448, 512, 96] as Rect,
  knobPanel: [1536, 544, 256, 256] as Rect,
  lampPanel: [1792, 544, 256, 256] as Rect,
});
export type DecalName = keyof typeof DECALS;

/** The UV rectangle [u0, v0, u1, v1] of a decal (v up, as three.js expects with flipY). */
export function decalUV(name: DecalName): [number, number, number, number] {
  const [x, y, w, h] = DECALS[name];
  return [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
}

// Coarse continents as [lon, lat] rings (degrees) — a stylised 1960s wall map, not a survey.
const CONTINENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // North America
  [[-168, 66], [-160, 71], [-140, 70], [-120, 69], [-95, 72], [-80, 68], [-62, 60], [-56, 52], [-66, 45], [-76, 38], [-81, 31], [-80, 25], [-84, 30], [-90, 29], [-97, 26], [-97, 21], [-87, 21], [-83, 15], [-78, 8], [-82, 8], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 41], [-124, 48], [-132, 55], [-150, 60], [-165, 60]],
  // Greenland
  [[-55, 60], [-44, 60], [-22, 70], [-18, 80], [-40, 83], [-62, 81], [-72, 77], [-56, 68]],
  // South America
  [[-78, 8], [-60, 10], [-50, 0], [-35, -6], [-39, -15], [-48, -26], [-58, -36], [-65, -42], [-68, -54], [-74, -50], [-72, -38], [-71, -20], [-77, -12], [-81, -3]],
  // Europe and Asia
  [[-10, 36], [-9, 43], [-2, 48], [5, 52], [10, 57], [5, 62], [15, 69], [28, 71], [45, 68], [70, 73], [100, 77], [140, 72], [170, 68], [180, 65], [170, 60], [160, 52], [142, 55], [135, 43], [128, 35], [121, 31], [122, 25], [110, 20], [108, 11], [104, 1], [100, 13], [92, 22], [80, 15], [77, 8], [72, 20], [60, 25], [50, 30], [56, 25], [52, 16], [43, 13], [35, 28], [35, 36], [27, 37], [23, 40], [12, 44], [15, 38], [8, 44], [3, 43]],
  // Africa
  [[-17, 21], [-10, 30], [-6, 36], [10, 37], [20, 32], [32, 31], [43, 12], [51, 11], [40, -3], [40, -15], [35, -24], [27, -34], [19, -35], [12, -18], [13, -6], [9, 4], [-8, 5], [-16, 12]],
  // Australia
  [[114, -22], [122, -18], [131, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [140, -38], [131, -31], [115, -34]],
  // Antarctica's edge
  [[-180, -70], [-120, -72], [-60, -64], [0, -69], [60, -67], [120, -66], [180, -70], [180, -85], [-180, -85]],
  // Britain, Japan, Madagascar, New Zealand, Indonesia (small)
  [[-6, 50], [2, 51], [-2, 56], [-5, 58], [-6, 55]],
  [[130, 31], [135, 34], [141, 36], [142, 43], [140, 41], [133, 34]],
  [[44, -16], [50, -14], [49, -25], [44, -24]],
  [[167, -46], [174, -41], [178, -38], [172, -34], [170, -44]],
  [[95, 5], [106, -6], [115, -8], [120, -3], [110, 2], [100, 2]],
];

function paintMap(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect): void {
  ctx.save();
  ctx.translate(x0, y0);
  // The frame and the sea.
  ctx.fillStyle = '#d8cfb2';
  ctx.fillRect(0, 0, w, h);
  const m = 10;
  ctx.fillStyle = '#a9c9d9';
  ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  ctx.beginPath();
  ctx.rect(m, m, w - 2 * m, h - 2 * m);
  ctx.clip();
  // Pacific-centred, as the series' map: longitude 20°E at the left edge round to 380° (20°E again).
  const lon0 = 20;
  const px = (lon: number) => m + ((((lon - lon0) % 360) + 360) % 360) / 360 * (w - 2 * m);
  const py = (lat: number) => m + (80 - lat) / 160 * (h - 2 * m);
  // The graticule.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  for (let lon = 0; lon < 360; lon += 15) {
    ctx.beginPath(); ctx.moveTo(px(lon), m); ctx.lineTo(px(lon), h - m); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.beginPath(); ctx.moveTo(m, py(lat)); ctx.lineTo(w - m, py(lat)); ctx.stroke();
  }
  // The continents: salmon land with a darker coast.
  ctx.fillStyle = '#d9795c';
  ctx.strokeStyle = '#9c4c38';
  ctx.lineWidth = 2;
  for (const ring of CONTINENTS) {
    // Each ring is drawn three times a whole turn apart; the clip keeps whichever copies fall on the map.
    for (const shift of [-360, 0, 360]) {
      ctx.beginPath();
      ring.forEach(([lon, lat], k) => {
        const x = m + (lon - lon0 + shift) / 360 * (w - 2 * m);
        if (k === 0) ctx.moveTo(x, py(lat)); else ctx.lineTo(x, py(lat));
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  // The tracking line down the middle with its target rings (ref 1).
  const cx = w / 2;
  ctx.strokeStyle = '#1d2a3a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, m); ctx.lineTo(cx, h - m); ctx.stroke();
  for (let k = 0; k < 5; k++) {
    const cy = m + (k + 0.5) * (h - 2 * m) / 5;
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx + 34, cy); ctx.stroke();
  }
  // Marineville: a red marker on the west coast of North America's Pacific shore.
  ctx.fillStyle = '#d62b1f';
  ctx.beginPath(); ctx.arc(px(-121), py(35), 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function paintVideophone(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = '#c8a25a'; // the gilt rim
  roundRect(ctx, 0, 0, w, h, 40);
  ctx.fill();
  ctx.fillStyle = '#d9502f';
  roundRect(ctx, 10, 10, w - 20, h - 20, 32);
  ctx.fill();
  const cx = w / 2;
  const cy = h / 2;
  // Yellow lightning rays round the screen.
  ctx.strokeStyle = '#f2c23a';
  ctx.lineWidth = 5;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    const r0 = 104;
    const r1 = 190;
    const mid = (r0 + r1) / 2;
    const n = 0.12;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.75);
    ctx.lineTo(cx + Math.cos(a + n) * mid, cy + Math.sin(a + n) * mid * 0.75);
    ctx.lineTo(cx + Math.cos(a - n * 0.3) * mid, cy + Math.sin(a - n * 0.3) * mid * 0.75);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.75);
    ctx.stroke();
  }
  // The round blue screen with a figure's silhouette.
  ctx.fillStyle = '#c8a25a';
  ctx.beginPath(); ctx.arc(cx, cy, 98, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(cx - 20, cy - 30, 10, cx, cy, 92);
  g.addColorStop(0, '#8fb8e8');
  g.addColorStop(1, '#2d5c9c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 92, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(20,40,80,0.55)';
  ctx.beginPath(); ctx.arc(cx, cy - 18, 30, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy + 62, 62, 44, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WORLD', cx, 42);
  ctx.fillText('VIDEOPHONE', cx, h - 40);
  ctx.restore();
}

function paintCompass(ctx: CanvasRenderingContext2D, [x0, y0, w]: Rect): void {
  ctx.save();
  ctx.translate(x0 + w / 2, y0 + w / 2);
  const r = w / 2;
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(-r, -r, w, w);
  ctx.fillStyle = '#26292d';
  ctx.beginPath(); ctx.arc(0, 0, r - 2, 0, Math.PI * 2); ctx.fill();
  // The white sunburst of triangles (ref 2).
  ctx.fillStyle = '#f2efe6';
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.07) * (r * 0.7), Math.sin(a - 0.07) * (r * 0.7));
    ctx.lineTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8));
    ctx.lineTo(Math.cos(a + 0.07) * (r * 0.7), Math.sin(a + 0.07) * (r * 0.7));
    ctx.fill();
  }
  ctx.fillStyle = '#5d8fb8';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2efe6';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0); ctx.stroke();
  ctx.fillStyle = '#d62b1f';
  ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(10, 0); ctx.lineTo(-10, 0); ctx.fill();
  ctx.restore();
}

function paintActionScreen(ctx: CanvasRenderingContext2D, [x0, y0, w]: Rect): void {
  ctx.save();
  ctx.translate(x0 + w / 2, y0 + w / 2);
  const r = w / 2;
  ctx.fillStyle = '#b9c2c6';
  ctx.fillRect(-r, -r, w, w);
  const g = ctx.createRadialGradient(-30, -40, 10, 0, 0, r);
  g.addColorStop(0, '#d9e6ee');
  g.addColorStop(1, '#7f9aaa');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r - 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(40,70,90,0.5)';
  ctx.lineWidth = 2;
  for (const k of [0.3, 0.55, 0.8]) { ctx.beginPath(); ctx.arc(0, 0, (r - 6) * k, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
  ctx.fillStyle = '#e8f04a';
  ctx.beginPath(); ctx.arc(34, -22, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** The inclined chart on the main console (ref 1): a coast in red and green bands on grey-blue. */
function paintChart(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = '#6aa04e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b8c3cc';
  ctx.fillRect(10, 10, w - 20, h - 20);
  const band = (colour: string, offset: number, width: number) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let x = 10; x <= w - 10; x += 8) {
      const y = h * 0.5 + offset + Math.sin(x / 47) * 18 + Math.sin(x / 13) * 4;
      if (x === 10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let x = w - 10; x >= 10; x -= 8) {
      const y = h * 0.5 + offset + width + Math.sin(x / 47) * 18 + Math.sin(x / 13) * 4;
      ctx.lineTo(x, y);
    }
    ctx.fill();
  };
  band('#b13a2a', -40, 34);
  band('#6aa04e', -6, 16);
  band('#4a5560', 10, 70);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('SECTOR 7 · PACIFIC', 24, 34);
  ctx.restore();
}

/** A blue panel with a grid of black knob sockets and engraved ticks (the consoles' blue fields, ref 1). */
function paintKnobPanel(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = '#3d6fb4';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b7cbe6';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cx = 32 + c * 64;
      const cy = 32 + r * 64;
      ctx.beginPath(); ctx.arc(cx, cy, 18, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    }
  }
  ctx.restore();
}

/** A grey panel with rows of coloured indicator lamps and a meter (the consoles' instrument fields). */
function paintLampPanel(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = '#8b9196';
  ctx.fillRect(0, 0, w, h);
  const colours = ['#e8432e', '#f2c23a', '#4fb35a', '#e9eef0', '#3d8fe0'];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.fillStyle = colours[(r * 2 + c) % colours.length]!;
      ctx.beginPath(); ctx.arc(26 + c * 41, 30 + r * 34, 11, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(28, 140, 200, 90);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(128, 225, 70, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(128, 225); ctx.lineTo(160, 165); ctx.stroke();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect, text: string, bg: string, fg: string, size: number): void {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 3;
  ctx.strokeRect(x0 + 5, y0 + 5, w - 10, h - 10);
  ctx.fillStyle = fg;
  ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + w / 2, y0 + h / 2 + 2, w - 24);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Every decal of the room in one canvas (see DECALS for the layout). */
export function decalAtlas(): THREE.CanvasTexture | null {
  return canvasTexture(ATLAS_W, ATLAS_H, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    paintMap(ctx, DECALS.map);
    paintVideophone(ctx, DECALS.videophone);
    paintCompass(ctx, DECALS.compass);
    paintActionScreen(ctx, DECALS.actionScreen);
    paintChart(ctx, DECALS.chart);
    paintKnobPanel(ctx, DECALS.knobPanel);
    paintLampPanel(ctx, DECALS.lampPanel);
    label(ctx, DECALS.banner, 'WORLD AQUANAUT SECURITY PATROL', '#c0362a', '#f4ead2', 40);
    label(ctx, DECALS.locatorSign, 'LOCATOR COMPASS', '#e6dcc0', '#2b2b2b', 46);
    label(ctx, DECALS.loungeSign, 'STANDBY LOUNGE', '#c0362a', '#f4ead2', 46);
    label(ctx, DECALS.actionSign, 'ACTION AREA', '#d9cdb0', '#2b2b2b', 50);
    label(ctx, DECALS.fireSign, 'FIRE', '#c0362a', '#ffffff', 52);
    label(ctx, DECALS.shorePlate, 'COMMANDER', '#2b2f33', '#e9c24a', 48);
    label(ctx, DECALS.hydrophones, 'HYDROPHONES', '#e6dcc0', '#2b2b2b', 46);
    label(ctx, DECALS.sonar, 'SONAR TRACK', '#e6dcc0', '#2b2b2b', 46);
    label(ctx, DECALS.power, 'MAIN POWER', '#f2c23a', '#2b2b2b', 46);
    label(ctx, DECALS.launch, 'PEN 3 · LAUNCH', '#e6dcc0', '#c0362a', 46);
    label(ctx, DECALS.comms, 'COMMUNICATIONS', '#e6dcc0', '#2b2b2b', 44);
  });
}
