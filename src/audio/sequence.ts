// The music scheduler's pure core (phase 4 S2): what to schedule between two times. music.ts calls `advance` once
// a frame with the audio clock and schedules what comes back; nothing here touches Web Audio, the DOM or
// a clock — time is always passed in (purity.test.ts holds it to that), so it is tested with a fake one.
//
// A play is a short list of segments laid end to end on the audio clock: [the left section's ending?] → the body
// → [its `then`?]. A looping body has no end; it plays until the next play replaces the sequence.

import { type Placed, type Score, type SectionId, placedBetween, sectionSeconds, sectionSteps, stepSeconds } from './score';

/** Seconds from a play call to its first hit (a hit scheduled in the past would sound late and clipped). */
export const START_DELAY = 0.05;
/** Schedule hits this far ahead of the clock each frame (the usual Web Audio look-ahead). */
export const LOOK_AHEAD = 0.2;

export interface Segment {
  id: SectionId;
  /** `ending`: the section's own ending (ROLL's brass hit), played as the section is left. */
  part: 'body' | 'ending';
  start: number;
  /** Infinity for a looping body. */
  end: number;
}

export interface Sequence {
  segments: Segment[];
  /** Everything before this time has been handed out. */
  cursor: number;
}

export interface Timed extends Placed {
  id: SectionId;
  part: Segment['part'];
  /** Audio-clock time of the hit. */
  time: number;
  /** The hit's length in seconds. */
  seconds: number;
}

export interface PlayOptions {
  then?: SectionId;
  /** Play the left section's ending first, if it has one (default true). */
  ending?: boolean;
}

/** The hits of one segment whose time lies in [fromTime, toTime). */
export function due(score: Score, seg: Segment, fromTime: number, toTime: number): Timed[] {
  const section = score.sections[seg.id];
  const ss = stepSeconds(score);
  const from = Math.max(fromTime, seg.start);
  const to = Math.min(toTime, seg.end);
  if (!(to > from)) return [];
  const body = seg.part === 'body';
  const tracks = body ? section.tracks : section.ending?.tracks;
  if (!tracks) return [];
  const length = body ? sectionSteps(section) : (section.ending?.steps ?? 0);
  const loop = body && section.loop;
  return placedBetween(tracks, length, loop, snap((from - seg.start) / ss), snap((to - seg.start) / ss)).map((h) => ({
    ...h,
    id: seg.id,
    part: seg.part,
    time: seg.start + h.step * ss,
    seconds: (h.len ?? 1) * ss,
  }));
}

/** Time → step leaves float dust (16.000000001); a bound within a hair of a step is that step. Deterministic, so
 *  consecutive windows still meet exactly. */
function snap(step: number): number {
  const r = Math.round(step);
  return Math.abs(step - r) < 1e-6 ? r : step;
}

/** The segment sounding (or about to) at `now`: the first that has not ended. */
function current(seq: Sequence | null, now: number): Segment | null {
  return seq?.segments.find((s) => s.end > now) ?? null;
}

/** A new sequence for `play(id)` at `now`, replacing `prev` (whose ending, if any, comes first). */
export function begin(score: Score, now: number, id: SectionId, opts: PlayOptions = {}, prev: Sequence | null = null): Sequence {
  const ss = stepSeconds(score);
  let t = now + START_DELAY;
  const segments: Segment[] = [];
  const left = current(prev, now);
  const ending = left && left.part === 'body' ? score.sections[left.id].ending : undefined;
  if (ending && opts.ending !== false) {
    segments.push({ id: left!.id, part: 'ending', start: t, end: t + ending.steps * ss });
    t += ending.steps * ss;
  }
  const body: Segment = { id, part: 'body', start: t, end: t + sectionSeconds(score, id) };
  segments.push(body);
  if (opts.then && body.end < Infinity) {
    segments.push({ id: opts.then, part: 'body', start: body.end, end: body.end + sectionSeconds(score, opts.then) });
  }
  return { segments, cursor: now };
}

/**
 * Everything due from where the last call stopped up to `now + ahead`. If the caller fell behind (a stalled frame),
 * the missed span is skipped rather than played late in a burst. With the clock stopped (a suspended context),
 * repeated calls hand out nothing new.
 */
export function advance(score: Score, seq: Sequence, now: number, ahead = LOOK_AHEAD): { hits: Timed[]; seq: Sequence } {
  const from = Math.max(seq.cursor, now);
  const to = now + ahead;
  if (!(to > from)) return { hits: [], seq };
  const hits = seq.segments.flatMap((s) => due(score, s, from, to)).sort((a, b) => a.time - b.time);
  return { hits, seq: { segments: seq.segments, cursor: to } };
}

/** What `Music.playing()` reports: the section asked for (an ending counts as the section that follows it); null once done. */
export function playingAt(seq: Sequence | null, now: number): SectionId | null {
  if (!seq) return null;
  const i = seq.segments.findIndex((s) => s.end > now);
  if (i < 0) return null;
  const s = seq.segments[i]!;
  return s.part === 'ending' ? (seq.segments[i + 1]?.id ?? s.id) : s.id;
}

/** True once every segment has ended (the sequence can be dropped). */
export function finished(seq: Sequence, now: number): boolean {
  return seq.segments.every((s) => s.end <= now);
}

/** When the body asked for starts (after any ending) — where a fade-in begins. */
export function bodyStart(seq: Sequence): number {
  return seq.segments.find((s) => s.part === 'body')?.start ?? seq.cursor;
}
