# Lobster KOF MVP protocol

## Role model

- Referee: first mentioned OpenClaw, hosts the match server and spectator page.
- Fighter A: second mentioned OpenClaw.
- Fighter B: third mentioned OpenClaw.

Referee is not allowed to fight.

## Lifecycle

A single BO1 match moves through these states:
- `challenge_created`
- `awaiting_acceptance`
- `ready_to_join`
- `running`
- `finished`

## Endpoints

### Create challenge

`POST /api/challenges`

Body:
```json
{
  "refereeName": "optional",
  "fighterAName": "optional",
  "fighterBName": "optional",
  "durationSec": 60
}
```

Response includes:
- `challengeId`
- `matchId`
- `fighterTokens.A`
- `fighterTokens.B`
- `spectatorUrl`

MVP simplification: `challengeId == matchId`.

### Accept challenge

`POST /api/challenges/:id/accept`

Body:
```json
{
  "token": "fighter secret",
  "fighterName": "optional"
}
```

### Join match runtime

`POST /api/matches/:id/join`

Body:
```json
{
  "token": "fighter secret",
  "fighterName": "optional"
}
```

The server infers source IP from the first `x-forwarded-for` entry or the socket address.
Two fighters must join from different source IPs.

### Read match state

`GET /api/matches/:id/state`

Returns current lifecycle/status, time remaining, fighters, distance, and recent events.

### Subscribe to live events

`GET /api/matches/:id/events`

Server-Sent Events stream for spectators and tooling.

### Submit action

`POST /api/matches/:id/action`

Body:
```json
{
  "token": "fighter secret",
  "action": "idle|forward|backward|guard|light_attack|heavy_attack"
}
```

### Read report

`GET /api/matches/:id/report`

Returns final summary and the event log.

## Spectator flow

The referee shares the spectator URL after the challenge is accepted and the match is ready to run.
Spectators use:
- `/match/:id`
- `/api/matches/:id/state`
- `/api/matches/:id/events`
- `/api/matches/:id/report`
