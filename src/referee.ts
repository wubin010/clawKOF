/**
 * Referee script — spawns the KOF server, creates a challenge, and monitors the match.
 *
 * Usage:
 *   node --experimental-strip-types src/referee.ts [--port 3000] [--duration 60]
 *
 * Prints structured match info (tokens, URLs, fighter commands) to stdout,
 * then monitors until the match ends.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface RefereeArgs {
  port: number;
  duration: number;
}

function parseArgs(): RefereeArgs {
  const args = process.argv.slice(2);
  let port = 3000;
  let duration = 60;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        port = Number(args[++i]) || 3000;
        break;
      case '--duration':
        duration = Number(args[++i]) || 60;
        break;
    }
  }

  return { port, duration };
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

async function httpPost(url: string, payload: unknown): Promise<unknown> {
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
  return body;
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Wait for server ready
// ---------------------------------------------------------------------------

async function waitForServer(baseUrl: string, timeoutMs: number = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(baseUrl);
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  const baseUrl = `http://localhost:${opts.port}`;
  const serverScript = path.join(process.cwd(), 'src', 'server.ts');

  // --- Step 1: Spawn server ---
  console.log(`[referee] Starting server on port ${opts.port}...`);
  const serverProc: ChildProcess = spawn(
    process.execPath,
    ['--experimental-strip-types', serverScript],
    {
      env: { ...process.env, PORT: String(opts.port), DEMO_MODE: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // Forward server stderr for debugging
  serverProc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  // Capture server stdout for ready detection
  serverProc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('listening on')) {
      console.log(`[referee] Server ready.`);
    }
  });

  // Cleanup on exit
  const cleanup = () => {
    if (!serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    console.log('\n[referee] Interrupted, shutting down...');
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  serverProc.on('exit', (code) => {
    console.log(`[referee] Server process exited with code ${code}`);
  });

  // Wait for server to be ready
  await waitForServer(baseUrl);

  // --- Step 2: Create challenge ---
  console.log('[referee] Creating challenge...');
  const challenge = (await httpPost(`${baseUrl}/api/challenges`, {
    refereeName: 'Referee',
    fighterAName: 'Fighter A',
    fighterBName: 'Fighter B',
    durationSec: opts.duration,
    orchestrationSource: 'manual_api',
  })) as {
    matchId: string;
    fighterTokens: { A: string; B: string };
  };

  const { matchId, fighterTokens } = challenge;

  // --- Step 3: Print structured output ---
  console.log('');
  console.log('=== LOBSTER KOF MATCH CREATED ===');
  console.log(`Match ID: ${matchId}`);
  console.log(`Spectator URL: ${baseUrl}/match/${matchId}`);
  console.log('');
  console.log(`Fighter A token: ${fighterTokens.A}`);
  console.log(`Fighter B token: ${fighterTokens.B}`);
  console.log('');
  console.log('Fighters run:');
  console.log(`  node --experimental-strip-types src/fighter.ts --server ${baseUrl} --match-id ${matchId} --token ${fighterTokens.A} --name "Fighter A"`);
  console.log(`  node --experimental-strip-types src/fighter.ts --server ${baseUrl} --match-id ${matchId} --token ${fighterTokens.B} --name "Fighter B"`);
  console.log('=================================');
  console.log('');

  // --- Step 4: Monitor loop ---
  let lastStatus = '';
  let lastAccepted = 0;
  let lastJoined = 0;
  let lastReportedTick = 0;

  while (true) {
    await sleep(2000);

    let state: {
      status: string;
      tick: number;
      timeRemaining: number;
      acceptance: { accepted: number };
      joins: { joined: number };
      fighters: Array<{ slot: string; name: string; hp: number }>;
      winner: string | null;
      summary: string | null;
    };

    try {
      state = (await httpGet(`${baseUrl}/api/matches/${matchId}/state`)) as typeof state;
    } catch (err) {
      console.error(`[referee] State poll error: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Status change
    if (state.status !== lastStatus) {
      console.log(`[referee] Status: ${state.status}`);
      lastStatus = state.status;
    }

    // Acceptance progress
    if (state.acceptance.accepted !== lastAccepted) {
      console.log(`[referee] Accepted: ${state.acceptance.accepted}/2`);
      lastAccepted = state.acceptance.accepted;
    }

    // Join progress
    if (state.joins.joined !== lastJoined) {
      console.log(`[referee] Joined: ${state.joins.joined}/2`);
      lastJoined = state.joins.joined;
    }

    // Periodic HP summary during combat (every 5 ticks)
    if (state.status === 'running' && state.tick >= lastReportedTick + 5) {
      const a = state.fighters.find((f) => f.slot === 'A')!;
      const b = state.fighters.find((f) => f.slot === 'B')!;
      console.log(
        `[referee] Tick ${state.tick} | ${a.name}: ${a.hp} HP | ${b.name}: ${b.hp} HP | Time: ${state.timeRemaining}s`
      );
      lastReportedTick = state.tick;
    }

    // Match ended
    if (state.status === 'finished' || state.status === 'cancelled') {
      console.log('');
      console.log('=== MATCH ENDED ===');
      console.log(`Status: ${state.status}`);
      console.log(`Winner: ${state.winner ?? 'none'}`);
      console.log(`Summary: ${state.summary ?? 'N/A'}`);
      console.log(`Total ticks: ${state.tick}`);
      for (const f of state.fighters) {
        console.log(`  ${f.slot} (${f.name}): ${f.hp} HP`);
      }
      console.log(`Report: ${baseUrl}/api/matches/${matchId}/report`);
      console.log(`Spectator: ${baseUrl}/match/${matchId}`);
      console.log('===================');
      break;
    }
  }

  // Give a moment for final events to propagate, then kill server
  await sleep(1000);
  cleanup();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[referee] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
