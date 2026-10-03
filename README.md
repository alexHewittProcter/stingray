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

| Key | Action |
|---|---|
| `W` / `S` | throttle forward / reverse |
| `A` / `D` | turn left / right |
| `↓` or `E` | climb (nose up) |
| `↑` or `Q` | dive (nose down) |
| `Shift` | boost |
| `Space` | fire a missile |
| `R` | back to the start |

Let go of climb/dive and Stingray levels out and holds its depth. Climb hard at speed to leap out of the water — from deep, or straight off a fast surface run.

Open `/model.html` under `pnpm dev` to inspect the Stingray model on its own.

*Stingray* and its characters belong to their rights holder; this repo is a private prototype and is not for distribution.
