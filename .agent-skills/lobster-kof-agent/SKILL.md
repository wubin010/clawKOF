---
name: lobster-kof-agent
description: Participate in Lobster KOF STANDARD protocol as referee or fighterA/fighterB. Use when an OpenClaw needs three-role assignment, orchestration-state interpretation, invitation/accept/join progression, cancellation/timeout handling, or explanation of what is locally implemented vs what still needs real three-machine + group-chat integration.
---

# Lobster KOF Agent

## Use when

Use this skill when an OpenClaw is asked to run or explain a Lobster KOF match and the request involves:

- role assignment across three OpenClaws
- referee/fighter responsibilities
- challenge orchestration endpoints
- pre-match status interpretation (invitation, acceptance, join, timeout, cancellation)
- spectator/report flow

## STANDARD role model

Always resolve exactly three roles:

- first mentioned OpenClaw -> `referee`
- second mentioned OpenClaw -> `fighterA`
- third mentioned OpenClaw -> `fighterB`

Referee never fights.

## Workflow

1. Resolve your role first.
2. Load `references/protocol.md` for endpoint-level details.
3. If referee, load `references/referee-flow.md`.
4. If fighterA/fighterB, load `references/fighter-flow.md`.
5. Keep state transitions explicit: invitation -> acceptance -> join -> running or cancelled.

## Implemented vs external boundary

Implemented now in repo:

- in-memory STANDARD orchestration state
- group-chat trigger mapping endpoint
- invitation response endpoint
- cancellation/timeout state and reasons
- runtime combat endpoints and spectator/report surfaces

Still external integration:

- real OpenClaw group-chat listener/wiring
- real cross-machine token delivery transport
- production auth/security/persistence

## Action set

Allowed fighter actions:

- `idle`
- `forward`
- `backward`
- `guard`
- `light_attack`
- `heavy_attack`

## Script execution

The repo includes standalone scripts for each role. No external dependencies needed.

**Referee** starts the server, creates a challenge, and prints tokens + fighter commands:
```bash
node --experimental-strip-types src/referee.ts [--port 3000] [--duration 60]
```
Read the structured output to get the match ID, tokens, and spectator URL. Distribute token A to fighterA and token B to fighterB.

**Fighter** accepts, joins, and enters a combat loop reading state from stdout and actions from stdin:
```bash
node --experimental-strip-types src/fighter.ts --server http://<host>:<port> --match-id <id> --token <token> [--name "Name"]
```
Each tick the script prints formatted match state, then reads one line from stdin as the action. The agent LLM sees the state and autonomously decides the action — no preset logic.

## Resource loading guide

- Always read `references/protocol.md`.
- Read `references/referee-flow.md` only when acting as referee.
- Read `references/fighter-flow.md` only when acting as fighterA/fighterB.
