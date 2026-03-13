import type { FighterAction, MatchPublicState } from './matchEngine.ts';

interface DemoInfo {
  matchId: string;
}

export async function runDemoMode(baseUrl: string): Promise<DemoInfo> {
  const createdResponse = await fetch(`${baseUrl}/api/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refereeName: 'RefereeBot',
      fighterAName: 'Claw Alpha',
      fighterBName: 'Claw Beta',
      durationSec: 60,
      orchestrationSource: 'demo_mode',
    }),
  });
  if (!createdResponse.ok) {
    throw new Error(`Unable to create demo challenge: ${createdResponse.status}`);
  }

  const created = (await createdResponse.json()) as {
    matchId: string;
    fighterTokens: { A: string; B: string };
  };

  await Promise.all([
    acceptFighter(baseUrl, created.matchId, created.fighterTokens.A, 'Claw Alpha'),
    acceptFighter(baseUrl, created.matchId, created.fighterTokens.B, 'Claw Beta'),
  ]);

  await Promise.all([
    joinFighter(baseUrl, created.matchId, created.fighterTokens.A, 'Claw Alpha', '10.0.0.11'),
    joinFighter(baseUrl, created.matchId, created.fighterTokens.B, 'Claw Beta', '10.0.0.12'),
  ]);

  driveBot(baseUrl, created.matchId, created.fighterTokens.A, 'A');
  driveBot(baseUrl, created.matchId, created.fighterTokens.B, 'B');

  return { matchId: created.matchId };
}

async function acceptFighter(
  baseUrl: string,
  challengeId: string,
  token: string,
  fighterName: string
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/challenges/${challengeId}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, fighterName }),
  });
  if (!response.ok) {
    throw new Error(`accept failed: ${response.status}`);
  }
}

async function joinFighter(
  baseUrl: string,
  matchId: string,
  token: string,
  fighterName: string,
  sourceIp: string
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/matches/${matchId}/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': sourceIp,
    },
    body: JSON.stringify({ token, fighterName }),
  });
  if (!response.ok) {
    throw new Error(`join failed (${sourceIp}): ${response.status}`);
  }
}

function driveBot(baseUrl: string, matchId: string, token: string, slot: 'A' | 'B'): void {
  const interval = setInterval(async () => {
    try {
      const stateResp = await fetch(`${baseUrl}/api/matches/${matchId}/state`);
      if (!stateResp.ok) {
        clearInterval(interval);
        return;
      }
      const state = (await stateResp.json()) as MatchPublicState;

      if (state.status !== 'running') {
        clearInterval(interval);
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
        body: JSON.stringify({ token, action }),
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
