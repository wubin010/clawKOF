# Lobster King of Fighters (STANDARD Scaffold)

TypeScript/Node scaffold for an internal-network spectator fighting game with a **formal three-role orchestration layer**.

This repository now implements the STANDARD path in-process, and intentionally stops at the boundary where real OpenClaw cross-machine/group-chat wiring would begin.

## For OpenClaw: Deploy & Play

### Prerequisites

- Node.js >= 18 (with `--experimental-strip-types` support; Node 22+ recommended)
- Zero npm dependencies — no `npm install` needed

### Deploy (one command)

```bash
git clone <this-repo> && cd clawKOF && npm run build
```

`npm run build` only does type-checking, no compile step. The project runs TypeScript directly.

### Play: 3-Agent Match

A match requires **3 OpenClaws** (or 3 terminals): 1 referee + 2 fighters.

**Step 1 — Referee starts the match:**

```bash
npm run referee
# or: npm run referee -- --port 3456 --duration 60
```

The referee script starts a server, creates a challenge, and prints output like:

```
=== LOBSTER KOF MATCH CREATED ===
Match ID: <uuid>
Spectator URL: http://localhost:3000/match/<uuid>

Fighter A token: <uuid-a>
Fighter B token: <uuid-b>

Fighters run:
  node --experimental-strip-types src/fighter.ts --server http://localhost:3000 --match-id <id> --token <uuid-a> --name "Fighter A"
  node --experimental-strip-types src/fighter.ts --server http://localhost:3000 --match-id <id> --token <uuid-b> --name "Fighter B"
=================================
```

Referee distributes token A to fighterA, token B to fighterB (never cross-share).

**Step 2 — Each fighter joins:**

```bash
npm run fighter -- --server http://<referee-ip>:<port> --match-id <id> --token <your-token> --name "YourName"
```

The fighter script auto-handles accept and join. Once both fighters join, the match starts automatically.

**Step 3 — Fight!**

Each tick (~1 second), the fighter script prints match state to stdout and waits for one action on stdin:

```
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
```

Type an action and press Enter. The agent LLM reads the state and decides autonomously — the script is a pure communication pipe with zero built-in strategy.

**Step 4 — Watch live:**

Open the Spectator URL in a browser to see real-time combat animation, HP bars, and event log.

**Step 5 — Results:**

When the match ends (KO or timeout), all three terminals print results and exit automatically. The browser spectator page also shows the final result.

### Quick Demo (solo, no agents)

```bash
DEMO_MODE=1 npm start
```

Starts the server with two auto-piloted bots. Open `http://localhost:3000/match/<id>` (printed in console) to watch.

### Combat Cheat Sheet

| Action | Energy | Range | Damage | Notes |
|---|---|---|---|---|
| `forward` | 0 | — | — | Move 6 units toward opponent |
| `backward` | 0 | — | — | Move 6 units away; reduces edge-range damage to 50% |
| `guard` | 0 | — | — | Reduces incoming damage to 45% |
| `light_attack` | 20 | 20 | 12 | Fast, long range |
| `heavy_attack` | 35 | 14 | 22 | Slow, high damage, short range |
| `idle` | 0 | — | — | Do nothing |

- Energy regenerates +10 per tick. Starting: 100 HP, 30 energy.
- Initial positions: A=25, B=75 (distance 50). You must `forward` several times before attacks can reach.

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
