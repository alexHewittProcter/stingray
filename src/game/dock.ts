// Dock guidance (phase 2, L6 "dock guidance on the HUD", T6) — pure, no DOM. On the way home, from the last bend
// of the tunnel to the lock, it says where the lowered cradle is relative to the craft, where the craft would come
// to rest if the pilot let go now, whether each of L3's lock conditions holds, and the one thing to do next.
// render/dock-guide.ts draws it; it never writes sim state, and its "ready" is exactly the sim's: a press of 3 is
// accepted precisely when refusalFor('clamps', …) is null.

import { REFUSAL, type GameState, refusalFor } from '../sim/launch';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import type { Interior } from '../sim/world';
import type { PanelMemory } from './panel';

/** The guide shows once the hull centre is this close to the lowered cradle position (the tunnel's last bend). */
export const DOCK_GUIDE_RANGE = 80; // m

/** A point in the craft's frame, level: ahead of the nose, to starboard, above. Metres. */
export interface CraftFrame {
  ahead: number;
  right: number;
  up: number;
}

export interface DockView {
  /** Hull centre to the lowered cradle position, m. */
  distance: number;
  /** Where the cradle position is, seen from the hull centre in the craft's (level) frame. */
  berth: CraftFrame;
  /** Where the cradle position is, seen from where the craft would coast to rest if the pilot let go now. */
  coast: CraftFrame;
  /** The berth's heading relative to the craft's, radians, counter-clockwise from above (the nearer axis direction). */
  berthTurn: number;
  /** The lock zone's horizontal radius at the craft's current height off the berth (0 when too high or low). */
  ringRadius: number;
  speed: number;
  /** Degrees off the pen's axis (the nearer direction) and off level. */
  alignDegrees: number;
  pitchDegrees: number;
  over: boolean;
  slow: boolean;
  lined: boolean;
  /** A press of 3 would lock the clamps: refusalFor('clamps', …) is null. */
  ready: boolean;
  /** The one thing to do next, in capitals. */
  hint: string;
}

const DEG = 180 / Math.PI;
/** Below this the craft counts as stopped for the "let go" advice, m/s. */
const DRIFT = 0.8;

/** The guide, or null when it does not show: only on the way home, released, near the cradle, in 'launch' presentation. */
export function dockView(g: GameState, m: PanelMemory, interior: Interior): DockView | null {
  const l = g.launch;
  if (m.shown !== 'launch' || m.trip !== 'home' || l.clamps !== 'released') return null;
  const c = interior.cradle;
  const target: Vec3 = { x: c.pos.x, y: c.loweredY, z: c.pos.z };
  const s = g.sub;
  const distance = Math.hypot(target.x - s.pos.x, target.y - s.pos.y, target.z - s.pos.z);
  if (distance > DOCK_GUIDE_RANGE) return null;

  const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  const right = { x: Math.cos(s.yaw), z: -Math.sin(s.yaw) };
  const toFrame = (from: Vec3): CraftFrame => {
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    return { ahead: dx * fwd.x + dz * fwd.z, right: dx * right.x + dz * right.z, up: target.y - from.y };
  };

  // Letting go: speed along the nose coasts down at coastDecel, drift off it decays at sideDrag (stepSub's swim).
  const along = s.vel.x * fwd.x + s.vel.z * fwd.z;
  const side = s.vel.x * right.x + s.vel.z * right.z;
  const run = (Math.sign(along) * along * along) / (2 * T.coastDecel);
  const drift = side / T.sideDrag;
  const rest = { x: s.pos.x + fwd.x * run + right.x * drift, y: s.pos.y, z: s.pos.z + fwd.z * run + right.z * drift };

  const berthYaw = Math.abs(wrap(s.yaw - c.yawOut)) <= Math.PI / 2 ? c.yawOut : wrap(c.yawOut + Math.PI);
  const berthTurn = wrap(berthYaw - s.yaw);
  const berth = toFrame(s.pos);
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  const reason = refusalFor('clamps', l, s, interior);
  const view: DockView = {
    distance,
    berth,
    coast: toFrame(rest),
    berthTurn,
    ringRadius: Math.sqrt(Math.max(0, T.lockRadius ** 2 - berth.up ** 2)),
    speed,
    alignDegrees: Math.abs(berthTurn) * DEG,
    pitchDegrees: s.pitch * DEG,
    over: distance <= T.lockRadius,
    slow: speed < T.lockSpeed,
    lined: Math.abs(berthTurn) <= T.lockHeading && Math.abs(s.pitch) <= T.lockPitch,
    ready: reason === null,
    hint: '',
  };
  view.hint = hintFor(view, reason);
  return view;
}

function hintFor(v: DockView, reason: string | null): string {
  if (reason === null) return 'PRESS 3 — LOCK THE CLAMPS';
  if (reason === REFUSAL.notOver) {
    // Let go once she would come to rest no more than half the zone short of the cradle: a pilot a quarter of a
    // second slow still stops inside it, even at the tunnel's 15 m/s.
    const coastIn = Math.hypot(v.coast.ahead, v.coast.right, v.coast.up) <= T.lockRadius && v.coast.ahead <= T.lockRadius / 2;
    if (v.speed > DRIFT && coastIn) return 'LET GO OF W — SHE WILL COAST ONTO THE CRADLE';
    if (v.speed > DRIFT && v.berth.ahead > 0 && v.coast.ahead < -T.lockRadius) return 'EASE OFF — YOU WILL OVERSHOOT';
    const flat = Math.hypot(v.berth.ahead, v.berth.right);
    if (Math.abs(v.berth.up) > flat || (Math.abs(v.berth.up) > v.ringRadius && flat < T.lockRadius)) {
      return v.berth.up > 0 ? `CLIMB ${metres(v.berth.up)} — E` : `DIVE ${metres(-v.berth.up)} — Q`;
    }
    if (Math.abs(v.berth.right) > Math.abs(v.berth.ahead)) {
      return v.berth.right > 0 ? `CRADLE ${metres(v.berth.right)} TO STARBOARD` : `CRADLE ${metres(-v.berth.right)} TO PORT`;
    }
    return v.berth.ahead > 0 ? `CRADLE ${metres(v.berth.ahead)} AHEAD — W` : `CRADLE ${metres(-v.berth.ahead)} ASTERN — S TO BACK UP`;
  }
  if (reason === REFUSAL.tooFast) return 'TOO FAST — LET GO OF W';
  // Not lined up: heading first (the cradle turns the craft only once locked), then pitch.
  if (Math.abs(v.berthTurn) > T.lockHeading) {
    return `LINE UP — TURN ${v.berthTurn > 0 ? 'LEFT (A)' : 'RIGHT (D)'} ${Math.round(v.alignDegrees)}°`;
  }
  return 'LEVEL OFF';
}

const metres = (m: number) => `${m < 10 ? m.toFixed(1) : Math.round(m)} M`;

function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
