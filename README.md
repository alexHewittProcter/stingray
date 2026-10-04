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

The game starts in Pen 3 with Stingray on its cradle. Launch her with the panel at the bottom of the screen — keys `1`–`4` or click the levers, in order: lower the cradle, start the engines, release the clamps, then drive down the tunnel and request the ocean door. A lamp shows each control's state: dark (not now), amber (ready, or moving), green (in launch position), red (refused — the reason shows on the panel).

| Key | Action |
|---|---|
| `1` `2` `3` `4` | cradle · engines · clamps · ocean door |
| `W` / `S` | throttle forward / reverse |
| `A` / `D` | turn left / right |
| `↓` or `E` | climb (nose up) |
| `↑` or `Q` | dive (nose down) |
| `Shift` | boost |
| `Space` | fire a missile |
| `R` | return to the pen (standby) |
| `M` | mute / unmute |

Let go of climb/dive and Stingray levels out and holds its depth. Climb hard at speed to leap out of the water — from deep, or straight off a fast surface run.

Add `?start=ocean` to start out at sea instead (released, engines on), or `?at=x,y,z&yaw=degrees&pitch=degrees` to start the sub at a point (yaw 0 faces north, toward Marineville; 180 faces out to sea) — handy for looking at one spot.

Open `/model.html` under `pnpm dev` to inspect the Stingray model on its own.

*Stingray* and its characters belong to their rights holder; this repo is a private prototype and is not for distribution.
