// Every handling number lives here. Feel changes are edits to this file, not to the logic.
// Units: metres, seconds, radians (written as degrees * DEG).

const DEG = Math.PI / 180;

export const TUNING = {
  // Forward / reverse / boost
  cruiseSpeed: 30, // m/s forward cap
  boostSpeed: 60, // m/s forward cap while boost is held
  reverseSpeed: 10, // m/s reverse cap
  thrustAccel: 15, // m/s² — rest to cruise in ≈ 2 s
  boostAccel: 20, // m/s² above cruise while boosting
  coastDecel: 10, // m/s² with no thrust — cruise to rest in ≈ 3 s
  sideDrag: 3, // 1/s — velocity off the nose decays, so motion follows the nose

  // Turning and pitch
  yawRate: 60 * DEG, // rad/s at up to cruise speed (and on the spot at rest)
  boostYawFactor: 0.5, // yaw rate multiplier at full boost speed — high-speed turns sweep
  pitchRate: 60 * DEG, // rad/s with pitch input
  levelRate: 60 * DEG, // rad/s back to level with no pitch input — level within ≈ 1 s
  maxPitch: 50 * DEG,

  // Surface running and leaping
  surfaceY: -1, // the hull's centre when running half-awash
  surfaceBand: 3, // a level hull this close under the surface is pulled onto it
  surfaceLevelEpsilon: 2 * DEG, // |pitch| below this counts as level
  surfaceSettle: 4, // 1/s — how quickly the hull settles to surfaceY
  surfaceLeapPitch: 22 * DEG, // on the surface the nose rears this far before the hull lets go and leaps
  leapSpeed: 6, // m/s upward when crossing y = 0: at or above → airborne, below → surface
  gravity: 9.8, // m/s² while airborne
  airPitchAuthority: 10 * DEG, // how far pitch input can hold the nose off the arc
  airNoseFollow: 6, // 1/s — how quickly the nose follows the flight path
  reentryKeep: 0.8, // fraction of speed kept on splashing back in

  // Collisions
  hullRadius: 4, // collision sphere; also the clearance kept above the seabed
  bedDrag: 0.6, // 1/s speed shed while sliding on the seabed
  contactDrag: 2, // 1/s speed shed while in contact with a solid landmark

  // Inside Marineville (phase 2, L1)
  // The hull centre stays this close to the tunnel's centreline: 8 m inside the 13 m bore, so keel, fins and
  // periscope clear the wall when the craft points along the tunnel. The mouth through the slab is sized to match.
  tunnelHullReach: 5, // m
  cameraWallInset: 1, // m the camera is held inside the drawn walls (bore and pen)
  interiorSpeedCap: 15, // m/s forward while the hull centre is north of the cliff face (boost off there)

  // Launch machinery (phase 2, L2 and L3)
  cradleTravel: 8, // s to lower, and again to raise
  engineStart: 2, // s from 'starting' to 'on'
  doorTravel: 5, // s to open, and again to close
  doorReopenDistance: 20, // m from the door's centre: a closing door reverses rather than close on the hull
  carrySpeed: 6, // m/s the clamped sub is carried toward the cradle's pose
  carryYawRate: 30 * DEG, // rad/s of heading while carried
  carryPitchRate: 60 * DEG, // rad/s of pitch while carried
  lockRadius: 4, // m from the lowered cradle position, hull centre
  lockSpeed: 3, // m/s — lock only below this
  lockHeading: 20 * DEG, // either way off the pen's axis, in either direction along it
  lockPitch: 15 * DEG, // off level
  refusalShow: 3, // s the HUD shows a refused press's reason

  // Ocean edge current (east, west, south)
  edgeZone: 150, // m from the bound where the current starts
  edgePush: 15, // m/s² inward at the bound itself (ramps from 0 at the zone's inner edge)
  edgeTurnRate: 50 * DEG, // rad/s the current swings the heading inward, at the bound

  // Missiles
  missileSpeed: 80, // m/s added to the sub's speed along its nose at launch
  missileCooldown: 0.4, // s between launches while fire is held
  missileLifetime: 6, // s before an unspent missile is gone
  // Launch point ahead of the hull centre: past the 13 m half-length, with the hull sphere and missile radius clear.
  missileNoseOffset: 18, // m
  missileRadius: 0.5, // m — the missile's hit sphere
  missileBedProbe: 1, // m between seabed samples along a step's travel, so thin ridges are not skipped
  missileBedRefine: 12, // bisection passes that pin the seabed crossing point (≈ 0.25 mm at 1 m probes)

  // Troy on foot (phase 3, M2) — added by phase 3; nothing above changes
  troyRadius: 0.4, // m — the capsule's foot circle
  troyHeight: 1.8, // m — feet to crown
  walkSpeed: 3.2, // m/s — WALK, at full stick
  walkAccel: 12, // m/s² up to the target speed
  walkDecel: 16, // m/s² down to it (and to rest)
  walkTurnRate: 540 * DEG, // rad/s — he turns to face his movement
  walkTurnSlow: 0.5, // fraction of the target speed while the wanted facing is more than 90° away
  walkStride: 1.4, // m per full gait cycle (two footfalls)

  // The on-foot follow camera (phase 3, M4) — presentation numbers, kept here with the rest (render/follow-camera.ts)
  followBoom: 3.6, // m from the pivot to the camera, before the orbit's zoom and the walls
  followPivotRise: 1.5, // m above Troy's feet: what the camera swings about and looks at
  followPitch: 18 * DEG, // the boom's angle above the horizontal behind him (the view looks 18° down)
  followFov: 60, // degrees
  followYawLag: 0.6, // s — the boom's heading follows Troy's facing with this lag, only while he walks
  followPivotRate: 10, // 1/s — the pivot's spring toward Troy (≈ 0.3 m behind at a walk)
  followBoomOutRate: 4, // m/s — a boom the walls shortened lengthens again no faster than this (shortening is instant)
  followWallInset: 0.35, // m the camera is held inside the room's box and clear of props (M4: ≥ 0.3)
  followNear: 0.2, // m — the near plane on foot, so its corners stay inside followWallInset of a wall
} as const;

export type Tuning = typeof TUNING;
