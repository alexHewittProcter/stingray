import * as THREE from 'three';

// The injector station's painted surfaces (phase 4, D2 — kept from phase 3's T5 lounge, renamed: [[prefer-reusable]]),
// drawn on canvases in code, after 03_STANDBY_INJECTOR/ and references/launch-and-boarding/: the yellow-and-black
// hazard band round the bore, and a small decal atlas — the station's yellow plate (INJECTOR STATION, D2: "a small
// plate low on its front"), the speaker/mesh grille in its gold ring for the maroon back panel, and a closed injector
// hatch. Phase 3's corridor and lounge surfaces (terrazzo, olive wallpaper, quilting, the connector panelling, the
// signs, the standby board, the crest, the floor stripe) went with those rooms. As control-room-textures.ts: in a test
// (no DOM) each function returns null and the meshes fall back to flat colour.

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

/** The station's maroon (phase 3's injector-bay dado, ref bay): the back panel behind the chairs (D2). */
export const STATION_MAROON = 0x7b3b35;

// ---- The decal atlas ----

const ATLAS_W = 512;
const ATLAS_H = 512;

type Rect = readonly [number, number, number, number];

/** Where each decal is painted in the atlas: x, y (top-left), w, h in pixels. */
export const STATION_DECALS = Object.freeze({
  stationPlate: [0, 0, 512, 96] as Rect,
  grille: [0, 128, 256, 256] as Rect,
  hatch: [256, 128, 192, 192] as Rect,
});
export type StationDecal = keyof typeof STATION_DECALS;

/** The UV rectangle [u0, v0, u1, v1] of a decal (v up). */
export function stationDecalUV(name: StationDecal): [number, number, number, number] {
  const [x, y, w, h] = STATION_DECALS[name];
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

/** Every one-off painted thing at the injector station, in one canvas. */
export function stationDecalAtlas(): THREE.CanvasTexture | null {
  return canvasTexture(ATLAS_W, ATLAS_H, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    const D = STATION_DECALS;
    // INJECTOR STATION: thin grey capitals on a yellow plate (phase 3's INJECTOR BAY plate, ref bay; D2's name).
    plate(ctx, D.stationPlate, 'INJECTOR STATION', '#e2c33c', '#6e6a5e', 52, 8);
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
