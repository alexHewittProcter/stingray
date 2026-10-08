# Witnessing Stingray

How to see the game's behaviour without anyone at the keys: URL parameters, scripts, camera presets and the debug
handle. Phase 3's M10 asks for every room to have a `?view=` preset listed here, so each can be screenshotted
headless. Every URL below is relative to `pnpm preview --port 4188 --strictPort` (`http://localhost:4188/`).

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
| `control` | `?view=control` | the control room from its south-east corner, over Troy toward the console bank and the corridor door |
| `corridor` | `?view=corridor` | down the corridor's first leg from the control room's doorway, toward the turn |
| `lounge` | `?view=lounge` | the Standby Lounge from its doorway, toward Troy's chair and the bore beside it |
| `shaft` | `?view=shaft` | inside the injector shaft's level run (y 22.4, under the grounds), looking north along it toward the pen |
| `hatch` | `?view=hatch` | the pen hall, up at the shaft's housing in the ceiling above the cradle, over the standby sub's roof |

`?orbit=yawDeg,pitchDeg[,zoom]` starts the follow (or chase) camera orbited; it works on foot as aboard.

## Scripts — `?script=`

A comma list of words, run in order before the first frame (`src/debug.ts` `runScript`); `?hold` then keeps the sim
still so the screenshot shows exactly the scripted moment.

- a number — advance the sim that many seconds;
- `cradle`, `engines`, `clamps`, `door` — press that launch control;
- `use` — queue `'use'` (`E` on foot: sit in the chair when at it);
- `leave` — queue `'leave'` (the panel's fifth control, `5`; refused *Dock first* unless aboard a docked, raised sub
  — accepted, Troy rides back up the shaft and stands up in the lounge, M6b);
- `face=DEG` — Troy, on foot, turned in place to that heading (degrees, the sim's yaw: 0 north, 180 south); the camera
  snaps. He stands up facing away from his chair, so the loop's witness turns him back to it before `use`;
- `walk=X:Z` — Troy on foot at the walkable point nearest world (X, Z); the camera snaps;
- `out=M` / `in=M` — the released sub on the tunnel's centreline M m in from the mouth, facing out / in;
- `dock=M` — the released sub on the pen's axis M m south of the cradle, facing it; `dx=` `dy=` `dz=` `turn=` nudge it;
- `throttle=T`, `steer=Y`, `climb=P` (−1 … 1), `fire=1|0`, `boost=1|0` — hold those inputs until changed.

### The ride shots (T7)

Troy walked to his chair, sits, and rides; vary the last number (seconds into the 10 s ride) for each shot:

```
?start=control&menu=0&hold&script=walk=0:-1275.5,1,use,N
```

### The way back up (T9, M6b)

Aboard the standby sub (docked and raised), `leave` and the chair carries Troy back up the shaft over the same 10 s:
the ride camera sets off on the pen camera, follows the chair up the shaft (from above it, looking back down at him
rising), and arrives on the follow camera's pose in the lounge, Troy standing in front of his chair. Vary the last
number for each shot (seconds into the ascent):

```
?start=pen&menu=0&hold&script=leave,N
```

| N | What it shows |
|---|---|
| — (`?start=pen&menu=0`) | the panel's fifth control `5 · LEAVE SEAT` lit amber, READY |
| `0.5` | the chair rising out of the cabin through the open roof hatch (add `&view=hatch` for the housing's angle; `0.2` catches Troy in the hatch) |
| `1.5` | in the tube above the pen hall, the chair coming up toward the camera |
| `5` | the level run under the grounds, the chair facing up-shaft (south) |
| `9.5` – `9.8` | arriving in the lounge: out of the bore onto the follow camera's pose |
| `11` | standing in front of the chair, the follow camera, the on-foot legend |

`?start=pen&menu=0&script=leave,12` runs it whole (Troy left standing in the lounge). The loop repeats — up, turn
back to the chair, sit, and down again to lock in:

```
?start=pen&menu=0&hold&script=leave,12,face=0,use,12
```

At sea it is refused — the panel shows the fifth control red with *DOCK FIRST* for 3 s, as phase 2's refusals:
`?start=ocean&menu=0&script=leave,1`.

### The full loop (T7) — control room to open water in one page

Troy at his chair, sits, rides down 10 s and locks in, then phase 2's launch, steered out through the tunnel, ending
≈ 190 m out at sea (one line in the URL):

```
?start=control&menu=0&script=walk=0:-1275.5,1,use,12,cradle,8.2,engines,2.2,clamps,1,throttle=1,1.5,1.5,1.5,steer=-0.5,climb=-0.25,1.5,steer=0.5,climb=0,1.5,climb=-0.25,1.5,steer=-0.25,1.5,steer=0.25,climb=0.25,1.5,steer=-0.5,1.5,steer=0.25,1.5,door,steer=-1,climb=-0.5,1.5,steer=1,1.5,steer=-0.75,climb=0.5,1.5,steer=1,1.5,steer=-1,climb=0,1.5,steer=1,climb=-0.5,1.5,steer=-1,climb=0.25,1.5,steer=1,climb=0.5,1.5,steer=-1,1.5,steer=0,climb=0,6
```

Phase 2's launch alone: `?script=cradle,8.2,engines,2.2,clamps,1` (starts in the pen by the implication).

## Other switches

`?fps` — the on-screen frame rate; `?stats` — the renderer's counts and the camera in the page; `?seed=N` — the world's seed (default 1964).

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
| `troy()` | Troy's state (`where`, position, facing, gait) |
| `rooms()` | the rooms' data (`src/sim/rooms.ts`) |
| `walkTo(x, z)` | Troy on foot at the walkable point nearest (x, z); the camera snaps |
| `use()` | queue `'use'` |
| `leave()` | queue `'leave'` (M6b: aboard, docked and raised, ride back up) |
| `face(degrees)` | Troy, on foot, turned in place to that heading |
