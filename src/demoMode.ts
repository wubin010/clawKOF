import type { FighterAction, MatchPublicState } from './matchEngine.ts';

interface DemoInfo {
  matchId: string;
}

export async function runDemoMode(baseUrl: string): Promise<DemoInfo> {
  // Fighter A creates/joins (auto-creates since no waiting match)
  const aResp = await fetch(`${baseUrl}/api/matches/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Claw Alpha', duration: 90 }),
  });
  if (!aResp.ok) {
    throw new Error(`Unable to create demo match: ${aResp.status}`);
  }
  const aResult = (await aResp.json()) as { matchId: string; slot: string };

  // Fighter B joins the waiting match
  const bResp = await fetch(`${baseUrl}/api/matches/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Claw Beta' }),
  });
  if (!bResp.ok) {
    throw new Error(`Unable to join demo match: ${bResp.status}`);
  }

  driveBot(baseUrl, aResult.matchId, 'Claw Alpha', 'A');
  driveBot(baseUrl, aResult.matchId, 'Claw Beta', 'B');

  return { matchId: aResult.matchId };
}

const MAX_CONSECUTIVE_ERRORS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function driveBot(baseUrl: string, matchId: string, name: string, slot: 'A' | 'B'): Promise<void> {
  let errors = 0;

  while (errors < MAX_CONSECUTIVE_ERRORS) {
    try {
      const stateResp = await fetch(`${baseUrl}/api/matches/${matchId}/state`);
      if (!stateResp.ok) {
        errors++;
        continue;
      }
      let state = (await stateResp.json()) as MatchPublicState;

      if (state.status === 'finished') return;
      if (state.status === 'waiting') {
        errors = 0;
        await sleep(500);
        continue;
      }

      // Running — submit actions until match ends
      while (state.status === 'running' && errors < MAX_CONSECUTIVE_ERRORS) {
        const me = state.fighters.find((fighter) => fighter.slot === slot);
        const opponent = state.fighters.find((fighter) => fighter.slot !== slot);
        if (!me || !opponent) break;

        const action = chooseAction(me.energy, state.distance, me.hp, opponent.hp);

        const actionResp = await fetch(`${baseUrl}/api/matches/${matchId}/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, action }),
        });

        if (!actionResp.ok) {
          errors++;
          break;
        }

        // POST blocks until tick resolves — response is the new state
        state = (await actionResp.json()) as MatchPublicState;
        errors = 0;
      }

      if (state.status === 'finished') return;
    } catch {
      errors++;
    }
  }
}

function chooseAction(energy: number, distance: number, hp: number, enemyHp: number): FighterAction {
  // Special finisher: high energy, in range, enemy low
  if (energy >= 55 && distance <= 16 && enemyHp <= 40) {
    return Math.random() < 0.8 ? 'special' : 'heavy_attack';
  }

  // Heavy attack at close range
  if (energy >= 30 && distance <= 14) {
    const r = Math.random();
    if (r < 0.5) return 'heavy_attack';
    if (r < 0.7) return 'counter';
    return 'guard';
  }

  // Light attack at mid range
  if (energy >= 18 && distance <= 18) {
    const r = Math.random();
    if (r < 0.5) return 'light_attack';
    if (r < 0.7) return 'counter';
    return 'guard';
  }

  // Dash attack to close gap and harass
  if (energy >= 12 && distance > 16 && distance <= 28) {
    return Math.random() < 0.6 ? 'dash_attack' : 'forward';
  }

  // Far away: approach
  if (distance > 18) {
    return Math.random() < 0.8 ? 'forward' : 'idle';
  }

  // Low HP defensive play
  if (hp < 30 && enemyHp > hp) {
    const r = Math.random();
    if (r < 0.4) return 'counter';
    if (r < 0.7) return 'guard';
    return 'backward';
  }

  const pool: FighterAction[] = ['idle', 'forward', 'backward', 'guard', 'counter'];
  return pool[Math.floor(Math.random() * pool.length)];
}
