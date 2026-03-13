import { randomUUID } from 'crypto';

export type FighterAction =
  | 'idle'
  | 'forward'
  | 'backward'
  | 'guard'
  | 'light_attack'
  | 'heavy_attack';

export type MatchStatus =
  | 'challenge_created'
  | 'awaiting_acceptance'
  | 'ready_to_join'
  | 'running'
  | 'finished';

type FighterSlot = 'A' | 'B';
type Winner = FighterSlot | 'draw' | null;

const VALID_ACTIONS: FighterAction[] = [
  'idle',
  'forward',
  'backward',
  'guard',
  'light_attack',
  'heavy_attack',
];

interface FighterInternalState {
  slot: FighterSlot;
  token: string;
  accepted: boolean;
  acceptedAt?: string;
  joined: boolean;
  joinedAt?: string;
  name: string;
  sourceIp?: string;
  hp: number;
  energy: number;
  position: number;
  currentAction: FighterAction;
}

export interface MatchEvent {
  id: number;
  tick: number;
  at: string;
  type: 'system' | 'accept' | 'join' | 'action' | 'tick' | 'end';
  message: string;
  payload?: Record<string, unknown>;
}

interface MatchInternalState {
  id: string;
  createdAt: string;
  refereeName: string;
  status: MatchStatus;
  maxDurationSec: number;
  timeRemaining: number;
  tick: number;
  fighters: [FighterInternalState, FighterInternalState];
  pendingActions: Map<string, FighterAction>;
  events: MatchEvent[];
  winner: Winner;
  summary: string | null;
  endedAt: string | null;
  nextEventId: number;
}

export interface FighterPublicState {
  slot: FighterSlot;
  name: string;
  accepted: boolean;
  joined: boolean;
  hp: number;
  energy: number;
  position: number;
  currentAction: FighterAction;
}

export interface MatchPublicState {
  id: string;
  createdAt: string;
  refereeName: string;
  status: MatchStatus;
  tick: number;
  timeRemaining: number;
  maxDurationSec: number;
  distance: number;
  acceptance: {
    accepted: number;
    total: number;
    remaining: number;
  };
  joins: {
    joined: number;
    total: number;
    remaining: number;
  };
  fighters: [FighterPublicState, FighterPublicState];
  winner: Winner;
  summary: string | null;
  recentEvents: MatchEvent[];
}

export interface MatchReport {
  id: string;
  refereeName: string;
  createdAt: string;
  endedAt: string | null;
  bo: 'BO1';
  winner: Winner;
  summary: string | null;
  totalTicks: number;
  fighters: Array<{
    slot: FighterSlot;
    name: string;
    accepted: boolean;
    acceptedAt?: string;
    joined: boolean;
    joinedAt?: string;
    sourceIp?: string;
    hp: number;
    energy: number;
  }>;
  events: MatchEvent[];
}

export interface CreateChallengeInput {
  refereeName?: string;
  fighterAName?: string;
  fighterBName?: string;
  durationSec?: number;
}

export type CreateMatchInput = CreateChallengeInput;

export interface CreateChallengeResult {
  id: string;
  challengeId: string;
  matchId: string;
  refereeName: string;
  fighterTokens: {
    A: string;
    B: string;
  };
}

export type CreateMatchResult = CreateChallengeResult;

export interface EngineUpdate {
  kind: 'state' | 'end' | 'event';
  state: MatchPublicState;
  event?: MatchEvent;
}

export class MatchEngine {
  private readonly matches = new Map<string, MatchInternalState>();
  private readonly listeners = new Map<string, Set<(update: EngineUpdate) => void>>();

  listMatches(): MatchPublicState[] {
    return Array.from(this.matches.values()).map((match) => this.toPublicState(match));
  }

  getLatestMatchId(): string | null {
    let latest: MatchInternalState | null = null;
    for (const match of this.matches.values()) {
      if (!latest || match.createdAt > latest.createdAt) {
        latest = match;
      }
    }
    return latest?.id ?? null;
  }

  createChallenge(input: CreateChallengeInput = {}): CreateChallengeResult {
    const id = randomUUID();
    const fighterAToken = randomUUID();
    const fighterBToken = randomUUID();
    const now = new Date().toISOString();

    const match: MatchInternalState = {
      id,
      createdAt: now,
      refereeName: input.refereeName ?? 'Referee',
      status: 'challenge_created',
      maxDurationSec: input.durationSec ?? 60,
      timeRemaining: input.durationSec ?? 60,
      tick: 0,
      fighters: [
        {
          slot: 'A',
          token: fighterAToken,
          accepted: false,
          joined: false,
          name: input.fighterAName ?? 'Fighter A',
          hp: 100,
          energy: 30,
          position: 25,
          currentAction: 'idle',
        },
        {
          slot: 'B',
          token: fighterBToken,
          accepted: false,
          joined: false,
          name: input.fighterBName ?? 'Fighter B',
          hp: 100,
          energy: 30,
          position: 75,
          currentAction: 'idle',
        },
      ],
      pendingActions: new Map<string, FighterAction>(),
      events: [],
      winner: null,
      summary: null,
      endedAt: null,
      nextEventId: 1,
    };

    this.addEvent(
      match,
      'system',
      'Challenge created (BO1). Waiting for fighter token acceptances.'
    );
    this.matches.set(id, match);
    this.emit(id, { kind: 'state', state: this.toPublicState(match) });

    return {
      id,
      challengeId: id,
      matchId: id,
      refereeName: match.refereeName,
      fighterTokens: {
        A: fighterAToken,
        B: fighterBToken,
      },
    };
  }

  createMatch(input: CreateChallengeInput = {}): CreateChallengeResult {
    return this.createChallenge(input);
  }

  getState(matchId: string): MatchPublicState {
    const match = this.mustMatch(matchId);
    return this.toPublicState(match);
  }

  getReport(matchId: string): MatchReport {
    const match = this.mustMatch(matchId);
    return {
      id: match.id,
      refereeName: match.refereeName,
      createdAt: match.createdAt,
      endedAt: match.endedAt,
      bo: 'BO1',
      winner: match.winner,
      summary: match.summary,
      totalTicks: match.tick,
      fighters: match.fighters.map((fighter) => ({
        slot: fighter.slot,
        name: fighter.name,
        accepted: fighter.accepted,
        acceptedAt: fighter.acceptedAt,
        joined: fighter.joined,
        joinedAt: fighter.joinedAt,
        sourceIp: fighter.sourceIp,
        hp: fighter.hp,
        energy: fighter.energy,
      })),
      events: match.events,
    };
  }

  acceptChallenge(matchId: string, token: string, fighterName?: string): MatchPublicState {
    const match = this.mustMatch(matchId);

    if (match.status === 'running' || match.status === 'finished') {
      throw new Error('Challenge is no longer accepting fighter confirmations.');
    }

    // Protocol assumption: fighter token is an out-of-band shared secret issued by referee.
    const fighter = match.fighters.find((candidate) => candidate.token === token);
    if (!fighter) {
      throw new Error('Invalid fighter token.');
    }
    if (fighter.accepted) {
      throw new Error('Fighter already accepted the challenge.');
    }

    fighter.accepted = true;
    fighter.acceptedAt = new Date().toISOString();
    fighter.name = fighterName?.trim() || fighter.name;

    this.addEvent(match, 'accept', `${fighter.slot} accepted the challenge.`, {
      slot: fighter.slot,
    });

    const previousStatus = match.status;
    this.recomputePreMatchStatus(match);
    this.maybeAddLifecycleEvent(match, previousStatus);

    const state = this.toPublicState(match);
    this.emit(match.id, { kind: 'state', state });
    return state;
  }

  joinMatch(matchId: string, token: string, sourceIp: string, fighterName?: string): MatchPublicState {
    const match = this.mustMatch(matchId);

    if (match.status === 'running') {
      throw new Error('Match is already running.');
    }
    if (match.status === 'finished') {
      throw new Error('Match has already finished.');
    }
    if (match.status !== 'ready_to_join') {
      throw new Error('Match is not ready for joins. Both fighters must accept first.');
    }

    const fighter = match.fighters.find((candidate) => candidate.token === token);
    if (!fighter) {
      throw new Error('Invalid fighter token.');
    }
    if (!fighter.accepted) {
      throw new Error('Fighter must accept challenge before joining runtime.');
    }
    if (fighter.joined) {
      throw new Error('Fighter already joined.');
    }

    const other = match.fighters.find((candidate) => candidate.slot !== fighter.slot);
    if (other?.joined && other.sourceIp === sourceIp) {
      throw new Error('Fighters must join from distinct source IPs.');
    }

    fighter.joined = true;
    fighter.joinedAt = new Date().toISOString();
    fighter.sourceIp = sourceIp;
    fighter.name = fighterName?.trim() || fighter.name;

    this.addEvent(match, 'join', `${fighter.slot} joined runtime from ${sourceIp}.`, {
      slot: fighter.slot,
      sourceIp,
    });

    if (match.fighters.every((candidate) => candidate.joined)) {
      match.status = 'running';
      this.addEvent(match, 'system', 'Both fighters joined from distinct IPs. Match started.');
    }

    const state = this.toPublicState(match);
    this.emit(match.id, { kind: 'state', state });
    return state;
  }

  submitAction(matchId: string, token: string, action: FighterAction): MatchPublicState {
    const match = this.mustMatch(matchId);
    if (match.status !== 'running') {
      throw new Error('Match is not running.');
    }

    const fighter = match.fighters.find((candidate) => candidate.token === token);
    if (!fighter) {
      throw new Error('Invalid fighter token.');
    }
    if (!fighter.joined) {
      throw new Error('Fighter has not joined.');
    }
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }

    match.pendingActions.set(token, action);
    this.addEvent(match, 'action', `${fighter.slot} submitted action: ${action}.`, {
      slot: fighter.slot,
      action,
    });

    const state = this.toPublicState(match);
    this.emit(match.id, { kind: 'event', state, event: match.events.at(-1) });
    return state;
  }

  tickAll(): void {
    for (const match of this.matches.values()) {
      if (match.status !== 'running') {
        continue;
      }
      this.resolveTick(match);
    }
  }

  subscribe(matchId: string, cb: (update: EngineUpdate) => void): () => void {
    const set = this.listeners.get(matchId) ?? new Set<(update: EngineUpdate) => void>();
    set.add(cb);
    this.listeners.set(matchId, set);

    return () => {
      const current = this.listeners.get(matchId);
      if (!current) {
        return;
      }
      current.delete(cb);
      if (current.size === 0) {
        this.listeners.delete(matchId);
      }
    };
  }

  private emit(matchId: string, update: EngineUpdate): void {
    const set = this.listeners.get(matchId);
    if (!set) {
      return;
    }
    for (const cb of set) {
      cb(update);
    }
  }

  private mustMatch(matchId: string): MatchInternalState {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error('Match not found.');
    }
    return match;
  }

  private resolveTick(match: MatchInternalState): void {
    match.tick += 1;
    match.timeRemaining = Math.max(0, match.timeRemaining - 1);

    const [fighterA, fighterB] = match.fighters;
    const actionA = match.pendingActions.get(fighterA.token) ?? 'idle';
    const actionB = match.pendingActions.get(fighterB.token) ?? 'idle';
    match.pendingActions.clear();

    fighterA.currentAction = actionA;
    fighterB.currentAction = actionB;

    fighterA.energy = Math.min(100, fighterA.energy + 10);
    fighterB.energy = Math.min(100, fighterB.energy + 10);

    this.applyMovement(fighterA, actionA);
    this.applyMovement(fighterB, actionB);
    this.enforceMinimumDistance(fighterA, fighterB);

    const distance = Math.abs(fighterA.position - fighterB.position);

    const strikeA = this.resolveStrike(fighterA, fighterB, actionA, actionB, distance);
    const strikeB = this.resolveStrike(fighterB, fighterA, actionB, actionA, distance);

    fighterA.hp = Math.max(0, fighterA.hp - strikeB.damage);
    fighterB.hp = Math.max(0, fighterB.hp - strikeA.damage);

    const message = [
      `Tick ${match.tick}:`,
      `A=${actionA}`,
      `B=${actionB}`,
      `damage(A<=${strikeB.damage}, B<=${strikeA.damage})`,
      `distance=${Math.round(distance)}`,
    ].join(' ');

    this.addEvent(match, 'tick', message, {
      actionA,
      actionB,
      strikeA,
      strikeB,
      distance,
    });

    if (fighterA.hp <= 0 && fighterB.hp <= 0) {
      this.finishMatch(match, 'draw', 'Double knockout.');
    } else if (fighterA.hp <= 0) {
      this.finishMatch(match, 'B', `${fighterB.name} wins by knockout.`);
    } else if (fighterB.hp <= 0) {
      this.finishMatch(match, 'A', `${fighterA.name} wins by knockout.`);
    } else if (match.timeRemaining <= 0) {
      if (fighterA.hp > fighterB.hp) {
        this.finishMatch(match, 'A', `${fighterA.name} wins on HP after timeout.`);
      } else if (fighterB.hp > fighterA.hp) {
        this.finishMatch(match, 'B', `${fighterB.name} wins on HP after timeout.`);
      } else {
        this.finishMatch(match, 'draw', 'Timeout draw. Equal HP.');
      }
    }

    const update: EngineUpdate = {
      kind: match.status === 'finished' ? 'end' : 'state',
      state: this.toPublicState(match),
      event: match.events.at(-1),
    };
    this.emit(match.id, update);
  }

  private applyMovement(fighter: FighterInternalState, action: FighterAction): void {
    const speed = 6;

    if (fighter.slot === 'A') {
      if (action === 'forward') {
        fighter.position += speed;
      } else if (action === 'backward') {
        fighter.position -= speed;
      }
    } else {
      if (action === 'forward') {
        fighter.position -= speed;
      } else if (action === 'backward') {
        fighter.position += speed;
      }
    }

    fighter.position = clamp(fighter.position, 4, 96);
  }

  private enforceMinimumDistance(a: FighterInternalState, b: FighterInternalState): void {
    const minDistance = 8;
    const distance = Math.abs(a.position - b.position);
    if (distance >= minDistance) {
      return;
    }

    const center = (a.position + b.position) / 2;
    a.position = clamp(center - minDistance / 2, 4, 96);
    b.position = clamp(center + minDistance / 2, 4, 96);
  }

  private resolveStrike(
    attacker: FighterInternalState,
    defender: FighterInternalState,
    action: FighterAction,
    defenderAction: FighterAction,
    distance: number
  ): { landed: boolean; damage: number; energySpent: number } {
    if (action !== 'light_attack' && action !== 'heavy_attack') {
      return { landed: false, damage: 0, energySpent: 0 };
    }

    const profile =
      action === 'light_attack'
        ? { cost: 20, range: 20, damage: 12 }
        : { cost: 35, range: 14, damage: 22 };

    if (attacker.energy < profile.cost) {
      return { landed: false, damage: 0, energySpent: 0 };
    }

    attacker.energy -= profile.cost;

    if (distance > profile.range) {
      return { landed: false, damage: 0, energySpent: profile.cost };
    }

    let damage = profile.damage;
    if (defenderAction === 'guard') {
      damage = Math.ceil(damage * 0.45);
    }

    if (defenderAction === 'backward' && distance > profile.range - 3) {
      damage = Math.floor(damage * 0.5);
    }

    return { landed: damage > 0, damage, energySpent: profile.cost };
  }

  private finishMatch(match: MatchInternalState, winner: Winner, summary: string): void {
    match.status = 'finished';
    match.winner = winner;
    match.summary = summary;
    match.endedAt = new Date().toISOString();
    this.addEvent(match, 'end', `Match finished. ${summary}`, { winner, summary });
  }

  private addEvent(
    match: MatchInternalState,
    type: MatchEvent['type'],
    message: string,
    payload?: Record<string, unknown>
  ): void {
    const event: MatchEvent = {
      id: match.nextEventId,
      tick: match.tick,
      at: new Date().toISOString(),
      type,
      message,
      payload,
    };
    match.nextEventId += 1;
    match.events.push(event);

    if (match.events.length > 300) {
      match.events.shift();
    }
  }

  private recomputePreMatchStatus(match: MatchInternalState): void {
    if (match.status === 'running' || match.status === 'finished') {
      return;
    }

    const acceptedCount = match.fighters.filter((fighter) => fighter.accepted).length;
    if (acceptedCount === 0) {
      match.status = 'challenge_created';
      return;
    }
    if (acceptedCount < match.fighters.length) {
      match.status = 'awaiting_acceptance';
      return;
    }
    match.status = 'ready_to_join';
  }

  private maybeAddLifecycleEvent(match: MatchInternalState, previousStatus: MatchStatus): void {
    if (match.status === previousStatus) {
      return;
    }

    if (match.status === 'awaiting_acceptance') {
      this.addEvent(match, 'system', 'First acceptance received. Waiting for second fighter acceptance.');
    } else if (match.status === 'ready_to_join') {
      this.addEvent(match, 'system', 'Both fighters accepted. Waiting for runtime joins.');
    }
  }

  private toPublicState(match: MatchInternalState): MatchPublicState {
    const [a, b] = match.fighters;
    const accepted = match.fighters.filter((fighter) => fighter.accepted).length;
    const joined = match.fighters.filter((fighter) => fighter.joined).length;

    return {
      id: match.id,
      createdAt: match.createdAt,
      refereeName: match.refereeName,
      status: match.status,
      tick: match.tick,
      timeRemaining: match.timeRemaining,
      maxDurationSec: match.maxDurationSec,
      distance: Math.abs(a.position - b.position),
      acceptance: {
        accepted,
        total: match.fighters.length,
        remaining: match.fighters.length - accepted,
      },
      joins: {
        joined,
        total: match.fighters.length,
        remaining: match.fighters.length - joined,
      },
      fighters: [
        {
          slot: a.slot,
          name: a.name,
          accepted: a.accepted,
          joined: a.joined,
          hp: a.hp,
          energy: a.energy,
          position: a.position,
          currentAction: a.currentAction,
        },
        {
          slot: b.slot,
          name: b.name,
          accepted: b.accepted,
          joined: b.joined,
          hp: b.hp,
          energy: b.energy,
          position: b.position,
          currentAction: b.currentAction,
        },
      ],
      winner: match.winner,
      summary: match.summary,
      recentEvents: match.events.slice(-25),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function isValidAction(action: string): action is FighterAction {
  return VALID_ACTIONS.includes(action as FighterAction);
}
