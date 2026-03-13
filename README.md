# Lobster King of Fighters (MVP Scaffold)

Small TypeScript/Node scaffold for an internal-network spectator fighting game.

## Quickstart

```bash
npm install
npm run build
npm start
```

Server defaults to `http://localhost:3000`.

With demo mode enabled (default), startup auto-creates one challenge and completes this full sequence over HTTP:

- create challenge
- both fighters accept
- both fighters join from distinct mock IPs
- match auto-starts and bots submit actions

- Spectator page: `GET /match/:id`
- Latest match shortcut: `GET /`

Disable demo mode:

```bash
DEMO_MODE=0 npm start
```

## Scripts

- `npm run build` syntax-check TypeScript sources via Node type-stripping parser
- `npm start` run server directly from TypeScript via Node type stripping
- `npm run dev` run with file watch via Node type stripping

## Architecture Summary

- **Node HTTP API server** (`src/server.ts`)
  - Exposes required challenge, match, and spectator endpoints.
  - Serves static spectator assets under `/static`.
  - Streams updates via Server-Sent Events.
- **In-memory match engine** (`src/matchEngine.ts`)
  - BO1 lifecycle machine:
    - `challenge_created` -> `awaiting_acceptance` -> `ready_to_join` -> `running` -> `finished`
  - 1s tick loop and conflict resolution for actions.
  - Validates distinct fighter source IPs on runtime join.
  - Produces state snapshots, event logs, and report payload.
- **Demo/mock mode** (`src/demoMode.ts`)
  - Uses HTTP APIs to run the full protocol sequence before combat.
- **Spectator front-end** (`public/spectator.html`, `public/spectator.css`, `public/spectator.js`)
  - Read-only page showing lifecycle state, readiness, HP/energy/timer/actions/log.
  - Canvas-based lobster animation interpolates between discrete ticks.
  - End-state summary with report link.

## API Notes

Create challenge (dev only):

```bash
curl -X POST http://localhost:3000/api/challenges \
  -H 'content-type: application/json' \
  -d '{"refereeName":"Ref","fighterAName":"A","fighterBName":"B"}'
```

Accept challenge:

```bash
curl -X POST http://localhost:3000/api/challenges/<id>/accept \
  -H 'content-type: application/json' \
  -d '{"token":"<fighter-token>","fighterName":"Claw A"}'
```

Join runtime (IP inferred from proxy or socket):

```bash
curl -X POST http://localhost:3000/api/matches/<id>/join \
  -H 'content-type: application/json' \
  -H 'x-forwarded-for: 10.0.0.11' \
  -d '{"token":"<fighter-token>","fighterName":"Claw A"}'
```

Submit action:

```bash
curl -X POST http://localhost:3000/api/matches/<id>/action \
  -H 'content-type: application/json' \
  -d '{"token":"<fighter-token>","action":"light_attack"}'
```

MVP note:
- `challengeId` and `matchId` are the same ID.
- `POST /api/matches` is kept as a backward-compatible alias to challenge creation.

## Protocol Reference

See `docs/PROTOCOL.md` for the group-chat to HTTP orchestration mapping.

## Scope Reminder

This scaffold intentionally does **not** implement real OpenClaw chat integration yet.
