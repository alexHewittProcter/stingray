// The score (phase 4 S1, S2): an ORIGINAL march in the idiom of a brisk 1960s military-march TV theme — a solo
// snare drum playing rudiments (flams, ruffs, rolls, a fast tattoo), a bass drum, timpani, a brass section and a
// bass. The melody, harmony and form are this game's own; nothing here is transcribed from, or approximates, any
// existing theme. Pure data and pure helpers: no Web Audio, no DOM, no clock (purity.test.ts holds it to that).
//
// Tempo 152 bpm, 4/4, G minor (the bridge passes through B♭ major; the home sting ends on a G major chord).
// A step is a sixteenth note; a bar is 16 steps. Notes are MIDI numbers (60 = middle C, 67 = G4).
//
// Tune by number here. Levels are in levels.ts (LEVELS.musicBus, LEVELS.music).

export type Instrument = 'snare' | 'kick' | 'timp' | 'brass' | 'bass';
export const INSTRUMENTS: readonly Instrument[] = ['snare', 'kick', 'timp', 'brass', 'bass'];
/** The instruments whose hits carry a `note`. */
export const PITCHED: readonly Instrument[] = ['timp', 'brass', 'bass'];

export type SectionId = 'FANFARE' | 'MARCH' | 'BRIDGE' | 'ROLL' | 'STING_HOME' | 'STING_END' | 'ALERT';
export const SECTION_IDS: readonly SectionId[] = ['FANFARE', 'MARCH', 'BRIDGE', 'ROLL', 'STING_HOME', 'STING_END', 'ALERT'];

export interface Hit {
  /** Sixteenth-note step from the section's top. */
  step: number;
  /** MIDI note (pitched instruments only). */
  note?: number;
  /** 0–1. */
  vel: number;
  /** Length in steps (default 1). */
  len?: number;
  /** Sub-hits per step across `len` (a roll), with a rising gain. Snare and timpani. */
  roll?: number;
  /** A grace stroke just ahead of the hit (snare). */
  flam?: boolean;
  /** Further pitches sounded with `note`, in semitones from it (brass: a section voicing). */
  chord?: number[];
}

export type Tracks = Record<Instrument, Hit[]>;

export interface Section {
  bars: number;
  loop: boolean;
  tracks: Tracks;
  /** Played once when a looping section is left for another (`play`), before the next starts: ROLL's brass hit. */
  ending?: { steps: number; tracks: Tracks };
  /** In-world (the base's PA): plays through the effects bus, taking the room and the muffle (S2). */
  diegetic?: boolean;
  /** A recorded clip the section plays instead of (or as well as) its tracks: ALERT's Launch Stations signal. */
  clip?: Clip;
}

/**
 * A sampled asset under public/ (fetched and decoded once by music.ts). A looping section sounds it from its top
 * every `seconds` + the caller's gap (LEVELS.alertGap): a signal, retriggered, not a drone.
 */
export interface Clip {
  /** Path under the site's base, e.g. 'sfx/launch-stations.wav'. */
  url: string;
  /** The file's length (s). score.test.ts reads the WAV's header and holds it to this. */
  seconds: number;
}

/**
 * The "Launch Stations" PA drum signal: an original modelled recreation, made by tools/launch-stations.py (180 bpm,
 * three 4/4 bars — the drumming fills ≈ 3.65 s and the file ends on the bar, at 4.000 s). See public/sfx/README.md.
 */
export const LAUNCH_STATIONS: Clip = { url: 'sfx/launch-stations.wav', seconds: 4 };

export interface Score {
  bpm: number;
  stepsPerBeat: 4;
  sections: Record<SectionId, Section>;
}

const BAR = 16;

// ── Small builders (pure) ──────────────────────────────────────────────────────────────────────────────────────

/** A pitched note within a bar: [step, note, len, vel?, chord?]. */
type N = [number, number, number, number?, number[]?];
/** A drum stroke within a bar: [step, vel, options?]. */
type D = [number, number, Partial<Pick<Hit, 'flam' | 'roll' | 'len'>>?];

function empty(): Tracks {
  return { snare: [], kick: [], timp: [], brass: [], bass: [] };
}

/** Bars of notes, one array per bar, from bar `first`; `vel` is the default, `scale` multiplies every vel. */
function notes(bars: N[][], first = 0, vel = 0.78, scale = 1): Hit[] {
  return bars.flatMap((bar, i) =>
    bar.map(([step, note, len, v, chord]) => {
      const h: Hit = { step: (first + i) * BAR + step, note, len, vel: round((v ?? vel) * scale) };
      if (chord) h.chord = chord;
      return h;
    }),
  );
}

/** One bar of drum strokes placed at bar `bar`. */
function drums(bar: number, strokes: D[], scale = 1): Hit[] {
  return strokes.map(([step, vel, o]) => ({ step: bar * BAR + step, vel: round(vel * scale), ...(o ?? {}) }));
}

/** A quarter-note bass: four notes a bar, each `len` steps. */
function quarters(bars: number[][], first = 0, vel = 0.7, len = 3): Hit[] {
  return bars.flatMap((four, i) => four.map((note, beat) => ({ step: (first + i) * BAR + beat * 4, note, len, vel })));
}

function round(v: number): number {
  return Math.round(Math.min(1, v) * 1000) / 1000;
}

// ── The material ──────────────────────────────────────────────────────────────────────────────────────────────

// The march snare: light taps, flammed backbeats on 2 and 4, a ruff into each downbeat.
const SNARE_MARCH: D[] = [
  [0, 0.55],
  [2, 0.28],
  [3, 0.34],
  [4, 0.88, { flam: true }],
  [6, 0.28],
  [7, 0.34],
  [8, 0.55],
  [10, 0.28],
  [11, 0.34],
  [12, 0.88, { flam: true }],
  [14, 0.45, { roll: 3, len: 2 }],
];
// Every fourth bar: a fill that drives into the next phrase.
const SNARE_FILL: D[] = [
  [0, 0.6],
  [4, 0.9, { flam: true }],
  [6, 0.4],
  [7, 0.45],
  [8, 0.55, { roll: 3, len: 4 }],
  [12, 0.95, { flam: true }],
  [13, 0.55],
  [14, 0.65],
  [15, 0.75],
];
// Softer, for the bridge: backbeats and ghost strokes.
const SNARE_LIGHT: D[] = [
  [0, 0.3],
  [3, 0.18],
  [4, 0.5, { flam: true }],
  [7, 0.2],
  [8, 0.3],
  [11, 0.18],
  [12, 0.5, { flam: true }],
  [14, 0.22],
  [15, 0.26],
];

// The tattoo: the alarm figure — flams, a quick ruff and driving sixteenths; the second bar answers the first and
// climbs to a roll. Opens the FANFARE. (The ALERT was this tattoo alone until it became the sampled Launch Stations
// signal, LAUNCH_STATIONS.)
const TATTOO_A: D[] = [
  [0, 0.92, { flam: true }],
  [1, 0.42],
  [2, 0.55],
  [3, 0.68],
  [4, 0.9, { flam: true }],
  [6, 0.55],
  [7, 0.68],
  [8, 0.7, { roll: 3, len: 2 }],
  [10, 0.92, { flam: true }],
  [12, 0.55],
  [13, 0.6],
  [14, 0.7],
  [15, 0.8],
];
const TATTOO_B: D[] = [
  [0, 0.95, { flam: true }],
  [2, 0.55],
  [3, 0.6],
  [4, 0.9, { flam: true }],
  [5, 0.45],
  [6, 0.58],
  [7, 0.7],
  [8, 0.72, { roll: 3, len: 4 }],
  [12, 0.98, { flam: true }],
  [14, 0.72],
  [15, 0.85],
];

// The tune: four four-bar phrases — a statement, its answer, a turn to the relative major, and the statement
// again closing home. Written for this game.
const TUNE: N[][] = [
  // A — G minor
  [[0, 74, 3, 0.85], [3, 74, 1], [4, 79, 4], [8, 77, 3], [11, 75, 1], [12, 74, 4]],
  [[0, 72, 2, 0.82], [2, 75, 2], [4, 79, 3], [7, 77, 1], [8, 75, 4], [12, 72, 4]],
  [[0, 69, 3, 0.82], [3, 74, 1], [4, 78, 4], [8, 74, 2], [10, 72, 2], [12, 69, 4]],
  [[0, 70, 3, 0.8], [3, 69, 1], [4, 67, 8, 0.8, [-5]], [14, 74, 2]],
  // A′ — the answer climbs higher
  [[0, 74, 3, 0.85], [3, 74, 1], [4, 79, 4], [8, 82, 3, 0.88], [11, 81, 1], [12, 79, 4]],
  [[0, 79, 3, 0.82], [3, 77, 1], [4, 75, 4], [8, 70, 3], [11, 72, 1], [12, 75, 4]],
  [[0, 75, 2], [2, 74, 2], [4, 72, 2], [6, 70, 2], [8, 69, 3], [11, 70, 1], [12, 72, 2], [14, 66, 2]],
  [[0, 67, 6, 0.85, [-5]], [8, 62, 2, 0.7], [10, 65, 2, 0.72], [12, 69, 2, 0.75], [14, 72, 2, 0.78]],
  // B — B♭ major, broader
  [[0, 74, 6, 0.82, [-4]], [6, 72, 2], [8, 70, 4], [12, 74, 4]],
  [[0, 72, 6, 0.8, [-3]], [6, 70, 2], [8, 69, 4], [12, 65, 4]],
  [[0, 67, 3, 0.8], [3, 70, 1], [4, 75, 4, 0.84], [8, 74, 2], [10, 72, 2], [12, 70, 4]],
  [[0, 69, 3, 0.8], [3, 72, 1], [4, 74, 4], [8, 78, 8, 0.9, [-4, -9]]],
  // A″ — the statement, closing on G with two stabs and a pickup back to the top
  [[0, 74, 3, 0.85], [3, 74, 1], [4, 79, 4], [8, 77, 3], [11, 75, 1], [12, 74, 4]],
  [[0, 72, 2, 0.82], [2, 75, 2], [4, 79, 3], [7, 77, 1], [8, 75, 4], [12, 72, 4]],
  [[0, 72, 3, 0.82], [3, 70, 1], [4, 69, 4], [8, 66, 4], [12, 69, 4]],
  [[0, 67, 6, 0.9, [-5, -12]], [8, 79, 2, 0.95, [-5, -12]], [12, 74, 2, 0.72]],
];

// The bass: root and fifth on the beat, walking into the turns.
const BASS: number[][] = [
  [43, 50, 43, 50], // Gm
  [48, 43, 48, 43], // Cm
  [38, 42, 45, 48], // D7
  [43, 50, 43, 38], // Gm
  [43, 50, 43, 50], // Gm
  [39, 46, 39, 46], // E♭
  [48, 43, 38, 45], // Cm | D
  [43, 50, 43, 45], // Gm → F7
  [46, 41, 46, 41], // B♭
  [41, 48, 41, 45], // F
  [39, 46, 39, 43], // E♭
  [38, 45, 38, 42], // D
  [43, 50, 43, 50], // Gm
  [48, 43, 48, 43], // Cm
  [38, 45, 38, 42], // D7
  [43, 50, 43, 38], // Gm → back to the top
];

function march(): Tracks {
  const t = empty();
  for (let bar = 0; bar < 16; bar++) {
    const fill = bar % 4 === 3;
    t.snare.push(...drums(bar, fill ? SNARE_FILL : SNARE_MARCH));
    t.kick.push(...drums(bar, fill ? [[0, 0.75], [8, 0.6], [12, 0.7]] : [[0, 0.75], [8, 0.55]]));
  }
  t.brass = notes(TUNE);
  t.bass = quarters(BASS);
  // Timpani: the phrase heads, the dominant before each return, and a roll into the loop.
  t.timp = [
    { step: 0, note: 43, vel: 0.8, len: 4 },
    { step: 2 * BAR + 8, note: 38, vel: 0.55, len: 4 },
    { step: 4 * BAR, note: 43, vel: 0.75, len: 4 },
    { step: 7 * BAR, note: 43, vel: 0.7, len: 4 },
    { step: 8 * BAR, note: 46, vel: 0.75, len: 4 },
    { step: 11 * BAR, note: 38, vel: 0.65, len: 4 },
    { step: 11 * BAR + 8, note: 38, vel: 0.8, len: 4 },
    { step: 12 * BAR, note: 43, vel: 0.8, len: 4 },
    { step: 14 * BAR, note: 38, vel: 0.6, len: 4 },
    { step: 15 * BAR, note: 43, vel: 0.85, len: 6 },
    { step: 15 * BAR + 8, note: 38, vel: 0.55, len: 8, roll: 2 },
  ];
  return t;
}

function fanfare(): Tracks {
  const t = empty();
  // Bars 1–2: the tattoo, alone.
  t.snare.push(...drums(0, TATTOO_A), ...drums(1, TATTOO_B));
  // Bars 3–4: horn calls in open fourths and fifths over the march snare.
  t.snare.push(...drums(2, SNARE_MARCH, 0.9), ...drums(3, SNARE_FILL));
  t.brass = notes(
    [
      [[0, 62, 2, 0.85, [5]], [2, 67, 2, 0.85, [7]], [4, 74, 6, 0.9, [-5]], [10, 72, 2, 0.8, [-5]], [12, 74, 4, 0.85, [-7]]],
      [[0, 79, 4, 0.92, [-7]], [4, 77, 2, 0.82, [-5]], [6, 74, 2, 0.82, [-5]], [8, 67, 8, 0.95, [7, 12, -12]]],
    ],
    2,
  );
  t.kick = [...drums(2, [[0, 0.8], [8, 0.6]]), ...drums(3, [[0, 0.8], [8, 0.85]])];
  t.timp = [
    { step: 2 * BAR, note: 43, vel: 0.85, len: 4 },
    { step: 2 * BAR + 8, note: 50, vel: 0.65, len: 4 },
    { step: 3 * BAR, note: 38, vel: 0.75, len: 4 },
    { step: 3 * BAR + 8, note: 43, vel: 0.85, len: 8, roll: 2 },
  ];
  t.bass = [
    { step: 2 * BAR, note: 43, vel: 0.7, len: 14 },
    { step: 3 * BAR, note: 38, vel: 0.7, len: 6 },
    { step: 3 * BAR + 8, note: 43, vel: 0.75, len: 8 },
  ];
  return t;
}

function bridge(): Tracks {
  // The B and A″ material of the march, softer: no stabs, brass down, the snare on ghost strokes.
  const t = empty();
  for (let bar = 0; bar < 8; bar++) {
    t.snare.push(...drums(bar, SNARE_LIGHT));
    t.kick.push(...drums(bar, [[0, 0.45]]));
  }
  t.brass = notes(
    TUNE.slice(8, 16).map((bar) => bar.map(([s, n, l, v]) => [s, n, l, v] as N)),
    0,
    0.78,
    0.62,
  );
  t.bass = quarters(BASS.slice(8, 16), 0, 0.55);
  t.timp = [
    { step: 0, note: 46, vel: 0.5, len: 4 },
    { step: 4 * BAR, note: 43, vel: 0.5, len: 4 },
    { step: 7 * BAR, note: 43, vel: 0.55, len: 6 },
  ];
  return t;
}

function roll(): Section {
  // An open-ended roll over a dominant pedal; it swells each bar and the timpani punctuate. It loops until left,
  // and leaving it lands the brass hit (G minor, full) with a pickup into whatever comes next. The build with the
  // descent comes from the player (Music.setIntensity, S3), not from the data.
  const t = empty();
  t.snare = [
    { step: 0, vel: 0.7, len: 8, roll: 3 },
    { step: 8, vel: 0.76, len: 8, roll: 3 },
    { step: 16, vel: 0.82, len: 8, roll: 3 },
    { step: 24, vel: 0.9, len: 8, roll: 3 },
  ];
  t.kick = [{ step: 0, vel: 0.5 }, { step: 16, vel: 0.55 }];
  t.timp = [
    { step: 0, note: 38, vel: 0.65, len: 4 },
    { step: 4, note: 38, vel: 0.4, len: 4 },
    { step: 8, note: 45, vel: 0.55, len: 4 },
    { step: 12, note: 38, vel: 0.45, len: 4 },
    { step: 16, note: 38, vel: 0.6, len: 8, roll: 2 },
    { step: 24, note: 45, vel: 0.75, len: 8, roll: 2 },
  ];
  t.bass = [
    { step: 0, note: 38, vel: 0.5, len: 16 },
    { step: 16, note: 38, vel: 0.55, len: 16 },
  ];
  const hit = empty();
  hit.brass = [{ step: 0, note: 67, vel: 1, len: 8, chord: [-12, -5, 3, 7] }];
  hit.kick = [{ step: 0, vel: 1 }];
  hit.timp = [{ step: 0, note: 43, vel: 1, len: 8 }];
  hit.bass = [{ step: 0, note: 43, vel: 0.85, len: 8 }];
  hit.snare = drums(0, [[0, 1, { flam: true }], [12, 0.5], [13, 0.6], [14, 0.7], [15, 0.82]]);
  return { bars: 2, loop: true, tracks: t, ending: { steps: BAR, tracks: hit } };
}

function stingHome(): Tracks {
  // A cadence home: iv – V7 – I, the minor turning major on the last chord.
  const t = empty();
  t.snare = [...drums(0, SNARE_MARCH, 0.8), ...drums(1, [[0, 0.6], [4, 0.85, { flam: true }], [8, 0.7, { roll: 3, len: 8 }]]), ...drums(3, [[0, 0.95, { flam: true }]])];
  t.kick = [...drums(0, [[0, 0.7], [8, 0.55]]), ...drums(1, [[0, 0.7], [8, 0.6]]), ...drums(2, [[0, 0.9]]), ...drums(3, [[0, 0.8]])];
  t.brass = notes([
    [[0, 79, 6, 0.85, [-4, -7]], [8, 77, 6, 0.82, [-5, -9]]], // Cm, then F (passing)
    [[0, 78, 6, 0.88, [-6, -9]], [8, 74, 6, 0.85, [-4, -9]]], // D7 — the leading tone over C and A, then D over B♭
    [[0, 79, 16, 0.95, [-5, -8, -12]]], // G major, held
    [[0, 79, 4, 0.9, [-5, -8, -12, -24]]], // and struck once more
  ]);
  t.timp = [
    { step: 0, note: 48, vel: 0.6, len: 4 },
    { step: BAR, note: 38, vel: 0.7, len: 4 },
    { step: 2 * BAR, note: 43, vel: 0.75, len: 12, roll: 2 },
    { step: 3 * BAR, note: 43, vel: 1, len: 8 },
  ];
  t.bass = [
    { step: 0, note: 48, vel: 0.7, len: 6 },
    { step: 8, note: 41, vel: 0.65, len: 6 },
    { step: BAR, note: 38, vel: 0.72, len: 6 },
    { step: BAR + 8, note: 45, vel: 0.68, len: 6 },
    { step: 2 * BAR, note: 43, vel: 0.8, len: 14 },
    { step: 3 * BAR, note: 31, vel: 0.85, len: 8 },
  ];
  return t;
}

function stingEnd(): Tracks {
  // A tag: two short calls on D, a ruff, and the tonic struck.
  const t = empty();
  t.snare = [...drums(0, [[0, 0.8, { flam: true }], [2, 0.45], [3, 0.55], [4, 0.85, { flam: true }], [8, 0.5], [10, 0.55], [12, 0.6, { roll: 3, len: 4 }]]), ...drums(1, [[0, 0.95, { flam: true }]])];
  t.kick = [...drums(0, [[0, 0.65], [8, 0.5]]), ...drums(1, [[0, 0.9]])];
  t.brass = notes([
    [[0, 74, 2, 0.8, [-5]], [4, 74, 2, 0.8, [-5]], [8, 70, 2, 0.78, [-3]], [10, 72, 2, 0.8, [-3]]],
    [[0, 67, 8, 0.95, [-12, 7]]],
  ]);
  t.timp = [{ step: 8, note: 38, vel: 0.55, len: 4 }, { step: BAR, note: 43, vel: 0.9, len: 8 }];
  t.bass = [{ step: 0, note: 38, vel: 0.6, len: 8 }, { step: BAR, note: 43, vel: 0.8, len: 8 }];
  return t;
}

export const SCORE: Score = {
  // 152: brisk, inside the idiom's 150–160 (research §4), a touch under the top so the sixteenth-note tattoo
  // (≈ 10 strokes a second) and the three-to-a-step rolls stay articulate on synthesised drums.
  bpm: 152,
  stepsPerBeat: 4,
  sections: {
    FANFARE: { bars: 4, loop: false, tracks: fanfare() },
    MARCH: { bars: 16, loop: true, tracks: march() },
    BRIDGE: { bars: 8, loop: false, tracks: bridge() },
    ROLL: roll(),
    STING_HOME: { bars: 4, loop: false, tracks: stingHome() },
    STING_END: { bars: 2, loop: false, tracks: stingEnd() },
    // The PA's Launch Stations signal: a sampled clip, no tracks. It is SFX (the effects bus, the Music switch does not
    // silence it); `bars` only keeps the section's shape for the scheduler — the clip's own timing is in LAUNCH_STATIONS.
    ALERT: { bars: 1, loop: true, tracks: empty(), diegetic: true, clip: LAUNCH_STATIONS },
  },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Seconds per step (a sixteenth note). */
export function stepSeconds(score: Pick<Score, 'bpm' | 'stepsPerBeat'>): number {
  return 60 / score.bpm / score.stepsPerBeat;
}

export function sectionSteps(section: Pick<Section, 'bars'>): number {
  return section.bars * BAR;
}

/** The section's length in seconds; Infinity when it loops (it plays until it is left). */
export function sectionSeconds(score: Score, id: SectionId): number {
  const s = score.sections[id];
  return s.loop ? Infinity : sectionSteps(s) * stepSeconds(score);
}

export interface Placed extends Hit {
  inst: Instrument;
}

/**
 * The hits whose step lies in [fromStep, toStep) (fractional bounds allowed), in step order. For a looping section
 * steps are absolute — the hit at step 4 of its second pass comes back at 4 + its length — so consecutive windows
 * hand each hit out exactly once.
 */
export function hitsBetween(section: Section, fromStep: number, toStep: number): Placed[] {
  return placedBetween(section.tracks, sectionSteps(section), section.loop, fromStep, toStep);
}

export function placedBetween(tracks: Tracks, length: number, loop: boolean, fromStep: number, toStep: number): Placed[] {
  const out: Placed[] = [];
  if (!(toStep > fromStep)) return out;
  const firstPass = loop ? Math.max(0, Math.floor(fromStep / length)) : 0;
  const lastPass = loop ? Math.floor(toStep / length) : 0;
  for (let pass = firstPass; pass <= lastPass; pass++) {
    const base = pass * length;
    for (const inst of INSTRUMENTS) {
      for (const h of tracks[inst]) {
        const step = base + h.step;
        if (step >= fromStep && step < toStep) out.push({ ...h, step, inst });
      }
    }
  }
  return out.sort((a, b) => a.step - b.step || INSTRUMENTS.indexOf(a.inst) - INSTRUMENTS.indexOf(b.inst));
}

/** MIDI note → Hz (A4 = 69 = 440 Hz). */
export function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
