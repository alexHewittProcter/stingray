// music.ts's clip path (the ALERT: the Launch Stations signal) over a fake AudioContext — headless runs have no Web
// Audio, so the nodes are records: what connects to what, which gains are set, which buffer sources start when.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from './levels';
import type { Mixer } from './mixer';
import { createMusic } from './music';
import { LAUNCH_STATIONS, SCORE, type Score } from './score';
import { LOOK_AHEAD, START_DELAY } from './sequence';

interface FakeParam {
  value: number;
  targets: number[];
  setTargetAtTime(v: number): void;
  cancelScheduledValues(): void;
  setValueAtTime(): void;
  linearRampToValueAtTime(): void;
}
interface FakeNode {
  kind: string;
  to: FakeNode[];
  gain: FakeParam;
  connect(n: FakeNode): FakeNode;
  disconnect(): void;
}
interface FakeSource extends FakeNode {
  buffer: unknown;
  started: number | null;
  stopped: number | null;
  onended: (() => void) | null;
  start(t: number): void;
  stop(t: number): void;
}

function param(value: number): FakeParam {
  return {
    value,
    targets: [],
    setTargetAtTime(v) {
      this.targets.push(v);
    },
    cancelScheduledValues: () => undefined,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
  };
}

function node(kind: string, value = 1): FakeNode {
  return {
    kind,
    to: [],
    gain: param(value),
    connect(n) {
      this.to.push(n);
      return n;
    },
    disconnect() {
      this.to = [];
    },
  };
}

function setUp(fetchOk = true) {
  const sources: FakeSource[] = [];
  const decoded = { duration: LAUNCH_STATIONS.seconds };
  const ctx = {
    currentTime: 0,
    createGain: () => node('gain'),
    createBufferSource: () => {
      const s: FakeSource = {
        ...node('source'),
        buffer: null,
        started: null,
        stopped: null,
        onended: null,
        start(t) {
          this.started = t;
        },
        stop(t) {
          this.stopped = t;
        },
      };
      sources.push(s);
      return s;
    },
    decodeAudioData: vi.fn(async () => decoded),
  };
  const fetchMock = vi.fn(async () =>
    fetchOk ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) },
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  const music = node('musicBus', LEVELS.musicBus);
  const effects = node('effectsBus', LEVELS.effectsBus);
  const m = { ctx, music, effects } as unknown as Mixer;
  // The real score, but STING_END silent: the fake context has no oscillators for playHit.
  const silent = { snare: [], kick: [], timp: [], brass: [], bass: [] };
  const score: Score = { ...SCORE, sections: { ...SCORE.sections, STING_END: { bars: 2, loop: false, tracks: silent } } };
  const mus = createMusic(m, score);
  return { ctx, sources, fetchMock, music, effects, mus, decoded };
}

/** Let the fetch → arrayBuffer → decode promise chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('music.ts: the ALERT plays the Launch Stations clip', () => {
  it('fetches the WAV once, when the music is made, from the site base', () => {
    const { fetchMock } = setUp();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/${LAUNCH_STATIONS.url}`);
  });

  it('plays through the diegetic send into the effects bus — not the music bus — at LEVELS.alert', async () => {
    const t = setUp();
    await settle();
    t.mus.play('ALERT');
    const src = t.sources[0]!;
    expect(src.buffer).toBe(t.decoded);
    expect(src.started).toBeCloseTo(START_DELAY, 9);
    const out = src.to[0]!;
    const send = out.to[0]!;
    expect(send.to).toEqual([t.effects]);
    expect(send.gain.value).toBe(LEVELS.alert);
    expect(t.music.to).toEqual([]);
  });

  it('the Music switch (setLevel) does not touch it: SFX, heard with the music off', async () => {
    const t = setUp();
    await settle();
    t.mus.play('ALERT');
    const send = t.sources[0]!.to[0]!.to[0]!;
    t.mus.setLevel(0);
    t.mus.setLevel(LEVELS.musicBus);
    expect(t.music.gain.targets).toEqual([0, LEVELS.musicBus]);
    expect(send.gain.targets).toEqual([]);
    expect(send.gain.value).toBe(LEVELS.alert);
  });

  it('sounds again every clip length + LEVELS.alertGap, on the audio clock', async () => {
    const t = setUp();
    await settle();
    t.mus.play('ALERT');
    const period = LAUNCH_STATIONS.seconds + LEVELS.alertGap;
    for (let now = 0; now < 3 * period - LOOK_AHEAD; now += 1 / 60) {
      t.ctx.currentTime = now;
      t.mus.frame();
    }
    expect(t.sources.map((s) => s.started)).toEqual([0, 1, 2].map((k) => expect.closeTo(START_DELAY + k * period, 9)));
    expect(t.mus.playing()).toBe('ALERT');
  });

  it('a sounding due before the decode landed starts from its top when it lands (within the grace)', async () => {
    const t = setUp();
    t.mus.play('ALERT'); // the first gesture: the fetch is still in flight
    expect(t.sources).toEqual([]);
    t.ctx.currentTime = 0.3;
    await settle();
    t.mus.frame();
    expect(t.sources.length).toBe(1);
    expect(t.sources[0]!.started).toBeCloseTo(0.3 + START_DELAY, 9);
  });

  it('stop fades it and stops its sources; playing another section replaces it', async () => {
    const t = setUp();
    await settle();
    t.mus.play('ALERT');
    t.ctx.currentTime = 1;
    t.mus.stop(1);
    expect(t.sources[0]!.stopped).toBeGreaterThan(1);
    expect(t.mus.playing()).toBeNull();
    t.mus.play('ALERT');
    t.ctx.currentTime = 1.5;
    t.mus.play('STING_END');
    expect(t.sources[1]!.stopped).not.toBeNull();
    for (let now = 1.5; now < 20; now += 1 / 60) {
      t.ctx.currentTime = now;
      t.mus.frame();
    }
    expect(t.sources.length).toBe(2); // no more soundings once the ALERT is left
  });

  it('a failed fetch leaves the ALERT silent and nothing throws', async () => {
    const t = setUp(false);
    await settle();
    t.mus.play('ALERT');
    for (let now = 0; now < 12; now += 1 / 60) {
      t.ctx.currentTime = now;
      t.mus.frame();
    }
    expect(t.sources).toEqual([]);
    expect(t.mus.playing()).toBe('ALERT');
  });
});
