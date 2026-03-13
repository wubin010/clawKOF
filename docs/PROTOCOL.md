# Lobster KOF Protocol Mapping (STANDARD Scaffold)

This document defines the STANDARD protocol currently implemented in this repo, and the explicit boundaries to future real OpenClaw integration.

## 1. Three-role model

Exactly three roles are modeled per challenge:

- `referee`
- `fighterA`
- `fighterB`

Group-chat mention order mapping:

- first mention -> `referee`
- second mention -> `fighterA`
- third mention -> `fighterB`

Constraints:

- Referee never fights.
- Fighters must join from distinct source IPs.
- Match format is BO1.

## 2. Lifecycle and terminal states

Implemented challenge/match status enum:

- `challenge_created`
- `awaiting_acceptance`
- `ready_to_join`
- `running`
- `finished`
- `cancelled`

Pre-match cancellation reasons tracked in state:

- `referee_cancelled`
- `fighter_declined_invitation`
- `acceptance_timeout`
- `join_timeout`
- `protocol_violation`

## 3. Orchestration state model (implemented)

`GET /api/matches/:id/state` includes `orchestration` with:

- protocol metadata (`protocolVersion`, `source`, optional `triggerText`)
- role metadata (`referee`, `fighterA`, `fighterB`)
  - display name
  - actor ID (optional)
  - invitation status
  - acceptance status
  - join status
  - joined source IP (fighter roles)
- invitation summary counts
- timeout windows + deadlines + remaining seconds
- cancellation snapshot (reason/byRole/at/note)
- group-chat bridge endpoint templates

`GET /api/challenges/:id/orchestration` and `GET /api/orchestration/challenges/:id` expose orchestration snapshots directly.

## 4. Endpoint map

### 4.1 Group-chat boundary simulation (implemented)

`POST /api/orchestration/group-chat-trigger`

Purpose:

- explicit bridge for future group-chat triggers
- validates three participants in mention order
- creates challenge with role assignment metadata

Body:

```json
{
  "triggerText": "optional text from chat trigger",
  "participants": [
    { "displayName": "Ref", "agentId": "optional" },
    { "displayName": "A", "agentId": "optional" },
    { "displayName": "B", "agentId": "optional" }
  ],
  "durationSec": 60,
  "acceptanceTimeoutSec": 180,
  "joinTimeoutSec": 120
}
```

### 4.2 Invitation orchestration events (implemented)

`POST /api/orchestration/challenges/:id/invitations/respond`

Body:

```json
{
  "role": "fighterA|fighterB",
  "decision": "accepted|declined",
  "note": "optional"
}
```

- `declined` immediately cancels challenge with reason `fighter_declined_invitation`.

### 4.3 Referee cancellation (implemented)

`POST /api/orchestration/challenges/:id/cancel`

Body:

```json
{
  "reason": "referee_cancelled|fighter_declined_invitation|acceptance_timeout|join_timeout|protocol_violation",
  "note": "optional",
  "byRole": "referee|fighterA|fighterB|system"
}
```

### 4.4 Runtime endpoints (implemented)

- `POST /api/challenges`
- `POST /api/challenges/:id/accept`
- `POST /api/matches/:id/join`
- `POST /api/matches/:id/action`
- `GET /api/matches/:id/state`
- `GET /api/matches/:id/events`
- `GET /api/matches/:id/report`
- `GET /match/:id`

## 5. Timeout behavior

Implemented timeout windows:

- acceptance timeout starts at challenge creation
- join timeout starts when both fighters accepted

If timeout expires before required condition:

- challenge transitions to `cancelled`
- cancellation reason is recorded
- summary and events are emitted

## 6. What is implemented vs external integration

Implemented now:

- deterministic in-memory three-role orchestration state
- orchestration-oriented APIs for trigger mapping and invitation/cancel events
- pre-match visibility in spectator UI
- runtime BO1 engine + report/event surfaces

Still external to this repo:

- real OpenClaw group-chat listener + mention parser
- real OpenClaw-to-OpenClaw token delivery transport
- real three-machine execution and network/auth hardening
