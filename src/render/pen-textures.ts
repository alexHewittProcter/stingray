import * as THREE from 'three';
import { fbm2 } from './noise';
import { mulberry32 } from './random';

// Pen 3's painted surfaces, drawn on canvases in code (no image files): the panelled concrete, the stencilled
// "PEN 3 STINGRAY", clock dials, the red-and-white leg stripes, hazard bands and grilles. In a test (no DOM) every
// function returns null and the meshes fall back to flat colour.

/** Pixels per metre on the wall texture. */
export const WALL_PX_PER_M = 24;
/** The wall texture spans the pen's full height and this many metres across before it repeats. */
export const WALL_TILE_M = 16;

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

/** Soft mottling: fbm drawn small and stretched over the canvas, as a translucent overlay. */
function mottle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, cells: number, strength: number): void {
  const nw = Math.max(8, Math.round(w / 4));
  const nh = Math.max(8, Math.round(h / 4));
  const small = document.createElement('canvas');
  small.width = nw;
  small.height = nh;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const n = fbm2((x / nw) * cells, (y / nh) * cells * (h / w), seed, 4, cells);
      const k = (y * nw + x) * 4;
      const v = n > 0.5 ? 255 : 0;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = Math.abs(n - 0.5) * 2 * 255 * strength;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, w, h);
}

/**
 * The pen's walls: grey panelled concrete from the pool floor (v = 0, y = −28) to the ceiling (v = 1, y = +20),
 * WALL_TILE_M across. Below the waterline it darkens and greens; a stain band marks the surface.
 */
export function wallTexture(floorY: number, ceilingY: number): THREE.CanvasTexture | null {
  const height = ceilingY - floorY;
  const w = WALL_TILE_M * WALL_PX_PER_M;
  const h = height * WALL_PX_PER_M;
  const yPx = (y: number) => (ceilingY - y) * WALL_PX_PER_M; // canvas y grows down
  const texture = canvasTexture(w, h, (ctx) => {
    const rand = mulberry32(0x9e43);
    // Base paint: a warm putty grey, the upper wall a touch lighter.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#8d8a80');
    grad.addColorStop(yPx(12) / h, '#9a978b');
    grad.addColorStop(yPx(1) / h, '#8f8c80');
    grad.addColorStop(yPx(-0.5) / h, '#55605a');
    grad.addColorStop(1, '#2f3c3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Panels: 4 m wide, 3 m tall courses, each a slightly different shade.
    const panelW = 4 * WALL_PX_PER_M;
    const panelH = 3 * WALL_PX_PER_M;
    for (let py = 0; py < h; py += panelH) {
      for (let px = 0; px < w; px += panelW) {
        const shade = rand();
        ctx.fillStyle = shade < 0.5 ? `rgba(0,0,0,${0.03 + shade * 0.08})` : `rgba(255,255,240,${(shade - 0.5) * 0.08})`;
        ctx.fillRect(px, py, panelW, panelH);
      }
    }
    mottle(ctx, w, h, 71, 6, 0.22);

    // Seams: a dark line with a pale lip below it.
    ctx.lineWidth = 1.5;
    for (let py = 0; py <= h; py += panelH) {
      ctx.strokeStyle = 'rgba(20,20,18,0.45)';
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,240,0.12)';
      ctx.beginPath(); ctx.moveTo(0, py + 2); ctx.lineTo(w, py + 2); ctx.stroke();
    }
    for (let px = 0; px <= w; px += panelW) {
      ctx.strokeStyle = 'rgba(20,20,18,0.4)';
      ctx.beginPath(); ctx.moveTo(px + 0.5, 0); ctx.lineTo(px + 0.5, h); ctx.stroke();
    }
    // Bolt heads at the panel corners.
    ctx.fillStyle = 'rgba(40,40,36,0.55)';
    for (let py = 0; py <= h; py += panelH) {
      for (let px = 0; px <= w; px += panelW) {
        for (const [dx, dy] of [[5, 5], [panelW - 5, 5], [5, panelH - 5], [panelW - 5, panelH - 5]] as const) {
          ctx.beginPath(); ctx.arc(px + dx, py + dy, 1.4, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Rust and damp streaks running down from the panel seams.
    for (let i = 0; i < 26; i++) {
      const x = rand() * w;
      const y0 = Math.floor(rand() * (h / panelH)) * panelH;
      const len = (1 + rand() * 4) * WALL_PX_PER_M;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
      const rust = rand() < 0.4;
      g.addColorStop(0, rust ? 'rgba(110,70,40,0.25)' : 'rgba(30,30,25,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, 2 + rand() * 5, len);
    }

    // The waterline: a dark tide stain just above the surface, weed below it.
    const wl = yPx(0);
    const tide = ctx.createLinearGradient(0, wl - 1.4 * WALL_PX_PER_M, 0, wl + 0.6 * WALL_PX_PER_M);
    tide.addColorStop(0, 'rgba(40,46,38,0)');
    tide.addColorStop(0.6, 'rgba(40,46,38,0.55)');
    tide.addColorStop(1, 'rgba(30,50,40,0.75)');
    ctx.fillStyle = tide;
    ctx.fillRect(0, wl - 1.4 * WALL_PX_PER_M, w, 2 * WALL_PX_PER_M);
    for (let i = 0; i < 160; i++) {
      const x = rand() * w;
      const y = wl + rand() * (h - wl);
      ctx.fillStyle = `rgba(${40 + rand() * 30},${70 + rand() * 40},${45 + rand() * 25},${0.15 + rand() * 0.2})`;
      ctx.fillRect(x, y, 1 + rand() * 3, 4 + rand() * 18);
    }
  });
  if (texture) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  return texture;
}

/** The ceiling: dark grey coffered panels, 6 m square. */
export function ceilingTexture(): THREE.CanvasTexture | null {
  const s = 192;
  const texture = canvasTexture(s, s, (ctx) => {
    ctx.fillStyle = '#2e3030';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, s, 19, 4, 0.12);
    ctx.strokeStyle = 'rgba(10,10,10,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, s - 16, s - 16);
  });
  if (texture) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** The pool floor: worn concrete slabs under water. */
export function floorTexture(): THREE.CanvasTexture | null {
  const s = 256;
  const texture = canvasTexture(s, s, (ctx) => {
    ctx.fillStyle = '#5a6560';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, s, 5, 4, 0.3);
    ctx.strokeStyle = 'rgba(20,30,28,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(s, i * 64); ctx.stroke();
    }
  });
  if (texture) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** "PEN 3 / STINGRAY" in white stencil capitals on a transparent ground (2:1). */
export function stencilTexture(lines: string[]): THREE.CanvasTexture | null {
  const w = 512;
  const h = 256;
  return canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f1efe6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = 96;
    ctx.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    lines.forEach((line, i) => {
      const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.12;
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.scale(0.86, 1);
      ctx.fillText(line, 0, 0);
      ctx.restore();
    });
    // Stencil bridges and wear: thin gaps through the letters, a few flecks of missing paint.
    ctx.globalCompositeOperation = 'destination-out';
    const rand = mulberry32(0x3e3);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

/** A clock dial: white face, black ticks and hands, a dark bezel. */
export function clockTexture(): THREE.CanvasTexture | null {
  const s = 128;
  return canvasTexture(s, s, (ctx) => {
    const c = s / 2;
    ctx.fillStyle = '#2a2c2e';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f4f2ea';
    ctx.beginPath(); ctx.arc(c, c, c * 0.86, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.sin(a) * c * 0.66, c - Math.cos(a) * c * 0.66);
      ctx.lineTo(c + Math.sin(a) * c * 0.8, c - Math.cos(a) * c * 0.8);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + c * 0.35, c - c * 0.2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c - c * 0.1, c - c * 0.6); ctx.stroke();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c, c + c * 0.15); ctx.lineTo(c + c * 0.25, c + c * 0.55); ctx.stroke();
  });
}

/** Bands for the cradle legs, along v: red and white, `bands` of each. */
export function stripeTexture(bands: number, a = '#c8321e', b = '#ece8dc'): THREE.CanvasTexture | null {
  const h = bands * 2 * 16;
  const texture = canvasTexture(8, h, (ctx) => {
    for (let i = 0; i < bands * 2; i++) {
      ctx.fillStyle = i % 2 === 0 ? a : b;
      ctx.fillRect(0, i * 16, 8, 16);
    }
  });
  if (texture) texture.magFilter = THREE.NearestFilter;
  return texture;
}

/** Diagonal yellow-and-black hazard bands, tiling along u. */
export function hazardTexture(): THREE.CanvasTexture | null {
  const w = 64;
  const h = 16;
  const texture = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#d9a91e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d1d1b';
    for (let x = -h; x < w; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, h); ctx.lineTo(x + 8, h); ctx.lineTo(x + 8 + h, 0); ctx.lineTo(x + h, 0);
      ctx.closePath(); ctx.fill();
    }
  });
  if (texture) texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** A louvred vent grille: dark slats in a pale frame. */
export function grilleTexture(): THREE.CanvasTexture | null {
  const w = 128;
  const h = 48;
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#b9b7ad';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26292a';
    ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#7d7f7a';
    for (let x = 10; x < w - 10; x += 7) ctx.fillRect(x, 8, 3, h - 16);
  });
}

/** A painted door: off-white with a round porthole and a kick plate. */
export function doorTexture(): THREE.CanvasTexture | null {
  const w = 64;
  const h = 128;
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#e4e2da';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8f8d86';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#3b4650';
    ctx.beginPath(); ctx.arc(w / 2, 40, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9da0a0';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(w / 2, 40, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#5d5f60';
    ctx.fillRect(w - 16, 70, 8, 4);
  });
}
