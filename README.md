# Stingray — Stand by for action

A third-person web game set in the world of *Stingray*: pilot the submarine out of Marineville, explore the ocean, fire its missiles. A private, local testbed.

Planned in `rapidstack-plan` under `goals/testbed-stingray/`; each phase readme there is the spec this repo is built against. Phase 1 is *Stingray in the ocean*.

```sh
pnpm install
pnpm dev        # play locally
pnpm test       # simulation unit tests
pnpm typecheck
pnpm build && pnpm preview
```

## Controls

The game opens on a title menu over the Marineville control room, with Troy Tempest standing by (Enter to start there, or skip to Pen 3 or the open ocean). On foot, walk him (`W A S D`, relative to the camera) through the corridor to the Standby Lounge and press `E` at his injector chair: it drops him down the shaft into Stingray's cabin in Pen 3. Aboard, launch her with the panel at the bottom of the screen — keys `1`–`4` or click the levers, in order: lower the cradle, start the engines, release the clamps, then drive down the tunnel and request the ocean door. A lamp shows each control's state: dark (not now), amber (ready, or moving), green (in launch position), red (refused — the reason shows on the panel).

| Key | Action |
|---|---|
| `W` `A` `S` `D` (on foot) | walk, relative to the camera |
| `E` (on foot) | use — the chair, and the things you are near |
| `1` `2` `3` `4` | cradle · engines · clamps · ocean door |
| `W` / `S` | throttle forward / reverse |
| `A` / `D` | turn left / right |
| `↓` or `E` | climb (nose up) |
| `↑` or `Q` | dive (nose down) |
| `Shift` | boost |
| `Space` | fire a missile |
| `R` | back to the start: Troy in the control room, Stingray on standby |
| `M` | mute / unmute |
| `H` | pin the key legend (it also shows by itself whenever no key is touched for a moment) |
| `Esc` | pause menu (resume, return to the control room, return to Pen 3, skip to open ocean, controls, sound) |
| drag / `J` `L` `I` `K` | look round Stingray (wheel zooms) |
| `C` / double-click | re-centre the camera (it also returns by itself once you drive) |

Let go of climb/dive and Stingray levels out and holds its depth. Climb hard at speed to leap out of the water — from deep, or straight off a fast surface run.

Add `?menu=0` to skip the title menu (any of `?start=`, `?at=`, `?script=`, `?hold`, `?view=` skips it too; `?menu=1` forces it). Add `?start=pen` to start aboard Stingray on standby in Pen 3, `?start=ocean` to start out at sea instead (released, engines on), or `?at=x,y,z&yaw=degrees&pitch=degrees` to start the sub at a point (yaw 0 faces north, toward Marineville; 180 faces out to sea) — handy for looking at one spot. The witnessing URLs (camera presets, scripts, the debug handle) are in [docs/witnessing.md](docs/witnessing.md).

Open `/model.html` under `pnpm dev` to inspect the Stingray model on its own.

*Stingray* and its characters belong to their rights holder; this repo is a private prototype and is not for distribution.
