/**
 * Fighter script — communication pipe between an agent's LLM and the KOF server.
 *
 * Usage:
 *   node --experimental-strip-types src/fighter.ts \
 *     --server http://localhost:3000 \
 *     --name "MyName"
 *
 * The script auto-pairs: if a waiting room exists, it joins; otherwise it creates one.
 * Once both fighters are in, the match starts and enters the combat loop:
 *   1. GET state -> print formatted status to stdout
 *   2. Read one line from stdin as the action
 *   3. POST action -> sleep -> repeat
 *
 * No decision logic lives here. The agent's LLM reads stdout and writes to stdin.
 */

import { createInterface, Interface as ReadlineInterface } from 'readline';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface FighterArgs {
  server: string;
  name: string;
}

function parseArgs(): FighterArgs {
  const args = process.argv.slice(2);
  let server = '';
  let name = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--server':
        server = args[++i] ?? '';
        break;
      case '--name':
        name = args[++i] ?? '';
        break;
    }
  }

  if (!server || !name) {
    console.error(
      'Usage: node --experimental-strip-types src/fighter.ts --server <url> --name "Name"'
    );
    process.exit(1);
  }

  return { server: server.replace(/\/$/, ''), name };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function httpGet(url: string): Promise<unknown> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as Record<string, unknown>).error ?? res.statusText;
    throw new Error(`GET ${url} -> ${res.status}: ${msg}`);
  }
  return body;
}

async function httpPost(url: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as Record<string, unknown>).error ?? res.statusText;
    throw new Error(`POST ${url} -> ${res.status}: ${msg}`);
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// State types (lightweight subset of MatchPublicState)
// ---------------------------------------------------------------------------

interface FighterPublic {
  slot: string;
  name: string;
  hp: number;
  energy: number;
  position: number;
  currentAction: string;
}

interface MatchState {
  id: string;
  status: string;
  tick: number;
  timeRemaining: number;
  maxDurationSec: number;
  distance: number;
  fighters: [FighterPublic, FighterPublic];
  winner: string | null;
  summary: string | null;
  recentEvents: Array<{ tick: number; message: string }>;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const VALID_ACTIONS = ['idle', 'forward', 'backward', 'guard', 'light_attack', 'heavy_attack'];

function formatState(state: MatchState, mySlot: string): string {
  const me = state.fighters.find((f) => f.slot === mySlot)!;
  const opp = state.fighters.find((f) => f.slot !== mySlot)!;

  const elapsed = state.maxDurationSec - state.timeRemaining;
  const lines: string[] = [
    `--- TICK ${state.tick} ---`,
    `Time: ${elapsed}s / ${state.maxDurationSec}s`,
    '',
    `YOU (${me.slot} - "${me.name}"):`,
    `  HP: ${me.hp}/100  Energy: ${me.energy}/100  Position: ${me.position}`,
    '',
    `OPPONENT (${opp.slot} - "${opp.name}"):`,
    `  HP: ${opp.hp}/100  Energy: ${opp.energy}/100  Position: ${opp.position}`,
    `  Last action: ${opp.currentAction}`,
    '',
    `Distance: ${state.distance}`,
  ];

  const tickEvents = state.recentEvents
    .filter((e) => e.message.startsWith('Tick '))
    .slice(-4);
  if (tickEvents.length > 0) {
    lines.push('');
    lines.push('Recent:');
    for (const evt of tickEvents) {
      lines.push(`  ${evt.message}`);
    }
  }

  lines.push('');
  lines.push(`Actions: ${VALID_ACTIONS.join(' | ')}`);
  lines.push('YOUR_ACTION>');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------

function createLineReader(): { nextLine: () => Promise<string | null>; close: () => void } {
  const rl: ReadlineInterface = createInterface({ input: process.stdin, terminal: false });
  const buffer: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;

  rl.on('line', (line: string) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      buffer.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  return {
    nextLine(): Promise<string | null> {
      if (buffer.length > 0) {
        return Promise.resolve(buffer.shift()!);
      }
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    close() {
      rl.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`[fighter] Server: ${opts.server}`);
  console.log(`[fighter] Name:   ${opts.name}`);
  console.log('');

  // --- Step 1: Auto-pair (find-or-create) ---
  console.log('[fighter] Joining match (auto-pair)...');
  const { body: joinResult } = await httpPost(`${opts.server}/api/matches/join`, {
    name: opts.name,
  });

  const result = joinResult as { matchId: string; slot: string; spectatorUrl: string };
  const matchId = result.matchId;
  const mySlot = result.slot;

  console.log(`[fighter] Match:  ${matchId}`);
  console.log(`[fighter] Slot:   ${mySlot}`);
  console.log(`[fighter] Watch:  ${opts.server}${result.spectatorUrl}`);
  console.log('');

  // --- Step 2: Wait for opponent if we created the room ---
  let state = (await httpGet(`${opts.server}/api/matches/${matchId}/state`)) as MatchState;

  while (state.status === 'waiting') {
    console.log('[fighter] Waiting for opponent to join...');
    await sleep(1500);
    state = (await httpGet(`${opts.server}/api/matches/${matchId}/state`)) as MatchState;
  }

  if (state.status === 'finished') {
    console.log(`[fighter] Match ended: ${state.summary ?? state.status}`);
    process.exit(0);
  }

  console.log('[fighter] Match started!');
  console.log('');

  // --- Step 3: Combat loop ---
  const reader = createLineReader();
  let stdinClosed = false;
  let lastTick = state.tick;

  while (state.status === 'running') {
    process.stdout.write(formatState(state, mySlot) + ' ');

    let action = 'idle';
    if (!stdinClosed) {
      const line = await reader.nextLine();
      if (line === null) {
        stdinClosed = true;
        console.log('\n[fighter] stdin closed, defaulting to idle for remaining ticks.');
      } else {
        const parsed = line.trim().toLowerCase();
        if (parsed && VALID_ACTIONS.includes(parsed)) {
          action = parsed;
        } else if (parsed) {
          console.log(`[fighter] Invalid action "${parsed}", using idle.`);
        }
      }
    }

    try {
      await httpPost(`${opts.server}/api/matches/${matchId}/action`, {
        name: opts.name,
        action,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not running')) {
        break;
      }
      console.error(`[fighter] Action error: ${msg}`);
    }

    await sleep(800);

    state = (await httpGet(`${opts.server}/api/matches/${matchId}/state`)) as MatchState;

    if (state.tick > lastTick + 1) {
      console.log(`[fighter] Note: tick jumped from ${lastTick} to ${state.tick} (slow decision?)`);
    }
    lastTick = state.tick;
  }

  reader.close();

  // --- Step 4: Print result ---
  console.log('');
  console.log('=== MATCH RESULT ===');
  console.log(`Status: ${state.status}`);
  console.log(`Winner: ${state.winner ?? 'none'}`);
  console.log(`Summary: ${state.summary ?? 'N/A'}`);
  console.log(`Total ticks: ${state.tick}`);
  const me = state.fighters.find((f) => f.slot === mySlot)!;
  const opp = state.fighters.find((f) => f.slot !== mySlot)!;
  console.log(`Your HP: ${me.hp}  Opponent HP: ${opp.hp}`);
  console.log('====================');
}

main().catch((err) => {
  console.error(`[fighter] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
