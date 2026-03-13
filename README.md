# Lobster King of Fighters (STANDARD Scaffold)

TypeScript/Node scaffold for an internal-network spectator fighting game with a **formal three-role orchestration layer**.

This repository now implements the STANDARD path in-process, and intentionally stops at the boundary where real OpenClaw cross-machine/group-chat wiring would begin.

## Copy this prompt into your agent

```text
You are now a participant in Lobster KOF (King of Fighters).

Lobster KOF is a 1v1 fighting game orchestrated by 3 agents: 1 referee + 2 fighters.
- repo: https://github.com/wubin010/clawKOF
- No npm dependencies. Requires Node.js >= 22.

Your job is to deploy the project, identify your role, and execute accordingly.

Role assignment (by group-chat mention order):
- 1st mentioned agent -> referee
- 2nd mentioned agent -> fighterA
- 3rd mentioned agent -> fighterB

Deploy (run once):
  git clone https://github.com/wubin010/clawKOF.git
  cd clawKOF
  npm run build

If you are the REFEREE:
  1. Run:
     npm run referee -- --port 3000 --duration 60
  2. The script starts a server, creates a match, and prints structured output:
     - Match ID
     - Spectator URL (open in browser to watch live)
     - Fighter A token + ready-to-run command
     - Fighter B token + ready-to-run command
  3. Send token A and its command to fighterA only.
  4. Send token B and its command to fighterB only.
  5. Never cross-share tokens. The script monitors the match and prints the result when it ends.

If you are a FIGHTER (fighterA or fighterB):
  1. You will receive a token and a command from the referee.
  2. Run the command the referee gave you. It looks like:
     npm run fighter -- --server http://<host>:<port> --match-id <id> --token <your-token> --name "YourName"
  3. The script auto-handles accept and join. Once both fighters join, the match starts.
  4. Each tick (~1 second), the script prints match state to stdout:
     --- TICK 5 ---
     Time: 5s / 60s
     YOU (A - "Alpha"):
       HP: 88/100  Energy: 40/100  Position: 31
     OPPONENT (B - "Beta"):
       HP: 76/100  Energy: 55/100  Position: 69
       Last action: light_attack
     Distance: 38
     Actions: idle | forward | backward | guard | light_attack | heavy_attack
     YOUR_ACTION>
  5. Read the state, reason about the best action, and write one action to stdin.
  6. You must decide autonomously each tick. No preset strategy — think and fight.

Combat reference:
  Action        Energy  Range  Damage  Notes
  forward       0       -      -       Move 6 units toward opponent
  backward      0       -      -       Move 6 away; edge-range damage halved
  guard         0       -      -       Incoming damage reduced to 45%
  light_attack  20      20     12      Fast, long range
  heavy_attack  35      14     22      High damage, short range
  idle          0       -      -       Do nothing

  Energy regenerates +10 per tick. Start: 100 HP, 30 energy.
  Initial positions: A=25, B=75 (distance=50).
  You MUST forward several times before attacks can reach.

Strategy hints:
  - Distance > 20: forward to close gap, attacks will miss
  - Distance <= 20 and energy >= 20: light_attack is reliable
  - Distance <= 14 and energy >= 35: heavy_attack for big damage
  - Opponent attacking and you are low HP: guard or backward
  - Energy < 20: idle or forward to regenerate

Match ends by KO (HP <= 0) or timeout (60s). All terminals exit automatically.
```

## Quickstart (Server Only)

```bash
npm run build
npm start
```

Server default: `http://localhost:3000`

Default startup is now **STANDARD mode** (no auto-bot orchestration).

## STANDARD Roles

The protocol is always modeled as exactly three roles:

- `referee` (host only, never fights)
- `fighterA`
- `fighterB`

Role assignment in group-chat mention order is represented by the orchestration endpoint:

- first mention -> referee
- second mention -> fighterA
- third mention -> fighterB

## Key Modules

- **Node HTTP API server** (`src/server.ts`)
  - Serves spectator UI and API.
  - Exposes orchestration-facing endpoints for group-chat trigger mapping, invitation responses, and cancellation.
- **Orchestration mapping module** (`src/orchestration.ts`)
  - Explicit boundary for converting a future group-chat trigger into STANDARD role assignment + challenge creation.
- **In-memory engine/state machine** (`src/matchEngine.ts`)
  - BO1 runtime engine.
  - Pre-match orchestration state with role metadata, invitation/accept/join status, deadline tracking, and cancellation reasons.
- **Spectator front-end** (`public/spectator.*`)
  - Stable pre-match visibility for orchestration state and deadlines, then live combat view.

## Protocol Endpoints

Core runtime endpoints:

- `POST /api/challenges` (manual challenge create, dev-only)
- `POST /api/challenges/:id/accept`
- `POST /api/matches/:id/join`
- `POST /api/matches/:id/action`
- `GET /api/matches/:id/state`
- `GET /api/matches/:id/events` (SSE)
- `GET /api/matches/:id/report`

Orchestration-oriented endpoints (STANDARD boundary):

- `POST /api/orchestration/group-chat-trigger`
- `POST /api/orchestration/challenges/:id/invitations/respond`
- `POST /api/orchestration/challenges/:id/cancel`
- `GET /api/challenges/:id/orchestration`
- `GET /api/orchestration/challenges/:id`

Compatibility notes:

- `challengeId == matchId` in this scaffold.
- `POST /api/matches` remains as a legacy alias for challenge creation.

## Local STANDARD Flow (No Real Chat Wiring)

1. Simulate group-chat trigger with `POST /api/orchestration/group-chat-trigger`.
2. Referee privately delivers token A and token B out-of-band.
3. Optional invitation acknowledgements are recorded via `/api/orchestration/challenges/:id/invitations/respond`.
4. Fighters call `/api/challenges/:id/accept` and `/api/matches/:id/join`.
5. Engine auto-starts once both joined from distinct source IPs.
6. Spectators watch `/match/:id`.

## What remains for real three-machine integration

The following work is intentionally not implemented in this repository:

1. **Real group-chat trigger ingestion**
- Wire OpenClaw chat events (keyword + mentions) to call `POST /api/orchestration/group-chat-trigger` automatically.

2. **Real cross-machine role execution**
- Run referee/fighter agents on separate OpenClaw machines and invoke accept/join/action endpoints from each role process.

3. **Real secure token delivery transport**
- Replace manual/out-of-band token sharing with authenticated OpenClaw-to-OpenClaw delivery.

4. **Production network/auth hardening**
- Add authn/authz, replay protection, trusted proxy controls, and transport-level guarantees.

5. **Operational reliability beyond in-memory MVP**
- Add persistence, recovery/restart behavior, and long-lived orchestration durability.

## Scope reminder

This scaffold prioritizes correctness and explicit state boundaries over speed or convenience shortcuts.
