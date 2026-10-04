import * as THREE from 'three';
import { fbm2 } from './noise';
import { mulberry32 } from './random';

// Every texture the scenery uses is drawn here, in code: no image files.
// Cards are drawn white-ish so each instance's colour tints them.

// ---- Ground detail: tiling cushions of moss with dark gaps and pale tips ----

const GROUND_SIZE = 256;
const CUSHION_CELLS = 16; // cushions across the tile

export interface GroundTextures {
  /** Colour multiplier, averaging a little under 1. */
  map: THREE.DataTexture;
  /** Height for the bump map, in the red channel. */
  bump: THREE.DataTexture;
}

export function groundTextures(seed: number): GroundTextures {
  const n = GROUND_SIZE;
  const rand = mulberry32(seed ^ 0x9e01);
  const cell = n / CUSHION_CELLS;
  const points: Array<[number, number, number]> = [];
  for (let j = 0; j < CUSHION_CELLS; j++) {
    for (let i = 0; i < CUSHION_CELLS; i++) points.push([(i + rand()) * cell, (j + rand()) * cell, 0.7 + rand() * 0.6]);
  }
  const color = new Uint8Array(n * n * 4);
  const height = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Cellular cushions: nearest jittered point, wrapped so the tile repeats seamlessly.
      let best = Infinity;
      let size = 1;
      const ci = Math.floor(x / cell);
      const cj = Math.floor(y / cell);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const pi = (ci + di + CUSHION_CELLS) % CUSHION_CELLS;
          const pj = (cj + dj + CUSHION_CELLS) % CUSHION_CELLS;
          const p = points[pj * CUSHION_CELLS + pi]!;
          const px = p[0] + (ci + di - pi) * cell;
          const py = p[1] + (cj + dj - pj) * cell;
          const d = Math.hypot(x - px, y - py) / (cell * p[2]);
          if (d < best) {
            best = d;
            size = p[2];
          }
        }
      }
      const cushion = Math.max(0, 1 - best * best) * (0.8 + 0.2 * size);
      const fine = fbm2(x / 8, y / 8, seed, 3, n / 8);
      const h = THREE.MathUtils.clamp(0.65 * cushion + 0.35 * fine, 0, 1);
      const speck = fine > 0.72 ? 0.25 : 0;
      const shade = THREE.MathUtils.clamp(0.42 + 0.62 * h + speck, 0, 1);
      // Cushion tops catch a yellower light; the gaps fall to a cool shadow.
      const k = (y * n + x) * 4;
      color[k] = 255 * shade * (0.92 + 0.08 * h);
      color[k + 1] = 255 * shade;
      color[k + 2] = 255 * shade * (1.02 - 0.15 * h);
      color[k + 3] = 255;
      height[k] = height[k + 1] = height[k + 2] = 255 * h;
      height[k + 3] = 255;
    }
  }
  return { map: tiled(color, n, n, true), bump: tiled(height, n, n, false) };
}

function tiled(data: Uint8Array<ArrayBuffer>, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---- Cards: alpha-cut silhouettes for fronds, feathery bushes and kelp ----

/** A small rasteriser: soft-edged strokes and ellipses into an alpha + shade buffer. */
class Card {
  readonly alpha: Float32Array;
  readonly shade: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.alpha = new Float32Array(w * h);
    this.shade = new Float32Array(w * h).fill(1);
  }

  /** A tapered stroke from (x0, y0) radius r0 to (x1, y1) radius r1, in pixels. */
  stroke(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, shade: number): void {
    const pad = Math.max(r0, r1) + 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    this.fill(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad, (x, y) => {
      const t = THREE.MathUtils.clamp(((x - x0) * dx + (y - y0) * dy) / len2, 0, 1);
      const r = r0 + (r1 - r0) * t;
      return r + 0.5 - Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
    }, shade);
  }

  /** An ellipse centred at (cx, cy) with radii (rx, ry), its rx axis turned by `angle`. */
  ellipse(cx: number, cy: number, rx: number, ry: number, angle: number, shade: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = Math.max(rx, ry) + 1;
    this.fill(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const u = ((x - cx) * c + (y - cy) * s) / rx;
      const v = (-(x - cx) * s + (y - cy) * c) / ry;
      return (1 - Math.hypot(u, v)) * Math.min(rx, ry) + 0.5;
    }, shade);
  }

  private fill(x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => number, shade: number): void {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.w - 1, Math.ceil(x1)); x++) {
        const a = THREE.MathUtils.clamp(inside(x + 0.5, y + 0.5), 0, 1);
        const k = y * this.w + x;
        if (a > 0) {
          this.shade[k] = this.alpha[k]! > 0 ? Math.min(this.shade[k]!, shade) * (1 - a) + shade * a : shade;
          this.alpha[k] = Math.max(this.alpha[k]!, a);
        }
      }
    }
  }

  /** Row 0 of the buffer is the bottom of the texture (v = 0), so cards are drawn with y up. */
  texture(): THREE.DataTexture {
    const data = new Uint8Array(this.w * this.h * 4);
    for (let k = 0; k < this.w * this.h; k++) {
      const s = 255 * THREE.MathUtils.clamp(this.shade[k]!, 0, 1);
      data[k * 4] = s;
      data[k * 4 + 1] = s;
      data[k * 4 + 2] = s;
      data[k * 4 + 3] = 255 * this.alpha[k]!;
    }
    const texture = new THREE.DataTexture(data, this.w, this.h, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}

/** A feathery fern frond: a curving stem with paired leaflets, shortening toward the tip. */
export function frondTexture(seed: number): THREE.DataTexture {
  const card = new Card(128, 256);
  const rand = mulberry32(seed ^ 0xf00d);
  const STEPS = 22;
  let px = 64;
  let py = 6;
  for (let i = 0; i < STEPS; i++) {
    const t = i / STEPS;
    const nx = 64 + Math.sin(t * 2.2) * 14 * t;
    const ny = 6 + (i + 1) * (240 / STEPS);
    card.stroke(px, py, nx, ny, 2.6 - 1.6 * t, 2.6 - 1.6 * (t + 1 / STEPS), 0.55);
    const leaf = (1 - t * 0.75) * 46;
    for (const side of [-1, 1]) {
      const angle = side * (0.55 + 0.25 * t) + (rand() - 0.5) * 0.2;
      const lx = nx + Math.sin(angle) * leaf * 0.5;
      const ly = ny + Math.cos(angle) * leaf * 0.5 - 4;
      card.ellipse(lx, ly, leaf * 0.5, 3.4 - 1.8 * t, Math.PI / 2 - angle, 0.75 + 0.25 * rand());
    }
    px = nx;
    py = ny;
  }
  return card.texture();
}

/** A feathery bush: a fan of curving stems from one root, each thick with leaflets, like the series' sea shrubs. */
export function bushTexture(seed: number): THREE.DataTexture {
  const card = new Card(256, 256);
  const rand = mulberry32(seed ^ 0xb05e);
  const STEMS = 11;
  for (let s = 0; s < STEMS; s++) {
    const spread = (s / (STEMS - 1) - 0.5) * 2.1 + (rand() - 0.5) * 0.15;
    const length = 150 + rand() * 80 - Math.abs(spread) * 40;
    const bend = (rand() - 0.5) * 0.6;
    let x = 128;
    let y = 4;
    const STEPS = 14;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const a = spread * (0.35 + 0.65 * t) + bend * t * t;
      const nx = x + Math.sin(a) * (length / STEPS);
      const ny = y + Math.cos(a) * (length / STEPS);
      card.stroke(x, y, nx, ny, 2.4 - 1.4 * t, 2.4 - 1.4 * t, 0.6);
      if (t > 0.2) {
        const leaf = 16 * (1.1 - t * 0.6);
        for (const side of [-1, 1]) {
          const la = a + side * (0.7 + rand() * 0.3);
          card.ellipse(nx + Math.sin(la) * leaf * 0.5, ny + Math.cos(la) * leaf * 0.5, leaf * 0.55, 2.8, Math.PI / 2 - la, 0.78 + 0.22 * rand());
        }
      }
      x = nx;
      y = ny;
    }
    card.ellipse(x, y, 8, 5, Math.PI / 2 - spread, 0.95);
  }
  return card.texture();
}

/** A kelp blade: a long ruffled ribbon either side of a midrib, with leafy lobes along its edges. */
export function kelpTexture(seed: number): THREE.DataTexture {
  const card = new Card(64, 512);
  const rand = mulberry32(seed ^ 0x6e1f);
  const SEGMENTS = 64;
  const width = (t: number) => (5 + 17 * Math.sin(Math.min(t * 3, 1) * Math.PI * 0.5) * (1 - 0.45 * t)) * (0.8 + 0.2 * Math.sin(t * 70));
  const y = (t: number) => 4 + t * 500;
  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    card.stroke(32, y(t0), 32, y(t1), width(t0), width(t1), 0.85);
  }
  for (let i = 2; i < SEGMENTS; i += 3) {
    const t = i / SEGMENTS;
    for (const side of [-1, 1]) {
      const len = 5 + rand() * 4;
      card.ellipse(32 + side * (width(t) + len * 0.3), y(t) + len * 0.6, len, 3, side * 0.9, 0.7 + 0.25 * rand());
    }
  }
  card.stroke(32, y(0), 32, y(1), 1.8, 0.8, 0.55);
  return card.texture();
}
