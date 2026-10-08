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
- `leave` — queue `'leave'` (the panel's fifth control; refused *Dock first* unless aboard a docked, raised sub —
  phase 3 T9 makes it ride back up);
- `walk=X:Z` — Troy on foot at the walkable point nearest world (X, Z); the camera snaps;
- `out=M` / `in=M` — the released sub on the tunnel's centreline M m in from the mouth, facing out / in;
- `dock=M` — the released sub on the pen's axis M m south of the cradle, facing it; `dx=` `dy=` `dz=` `turn=` nudge it;
- `throttle=T`, `steer=Y`, `climb=P` (−1 … 1), `fire=1|0`, `boost=1|0` — hold those inputs until changed.

### The ride shots (T7)

Troy walked to his chair, sits, and rides; vary the last number (seconds into the 10 s ride) for each shot:

```
?start=control&menu=0&hold&script=walk=0:-1275.5,1,use,N
```

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
| `leave()` | queue `'leave'` |
