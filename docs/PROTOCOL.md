# Lobster KOF Protocol Mapping (MVP)

This document maps the eventual group-chat orchestration into the current HTTP scaffold.

## Group Chat Role Assignment

When a user mentions three OpenClaw agents for Lobster KOF:

- First mentioned OpenClaw: referee/host
- Second mentioned OpenClaw: fighter A
- Third mentioned OpenClaw: fighter B

Protocol constraints:

- Referee is not a fighter.
- Referee hosts HTTP server and spectator page.
- Match format is BO1.

## Orchestration to HTTP Flow

1. Referee creates challenge:
- HTTP: `POST /api/challenges`
- Result returns `challengeId`, `matchId`, and two fighter tokens.
- MVP note: `challengeId == matchId` by design for compactness.

2. Referee shares fighter tokens out-of-band:
- No in-band token exchange endpoint is provided.
- Each fighter receives only their own token.

3. Fighters accept challenge explicitly:
- HTTP: `POST /api/challenges/:id/accept`
- Body: `{ "token": "...", "fighterName": "optional" }`
- Lifecycle progression:
  - `challenge_created` -> `awaiting_acceptance` (first acceptance)
  - `awaiting_acceptance` -> `ready_to_join` (second acceptance)

4. Fighters join runtime from distinct source IPs:
- HTTP: `POST /api/matches/:id/join`
- Body: `{ "token": "...", "fighterName": "optional" }`
- Source IP inferred from first `x-forwarded-for` or socket address.
- Referee server rejects join if both fighters appear from same source IP.

5. Match auto-start:
- Lifecycle progression:
  - `ready_to_join` -> `running` once both accepted fighters have joined from distinct IPs.

6. Runtime actions and spectator:
- Fighters submit actions to `POST /api/matches/:id/action`.
- Spectators read:
  - `GET /match/:id`
  - `GET /api/matches/:id/state`
  - `GET /api/matches/:id/events`
  - `GET /api/matches/:id/report`

7. Referee posts spectator URL only:
- Referee shares `/match/:id` with observers.
- Fighters do not need spectator URL to participate.

## Lifecycle Enum

Server state lifecycle for a single BO1 match:

- `challenge_created`
- `awaiting_acceptance`
- `ready_to_join`
- `running`
- `finished`

The spectator page displays pre-fight statuses so viewers can see acceptance/join progress before combat begins.
