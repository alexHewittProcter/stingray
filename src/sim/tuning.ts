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
  leapSpeed: 6, // m/s upward when crossing y = 0: at or above → airborne, below → surface
  gravity: 9.8, // m/s² while airborne
  airPitchAuthority: 10 * DEG, // how far pitch input can hold the nose off the arc
  airNoseFollow: 6, // 1/s — how quickly the nose follows the flight path
  reentryKeep: 0.8, // fraction of speed kept on splashing back in

  // Collisions
  hullRadius: 4, // collision sphere; also the clearance kept above the seabed
  bedDrag: 0.6, // 1/s speed shed while sliding on the seabed
  contactDrag: 2, // 1/s speed shed while in contact with a solid landmark

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
} as const;

export type Tuning = typeof TUNING;
