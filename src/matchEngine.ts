import { randomUUID } from 'crypto';

export type FighterAction =
  | 'idle'
  | 'forward'
  | 'backward'
  | 'guard'
  | 'light_attack'
  | 'heavy_attack';

export type MatchStatus = 'waiting' | 'running' | 'finished';

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
  joined: boolean;
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
  type: 'system' | 'join' | 'action' | 'tick' | 'end';
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
    sourceIp?: string;
    hp: number;
    energy: number;
  }>;
  events: MatchEvent[];
}

export interface CreateMatchInput {
  refereeName?: string;
  fighterAName?: string;
  fighterBName?: string;
  durationSec?: number;
}

export interface CreateMatchResult {
  id: string;
  refereeName: string;
  fighterTokens: {
    A: string;
    B: string;
  };
}

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

  createMatch(input: CreateMatchInput = {}): CreateMatchResult {
    const id = randomUUID();
    const fighterAToken = randomUUID();
    const fighterBToken = randomUUID();
    const now = new Date().toISOString();

    const match: MatchInternalState = {
      id,
      createdAt: now,
      refereeName: input.refereeName ?? 'Referee',
      status: 'waiting',
      maxDurationSec: input.durationSec ?? 60,
      timeRemaining: input.durationSec ?? 60,
      tick: 0,
      fighters: [
        {
          slot: 'A',
          token: fighterAToken,
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

    this.addEvent(match, 'system', 'Match created (BO1). Waiting for two fighters to join.');
    this.matches.set(id, match);
    this.emit(id, { kind: 'state', state: this.toPublicState(match) });

    return {
      id,
      refereeName: match.refereeName,
      fighterTokens: {
        A: fighterAToken,
        B: fighterBToken,
      },
    };
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
        sourceIp: fighter.sourceIp,
        hp: fighter.hp,
        energy: fighter.energy,
      })),
      events: match.events,
    };
  }

  joinMatch(matchId: string, token: string, sourceIp: string, fighterName?: string): MatchPublicState {
    const match = this.mustMatch(matchId);

    if (match.status !== 'waiting') {
      throw new Error('Match is not accepting joins.');
    }

    // Protocol assumption: fighter token is an out-of-band shared secret issued by referee.
    const fighter = match.fighters.find((candidate) => candidate.token === token);
    if (!fighter) {
      throw new Error('Invalid fighter token.');
    }
    if (fighter.joined) {
      throw new Error('Fighter already joined.');
    }

    const other = match.fighters.find((candidate) => candidate.slot !== fighter.slot);
    if (other?.joined && other.sourceIp === sourceIp) {
      throw new Error('Fighters must join from distinct source IPs.');
    }

    fighter.joined = true;
    fighter.sourceIp = sourceIp;
    fighter.name = fighterName?.trim() || fighter.name;

    this.addEvent(
      match,
      'join',
      `${fighter.slot} joined from ${sourceIp}.`,
      { slot: fighter.slot, sourceIp }
    );

    if (match.fighters.every((candidate) => candidate.joined)) {
      match.status = 'running';
      this.addEvent(match, 'system', 'Both fighters joined. Match started.');
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

  private toPublicState(match: MatchInternalState): MatchPublicState {
    const [a, b] = match.fighters;
    return {
      id: match.id,
      createdAt: match.createdAt,
      refereeName: match.refereeName,
      status: match.status,
      tick: match.tick,
      timeRemaining: match.timeRemaining,
      maxDurationSec: match.maxDurationSec,
      distance: Math.abs(a.position - b.position),
      fighters: [
        {
          slot: a.slot,
          name: a.name,
          joined: a.joined,
          hp: a.hp,
          energy: a.energy,
          position: a.position,
          currentAction: a.currentAction,
        },
        {
          slot: b.slot,
          name: b.name,
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
