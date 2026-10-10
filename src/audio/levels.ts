// Every sound's level and the few numbers that shape the mix — tune here, not in the recipes.
// Gains are linear (1 = the bus's full level). The master chain (mixer.ts) compresses and then limits, so a
// pile of detonations ducks the mix rather than clipping it; leave headroom here rather than leaning on it.

export const LEVELS = {
  master: 0.8,

  // Buses (each sound below is scaled by its bus)
  ambienceBus: 0.55,
  engineBus: 0.5,
  effectsBus: 0.9,
  // Phase 4 (S2, S3): the score. Non-diegetic, straight to master, and it sits UNDER the effects (tuned at T7 by ear);
  // the drop's roll is the one cue allowed forward, through the music's intensity (audio/music-cues.ts), not this.
  musicBus: 0.35,

  // Ambience beds (continuous, crossfaded by where the sub is)
  seaUnder: 0.5, // deep, slow, filtered rumble of the open sea below the surface
  seaAbove: 0.45, // swell wash and wind above the surface
  tunnel: 0.4, // Marineville's tunnel and pool underwater: machinery hum, a resonant bore
  hall: 0.3, // Pen 3 in air: mains hum and air handling
  rooms: 0.16, // phase 3: the control tower's low console hum (on foot)
  shaftRush: 0.5, // phase 3: the injector shaft's air rush at the chair's cruising speed
  ambienceFade: 0.6, // s — time constant of the crossfade between beds

  // The craft
  engineThrob: 0.45, // the low drive throb
  engineWhine: 0.12, // the turbine whine over it
  engineWash: 0.2, // water rush past the hull, with speed
  engineIgnition: 0.35, // the chuffs and starter whine of the 2 s start
  engineSmoothing: 0.25, // s — time constant the hum follows speed and boost with
  engineSpinDown: 0.9, // s — time constant of the hum dying when the engines stop

  // Pen machinery
  klaxon: 0.32,
  hydraulics: 0.22, // continuous while the cradle moves
  clunk: 0.7, // the cradle stopping
  clamps: 0.55,
  water: 0.5, // the hull going under / coming out on the cradle
  refusal: 0.1,
  chair: 0.6, // phase 3: the injector chair's carriage letting go, and locking into the cabin
  portServo: 0.22, // phase 4: the pen ceiling port's lid servo, opening and shutting
  poleHiss: 0.32, // phase 4: the pole's hydraulic hiss, retracting into the port and extending from it

  // The ocean door (both scaled by distance from the door's centre)
  doorMachinery: 0.3,
  doorSeal: 0.9,
  doorReference: 60, // m — the door is at full level within about this distance, half at twice it

  // Sea and weapons
  splash: 0.85, // leap and re-entry, scaled by speed
  missile: 0.8,
  detonation: 1.0, // at the listener; falls with distance
  detonationReference: 80, // m — half level at this distance
  detonationMaxPerStep: 3, // more detonations in one step than this play as this many
  underwaterCutoff: 1400, // Hz — effects and the engine are low-passed this hard while the sub is submerged
  airCutoff: 16000, // Hz — and this open in air

  // The ALERT: the "Launch Stations" PA drum signal (public/sfx/launch-stations.wav, made by tools/launch-stations.py),
  // played on foot in the control room. SFX, not score: through the effects bus (× effectsBus, taking the room and the
  // muffle), never scaled by the Music switch — quiet, read as the base's loudspeakers rather than as music. The clip
  // is peak-normalised to −1 dBFS and compressed, so it sits lower here than the old synthesised tattoo's 0.3.
  alert: 0.22,
  // s — the silence after each sounding before the signal sounds again: one bar at the clip's 180 bpm, so the
  // 4.000 s clip (three bars, the drumming ≈ 3.65 s) comes round every four bars.
  alertGap: 4 / 3,

  // Phase 4 (S2, S3): the score's instruments (audio/instruments.ts), each scaled by the music bus above.
  music: {
    snareNoise: 0.5, // the wires: noise through a band-pass at ≈ 1.8 kHz
    snareCrack: 0.16, // the stick on the head: a short high-passed tick
    snareBody: 0.28, // the shell: a 180 Hz tone
    snareFlam: 0.38, // the grace stroke, relative to the main one
    flamAhead: 0.024, // s — how far the grace stroke leads
    rollRise: 0.4, // a short roll (≤ half a bar) rises from (1 − this) of its velocity to its velocity
    longRollRise: 0.15, // a sustained roll swells more gently
    kick: 0.7,
    timp: 0.6,
    brass: 0.26, // per voicing, divided across its pitches
    brassVibrato: 7, // cents
    bass: 0.5,
  },
} as const;
