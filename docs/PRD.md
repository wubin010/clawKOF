# Product Requirements Document: Lobster King of Fighters (MVP Scaffold)

## 1. Product Scope
Lobster King of Fighters is an internal-network spectator fighting game.

- It is initiated from group-chat context (trigger phrase concept only for now).
- Exactly three OpenClaw agents are involved conceptually:
  - Agent 1: referee/host
  - Agent 2: fighter A
  - Agent 3: fighter B
- Referee is not a fighter.
- Referee hosts match server and spectator page.
- Match format is BO1.

Out of scope:
- Real OpenClaw chat integration.
- Multi-match tournaments, persistence, auth hardening, and production-scale reliability.

## 2. Core Functional Requirements

### 2.1 Network and Role Rules
- Fighters join remotely through HTTP protocol.
- MVP includes local mock mode so demo can run without remote agents.
- The two fighters must join from distinct source IPs.
- Referee validates source IP uniqueness at join time.
- Referee shares fighter tokens to fighters out-of-band.

### 2.2 Pre-Match Lifecycle
- Challenge lifecycle states:
  - `challenge_created`
  - `awaiting_acceptance`
  - `ready_to_join`
  - `running`
  - `finished`
- Referee creates the challenge.
- Both fighters must explicitly accept before runtime join is allowed.
- Match starts only after both fighters join from distinct source IPs.

### 2.3 Match Simulation
- Turn/tick-based discrete decision engine.
- Tick interval: 1 second.
- Core state: hp, energy, distance, timeRemaining, status.
- Allowed actions:
  - `idle`
  - `forward`
  - `backward`
  - `guard`
  - `light_attack`
  - `heavy_attack`
- Basic conflict resolution between both fighter actions each tick.
- Action/event log available for spectators/report.

### 2.4 Match End
- BO1 end conditions include KO and timeout decision.
- End page/state shows summary and report link.

## 3. HTTP Interfaces
Required endpoints:

- `GET /` -> redirect or render current match page
- `GET /match/:id` -> spectator page
- `GET /api/matches/:id/state`
- `GET /api/matches/:id/events` (SSE acceptable)
- `POST /api/challenges` (dev only)
- `POST /api/challenges/:id/accept`
- `POST /api/matches/:id/join`
- `POST /api/matches/:id/action`
- `GET /api/matches/:id/report`

MVP simplification:
- `challengeId` and `matchId` are the same identifier.

## 4. Spectator UX Requirements
- Read-only single-match page on internal port.
- Visual style should feel like a 2D fighter, while backend remains discrete/tick-based.
- Show pre-match lifecycle and readiness details.
- Show hp, energy, timer, current action, and action log.
- Animate between state updates so combat appears continuous.
- On finish, show result summary and report link.

## 5. Non-Functional Requirements
- Keep implementation small and understandable.
- In-memory MVP state is acceptable.
- Include code comments for protocol assumptions.
- Must pass `npm install && npm run build`.
