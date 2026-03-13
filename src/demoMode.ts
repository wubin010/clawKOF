import type { FighterAction, MatchPublicState } from './matchEngine.ts';

interface DemoInfo {
  matchId: string;
}

export async function runDemoMode(baseUrl: string): Promise<DemoInfo> {
  // Fighter A creates/joins (auto-creates since no waiting match)
  const aResp = await fetch(`${baseUrl}/api/matches/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Claw Alpha', duration: 60 }),
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

function driveBot(baseUrl: string, matchId: string, name: string, slot: 'A' | 'B'): void {
  const interval = setInterval(async () => {
    try {
      const stateResp = await fetch(`${baseUrl}/api/matches/${matchId}/state`);
      if (!stateResp.ok) {
        clearInterval(interval);
        return;
      }
      const state = (await stateResp.json()) as MatchPublicState;

      if (state.status !== 'running') {
        if (state.status === 'finished') {
          clearInterval(interval);
        }
        return;
      }

      const me = state.fighters.find((fighter) => fighter.slot === slot);
      const opponent = state.fighters.find((fighter) => fighter.slot !== slot);
      if (!me || !opponent) {
        return;
      }

      const action = chooseAction(me.energy, state.distance, me.hp, opponent.hp);

      await fetch(`${baseUrl}/api/matches/${matchId}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, action }),
      });
    } catch {
      clearInterval(interval);
    }
  }, 850);
}

function chooseAction(energy: number, distance: number, hp: number, enemyHp: number): FighterAction {
  if (energy >= 35 && distance <= 14) {
    return Math.random() < 0.7 ? 'heavy_attack' : 'guard';
  }
  if (energy >= 20 && distance <= 20) {
    return Math.random() < 0.65 ? 'light_attack' : 'guard';
  }
  if (distance > 18) {
    return Math.random() < 0.8 ? 'forward' : 'idle';
  }
  if (hp < 30 && enemyHp > hp) {
    return Math.random() < 0.65 ? 'guard' : 'backward';
  }

  const pool: FighterAction[] = ['idle', 'forward', 'backward', 'guard'];
  return pool[Math.floor(Math.random() * pool.length)];
}
