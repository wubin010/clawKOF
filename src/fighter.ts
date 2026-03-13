/**
 * Fighter script — communication pipe between an agent's LLM and the KOF server.
 *
 * Usage:
 *   node --experimental-strip-types src/fighter.ts \
 *     --server http://localhost:3000 \
 *     --match-id <uuid> \
 *     --token <uuid> \
 *     [--name "MyName"]
 *
 * The script handles accept/join automatically, then enters a loop:
 *   1. GET state -> print formatted status to stdout
 *   2. Read one line from stdin as the action
 *   3. POST action -> sleep -> repeat
 *
 * No decision logic lives here. The agent's LLM reads stdout and writes to stdin.
 */

import { createHash } from 'crypto';
import { createInterface, Interface as ReadlineInterface } from 'readline';

// ---------------------------------------------------------------------------
// Arg parsing (zero dependencies)
// ---------------------------------------------------------------------------

interface FighterArgs {
  server: string;
  matchId: string;
  token: string;
  name: string | undefined;
}

function parseArgs(): FighterArgs {
  const args = process.argv.slice(2);
  let server = '';
  let matchId = '';
  let token = '';
  let name: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--server':
        server = args[++i] ?? '';
        break;
      case '--match-id':
        matchId = args[++i] ?? '';
        break;
      case '--token':
        token = args[++i] ?? '';
        break;
      case '--name':
        name = args[++i] ?? undefined;
        break;
    }
  }

  if (!server || !matchId || !token) {
    console.error(
      'Usage: node --experimental-strip-types src/fighter.ts --server <url> --match-id <id> --token <token> [--name "Name"]'
    );
    process.exit(1);
  }

  return { server: server.replace(/\/$/, ''), matchId, token, name };
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

async function httpPost(url: string, payload: unknown, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as Record<string, unknown>).error ?? res.statusText;
    throw new Error(`POST ${url} -> ${res.status}: ${msg}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Unique IP generation from token hash
// ---------------------------------------------------------------------------

function tokenToIp(token: string): string {
  const hash = createHash('sha256').update(token).digest();
  // Generate a 10.x.x.x address from the first 3 bytes of the hash
  return `10.${hash[0]}.${hash[1]}.${hash[2]}`;
}

// ---------------------------------------------------------------------------
// State types (lightweight subset of MatchPublicState)
// ---------------------------------------------------------------------------

interface FighterPublic {
  slot: string;
  name: string;
  accepted: boolean;
  joined: boolean;
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

  // Recent events (last 4 tick events)
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
  const fakeIp = tokenToIp(opts.token);

  console.log(`[fighter] Server: ${opts.server}`);
  console.log(`[fighter] Match:  ${opts.matchId}`);
  console.log(`[fighter] IP:     ${fakeIp}`);
  console.log('');

  // --- Step 1: Accept challenge ---
  console.log('[fighter] Accepting challenge...');
  const acceptResult = await httpPost(`${opts.server}/api/challenges/${opts.matchId}/accept`, {
    token: opts.token,
    fighterName: opts.name,
  }) as MatchState;

  // Determine our slot
  const mySlot = acceptResult.fighters.find((f) => f.name === (opts.name ?? ''))
    ? (acceptResult.fighters.find((f) => f.name === opts.name)?.slot ?? detectSlot(acceptResult, opts.token))
    : detectSlot(acceptResult, opts.token);

  console.log(`[fighter] Accepted as slot ${mySlot}.`);

  // --- Step 2: Wait for both accepted ---
  let state = acceptResult;
  while (state.status !== 'ready_to_join' && state.status !== 'running' && state.status !== 'finished' && state.status !== 'cancelled') {
    console.log(`[fighter] Waiting for opponent to accept... (status: ${state.status})`);
    await sleep(1500);
    state = (await httpGet(`${opts.server}/api/matches/${opts.matchId}/state`)) as MatchState;
  }

  if (state.status === 'cancelled' || state.status === 'finished') {
    console.log(`[fighter] Match ended before join: ${state.summary ?? state.status}`);
    process.exit(0);
  }

  // --- Step 3: Join match ---
  console.log('[fighter] Joining match...');
  state = (await httpPost(
    `${opts.server}/api/matches/${opts.matchId}/join`,
    { token: opts.token, fighterName: opts.name },
    { 'X-Forwarded-For': fakeIp }
  )) as MatchState;
  console.log(`[fighter] Joined from IP ${fakeIp}.`);

  // --- Step 4: Wait for opponent join ---
  while (state.status !== 'running' && state.status !== 'finished' && state.status !== 'cancelled') {
    console.log(`[fighter] Waiting for opponent to join... (status: ${state.status})`);
    await sleep(1500);
    state = (await httpGet(`${opts.server}/api/matches/${opts.matchId}/state`)) as MatchState;
  }

  if (state.status === 'cancelled' || state.status === 'finished') {
    console.log(`[fighter] Match ended before combat: ${state.summary ?? state.status}`);
    process.exit(0);
  }

  console.log('[fighter] Match started!');
  console.log('');

  // --- Step 5: Combat loop ---
  const reader = createLineReader();
  let stdinClosed = false;
  let lastTick = state.tick;

  while (state.status === 'running') {
    // Print state
    process.stdout.write(formatState(state, mySlot) + ' ');

    // Read action from stdin
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

    // Submit action
    try {
      await httpPost(`${opts.server}/api/matches/${opts.matchId}/action`, {
        token: opts.token,
        action,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Match may have ended between state check and action submit
      if (msg.includes('not running')) {
        break;
      }
      console.error(`[fighter] Action error: ${msg}`);
    }

    // Wait for next tick
    await sleep(800);

    // Fetch new state
    state = (await httpGet(`${opts.server}/api/matches/${opts.matchId}/state`)) as MatchState;

    // Detect tick skip
    if (state.tick > lastTick + 1) {
      console.log(`[fighter] Note: tick jumped from ${lastTick} to ${state.tick} (slow decision?)`);
    }
    lastTick = state.tick;
  }

  reader.close();

  // --- Step 6: Print result ---
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

/**
 * Detect our slot by checking which fighter just got accepted.
 * After accept, the fighter that was just accepted will have accepted=true.
 * If both are accepted, fall back to checking whose data was most recently updated.
 */
function detectSlot(state: MatchState, _token: string): string {
  // After accept, the one just accepted has accepted=true and the accept response
  // includes our name. Since we can't see tokens in public state, use positional logic:
  // In the accept response, the status changes tell us which slot we are.
  // Look at recentEvents for the accept event
  const acceptEvents = state.recentEvents.filter((e) => e.message.includes('accepted the challenge'));
  if (acceptEvents.length > 0) {
    const last = acceptEvents[acceptEvents.length - 1];
    if (last.message.startsWith('A ')) return 'A';
    if (last.message.startsWith('B ')) return 'B';
  }
  // Fallback: first accepted fighter
  const accepted = state.fighters.filter((f) => f.accepted);
  if (accepted.length === 1) return accepted[0].slot;
  return 'A';
}

main().catch((err) => {
  console.error(`[fighter] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
