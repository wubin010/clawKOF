import { randomUUID } from 'crypto';

export type FighterAction =
  | 'idle'
  | 'forward'
  | 'backward'
  | 'guard'
  | 'light_attack'
  | 'heavy_attack'
  | 'dash_attack'
  | 'counter'
  | 'special';

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
  'dash_attack',
  'counter',
  'special',
];

interface FighterInternalState {
  slot: FighterSlot;
  name: string;
  hp: number;
  energy: number;
  position: number;
  currentAction: FighterAction;
  totalDamageDealt: number;
}

export interface MatchEvent {
  id: number;
  tick: number;
  at: string;
  type: 'system' | 'join' | 'action' | 'tick' | 'end';
  message: string;
  payload?: Record<string, unknown>;
}

const TICK_DEADLINE_MS = Number(process.env.TICK_DEADLINE_MS) || 5000;

interface MatchInternalState {
  id: string;
  createdAt: string;
  status: MatchStatus;
  maxDurationSec: number;
  timeRemaining: number;
  tick: number;
  fighters: [FighterInternalState, FighterInternalState];
  pendingActions: Map<FighterSlot, FighterAction>;
  events: MatchEvent[];
  winner: Winner;
  summary: string | null;
  endedAt: string | null;
  nextEventId: number;
  waitingDeadline: number;
  tickTimer: ReturnType<typeof setTimeout> | null;
  tickResolvers: Array<(state: MatchPublicState) => void>;
  startResolvers: Array<(state: MatchPublicState) => void>;
}

export interface FighterPublicState {
  slot: FighterSlot;
  name: string;
  hp: number;
  energy: number;
  position: number;
  currentAction: FighterAction;
}

export interface MatchPublicState {
  id: string;
  createdAt: string;
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
  createdAt: string;
  endedAt: string | null;
  status: MatchStatus;
  winner: Winner;
  summary: string | null;
  totalTicks: number;
  fighters: Array<{
    slot: FighterSlot;
    name: string;
    hp: number;
    energy: number;
  }>;
  events: MatchEvent[];
}

export interface CreateMatchResult {
  matchId: string;
  slot: FighterSlot;
}

export interface JoinMatchResult {
  matchId: string;
  slot: FighterSlot;
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

  findWaitingMatch(): string | null {
    for (const match of this.matches.values()) {
      if (match.status === 'waiting') {
        return match.id;
      }
    }
    return null;
  }

  createMatch(opts: { name: string; durationSec?: number }): CreateMatchResult {
    validateFighterName(opts.name);
    const id = randomUUID();
    const now = new Date().toISOString();
    const duration = sanitizeDuration(opts.durationSec);

    const match: MatchInternalState = {
      id,
      createdAt: now,
      status: 'waiting',
      maxDurationSec: duration,
      timeRemaining: duration,
      tick: 0,
      fighters: [
        {
          slot: 'A',
          name: opts.name,
          hp: 100,
          energy: 30,
          position: 25,
          currentAction: 'idle',
          totalDamageDealt: 0,
        },
        {
          slot: 'B',
          name: '',
          hp: 100,
          energy: 30,
          position: 75,
          currentAction: 'idle',
          totalDamageDealt: 0,
        },
      ],
      pendingActions: new Map<FighterSlot, FighterAction>(),
      events: [],
      winner: null,
      summary: null,
      endedAt: null,
      nextEventId: 1,
      waitingDeadline: Date.now() + 300_000,
      tickTimer: null,
      tickResolvers: [],
      startResolvers: [],
    };

    this.addEvent(match, 'system', `Match created. ${opts.name} joined as A. Waiting for opponent.`);
    this.matches.set(id, match);
    this.emit(id, { kind: 'state', state: this.toPublicState(match) });

    return { matchId: id, slot: 'A' };
  }

  joinMatch(matchId: string, name: string): JoinMatchResult {
    validateFighterName(name);
    const match = this.mustMatch(matchId);

    if (match.status === 'running') {
      throw new Error('Match is already running.');
    }
    if (match.status === 'finished') {
      throw new Error('Match has already finished.');
    }
    if (match.fighters[0].name === name) {
      throw new Error('Name already taken in this match.');
    }
    if (match.fighters[1].name !== '') {
      throw new Error('Match is full.');
    }

    match.fighters[1].name = name;
    match.status = 'running';

    this.addEvent(match, 'join', `${name} joined as B. Match started.`);
    const pubState = this.toPublicState(match);
    this.emit(match.id, { kind: 'state', state: pubState });

    for (const resolve of match.startResolvers) resolve(pubState);
    match.startResolvers = [];

    return { matchId: match.id, slot: 'B' };
  }

  getState(matchId: string): MatchPublicState {
    const match = this.mustMatch(matchId);
    return this.toPublicState(match);
  }

  waitForStart(matchId: string): Promise<MatchPublicState> {
    const match = this.mustMatch(matchId);
    if (match.status !== 'waiting') {
      return Promise.resolve(this.toPublicState(match));
    }
    return new Promise((resolve) => {
      match.startResolvers.push(resolve);
    });
  }

  getReport(matchId: string): MatchReport {
    const match = this.mustMatch(matchId);
    return {
      id: match.id,
      createdAt: match.createdAt,
      endedAt: match.endedAt,
      status: match.status,
      winner: match.winner,
      summary: match.summary,
      totalTicks: match.tick,
      fighters: match.fighters.map((fighter) => ({
        slot: fighter.slot,
        name: fighter.name,
        hp: fighter.hp,
        energy: fighter.energy,
      })),
      events: match.events,
    };
  }

  submitAction(matchId: string, name: string, action: FighterAction): Promise<MatchPublicState> {
    const match = this.mustMatch(matchId);
    if (match.status !== 'running') {
      throw new Error('Match is not running.');
    }

    const fighter = match.fighters.find((f) => f.name === name);
    if (!fighter) {
      throw new Error('Fighter not found in this match.');
    }
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    if (match.pendingActions.has(fighter.slot)) {
      throw new Error('Action already submitted for this tick.');
    }

    match.pendingActions.set(fighter.slot, action);
    this.addEvent(match, 'action', `${fighter.slot} submitted action: ${action}.`, {
      slot: fighter.slot,
      action,
    });

    const state = this.toPublicState(match);
    this.emit(match.id, { kind: 'event', state, event: match.events.at(-1) });

    if (match.pendingActions.size === 2) {
      // Both submitted — resolve tick immediately
      if (match.tickTimer) {
        clearTimeout(match.tickTimer);
        match.tickTimer = null;
      }
      this.resolveTick(match);
      return Promise.resolve(this.toPublicState(match));
    }

    // First submission — start deadline timer
    if (!match.tickTimer) {
      match.tickTimer = setTimeout(() => {
        match.tickTimer = null;
        if (match.status === 'running') {
          this.resolveTick(match);
        }
      }, TICK_DEADLINE_MS);
    }

    return new Promise((resolve) => {
      match.tickResolvers.push(resolve);
    });
  }

  housekeep(): void {
    const now = Date.now();
    for (const [id, match] of this.matches) {
      if (match.status === 'waiting' && now > match.waitingDeadline) {
        this.finishMatch(match, null, 'No opponent joined.');
        const pubState = this.toPublicState(match);
        for (const resolve of match.startResolvers) resolve(pubState);
        match.startResolvers = [];
        this.emit(id, { kind: 'end', state: pubState });
      } else if (match.status === 'finished' && match.endedAt) {
        const endedMs = new Date(match.endedAt).getTime();
        if (now - endedMs > 600_000) {
          this.listeners.delete(id);
          this.matches.delete(id);
        }
      }
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
      try {
        cb(update);
      } catch {
        // subscriber error must not break other subscribers
      }
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
    let actionA = match.pendingActions.get('A') ?? 'idle';
    let actionB = match.pendingActions.get('B') ?? 'idle';
    match.pendingActions.clear();

    // Energy regen (7 per tick)
    fighterA.energy = Math.min(100, fighterA.energy + 7);
    fighterB.energy = Math.min(100, fighterB.energy + 7);

    // Guard energy gate: guard costs 8 energy, fails to idle if insufficient
    if (actionA === 'guard') {
      if (fighterA.energy >= 8) {
        fighterA.energy -= 8;
      } else {
        actionA = 'idle';
      }
    }
    if (actionB === 'guard') {
      if (fighterB.energy >= 8) {
        fighterB.energy -= 8;
      } else {
        actionB = 'idle';
      }
    }

    // Counter energy gate: counter costs 15 energy, fails to idle if insufficient
    if (actionA === 'counter') {
      if (fighterA.energy >= 15) {
        fighterA.energy -= 15;
      } else {
        actionA = 'idle';
      }
    }
    if (actionB === 'counter') {
      if (fighterB.energy >= 15) {
        fighterB.energy -= 15;
      } else {
        actionB = 'idle';
      }
    }

    // Dash attack must have enough energy to dash. If not, it degrades to idle.
    // (Damage cost is still deducted later inside resolveStrike when the attack executes.)
    if (actionA === 'dash_attack' && fighterA.energy < 12) {
      actionA = 'idle';
    }
    if (actionB === 'dash_attack' && fighterB.energy < 12) {
      actionB = 'idle';
    }

    fighterA.currentAction = actionA;
    fighterB.currentAction = actionB;

    this.applyMovement(fighterA, actionA);
    this.applyMovement(fighterB, actionB);
    this.enforceMinimumDistance(fighterA, fighterB);

    const distance = Math.abs(fighterA.position - fighterB.position);

    // Resolve strikes (attacks + counter logic)
    const strikeA = this.resolveStrike(fighterA, fighterB, actionA, actionB, distance);
    const strikeB = this.resolveStrike(fighterB, fighterA, actionB, actionA, distance);

    // Counter resolution: if a fighter uses counter and is attacked, reflect 14 damage
    let counterDmgA = 0; // extra damage A takes from B's counter
    let counterDmgB = 0; // extra damage B takes from A's counter
    if (actionA === 'counter' && strikeB.landed) {
      counterDmgB = 14; // A reflects 14 to B
    }
    if (actionB === 'counter' && strikeA.landed) {
      counterDmgA = 14; // B reflects 14 to A
    }

    fighterA.hp = Math.max(0, fighterA.hp - strikeB.damage - counterDmgA);
    fighterB.hp = Math.max(0, fighterB.hp - strikeA.damage - counterDmgB);

    // Track total damage dealt
    fighterA.totalDamageDealt += strikeA.damage + counterDmgB;
    fighterB.totalDamageDealt += strikeB.damage + counterDmgA;

    const message = [
      `Tick ${match.tick}:`,
      `A=${actionA}`,
      `B=${actionB}`,
      `damage(A<=${strikeB.damage + counterDmgA}, B<=${strikeA.damage + counterDmgB})`,
      `distance=${Math.round(distance)}`,
    ].join(' ');

    this.addEvent(match, 'tick', message, {
      actionA,
      actionB,
      strikeA: { ...strikeA, counterReflect: counterDmgB },
      strikeB: { ...strikeB, counterReflect: counterDmgA },
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
      } else if (fighterA.totalDamageDealt > fighterB.totalDamageDealt) {
        this.finishMatch(match, 'A', `${fighterA.name} wins on damage dealt after timeout.`);
      } else if (fighterB.totalDamageDealt > fighterA.totalDamageDealt) {
        this.finishMatch(match, 'B', `${fighterB.name} wins on damage dealt after timeout.`);
      } else {
        this.finishMatch(match, 'draw', 'Timeout draw. Equal HP and damage.');
      }
    }

    const pubState = this.toPublicState(match);
    const update: EngineUpdate = {
      kind: match.status === 'finished' ? 'end' : 'state',
      state: pubState,
      event: match.events.at(-1),
    };
    this.emit(match.id, update);

    // Notify all waiters (from submitAction promises)
    for (const resolve of match.tickResolvers) resolve(pubState);
    match.tickResolvers = [];
    match.tickTimer = null;
  }

  private applyMovement(fighter: FighterInternalState, action: FighterAction): void {
    const speed = 6;
    const dashSpeed = 10;

    if (fighter.slot === 'A') {
      if (action === 'forward') {
        fighter.position += speed;
      } else if (action === 'backward') {
        fighter.position -= speed;
      } else if (action === 'dash_attack') {
        fighter.position += dashSpeed;
      }
    } else {
      if (action === 'forward') {
        fighter.position -= speed;
      } else if (action === 'backward') {
        fighter.position += speed;
      } else if (action === 'dash_attack') {
        fighter.position -= dashSpeed;
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

    const arenaMin = 4;
    const arenaMax = 96;
    const half = minDistance / 2;

    let left = (a.position + b.position) / 2 - half;
    let right = (a.position + b.position) / 2 + half;

    // Re-anchor the pair on edges if center split would violate bounds.
    if (left < arenaMin) {
      left = arenaMin;
      right = arenaMin + minDistance;
    } else if (right > arenaMax) {
      right = arenaMax;
      left = arenaMax - minDistance;
    }

    a.position = left;
    b.position = right;
  }

  private resolveStrike(
    attacker: FighterInternalState,
    defender: FighterInternalState,
    action: FighterAction,
    defenderAction: FighterAction,
    distance: number
  ): { landed: boolean; damage: number; energySpent: number } {
    const attackProfiles: Record<string, { cost: number; range: number; damage: number }> = {
      light_attack:  { cost: 18, range: 18, damage: 10 },
      heavy_attack:  { cost: 30, range: 14, damage: 20 },
      dash_attack:   { cost: 12, range: 22, damage: 6 },
      special:       { cost: 55, range: 16, damage: 32 },
    };

    const profile = attackProfiles[action];
    if (!profile) {
      return { landed: false, damage: 0, energySpent: 0 };
    }

    if (attacker.energy < profile.cost) {
      return { landed: false, damage: 0, energySpent: 0 };
    }

    attacker.energy -= profile.cost;

    if (distance > profile.range) {
      return { landed: false, damage: 0, energySpent: profile.cost };
    }

    let damage = profile.damage;

    // Guard: reduce to 35% (ceil)
    if (defenderAction === 'guard') {
      damage = Math.ceil(damage * 0.35);
    }

    // Backward dodge: within range-6 of max range, 50% damage reduction
    if (defenderAction === 'backward' && distance > profile.range - 6) {
      damage = Math.floor(damage * 0.5);
    }

    // Counter: defender takes 60% damage (40% reduction)
    if (defenderAction === 'counter') {
      damage = Math.ceil(damage * 0.6);
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
      status: match.status,
      tick: match.tick,
      timeRemaining: match.timeRemaining,
      maxDurationSec: match.maxDurationSec,
      distance: Math.abs(a.position - b.position),
      fighters: [
        {
          slot: a.slot,
          name: a.name,
          hp: a.hp,
          energy: a.energy,
          position: a.position,
          currentAction: a.currentAction,
        },
        {
          slot: b.slot,
          name: b.name,
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

function sanitizeDuration(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return 90;
  }
  return Math.min(300, Math.floor(value));
}

export function isValidAction(action: string): action is FighterAction {
  return VALID_ACTIONS.includes(action as FighterAction);
}

const FIGHTER_NAME_RE = /^[\w\u4e00-\u9fff\- ]{1,32}$/;

function validateFighterName(name: string): void {
  if (!FIGHTER_NAME_RE.test(name)) {
    throw new Error('Invalid fighter name. 1-32 characters, letters/digits/Chinese/underscore/hyphen/space.');
  }
}
