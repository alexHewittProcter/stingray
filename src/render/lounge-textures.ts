import * as THREE from 'three';
import { mulberry32 } from './random';

// The corridor's and the Standby Lounge's painted surfaces (phase 3, T5 — M1 art), drawn on canvases in code, after
// 03_STANDBY_INJECTOR/: the lounge's olive ribbed wallpaper and grey speckled floor (TV_standby_lounge_troy_phones_01),
// the red quilted upholstery, the injector bay's yellow INJECTOR BAY plate (TV_injector_bay_clean_01), the yellow-and-
// black hazard band round the bore, and the corridor's WASP connector panelling. Tiling surfaces are their own
// textures (they repeat); everything flat and one-off is in one small decal atlas, so the signs are one draw call. As
// control-room-textures.ts: in a test (no DOM) each function returns null and the meshes fall back to flat colour.

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture | null {
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
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** The lounge's floor: grey terrazzo speckle (ref, lounge), tiling every 2 m. */
export function terrazzoTexture(): THREE.CanvasTexture | null {
  return canvasTexture(256, 256, (ctx) => {
    const rand = mulberry32(0x7e44);
    ctx.fillStyle = '#9b9a97';
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 2600; k++) {
      const l = rand() < 0.5 ? 40 + rand() * 25 : 72 + rand() * 20;
      ctx.fillStyle = `hsl(${30 + rand() * 30}, ${rand() * 8}%, ${l}%)`;
      const s = 1 + rand() * 2.5;
      ctx.fillRect(rand() * 256, rand() * 256, s, s);
    }
  }, true);
}

/** The lounge's walls: olive ribbed wallpaper (ref, lounge) — fine vertical ribs, tiling every metre. */
export function oliveWallTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, 128, (ctx) => {
    const rand = mulberry32(0x011e);
    ctx.fillStyle = '#9a9a55';
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 2) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '60,62,25' : '200,200,140'},${0.12 + rand() * 0.16})`;
      ctx.fillRect(x, 0, 1, 128);
    }
  }, true);
}

/** Red quilted upholstery (ref, lounge): diamonds of stitching on red, one diamond every 12 cm. */
export function quiltTexture(): THREE.CanvasTexture | null {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#b3242a';
    ctx.fillRect(0, 0, 64, 64);
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 34);
    g.addColorStop(0, 'rgba(255,140,140,0.25)');
    g.addColorStop(1, 'rgba(60,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(70,5,10,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 32); ctx.lineTo(32, 0); ctx.lineTo(64, 32); ctx.lineTo(32, 64); ctx.closePath();
    ctx.stroke();
  }, true);
}

/** Yellow-and-black hazard stripes, diagonal, one pair every 40 cm along u. */
export function hazardTexture(): THREE.CanvasTexture | null {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#e9b52c';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1d1d1f';
    for (const off of [-64, 0, 64]) {
      ctx.beginPath();
      ctx.moveTo(off, 64); ctx.lineTo(off + 32, 64); ctx.lineTo(off + 64 + 32, 0); ctx.lineTo(off + 64, 0); ctx.closePath();
      ctx.fill();
    }
  }, true);
}

/**
 * The corridor's walls: a WASP connector's pale grey panelling (u, v: one tile per 1.2 m wide × the wall's height) —
 * panel seams, a blue band at handrail height, a darker kick plate.
 */
export function corridorPanelTexture(): THREE.CanvasTexture | null {
  return canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#c9ccc9';
    ctx.fillRect(0, 0, 128, 256);
    // The kick plate (bottom 0.3 of 3 m) and the blue band at ≈ 1 m.
    ctx.fillStyle = '#5f666d';
    ctx.fillRect(0, 230, 128, 26);
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(0, 168, 128, 8);
    // Seams and a faint panel shade.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, 2, 256);
    ctx.fillRect(0, 84, 128, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(2, 0, 1, 256);
    for (const [x, y] of [[10, 10], [118, 10], [10, 74], [118, 74], [10, 96], [118, 96], [10, 220], [118, 220]] as const) {
      ctx.fillStyle = '#8e9294';
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }, true);
}

// ---- The decal atlas ----

const ATLAS_W = 1024;
const ATLAS_H = 512;

type Rect = readonly [number, number, number, number];

/** Where each decal is painted in the atlas: x, y (top-left), w, h in pixels. */
export const LOUNGE_DECALS = Object.freeze({
  injectorBay: [0, 0, 512, 96] as Rect,
  toLounge: [512, 0, 512, 96] as Rect,
  toControl: [0, 96, 512, 96] as Rect,
  standbyBoard: [512, 96, 512, 192] as Rect,
  crest: [0, 192, 256, 256] as Rect,
  grille: [256, 192, 256, 256] as Rect,
  floorStripe: [512, 288, 512, 32] as Rect,
  hatch: [512, 320, 192, 192] as Rect,
});
export type LoungeDecal = keyof typeof LOUNGE_DECALS;

/** The UV rectangle [u0, v0, u1, v1] of a decal (v up). */
export function loungeDecalUV(name: LoungeDecal): [number, number, number, number] {
  const [x, y, w, h] = LOUNGE_DECALS[name];
  return [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
}

function plate(ctx: CanvasRenderingContext2D, [x0, y0, w, h]: Rect, text: string, bg: string, fg: string, size: number, spacing = 0): void {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
  ctx.fillStyle = fg;
  ctx.font = `${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
  ctx.fillText(text, x0 + w / 2, y0 + h / 2 + 3, w - 20);
  ctx.restore();
}

/** Every one-off painted thing in the corridor and the lounge, in one canvas. */
export function loungeDecalAtlas(): THREE.CanvasTexture | null {
  return canvasTexture(ATLAS_W, ATLAS_H, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    const D = LOUNGE_DECALS;
    // INJECTOR BAY: thin grey capitals on a yellow plate (ref, bay).
    plate(ctx, D.injectorBay, 'INJECTOR BAY', '#e2c33c', '#6e6a5e', 60, 14);
    plate(ctx, D.toLounge, '◄  STANDBY LOUNGE', '#c0362a', '#f4ead2', 50, 2);
    plate(ctx, D.toControl, 'CONTROL ROOM  ►', '#e6dcc0', '#2b2b2b', 50, 2);
    // The standby board: Stingray's status, green lamps on black.
    {
      const [x, y, w, h] = D.standbyBoard;
      ctx.fillStyle = '#1b1f22';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#c9a54c';
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = '#e9c24a';
      ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('STANDBY', x + 24, y + 36);
      ctx.font = '28px "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = '#d7ead8';
      const rows = ['STINGRAY · PEN 3', 'INJECTORS ARMED', 'HATCH CLOSED'];
      rows.forEach((r, k) => {
        ctx.fillStyle = k === 2 ? '#e8322a' : '#56d36a';
        ctx.beginPath(); ctx.arc(x + 36, y + 84 + k * 36, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d7ead8';
        ctx.fillText(r, x + 60, y + 84 + k * 36);
      });
    }
    // The WASP crest: a pale-blue shield with WASP over a wasp's stripes.
    {
      const [x, y, w, h] = D.crest;
      ctx.fillStyle = '#d9cdb0';
      ctx.fillRect(x, y, w, h);
      const cx = x + w / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 90, y + 30); ctx.lineTo(cx + 90, y + 30); ctx.lineTo(cx + 90, y + 140);
      ctx.quadraticCurveTo(cx + 80, y + 210, cx, y + 236);
      ctx.quadraticCurveTo(cx - 80, y + 210, cx - 90, y + 140);
      ctx.closePath();
      ctx.fillStyle = '#7cc6e6';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#c9a54c';
      ctx.stroke();
      ctx.fillStyle = '#1f3d6b';
      ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('WASP', cx, y + 80);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = k % 2 === 0 ? '#e9b52c' : '#1d1d1f';
        ctx.fillRect(cx - 50, y + 120 + k * 18, 100, 18);
      }
    }
    // A speaker grille: fine mesh in a gold ring (ref, bay).
    {
      const [x, y, w, h] = D.grille;
      ctx.fillStyle = '#9a9c9c';
      ctx.fillRect(x, y, w, h);
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = '#b9b8ae';
      ctx.beginPath(); ctx.arc(cx, cy, 120, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(70,70,60,0.55)';
      for (let yy = -116; yy < 116; yy += 6) for (let xx = -116; xx < 116; xx += 6) if (xx * xx + yy * yy < 116 * 116) ctx.fillRect(cx + xx, cy + yy, 2, 2);
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#c9a54c';
      ctx.beginPath(); ctx.arc(cx, cy, 122, 0, Math.PI * 2); ctx.stroke();
    }
    // The corridor's floor stripe: yellow with black chevrons pointing along +u.
    {
      const [x, y, w, h] = D.floorStripe;
      ctx.fillStyle = '#e9b52c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#2b2b2b';
      for (let k = 0; k < 8; k++) {
        const cx = x + 32 + k * 64;
        ctx.beginPath();
        ctx.moveTo(cx - 10, y + 4); ctx.lineTo(cx + 6, y + h / 2); ctx.lineTo(cx - 10, y + h - 4);
        ctx.lineTo(cx - 2, y + h - 4); ctx.lineTo(cx + 14, y + h / 2); ctx.lineTo(cx - 2, y + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
    // A closed injector hatch: a dark disc with a ring of bolts and a cross seam.
    {
      const [x, y, w, h] = D.hatch;
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = '#6d747b';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#3a3f45';
      ctx.beginPath(); ctx.arc(cx, cy, 92, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#23272b';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 90, cy); ctx.lineTo(cx + 90, cy); ctx.moveTo(cx, cy - 90); ctx.lineTo(cx, cy + 90); ctx.stroke();
      ctx.fillStyle = '#9aa4ad';
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 82, cy + Math.sin(a) * 82, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}
