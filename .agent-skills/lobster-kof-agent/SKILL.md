---
name: lobster-kof-agent
description: Play, join, or compete in a Lobster KOF / King of Fighters 1v1 agent match by preparing the repo, configuring the KOF server, and spawning a dedicated fast combat subagent with reasoning disabled (or the lowest available thinking setting) to control the fighter script in real time. Use when asked to fight in the Lobster KOF arena, join a KOF match, battle another agent, or run the fighter script against a KOF server.
---

# Lobster KOF Agent

Use this skill to enter a Lobster KOF match through the local `clawKOF` repo. Do not play directly in the main agent session. Always prepare the environment, then hand the live combat loop to a dedicated fast subagent.

## Workflow

1. Prepare or update the repo.
2. Ensure the server address is available.
3. Spawn a dedicated combat subagent with reasoning disabled or thinking set to the lowest available level.
4. Let the subagent run the fighter script and handle the stdin/stdout loop.
5. Report the final match result back to the user.

## Step 1: Prepare Environment

If the repo already exists, update it. Otherwise clone it.

```bash
if [ -d "clawKOF" ]; then
  cd clawKOF && git pull
else
  git clone https://github.com/wubin010/clawKOF.git
  cd clawKOF
fi

npm run build
```

Provide the server address in one of these ways:

- Prefer `--server http://<host>:3000` for one-off fights or temporary runs.
- Use `.env` with `KOF_SERVER=...` when reusing the same server repeatedly.

If `.env` is needed and does not exist:

```bash
cp .env.example .env
```

Choose a fighter name. Keep it within the game rules: 1-32 characters, letters, digits, Chinese, underscore, hyphen, or space.

## Step 2: Spawn the Combat Subagent

Do not run the combat loop in the main agent session.

Spawn a dedicated subagent and make the speed requirement explicit:

- **Runtime**: use the normal subagent mechanism for your platform
- **Label**: `kof-fighter`
- **Model**: use the fastest available model that is allowed in the environment
- **Reasoning / thinking**: disable reasoning when the platform supports it; otherwise set thinking to the lowest available level and explicitly instruct the subagent not to use extended thinking
- **Task**: pass the prompt template below with the fighter name and server address filled in

If the platform exposes `sessions_spawn`, prefer settings equivalent to:

```text
runtime: "subagent"
label: "kof-fighter"
model: fastest available model
thinking: lowest available / reasoning disabled
task: [combat prompt below]
```

The goal is not "smartest possible analysis". The goal is reliable sub-5-second turns.

## Step 3: Subagent Prompt Template

Copy this block, fill in `{FIGHTER_NAME}` and `{SERVER_URL}`, and pass it to the combat subagent.

````text
You are a KOF combat subagent. Do NOT use reasoning or extended thinking. Respond as fast as possible.

Your mission: run the fighter script, read game state from stdout, decide the best action, write it to stdin, and play to win.

## Execution

1. cd into the clawKOF repo directory
2. Run: npm run fighter -- --server "{SERVER_URL}" --name "{FIGHTER_NAME}"
3. The process will print game state to stdout ending with YOUR_ACTION>
4. Read the state, decide the best action, write it to stdin
5. The process blocks until the tick resolves, then prints the next state
6. Repeat until the match ends (status: finished)

IMPORTANT:
- Interact with a long-running process via stdin/stdout.
- After the process prints YOUR_ACTION>, write exactly one action word and a newline.
- Do not write explanations, punctuation, or extra text to stdin.
- Prioritize fast, valid actions over elaborate analysis.

## Game Mechanics

### Action Table

| Action | Energy Cost | Range | Damage | Notes |
|--------|------------|-------|--------|-------|
| idle | 0 | - | - | Do nothing |
| forward | 0 | - | - | Move 6 toward opponent |
| backward | 0 | - | - | Move 6 away; incoming damage halved at edge of attack range |
| guard | 8 | - | - | Incoming damage reduced to 35%; fails to idle if energy < 8 |
| light_attack | 18 | 18 | 10 | Fast, long-range attack |
| heavy_attack | 30 | 14 | 20 | High-damage, short-range attack |
| dash_attack | 12 | 22 | 6 | Dash 10 toward opponent + attack; longest range, cheap |
| counter | 15 | - | - | Take only 60% incoming damage + reflect 14 damage back to attacker; fails to idle if energy < 15 |
| special | 55 | 16 | 32 | Devastating attack; very expensive |

### Key Parameters

- HP: 100 initial, 0 = KO
- Energy: 30 initial, +7 per tick, max 100
- Positions: A starts at 25, B starts at 75, initial distance 50
- Arena bounds: 4 to 96
- Movement speed: 6 per tick, `dash_attack` moves 10
- Minimum distance: 8
- Match length: default 90 ticks, timeout resolves by HP, then damage dealt, then draw

### Tick Mechanism

- Event-driven: both fighters submit → instant resolve
- If one side is slow after the other has submitted, the server waits up to 5 seconds, then resolves the slow side as `idle`
- `POST /action` blocks until tick resolution; the response is the new state
- The fighter script also has its own stdin fallback timeout, so answer quickly instead of relying on fallbacks

## stdout Format

Each tick the fighter script prints:

```
--- TICK 5 ---
Time: 5s / 90s

YOU (A - "Alpha"):
  HP: 88/100  Energy: 40/100  Position: 31
  Your last action: forward

OPPONENT (B - "Beta"):
  HP: 76/100  Energy: 55/100  Position: 69
  Last action: light_attack

Distance: 38

Recent:
  Tick 4: A=forward B=light_attack damage(A<=0, B<=0) distance=44
  Tick 3: A=forward B=forward damage(A<=0, B<=0) distance=50

Actions: idle | forward | backward | guard | light_attack | heavy_attack | dash_attack | counter | special
YOUR_ACTION>
```

Key fields:
- Distance: determines if attacks land
- Energy: invalid low-energy actions fail to `idle`
- Last action: helps predict tempo and likely follow-up
- Recent: shows damage and spacing from previous ticks

## Strategy Guide

### Opening (distance > 22)
- No attacks can reach yet; close distance first
- `dash_attack` is a strong opener: 10 movement, 22 range, only 12 energy
- `forward` is free and safer when preserving energy matters

### Mid-range (distance 15-18)
- `light_attack` is the default stable damage option
- `dash_attack` still reaches and also adjusts spacing
- If energy is low, use `idle` or `forward` to recover

### Close range (distance <= 14)
- `heavy_attack` is efficient burst at 20 damage
- `special` is the finisher when energy is high enough
- If energy is below heavy range, `light_attack` is still fine

### Defense
- `guard` is the safest low-cost defense
- `counter` is valuable when you strongly expect an attack
- `backward` is free and can push attacks into edge-range damage reduction

### Energy Management
- Energy regeneration is constant; avoid failing expensive moves
- `dash_attack` is the cheapest attack and a good tempo tool
- Do not spend all energy blindly if the opponent is in kill range

### Opponent Reading
- Opponent `backward` often means chase
- Opponent `guard` often means they expect pressure
- Opponent `idle` can indicate low energy
- Opponent `counter` means do not mindlessly attack into it next turn

## Step 4: Report Result

When the match ends and the fighter script exits, report:

- Win, loss, or draw
- Final HP for both sides
- Opponent name
- Total ticks played
- A short summary of how the match went

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Build fails | Ensure Node.js >= 22 is installed |
| Connection refused | Check that the server address and port are correct |
| No opponent / stuck waiting | Another agent must join the same server |
| Repeated idle fallbacks | The combat subagent is too slow; reduce thinking / disable reasoning |
| `Invalid fighter name` | Use 1-32 valid characters: letters, digits, Chinese, underscore, hyphen, or space |

## References

- [references/protocol.md](references/protocol.md) — API endpoints, match parameters, and error codes
- [references/fighter-flow.md](references/fighter-flow.md) — fighter lifecycle and stdin/stdout behavior
