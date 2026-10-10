# Witnessing Stingray

How to see the game's behaviour without anyone at the keys: URL parameters, scripts, camera presets and the debug
handle. Phase 3's M10 asks for every room to have a `?view=` preset listed here, so each can be screenshotted
headless; phase 4 (W) renamed them for the straight drop (the corridor and the Standby Lounge are gone — the injector
chairs stand in the control room, D2). Every URL below is relative to `pnpm preview --port 4188 --strictPort` (`http://localhost:4188/`).

## Headless Chrome

The command used for every witness screenshot (the `perl` alarm kills a hung Chrome after 60 s):

```sh
perl -e 'alarm 60; exec @ARGV' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-angle=metal --enable-unsafe-swiftshader --window-size=1280,720 \
  --virtual-time-budget=<ms> --screenshot=<png> "<url>"
```

`3000` ms is enough for a still view; give a long script ≈ 10000. To check for console errors, add
`--enable-logging=stderr --v=0` and look for `INFO:CONSOLE` lines on stderr (none = clean).

## Where the game starts — `?start=`

| URL | Start |
|---|---|
| `/` | the title menu over the control room, Troy standing there (M9) |
| `?start=control` | the control room, Troy on foot — the same as no parameter (the default), minus the title |
| `?start=pen` | aboard Stingray on standby in Pen 3, Troy in the pilot's seat (phase 2's start) |
| `?start=ocean` | aboard, out at sea: released, engines on |
| `?at=x,y,z&yaw=deg&pitch=deg` | aboard, at that point (implies `ocean`) |

`?script=` without `?start=` implies `pen`, so every phase-2 witnessing URL runs unchanged (M7). An unknown
`?start=` value is ignored.

Any of `?start=`, `?at=`, `?script=`, `?hold`, `?view=` skips the title menu; `?menu=0` skips it, `?menu=1` forces it,
`?menu=pause` opens the pause menu over the scripted moment (e.g. `?menu=pause&start=control`).

## Camera presets — `?view=`

`?view=x,y,z,lookX,lookY,lookZ` fixes the camera there, ignoring the rig; a name uses a preset
(`src/debug.ts` `VIEW_PRESETS`). With no `?start=` the session starts in the control room, so Troy is in the control
room's shot and Stingray is on standby in the pen's.

| Preset | URL | What it shows |
|---|---|---|
| `control` | `?view=control` | the control room from the south windows, over Troy at the start, across the room to the injector station |
| `station` | `?view=station` | the station from behind (north, over its back panel): the three chairs' backs, the dais, the bore under Troy's |
| `shaft` | `?view=shaft` | inside the injector shaft's tube, high in the tower's stalk (y 60), looking straight down it toward the pen |
| `port` | `?view=port` | the pen hall from beside the docked sub, up at the ceiling: Troy's port (lid open, lit ring), Phones's dummy 1.6 m west, and the pole standing from the port down into Troy's open hatch (phase 4 D3) |
| `hatch` | `?view=hatch` | the docked sub's cabin roof close, from above and behind: Troy's hatch open (the lid swung forward) with Troy in his seat and the pole coming down to his chair's head bar, Phones's dummy beside it, the dome aft |

`port` and `hatch` start in the pen (the docked sub, Troy aboard) when no `?start=` is given; with one, they are only
the camera (e.g. `?start=control&view=port` — the hall with the lid shut and no pole).

Every preset is computed from the tower's axis, the chair and the seat (`sim/rooms.ts` `TOWER_AXIS`, `ROOMS.chair`,
`SEAT`; phase 4 D1), so they follow the rooms if the tower ever moves. The numbers today: the tower's axis is
x 0, z −1392.2; Troy's chair (0.6, 92.7, −1392.2); the seat (0.6, 9, −1392.2); Troy starts at (0.6, −1387) facing north.

`?orbit=yawDeg,pitchDeg[,zoom]` starts the follow (or chase) camera orbited; it works on foot as aboard.

## Scripts — `?script=`

A comma list of words, run in order before the first frame (`src/debug.ts` `runScript`); `?hold` then keeps the sim
still so the screenshot shows exactly the scripted moment.

- a number — advance the sim that many seconds;
- `cradle`, `engines`, `clamps`, `door` — press that launch control;
- `use` — queue `'use'` (`E` on foot: sit in the chair when at it);
- `leave` — queue `'leave'` (the panel's fifth control, `5`; refused *Dock first* unless aboard a docked, raised sub
  — accepted, Troy rides back up the shaft and stands up in front of his chair, M6b);
- `face=DEG` — Troy, on foot, turned in place to that heading (degrees, the sim's yaw: 0 north, 180 south); the camera
  snaps. He stands up facing away from his chair, so the loop's witness turns him back to it before `use`;
- `walk=X:Z` — Troy on foot at the walkable point nearest world (X, Z); the camera snaps. The front of his chair —
  where he stands to sit, 1.6 m south of it (he walks up from the south, D2) — is `walk=0.6:-1390.6`;
- `out=M` / `in=M` — the released sub on the tunnel's centreline M m in from the mouth, facing out / in;
- `dock=M` — the released sub on the pen's axis M m south of the cradle, facing it; `dx=` `dy=` `dz=` `turn=` nudge it;
- `throttle=T`, `steer=Y`, `climb=P` (−1 … 1), `fire=1|0`, `boost=1|0` — hold those inputs until changed.

### The ride shots (T7; phase 4 D4)

Troy walked to the front of his chair, sits, and rides straight down; vary the last number (seconds into the 6 s ride)
for each shot:

```
?start=control&menu=0&hold&script=walk=0.6:-1390.6,use,N
```

| N | What it shows |
|---|---|
| `0.5` | the hold (`rideHold` 0.8 s): still in the room, looking down on the chair dropping into the bore past the other two chairs |
| `2.5` | in the tube, above and behind the chair, looking down the shaft's light rings |
| `4.6` | over the chair at the tube's foot: down the annulus's cone to the open lid, the sub's roof through the port |
| `4.85` | the chair going through the port; the camera inside the annulus, closed in on the axis (it never leaves the cone) |
| `5.05` | the camera through the port into the hall, over Troy, the sub and the pool below |
| `5.4` | the arrival blend: the hall, Troy on the pole above the open hatch |

`use,8` locks him in (the sub on standby, Troy in the pilot's seat). The chair passes the port (y 20) at ≈ 4.84 s;
the camera, 3 m up its boom, at ≈ 5.03 s. The view (orientation, fov) blends into the pen camera over the last 1.5 s
as phase 3 had it; the camera's *place* starts its blend only once it is through the port (D4: it keeps inside the
annulus's cone and the collar, `render/ride-camera.ts` `rideWallRadius`/`boomRise`), so it never looks through rock.

### The way back up (T9, M6b)

Aboard the standby sub (docked and raised), `leave` and the chair carries Troy back up the shaft over the same 6 s:
the ride camera sets off on the pen camera, follows the chair up the shaft (from above it, looking back down at him
rising), and arrives on the follow camera's pose in the control room, Troy standing in front of his chair. Vary the last
number for each shot (seconds into the ascent):

```
?start=pen&menu=0&hold&script=leave,N
```

| N | What it shows |
|---|---|
| — (`?start=pen&menu=0`) | the panel's fifth control `5 · LEAVE SEAT` lit amber, READY |
| `0.5` | the chair rising out of the cabin, up through the hall toward the ceiling (add `&view=port` for the hall's angle) |
| `2` | in the tube above the pen hall, the chair coming up toward the camera, facing the windows' way (south) |
| `5.5` – `5.8` | arriving in the control room: out of the bore onto the follow camera's pose |
| `7` | standing in front of the chair, the follow camera, the on-foot legend |

`?start=pen&menu=0&script=leave,8` runs it whole (Troy left standing in front of his chair). The loop repeats — up,
turn back to the chair, sit, and down again to lock in:

```
?start=pen&menu=0&hold&script=leave,8,face=0,use,8
```

### The port, the pole and the hatch (phase 4, D3)

Everything here is drawn from `(troy, launch)` each frame (`render/boarding.ts`; no sim state). Docked and raised with
Troy aboard, the pole stands from Troy's port down to his chair's head bar in the open hatch (the series' frame): so
`?start=pen` shows the pole down, the port's lid open and the hatch open. Press `1` and the pole retracts up through
the port over 1.5 s, then the lid (0.6 s) and the hatch (0.4 s) shut behind it; docking again reverses it — the lid
opens, then the pole comes down. Riding, the lid and the hatch open as the chair comes within 14 m of the port; the
pole is drawn from the port down to the chair's pole top once that is below the ceiling.

| URL | What it shows |
|---|---|
| `?view=port` | docked: the port open, the pole standing to the roof |
| `?start=pen&menu=0&view=port&hold&script=cradle,0.75` | the pole half retracted, the sub going down |
| `?start=pen&menu=0&hold&script=cradle,1.2` | the pole nearly up (behind the HUD's title from the pen camera), the hatch still open |
| `?start=pen&menu=0&hold&script=cradle,4` | the sub under water: no pole, the lid and the hatch shut |
| `?start=control&menu=0&view=port&hold&script=walk=0.6:-1390.6,use,4.95` | the chair coming down through the port into the hall, the hatch open below |
| `?start=control&menu=0&hold&script=walk=0.6:-1390.6,use,4.6` | the ride camera over the chair, looking down the annulus through the open lid to the hatch |
| `?start=control&menu=0&hold&script=walk=0.6:-1390.6,use,8` | locked in: the pole standing, Troy in his seat |
| `?start=pen&menu=0&view=5.2,9.6,-1392.2,0.6,9.6,-1392.2` | Troy in his seat through the window band's forward pane, the open hatch above |
| `?start=pen&menu=0&view=port&hold&script=leave,1.1` | the ascent: the chair going up through the port |
| `?start=pen&menu=0&view=port&hold&script=leave,8` | Troy back in the control room: the port and the hatch shut, no pole |

At sea it is refused — the panel shows the fifth control red with *DOCK FIRST* for 3 s, as phase 2's refusals:
`?start=ocean&menu=0&script=leave,1`.

### The full loop (T7; phase 4 T4) — control room to open water in one page

Troy at his chair, sits, rides down 6 s and locks in, then phase 2's launch — and phase 4's straight tunnel (D6): the
door is asked for from the cradle as the clamps let go (it is open 5 s later, before Stingray gets there), and
Stingray boosts straight out on the throttle alone at up to 60 m/s, ending out at sea (one line in the URL):

```
?start=control&menu=0&script=walk=0.6:-1390.6,1,use,8,cradle,8.2,engines,2.2,clamps,door,throttle=1,boost=1,12
```

No steering: the bore's pitch assist trims the nose to the incline (below). From the release: the pen's wall at
≈ 4.2 s, the mouth at ≈ 9.3 s, 100 m out at ≈ 10.9 s. Stop it early with `&hold` for the stages: `…,boost=1,6.2&hold`
on the incline, nose down 8.7°, 96 kn and gathering speed (60 m/s, 117 kn, by ≈ 6.7 s); `…,boost=1,8.6&hold` the level door chamber, the door open ahead.

Phase 2's launch alone: `?script=cradle,8.2,engines,2.2,clamps,1` (starts in the pen by the implication).

### The straight tunnel (phase 4 D6)

The centreline is three points: the mouth `(0, −40, −1100)`, the end of the level 70 m door chamber `(0, −40, −1170)`,
and the pen's south wall `(0, −14, −1340)` — one straight incline of 26 m over 170 m (≈ 8.7°). From the pen's south
wall the ocean door is in sight down the bore:

| URL | What it shows |
|---|---|
| `?start=pen&menu=0&view=0,-11,-1345,0,-40,-1100&hold&script=cradle,8.2,engines,2.2,clamps,door,5.02` | from just inside the bore at the pen's wall, straight down it to the open door and the sea |
| `?start=pen&menu=0&script=cradle,8.2,engines,2.2,clamps,1,throttle=1,2&hold` | the pen camera behind the sub at the wall, the bore ahead (the sub hides the door's centre) |

**Speed (`sim/interior.ts` `capAt`).** The cap is a ramp by distance to the pen: the full cruise/boost cap (60 m/s)
more than `capRamp` 60 m south of the pen's south wall — the tunnel proper and the sea — falling linearly to
`interiorSpeedCap` 15 m/s at the wall, and 15 inside the pen. Boost works wherever the cap is above cruise (30).

**The door's two ranges (`tuning.ts`).** `doorRequestRange` 340 m — a request is accepted within it, so from the
lowered cradle (296 m) and from the pen's mouth; `doorCloseRange` 280 m — the tower shuts an open door once the hull is
beyond it, so docking still shuts it (the cradle is 296 m away) and at sea it shuts behind a departing sub as before.
A sub that asks from the cradle and then waits there sees the door open and close again (it is beyond 280 m).

**Pitch on the incline — the bore's pitch assist (`sim/interior.ts` `boreSlopeAt`).** Inside the bore, the nose with
no pitch input settles (at the usual levelling rate) to the bore's slope along the heading instead of to level: ≈ −8.7°
heading out down the incline, ≈ +8.7° heading in, 0 in the level door chamber and broadside, blended over
`boreTrimBlend` 20 m across the corner and to level at the pen's wall. Pitch input works on top as everywhere; at sea
and in the pen nothing changes. So a sub held on the throttle runs the incline at 60 m/s either way (without it, a level
hull rode the incline's crown and slid along it at ≈ 7 m/s).

### Coming home (phase 4 D6)

From 200 m out at sea, facing in: the door, a boosted run in on the throttle alone (the pitch assist takes the nose up
the incline), the ramp slowing Stingray from 60 m/s to 15 into the pen, then docked and raised — and the door shut
behind her:

```
?start=ocean&menu=0&hold&script=in=-200,door,throttle=1,boost=1,N
```

| N | What it shows |
|---|---|
| `7.6` | mid-incline at 117 kn (60 m/s), nose up 8.7° |
| `9.4` | on the ramp, 13 m from the pen: 48 kn and falling; the docking guide up |
| `10.2` | at the pen's wall: 29 kn (15 m/s), "STINGRAY IN PEN 3 — DOCKING" |
| `11,throttle=0,boost=0,dock=0,clamps,1,engines,cradle,8.2` | docked and raised: the ocean door SHUT (the tower closed it once the hull was beyond 280 m) |

## Score (phase 4 S1–S4)

**Headless Chrome has no audio.** The engine is unit-tested (`score.test.ts`, `music.test.ts`, `music-cues.test.ts`,
`audio.test.ts`); the ear test is the founder's. What a headless run can show is *which* cue fires *when*:
`?debug=music` logs every music command to the console as it is decided (with the sim time and step), whether or not
sound has started — add `--enable-logging=stderr --v=0` and read the `INFO:CONSOLE` lines.

**Hearing each section** (a real browser, sound on):

- `pnpm dev` → `/score.html` — play any section on its own, ROLL → MARCH (the brass hit), stop, and sliders.
- In the game, from the console: `__stingray.music.play('ROLL')`, `__stingray.music.stop()`,
  `__stingray.music.playing()`. Click the page first (a browser holds a context made without a gesture).
- The **Music** item beside Sound on both menus switches the score on and off (stored as `stingray.music`, default
  off since `53346f3`); `M` mutes everything, music included. The `ALERT` is not score (below): the switch leaves it on. `?music=0` starts a page with the music off without touching the stored
  switch.

**The cues** (`src/audio/music-cues.ts`; the edges are the fixed step pairs `Game.onStep` hands the sound, so each fires once):

| When (the sim edge) | Plays |
|---|---|
| the title menu up, from the first gesture | `FANFARE` then `MARCH` (looping) |
| the title closed — Start / Skip to… | `stop(4)`; on foot, the `ALERT` once the 4 s fade is done (on the audio clock) |
| on foot in the control room (after a jump, or the title) | `ALERT` — the PA's Launch Stations signal (a sampled clip, below), through the effects bus (the room's send), quiet, every 5.33 s |
| sit: `troy.where` `onFoot` → `riding` (down) | `ROLL`, its intensity following the ride: 0.4 at the top → 1.2 at the seat |
| lock-in: `riding` → `aboard`, 6.0 s after the sit | `MARCH` — ROLL's brass hit lands on the step, the march a bar (≈ 1.58 s) later |
| the session mode becomes `piloting` (the hull past z −1100) | `stop(6)`; at sea, the ambience alone |
| the rising edge of `docked(launch)`, once the sub has been released (never the session's start) | `STING_HOME` |
| leave: `aboard` → `riding` (up) | `ROLL`, loud at the seat, thinning to the top |
| stand-up: `riding` (up) → `onFoot`, 6.0 s after the leave | `STING_END` (no brass hit) |
| the pause menu | nothing — the context is suspended; the music resumes where it was |
| `R`, the menu's jumps, `?start=`, a script's `walk=` / `in=` / `dock=` | `stop(0.2)`, then the new state's cue (the title's `MARCH` under the title; the `ALERT` on foot; else none) |

With `&debug=music` on the full loop above: the sit at 1.02 s → `ROLL`; 7.02 s → `MARCH`; 28.65 s (9.25 s after the
clamps let go) → `stop(6)`. On the homecoming, `…,11,throttle=0,boost=0,dock=0,clamps,1,engines,cradle,8.2,leave,8`:
`STING_HOME` as the cradle locks up, `ROLL` on the leave, `STING_END` 6.0 s later.

### The Launch Stations signal (the ALERT)

The `ALERT` is a sampled asset, not the synthesised score: `public/sfx/launch-stations.wav`, an original modelled
recreation of the base's PA drum signal (the founder's brief: `docs/briefs/launch-stations-prompt.md`). It is SFX —
through the effects bus at `LEVELS.alert`, so it sounds **with the Music switch off** (`M` still mutes it). It plays
from its top, and again every 4.000 s clip + `LEVELS.alertGap` (one bar at its 180 bpm: 5.33 s, four bars, a cycle).

- **Hear it:** `pnpm dev` → `/?start=control&menu=0`, then click the page (the first gesture starts sound; the first
  sounding comes as soon as the file has decoded). Or from the console anywhere: `__stingray.music.play('ALERT')` /
  `__stingray.music.stop()`. `/score.html`'s ALERT button plays it too (its offline `?render=` does not: it renders
  hits only). The file alone: `afplay public/sfx/launch-stations.wav`.
- **Regenerate it:** `python3 tools/launch-stations.py` (Python 3 with numpy and scipy; deterministic — same seed,
  same bytes). `--events` prints every hit (time ms, voice, velocity), `--settings` the PA chain; tune by the named
  constants at the top of each part of the script. `--samples DIR` swaps the modelled drums for recordings
  (`DIR/snare.wav`, `accent.wav`, `tenor.wav`, optional `rim.wav`) on the same event list. If the length changes,
  change `LAUNCH_STATIONS.seconds` in `src/audio/score.ts` (`score.test.ts` reads the WAV's header and holds them
  together).

## Other switches

`?fps` — the on-screen frame rate; `?music=0` — the score off for this page; `?debug=music` — log the music's cues; `?stats` — the renderer's counts and the camera in the page; `?seed=N` — the world's seed (default 1964).

## `window.__stingray`

| Method | What it does |
|---|---|
| `mode()` | the session mode: `onFoot`, `transport`, `launch` or `piloting` |
| `steps()` | fixed steps run so far |
| `state()` | the sub's state |
| `combat()` | the targets, missiles and clock |
| `launch()` | the launch machinery's state |
| `press(p)` | queue a press — a launch control, `'use'` or `'leave'` |
| `teleport(pos, yaw?)` | the sub at rest there: Troy aboard, released, engines on |
| `setInput(axes)` | hold these input axes over the keyboard's; `{}` releases them |
| `advance(seconds)` | run the sim that many seconds and draw a frame (works in a hidden tab) |
| `camera()` | the camera's position |
| `menu()` | which menu is up: `'title'`, `'pause'` or `null` |
| `closeMenu()` | close it and play on as things stand |
| `music.play(id)` / `music.stop()` / `music.playing()` | the score: a section from its top, a 1 s fade out, what plays (phase 4 S4; see Score) |
| `troy()` | Troy's state (`where`, position, facing, gait) |
| `rooms()` | the rooms' data (`src/sim/rooms.ts`) |
| `walkTo(x, z)` | Troy on foot at the walkable point nearest (x, z); the camera snaps |
| `use()` | queue `'use'` |
| `leave()` | queue `'leave'` (M6b: aboard, docked and raised, ride back up) |
| `face(degrees)` | Troy, on foot, turned in place to that heading |
