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
 *   1. Print formatted status to stdout
 *   2. Read one line from stdin as the action
 *   3. POST action (blocks until tick resolves) -> use response as new state -> repeat
 *
 * No decision logic lives here. The agent's LLM reads stdout and writes to stdin.
 */

import { createInterface, Interface as ReadlineInterface } from 'readline';
import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Load .env (lightweight, no dependencies)
// ---------------------------------------------------------------------------

function loadEnv(): void {
  try {
    const content = readFileSync('.env', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // no .env file, that's fine
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface FighterArgs {
  server: string;
  name: string;
}

function parseArgs(): FighterArgs {
  const args = process.argv.slice(2);
  let server = process.env.KOF_SERVER ?? '';
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
    process.stderr.write(
      'Usage: npm run fighter -- --name "Name" [--server <url>]\n' +
      'Or set KOF_SERVER in .env file and just pass --name.\n'
    );
    process.exit(1);
  }

  return { server: server.replace(/\/$/, ''), name };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;

async function httpGet(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        const msg = (body as Record<string, unknown>).error ?? res.statusText;
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`GET ${url} -> ${res.status}: ${msg}`);
        }
        throw new Error(`GET ${url} -> ${res.status}: ${msg}`);
      }
      return body;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 4xx errors: don't retry
      if (msg.includes('-> 4')) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function httpPost(url: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = (body as Record<string, unknown>).error ?? res.statusText;
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`POST ${url} -> ${res.status}: ${msg}`);
        }
        throw new Error(`POST ${url} -> ${res.status}: ${msg}`);
      }
      return { status: res.status, body };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 4xx errors: don't retry
      if (msg.includes('-> 4')) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastError;
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

const VALID_ACTIONS = ['idle', 'forward', 'backward', 'guard', 'light_attack', 'heavy_attack', 'dash_attack', 'counter', 'special'];

function formatState(state: MatchState, mySlot: string, myLastAction: string): string {
  const me = state.fighters.find((f) => f.slot === mySlot)!;
  const opp = state.fighters.find((f) => f.slot !== mySlot)!;

  const elapsed = state.maxDurationSec - state.timeRemaining;
  const lines: string[] = [
    `--- TICK ${state.tick} ---`,
    `Time: ${elapsed}s / ${state.maxDurationSec}s`,
    '',
    `YOU (${me.slot} - "${me.name}"):`,
    `  HP: ${me.hp}/100  Energy: ${me.energy}/100  Position: ${me.position}`,
    `  Your last action: ${myLastAction}`,
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

const SERVER_TICK_DEADLINE_MS = Number(process.env.TICK_DEADLINE_MS) || 5000;
const READLINE_TIMEOUT_MS = Number(process.env.FIGHTER_READLINE_TIMEOUT_MS)
  || Math.max(1000, SERVER_TICK_DEADLINE_MS - 500);

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
        const timer = setTimeout(() => {
          if (waiting === wrappedResolve) {
            waiting = null;
            resolve('idle');
          }
        }, READLINE_TIMEOUT_MS);

        function wrappedResolve(line: string | null): void {
          clearTimeout(timer);
          resolve(line);
        }

        waiting = wrappedResolve;
      });
    },
    close() {
      rl.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Logging helper — all [fighter] logs go to stderr
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`[fighter] ${msg}\n`);
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

  log(`Server: ${opts.server}`);
  log(`Name:   ${opts.name}`);
  log('');

  // --- Step 1: Auto-pair (find-or-create) ---
  log('Joining match (auto-pair)...');
  const { body: joinResult } = await httpPost(`${opts.server}/api/matches/join`, {
    name: opts.name,
  });

  const result = joinResult as { matchId: string; slot: string; spectatorUrl: string };
  const matchId = result.matchId;
  const mySlot = result.slot;

  log(`Match:  ${matchId}`);
  log(`Slot:   ${mySlot}`);
  log(`Watch:  ${opts.server}${result.spectatorUrl}`);
  log('');

  // --- Step 2: Wait for opponent if we created the room ---
  let state = (await httpGet(`${opts.server}/api/matches/${matchId}/state`)) as MatchState;

  if (state.status === 'waiting') {
    log('Waiting for opponent to join...');
    state = (await httpGet(`${opts.server}/api/matches/${matchId}/wait-for-start`)) as MatchState;
  }

  if (state.status === 'finished') {
    log(`Match ended: ${state.summary ?? state.status}`);
    process.exit(0);
  }

  log('Match started!');
  log('');

  // --- Step 3: Combat loop ---
  // POST /action blocks until tick resolves, so its response IS the new state.
  // No sleep, no extra GET needed.
  const reader = createLineReader();
  let stdinClosed = false;
  let myLastAction = 'idle';

  while (state.status === 'running') {
    process.stdout.write(formatState(state, mySlot, myLastAction) + ' ');

    let action = 'idle';
    if (!stdinClosed) {
      const line = await reader.nextLine();
      if (line === null) {
        stdinClosed = true;
        log('stdin closed, defaulting to idle for remaining ticks.');
      } else {
        const parsed = line.trim().toLowerCase();
        if (parsed && VALID_ACTIONS.includes(parsed)) {
          action = parsed;
        } else if (parsed) {
          log(`Invalid action "${parsed}", using idle.`);
        }
      }
    }

    myLastAction = action;

    try {
      const { body } = await httpPost(`${opts.server}/api/matches/${matchId}/action`, {
        name: opts.name,
        action,
      });
      state = body as MatchState;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not running')) {
        break;
      }
      log(`Action error: ${msg}`);
      // On error, fetch state to stay in sync
      state = (await httpGet(`${opts.server}/api/matches/${matchId}/state`)) as MatchState;
    }
  }

  reader.close();

  // --- Step 4: Print result ---
  log('');
  log('=== MATCH RESULT ===');
  log(`Status: ${state.status}`);
  log(`Winner: ${state.winner ?? 'none'}`);
  log(`Summary: ${state.summary ?? 'N/A'}`);
  log(`Total ticks: ${state.tick}`);
  const me = state.fighters.find((f) => f.slot === mySlot)!;
  const opp = state.fighters.find((f) => f.slot !== mySlot)!;
  log(`Your HP: ${me.hp}  Opponent HP: ${opp.hp}`);
  log('====================');
}

main().catch((err) => {
  process.stderr.write(`[fighter] Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
