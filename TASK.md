Build an MVP scaffold for an internal-network game called "Lobster King of Fighters".

Product constraints:
- This is NOT a normal local game. It is an internal-network spectator game.
- In a group chat, a user mentions 3 OpenClaw agents: first is referee/host, second and third are fighters.
- Referee is NOT a fighter.
- Referee runs the match server and spectator web page.
- Fighters are remote agents on different servers; for MVP, only define/join through HTTP protocol and provide a local mock mode.
- The two fighters must come from different source IPs; referee validates that on join.
- Trigger phrase is conceptually "@ref @a @b 龙虾拳皇" but chat integration is out of scope for this scaffold.
- Match is BO1.
- Underlying logic is turn/tick based discrete decision making.
- Visual presentation should feel like a 2D fighting game with continuous animation.
- Spectator view is read-only, single-match page, served on an internal port.
- Match end page should show summary and link to a detailed report.

Please create a runnable TypeScript Node project with:
1. README.md with quickstart and architecture summary.
2. docs/PRD.md capturing the confirmed requirements above.
3. package.json, tsconfig.json, and minimal scripts.
4. A small Express server (or similarly lightweight framework) that serves:
   - GET /              -> redirect or render current match page
   - GET /match/:id     -> spectator page
   - GET /api/matches/:id/state
   - GET /api/matches/:id/events (SSE is fine)
   - POST /api/matches  -> create a match (dev only)
   - POST /api/matches/:id/join -> player join with token, record source IP
   - POST /api/matches/:id/action -> submit action for a tick
   - GET /api/matches/:id/report
5. A minimal in-memory match engine with:
   - hp, energy, distance, timeRemaining, status
   - 1 second tick
   - actions: idle, forward, backward, guard, light_attack, heavy_attack
   - BO1 end conditions
   - basic conflict resolution and action log
6. A simple front-end spectator page using plain HTML/CSS/JS (canvas okay) that:
   - renders two simplified lobster fighters
   - shows hp/energy/timer/current action/log
   - animates between discrete state updates to feel alive
   - shows end state and report link when match finishes
7. A dev/demo mode with 2 mock fighters that auto-join from simulated distinct IPs and play random/heuristic actions so the page can be demoed without remote agents.
8. Keep the code reasonably small and understandable.
9. Include comments where protocol assumptions matter.
10. Ensure npm install && npm run build succeeds.

Do not implement real OpenClaw chat integration yet.
Do not over-engineer. Prioritize a clean, demoable scaffold.
