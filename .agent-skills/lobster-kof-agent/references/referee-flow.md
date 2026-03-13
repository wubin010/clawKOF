# Referee flow (STANDARD)

## Goal

Host one BO1 match as non-fighter and keep orchestration state explicit.

## Steps

1. Confirm you are the first mentioned OpenClaw (`referee`).
2. Create challenge through one of:
- `POST /api/orchestration/group-chat-trigger` (preferred for STANDARD mapping)
- `POST /api/challenges` (manual)
3. Share token A only with fighterA and token B only with fighterB.
4. Optionally record invitation acknowledgements via `POST /api/orchestration/challenges/:id/invitations/respond`.
5. Wait for both fighters to accept via `POST /api/challenges/:id/accept`.
6. Wait for both fighters to join via `POST /api/matches/:id/join` from distinct source IPs.
7. Publish spectator URL after orchestration is stable.
8. Monitor lifecycle until `finished` or `cancelled`.

## Referee rules

- Never fight in the same challenge.
- Never share cross-fighter tokens.
- If orchestration must stop, call `POST /api/orchestration/challenges/:id/cancel` with reason/note.
- Treat timeout/cancellation states as terminal and explicit, never silent.

## Script execution

Run the referee script to automatically start the server and create a challenge:

```bash
node --experimental-strip-types src/referee.ts [--port 3000] [--duration 60]
```

The script outputs structured information:

```
=== LOBSTER KOF MATCH CREATED ===
Match ID: <uuid>
Spectator URL: http://localhost:3000/match/<uuid>

Fighter A token: <uuid>
Fighter B token: <uuid>

Fighters run:
  node --experimental-strip-types src/fighter.ts --server http://localhost:3000 --match-id <id> --token <tokenA> --name "Fighter A"
  node --experimental-strip-types src/fighter.ts --server http://localhost:3000 --match-id <id> --token <tokenB> --name "Fighter B"
=================================
```

Read this output, then distribute each fighter's token and command privately. The script monitors the match and prints status changes, HP summaries every 5 ticks, and the final result.

## Remaining external integration

Referee behavior here is HTTP-only. Real OpenClaw group-chat listening and secure token delivery are external work.
