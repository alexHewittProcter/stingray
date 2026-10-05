import * as THREE from 'three';
import { mulberry32 } from './random';

// The launch tunnel's painted surfaces, drawn on canvases in code (no image files): the bore's wall paint and the
// numbered section boards. In a test (no DOM) every function returns null and the meshes fall back to flat colour.

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

/** Where the wall paint's bands sit, as a fraction of the way round from the crown toward `side` (0 … 1). */
export const WALL_BANDS = {
  /** The broad blue band along both walls, centred a little below the springing. */
  blue: [[0.2, 0.29], [0.71, 0.8]] as const,
  /** The silted invert. */
  floor: [0.37, 0.63] as const,
};

/**
 * The bore's wall: u runs once round the bore from the crown (u = 0) toward `side`; v runs one bay (one rib
 * spacing) along the tunnel. Light grey precast panels, a broad blue band with white pinstripes along both walls
 * (it streaks past at speed), a dark, silted invert, panel joints and run-down grime.
 */
export function boreWallTexture(): THREE.CanvasTexture | null {
  const w = 1024;
  const h = 256;
  const texture = canvasTexture(w, h, (ctx) => {
    const rand = mulberry32(0x7a11);
    ctx.fillStyle = '#82847e';
    ctx.fillRect(0, 0, w, h);
    // Panels: each a slightly different grey.
    const across = 24;
    for (let i = 0; i < across; i++) {
      for (let j = 0; j < 2; j++) {
        const g = 118 + Math.round((rand() - 0.5) * 20);
        ctx.fillStyle = `rgb(${g},${g + 2},${g - 4})`;
        ctx.fillRect((i * w) / across, (j * h) / 2, w / across, h / 2);
      }
    }
    // The blue band, white pinstripes either side.
    for (const [a, b] of WALL_BANDS.blue) {
      ctx.fillStyle = '#2f5576';
      ctx.fillRect(a * w, 0, (b - a) * w, h);
      ctx.fillStyle = '#e8e6dc';
      ctx.fillRect(a * w - 7, 0, 4, h);
      ctx.fillRect(b * w + 3, 0, 4, h);
    }
    // The invert: dark, green-grey, silted toward the middle.
    const [f0, f1] = WALL_BANDS.floor;
    const floor = ctx.createLinearGradient(f0 * w, 0, f1 * w, 0);
    floor.addColorStop(0, 'rgba(70,78,70,0.0)');
    floor.addColorStop(0.15, 'rgba(70,78,70,0.85)');
    floor.addColorStop(0.5, 'rgba(58,62,52,1)');
    floor.addColorStop(0.85, 'rgba(70,78,70,0.85)');
    floor.addColorStop(1, 'rgba(70,78,70,0.0)');
    ctx.fillStyle = floor;
    ctx.fillRect(f0 * w, 0, (f1 - f0) * w, h);
    // Panel joints: round the bore at mid-bay and at the bay ends, along it between panels.
    ctx.fillStyle = 'rgba(30,32,30,0.55)';
    for (let i = 0; i < across; i++) ctx.fillRect((i * w) / across - 1, 0, 2, h);
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h / 2 - 1, w, 2);
    // Bolt heads at the panel corners.
    ctx.fillStyle = 'rgba(40,42,40,0.8)';
    for (let i = 0; i < across; i++) {
      for (const y of [8, h / 2 + 8, h / 2 - 8, h - 8]) {
        ctx.beginPath();
        ctx.arc((i * w) / across + 8, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Grime: streaks running down the walls from the crown toward the invert (along u, both ways).
    for (let i = 0; i < 160; i++) {
      const v = rand() * h;
      const u0 = rand() < 0.5 ? rand() * 0.45 : 1 - rand() * 0.45;
      const len = (0.02 + rand() * 0.12) * w;
      const down = u0 < 0.5 ? 1 : -1;
      const g = ctx.createLinearGradient(u0 * w, 0, u0 * w + down * len, 0);
      g.addColorStop(0, 'rgba(60,58,48,0)');
      g.addColorStop(0.3, `rgba(60,58,48,${0.12 + rand() * 0.18})`);
      g.addColorStop(1, 'rgba(60,58,48,0)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(u0 * w, u0 * w + down * len), v, len, 1 + rand() * 4);
    }
  });
  if (texture) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** The section boards: cell k of SECTION_CELLS, in an atlas of SECTION_ATLAS.cols × rows cells. */
export const SECTION_ATLAS = { cols: 4, rows: 3, cellW: 512, cellH: 320 } as const;

/** What each board says: the section numbers counting down to the door, then the chamber's boards. */
export function sectionCellLabel(k: number): { big: string; small: string; hazard: boolean } {
  if (k < 10) return { big: String(k + 1).padStart(2, '0'), small: 'SECTION', hazard: false };
  if (k === 10) return { big: 'OCEAN DOOR', small: 'CHAMBER — STAND BY', hazard: true };
  return { big: 'PEN 3', small: 'STINGRAY', hazard: false };
}

/**
 * One atlas holding every section board: a dark slate board with a white frame, "SECTION" over a big stencilled
 * number, a red bar under it; the door chamber's board is hazard-banded. Transparent round the boards.
 */
export function sectionAtlasTexture(): THREE.CanvasTexture | null {
  const { cols, rows, cellW, cellH } = SECTION_ATLAS;
  return canvasTexture(cols * cellW, rows * cellH, (ctx) => {
    ctx.clearRect(0, 0, cols * cellW, rows * cellH);
    const rand = mulberry32(0x5ec7);
    for (let k = 0; k < cols * rows; k++) {
      const x0 = (k % cols) * cellW;
      // Row 0 at the top of the canvas = the top of the texture (flipY): v = 1 − row / rows.
      const y0 = Math.floor(k / cols) * cellH;
      const label = sectionCellLabel(k);
      ctx.save();
      ctx.translate(x0, y0);
      const pad = 10;
      ctx.fillStyle = label.hazard ? '#d9a91e' : '#24292d';
      ctx.fillRect(pad, pad, cellW - 2 * pad, cellH - 2 * pad);
      if (label.hazard) {
        ctx.fillStyle = '#1d1d1b';
        for (let x = -cellH; x < cellW; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, cellH - pad); ctx.lineTo(x + 32, cellH - pad); ctx.lineTo(x + 32 + 48, cellH - pad - 48); ctx.lineTo(x + 48, cellH - pad - 48);
          ctx.closePath(); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x, pad + 48); ctx.lineTo(x + 32, pad + 48); ctx.lineTo(x + 32 + 48, pad); ctx.lineTo(x + 48, pad);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#1d1d1b';
        ctx.fillRect(pad + 24, pad + 64, cellW - 2 * pad - 48, cellH - 2 * pad - 128);
      }
      ctx.strokeStyle = '#ecebe3';
      ctx.lineWidth = 6;
      ctx.strokeRect(pad + 10, pad + 10, cellW - 2 * pad - 20, cellH - 2 * pad - 20);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = label.hazard ? '#f0c040' : '#ecebe3';
      ctx.font = 'bold 34px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(label.small, cellW / 2, label.hazard ? cellH - 102 : 58);
      const bigSize = label.big.length > 4 ? 86 : 190;
      ctx.font = `bold ${bigSize}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      ctx.save();
      ctx.translate(cellW / 2, label.hazard ? cellH / 2 - 18 : cellH / 2 + 18);
      ctx.scale(0.82, 1);
      ctx.fillText(label.big, 0, 0);
      ctx.restore();
      if (!label.hazard) {
        ctx.fillStyle = '#c23a22';
        ctx.fillRect(pad + 30, cellH - pad - 44, cellW - 2 * pad - 60, 14);
      }
      // Stencil wear.
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.5})`;
        ctx.fillRect(pad + rand() * (cellW - 2 * pad), pad + rand() * (cellH - 2 * pad), 1 + rand() * 4, 1 + rand() * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  });
}
