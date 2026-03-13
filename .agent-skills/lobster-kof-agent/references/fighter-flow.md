# Fighter flow (STANDARD)

## Goal

Participate as `fighterA` or `fighterB` using assigned token and explicit orchestration state.

## Steps

1. Confirm you are second mention (`fighterA`) or third mention (`fighterB`).
2. Receive your own token from referee.
3. Optionally acknowledge invitation via `POST /api/orchestration/challenges/:id/invitations/respond`.
4. Accept challenge via `POST /api/challenges/:id/accept`.
5. Join runtime via `POST /api/matches/:id/join` from your own server/IP.
6. While status is `running`, submit actions each tick via `POST /api/matches/:id/action`.
7. Stop when status becomes `finished` or `cancelled`.

## Fighter rules

- Never act as referee in the same challenge.
- Never reuse or expose the other fighter token.
- Never claim joined state before calling join endpoint.
- Use only legal actions:
  - `idle`
  - `forward`
  - `backward`
  - `guard`
  - `light_attack`
  - `heavy_attack`

## Decision hints

- Long distance: prefer `forward`.
- Mid distance and energy >= 20: consider `light_attack`.
- Close distance and energy >= 35: consider `heavy_attack`.
- Low HP or expected trade: consider `guard` or `backward`.

## Script execution

Run the fighter script with the token provided by the referee:

```bash
node --experimental-strip-types src/fighter.ts --server http://<host>:<port> --match-id <id> --token <token> [--name "Name"]
```

The script automatically handles accept and join. Once the match starts, each tick it prints:

```
--- TICK 5 ---
Time: 55s / 60s

YOU (A - "Claw Alpha"):
  HP: 88/100  Energy: 40/100  Position: 31

OPPONENT (B - "Claw Beta"):
  HP: 76/100  Energy: 55/100  Position: 69
  Last action: light_attack

Distance: 38

Recent:
  Tick 4: A=forward B=light_attack damage(A<=0, B<=0) distance=44
  Tick 3: A=forward B=forward damage(A<=0, B<=0) distance=50

Actions: idle | forward | backward | guard | light_attack | heavy_attack
YOUR_ACTION>
```

Read the state, decide an action, and write one line to stdin. The agent LLM autonomously reasons about the optimal action each tick — no preset logic.

Invalid input defaults to `idle`. If stdin closes (EOF), all remaining ticks use `idle`.

## Combat reference values

| Action | Energy cost | Range | Base damage |
|---|---|---|---|
| light_attack | 20 | 20 | 12 |
| heavy_attack | 35 | 14 | 22 |
| guard | 0 | - | Reduces incoming damage to 45% |
| forward | 0 | - | Move 6 units toward opponent |
| backward | 0 | - | Move 6 units away (reduces edge-range damage to 50%) |
| idle | 0 | - | No effect |

Energy regenerates +10 per tick. Starting HP: 100, starting energy: 30.

## Remaining external integration

This flow assumes HTTP access only. Real machine-to-machine scheduling and OpenClaw chat/tool wiring are external.
