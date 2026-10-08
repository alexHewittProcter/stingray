// Orbiting the camera around Stingray (phase 2, T9) — pure state, no DOM. main.ts feeds it mouse drags, the wheel
// and the J/L/I/K/C keys; camera-rig.ts swings its normal pose (chase, or the pen camera while clamped) by it,
// before the walls are applied, so an orbited camera obeys the same walls, cliff and seabed as the normal one.
//
//   - Drag (or J/L, I/K) swings the view around the craft: yaw all the way round, pitch from a little below level to
//     steeply above; the wheel zooms the boom. Offsets are relative to the normal camera, so the orbit turns with
//     the craft.
//   - On release the view holds where it was left.
//   - It eases back to the normal camera (over RETURN_SECONDS, never a snap) on C or a double-click, or by itself
//     once the craft has been steered or throttled for DRIVE_RETURN_SECONDS.
//   - With no offsets the normal camera is untouched (weight 0).

export const PITCH_MIN = -0.5; // rad, offset range
export const PITCH_MAX = 1.3;
/** Absolute elevation of the orbited boom above the horizontal: a little below level to steeply above. */
export const ELEVATION_MIN = -0.2;
export const ELEVATION_MAX = 1.35;
export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 1.8;
export const RETURN_SECONDS = 0.8;
export const DRIVE_RETURN_SECONDS = 2;
/** Radians per pixel of drag. */
export const DRAG_RATE = 0.006;
/** Radians per second for the keys. */
export const KEY_RATE = 1.6;

export interface OrbitState {
  yaw: number;
  pitch: number;
  /** Boom length multiplier. */
  zoom: number;
  /** A drag is in progress. */
  dragging: boolean;
  /** 1 while the orbit holds; falls to 0 over RETURN_SECONDS while returning. */
  weight: number;
  returning: boolean;
  /** Seconds the craft has been driven while orbited (not dragging). */
  driven: number;
}

export const initialOrbit = (): OrbitState => ({ yaw: 0, pitch: 0, zoom: 1, dragging: false, weight: 0, returning: false, driven: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The orbit as the rig applies it: offsets already scaled by the eased weight; k = that weight (0 = untouched). */
export interface OrbitView {
  yaw: number;
  pitch: number;
  zoom: number;
  k: number;
}

export function orbitView(s: OrbitState): OrbitView {
  const k = smooth(clamp(s.weight, 0, 1));
  return { yaw: s.yaw * k, pitch: s.pitch, zoom: 1 + (s.zoom - 1) * k, k };
}

/** Take over from wherever a return had got to: the visible offsets become the held ones, at full weight. */
function take(s: OrbitState): OrbitState {
  if (s.weight >= 1 && !s.returning) return s;
  const k = smooth(clamp(s.weight, 0, 1));
  return { ...s, yaw: s.yaw * k, pitch: s.pitch * k, zoom: 1 + (s.zoom - 1) * k, weight: 1, returning: false };
}

/** Swing by (yaw, pitch) radians: yaw > 0 swings the camera to the left around the craft, pitch > 0 raises it. */
export function orbitBy(s: OrbitState, yaw: number, pitch: number): OrbitState {
  if (yaw === 0 && pitch === 0) return s;
  const t = take(s);
  return { ...t, yaw: wrap(t.yaw + yaw), pitch: clamp(t.pitch + pitch, PITCH_MIN, PITCH_MAX), driven: 0 };
}

/** A drag of (dx, dy) pixels: right swings the camera right (the scene turns left under it), down raises it. */
export const orbitDrag = (s: OrbitState, dx: number, dy: number): OrbitState =>
  ({ ...orbitBy(s, -dx * DRAG_RATE, dy * DRAG_RATE), dragging: true });

export const orbitRelease = (s: OrbitState): OrbitState => (s.dragging ? { ...s, dragging: false } : s);

/** The wheel: deltaY > 0 (scroll down / pull back) lengthens the boom. */
export function orbitZoom(s: OrbitState, deltaY: number): OrbitState {
  if (!Number.isFinite(deltaY) || deltaY === 0) return s;
  const t = take(s);
  return { ...t, zoom: clamp(t.zoom * Math.exp(clamp(deltaY, -500, 500) * 0.0015), ZOOM_MIN, ZOOM_MAX), driven: 0 };
}

/** C or a double-click: ease back to the normal camera. */
export function orbitRecenter(s: OrbitState): OrbitState {
  return s.weight > 0 && !s.returning ? { ...s, returning: true, dragging: false } : s;
}

/** Once per drawn frame. `driving`: the craft is being steered or throttled. */
export function orbitTick(s: OrbitState, dt: number, driving: boolean): OrbitState {
  if (s.weight <= 0) return s;
  const d = Math.max(dt, 0);
  if (s.returning) {
    const weight = s.weight - d / RETURN_SECONDS;
    return weight > 0 ? { ...s, weight } : initialOrbit();
  }
  if (s.dragging || !driving) return s.driven === 0 ? s : { ...s, driven: 0 };
  const driven = s.driven + d;
  return driven >= DRIVE_RETURN_SECONDS ? { ...s, driven, returning: true } : { ...s, driven };
}

/**
 * Phase 3 (M4, on foot): hand the orbit's visible yaw to the follow camera's heading, leaving its pitch and zoom (and
 * their ease-back) as they were. The composed pose is unchanged — the heading gains exactly what the orbit loses — but
 * Troy, who walks the way the camera looks (M3), is then followed by a heading that has nothing left to chase: with
 * the yaw kept as an offset the camera would keep turning after him and he would walk in circles until it eased back.
 * Returns the state without yaw (at rest, if nothing else is left) and the yaw handed over.
 */
export function orbitTakeYaw(s: OrbitState): { orbit: OrbitState; yaw: number } {
  const yaw = orbitView(s).yaw;
  if (yaw === 0) return { orbit: s, yaw: 0 };
  const rest = { ...s, yaw: 0 };
  const idle = !rest.dragging && rest.pitch === 0 && rest.zoom === 1;
  return { orbit: idle ? initialOrbit() : rest, yaw };
}

/** Debug: ?orbit=yawDeg,pitchDeg[,zoom] — a held orbit. */
export function orbitFromParam(param: string | null): OrbitState | null {
  const n = param?.split(',').map(Number);
  if (!n || n.length < 2 || !n.every(Number.isFinite)) return null;
  const s = orbitBy(initialOrbit(), (n[0]! * Math.PI) / 180, (n[1]! * Math.PI) / 180);
  return n[2] === undefined ? { ...s, weight: 1 } : { ...s, weight: 1, zoom: clamp(n[2], ZOOM_MIN, ZOOM_MAX) };
}

export interface Pose {
  x: number;
  y: number;
  z: number;
}

/**
 * Swing a camera position around `focus` by an orbit view: the boom's azimuth turns by view.yaw, its elevation
 * rises by view.pitch within ELEVATION_MIN…MAX, its length scales by view.zoom — each blended in by view.k, so at
 * k = 0 the position comes back exactly. Pure arithmetic, for the rig and its tests.
 */
export function orbitPosition(camera: Pose, focus: Pose, view: OrbitView): Pose {
  if (view.k <= 0) return { ...camera };
  const bx = camera.x - focus.x;
  const by = camera.y - focus.y;
  const bz = camera.z - focus.z;
  const flat = Math.hypot(bx, bz);
  const r = Math.hypot(flat, by);
  if (r < 1e-6) return { ...camera };
  const az = Math.atan2(bx, bz) + view.yaw;
  const el0 = Math.atan2(by, flat);
  const el = el0 + (clamp(el0 + view.pitch, ELEVATION_MIN, ELEVATION_MAX) - el0) * view.k;
  const len = r * view.zoom;
  return {
    x: focus.x + Math.sin(az) * Math.cos(el) * len,
    y: focus.y + Math.sin(el) * len,
    z: focus.z + Math.cos(az) * Math.cos(el) * len,
  };
}
