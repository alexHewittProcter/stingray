// The frame-rate readout (phase 2, T8 — `?fps`): a small corner box with the current frame rate, the 1 % low and
// the worst frame over the last few seconds, the mean frame time, and the renderer's draw calls and triangles.
// Off by default. It keeps a fixed ring of frame times and writes the DOM a few times a second, so it costs next
// to nothing next to the frame it measures. The statistics are pure (frameStats) and tested.

/** Seconds of frames the readout summarises. */
export const FPS_WINDOW_SECONDS = 5;
/** How often the box is rewritten (s). */
const REFRESH_SECONDS = 0.25;
/** Ring capacity: enough for FPS_WINDOW_SECONDS at 240 Hz. */
const CAPACITY = 1200;

export interface FrameStats {
  /** Frames per second over the window (frames / total time). */
  fps: number;
  /** Mean frame time (ms). */
  meanMs: number;
  /** The 1 % low: the frame rate of the slowest 1 % of frames (at least one frame). */
  low1Fps: number;
  /** The single slowest frame (ms). */
  worstMs: number;
  frames: number;
}

/** Statistics over a list of frame times in milliseconds (non-positive or non-finite entries are ignored). */
export function frameStats(frameMs: readonly number[]): FrameStats {
  const ms = frameMs.filter((m) => Number.isFinite(m) && m > 0);
  if (ms.length === 0) return { fps: 0, meanMs: 0, low1Fps: 0, worstMs: 0, frames: 0 };
  const total = ms.reduce((a, b) => a + b, 0);
  const sorted = [...ms].sort((a, b) => b - a); // slowest first
  const slowest = sorted.slice(0, Math.max(1, Math.ceil(ms.length * 0.01)));
  const slowMean = slowest.reduce((a, b) => a + b, 0) / slowest.length;
  return {
    fps: (1000 * ms.length) / total,
    meanMs: total / ms.length,
    low1Fps: 1000 / slowMean,
    worstMs: sorted[0]!,
    frames: ms.length,
  };
}

/** The last frames, oldest dropped first, kept to the last FPS_WINDOW_SECONDS of frame time. */
export class FrameRing {
  private readonly buf = new Float64Array(CAPACITY);
  private start = 0;
  private count = 0;
  private sum = 0;

  constructor(private readonly windowMs = FPS_WINDOW_SECONDS * 1000) {}

  push(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    if (this.count === CAPACITY) this.dropOldest();
    this.buf[(this.start + this.count) % CAPACITY] = ms;
    this.count++;
    this.sum += ms;
    while (this.count > 1 && this.sum - this.buf[this.start]! >= this.windowMs) this.dropOldest();
  }

  values(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.buf[(this.start + i) % CAPACITY]!);
    return out;
  }

  private dropOldest(): void {
    this.sum -= this.buf[this.start]!;
    this.start = (this.start + 1) % CAPACITY;
    this.count--;
  }
}

export interface FpsReadout {
  /** Call once per drawn frame with the frame's wall time and the renderer's counts for it. */
  frame(frameMs: number, calls: number, triangles: number): void;
}

export function createFpsReadout(parent: HTMLElement): FpsReadout {
  const box = document.createElement('pre');
  box.id = 'fps';
  Object.assign(box.style, {
    position: 'fixed', right: '8px', top: '8px', margin: '0', padding: '4px 7px', zIndex: '5', pointerEvents: 'none',
    color: '#cfe9ff', background: 'rgba(0,10,20,.55)', borderRadius: '4px', font: '11px/1.35 ui-monospace, Menlo, monospace',
  });
  parent.appendChild(box);
  const ring = new FrameRing();
  let sinceWrite = REFRESH_SECONDS; // write on the first frame
  return {
    frame(frameMs, calls, triangles) {
      ring.push(frameMs);
      sinceWrite += frameMs / 1000;
      if (sinceWrite < REFRESH_SECONDS) return;
      sinceWrite = 0;
      const s = frameStats(ring.values());
      box.textContent =
        `${s.fps.toFixed(0)} fps  ${s.meanMs.toFixed(1)} ms\n` +
        `1% low ${s.low1Fps.toFixed(0)}  worst ${s.worstMs.toFixed(0)} ms\n` +
        `calls ${calls}  tris ${(triangles / 1000).toFixed(0)}k`;
    },
  };
}
