# Product Requirements Document: Lobster King of Fighters (STANDARD Scaffold)

## 1. Product Scope

Lobster King of Fighters is an internal-network spectator fighting game scaffold.

- It models group-chat initiation but does not yet consume real OpenClaw chat events.
- Exactly three roles are represented:
  - `referee` (host only)
  - `fighterA`
  - `fighterB`
- Referee is not a fighter.
- Match format is BO1.

Out of scope for this repo:

- Real OpenClaw group-chat ingestion and outbound messaging.
- Production security hardening and persistence.
- Tournament-level/multi-match orchestration.

## 2. Core Functional Requirements

### 2.1 Orchestration model

- Formal role metadata must exist in challenge state for referee/fighterA/fighterB.
- Role records must include invitation, acceptance, and join statuses.
- Orchestration state must include timeout windows and terminal cancellation metadata.

### 2.2 Network and role constraints

- Fighters join remotely through HTTP.
- Fighters must join from distinct source IPs.
- Referee validates source IP uniqueness at join time.
- Token sharing is out-of-band in this scaffold.

### 2.3 Pre-match lifecycle

- Lifecycle states:
  - `challenge_created`
  - `awaiting_acceptance`
  - `ready_to_join`
  - `running`
  - `finished`
  - `cancelled`
- Both fighters must accept before runtime join is allowed.
- Match starts only after both fighters join from distinct source IPs.
- Pre-match timeout expiry must cancel challenge with explicit reason.

### 2.4 Runtime simulation

- Tick-based discrete decision engine.
- Tick interval: 1 second.
- Core runtime state: hp, energy, distance, timeRemaining, status.
- Allowed actions:
  - `idle`
  - `forward`
  - `backward`
  - `guard`
  - `light_attack`
  - `heavy_attack`

### 2.5 Match end and report

- End conditions: KO or timeout decision.
- Cancellation also produces terminal state details.
- Report endpoint includes orchestration + runtime event log.

## 3. HTTP Interfaces

Required runtime endpoints:

- `GET /`
- `GET /match/:id`
- `GET /api/matches/:id/state`
- `GET /api/matches/:id/events`
- `GET /api/matches/:id/report`
- `POST /api/challenges`
- `POST /api/challenges/:id/accept`
- `POST /api/matches/:id/join`
- `POST /api/matches/:id/action`

Required orchestration endpoints:

- `POST /api/orchestration/group-chat-trigger`
- `POST /api/orchestration/challenges/:id/invitations/respond`
- `POST /api/orchestration/challenges/:id/cancel`
- `GET /api/challenges/:id/orchestration`
- `GET /api/orchestration/challenges/:id`

## 4. Spectator UX Requirements

- Read-only single-match page.
- Pre-match orchestration state must be visible and stable:
  - role table
  - invitation/accept/join statuses
  - timeout deadlines and remaining windows
  - cancellation reason (if applicable)
- Runtime view shows HP/energy/timer/actions/event log.
- End-state panel links report JSON.

## 5. Non-Functional Requirements

- Keep implementation conservative and explicit.
- In-memory state is acceptable for scaffold.
- Protocol assumptions should be documented in code/docs.
- Must pass `npm install && npm run build`.
