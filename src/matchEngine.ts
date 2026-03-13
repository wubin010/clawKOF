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
  | 'finished'
  | 'cancelled';

type FighterSlot = 'A' | 'B';
type Winner = FighterSlot | 'draw' | null;

export type OrchestrationRole = 'referee' | 'fighterA' | 'fighterB';
export type InvitationStatus = 'not_required' | 'sent' | 'accepted' | 'declined';
export type RoleAcceptanceStatus = 'not_required' | 'pending' | 'accepted';
export type RoleJoinStatus = 'not_required' | 'pending' | 'joined';
export type ChallengeOrchestrationSource = 'manual_api' | 'group_chat_trigger' | 'demo_mode';

export type ChallengeCancellationReason =
  | 'referee_cancelled'
  | 'fighter_declined_invitation'
  | 'acceptance_timeout'
  | 'join_timeout'
  | 'protocol_violation';

const VALID_ACTIONS: FighterAction[] = [
  'idle',
  'forward',
  'backward',
  'guard',
  'light_attack',
  'heavy_attack',
];

const DEFAULT_ACCEPTANCE_TIMEOUT_SEC = 180;
const DEFAULT_JOIN_TIMEOUT_SEC = 120;
const ORCHESTRATION_PROTOCOL_VERSION = 'STANDARD-v1';

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

interface RoleInternalState {
  role: OrchestrationRole;
  slot?: FighterSlot;
  displayName: string;
  actorId?: string;
  invitation: {
    status: InvitationStatus;
    sentAt?: string;
    respondedAt?: string;
    note?: string;
  };
  acceptance: {
    status: RoleAcceptanceStatus;
    acceptedAt?: string;
  };
  join: {
    status: RoleJoinStatus;
    joinedAt?: string;
    sourceIp?: string;
  };
}

interface TimeoutWindowInternal {
  windowSec: number;
  deadlineAt: string | null;
  expiredAt?: string;
}

interface CancellationInternal {
  reason: ChallengeCancellationReason | null;
  byRole: OrchestrationRole | 'system' | null;
  at: string | null;
  note: string | null;
}

interface OrchestrationInternalState {
  protocolVersion: string;
  source: ChallengeOrchestrationSource;
  triggerText: string | null;
  roles: {
    referee: RoleInternalState;
    fighterA: RoleInternalState;
    fighterB: RoleInternalState;
  };
  timeouts: {
    acceptance: TimeoutWindowInternal;
    join: TimeoutWindowInternal;
  };
  cancellation: CancellationInternal;
}

export interface MatchEvent {
  id: number;
  tick: number;
  at: string;
  type: 'system' | 'orchestration' | 'accept' | 'join' | 'action' | 'tick' | 'end' | 'cancel';
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
  orchestration: OrchestrationInternalState;
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

export interface RolePublicState {
  role: OrchestrationRole;
  slot: FighterSlot | null;
  displayName: string;
  actorId: string | null;
  invitationStatus: InvitationStatus;
  invitationSentAt: string | null;
  invitationRespondedAt: string | null;
  invitationNote: string | null;
  acceptanceStatus: RoleAcceptanceStatus;
  acceptedAt: string | null;
  joinStatus: RoleJoinStatus;
  joinedAt: string | null;
  sourceIp: string | null;
}

export interface MatchOrchestrationPublicState {
  protocolVersion: string;
  source: ChallengeOrchestrationSource;
  triggerText: string | null;
  roles: {
    referee: RolePublicState;
    fighterA: RolePublicState;
    fighterB: RolePublicState;
  };
  invitationSummary: {
    accepted: number;
    pending: number;
    declined: number;
    total: number;
  };
  timeouts: {
    acceptance: {
      windowSec: number;
      deadlineAt: string;
      remainingSec: number;
      isExpired: boolean;
      expiredAt: string | null;
    };
    join: {
      windowSec: number;
      deadlineAt: string | null;
      remainingSec: number | null;
      isActive: boolean;
      isExpired: boolean;
      expiredAt: string | null;
    };
  };
  cancellation: {
    isCancelled: boolean;
    reason: ChallengeCancellationReason | null;
    byRole: OrchestrationRole | 'system' | null;
    at: string | null;
    note: string | null;
  };
  groupChatBridge: {
    triggerEndpoint: '/api/orchestration/group-chat-trigger';
    invitationResponseEndpointTemplate: '/api/orchestration/challenges/{challengeId}/invitations/respond';
    refereeCancelEndpointTemplate: '/api/orchestration/challenges/{challengeId}/cancel';
  };
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
  orchestration: MatchOrchestrationPublicState;
  winner: Winner;
  summary: string | null;
  recentEvents: MatchEvent[];
}

export interface MatchOrchestrationSnapshot {
  id: string;
  status: MatchStatus;
  createdAt: string;
  orchestration: MatchOrchestrationPublicState;
  recentEvents: MatchEvent[];
}

export interface MatchReport {
  id: string;
  refereeName: string;
  createdAt: string;
  endedAt: string | null;
  status: MatchStatus;
  bo: 'BO1';
  winner: Winner;
  summary: string | null;
  totalTicks: number;
  orchestration: MatchOrchestrationPublicState;
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
  refereeAgentId?: string;
  fighterAAgentId?: string;
  fighterBAgentId?: string;
  durationSec?: number;
  acceptanceTimeoutSec?: number;
  joinTimeoutSec?: number;
  orchestrationSource?: ChallengeOrchestrationSource;
  triggerText?: string;
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
  orchestration: {
    protocolVersion: string;
    source: ChallengeOrchestrationSource;
    roles: {
      referee: { displayName: string; actorId: string | null };
      fighterA: { displayName: string; actorId: string | null };
      fighterB: { displayName: string; actorId: string | null };
    };
    timeouts: {
      acceptanceTimeoutSec: number;
      joinTimeoutSec: number;
      acceptanceDeadlineAt: string;
      joinDeadlineAt: string | null;
    };
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

    const acceptanceTimeoutSec = sanitizeTimeout(input.acceptanceTimeoutSec, DEFAULT_ACCEPTANCE_TIMEOUT_SEC);
    const joinTimeoutSec = sanitizeTimeout(input.joinTimeoutSec, DEFAULT_JOIN_TIMEOUT_SEC);

    const refereeName = input.refereeName ?? 'Referee';
    const fighterAName = input.fighterAName ?? 'Fighter A';
    const fighterBName = input.fighterBName ?? 'Fighter B';

    const orchestration: OrchestrationInternalState = {
      protocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      source: input.orchestrationSource ?? 'manual_api',
      triggerText: input.triggerText ?? null,
      roles: {
        referee: {
          role: 'referee',
          displayName: refereeName,
          actorId: input.refereeAgentId,
          invitation: { status: 'not_required' },
          acceptance: { status: 'not_required' },
          join: { status: 'not_required' },
        },
        fighterA: {
          role: 'fighterA',
          slot: 'A',
          displayName: fighterAName,
          actorId: input.fighterAAgentId,
          invitation: { status: 'sent', sentAt: now },
          acceptance: { status: 'pending' },
          join: { status: 'pending' },
        },
        fighterB: {
          role: 'fighterB',
          slot: 'B',
          displayName: fighterBName,
          actorId: input.fighterBAgentId,
          invitation: { status: 'sent', sentAt: now },
          acceptance: { status: 'pending' },
          join: { status: 'pending' },
        },
      },
      timeouts: {
        acceptance: {
          windowSec: acceptanceTimeoutSec,
          deadlineAt: addSeconds(now, acceptanceTimeoutSec),
        },
        join: {
          windowSec: joinTimeoutSec,
          deadlineAt: null,
        },
      },
      cancellation: {
        reason: null,
        byRole: null,
        at: null,
        note: null,
      },
    };

    const match: MatchInternalState = {
      id,
      createdAt: now,
      refereeName,
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
          name: fighterAName,
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
          name: fighterBName,
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
      orchestration,
    };

    this.addEvent(match, 'system', 'Challenge created (BO1). Waiting for fighter token acceptances.');
    this.addEvent(
      match,
      'orchestration',
      'STANDARD orchestration initialized for roles: referee, fighterA, fighterB.',
      {
        source: orchestration.source,
        acceptanceDeadlineAt: orchestration.timeouts.acceptance.deadlineAt,
      }
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
      orchestration: {
        protocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
        source: orchestration.source,
        roles: {
          referee: {
            displayName: orchestration.roles.referee.displayName,
            actorId: orchestration.roles.referee.actorId ?? null,
          },
          fighterA: {
            displayName: orchestration.roles.fighterA.displayName,
            actorId: orchestration.roles.fighterA.actorId ?? null,
          },
          fighterB: {
            displayName: orchestration.roles.fighterB.displayName,
            actorId: orchestration.roles.fighterB.actorId ?? null,
          },
        },
        timeouts: {
          acceptanceTimeoutSec,
          joinTimeoutSec,
          acceptanceDeadlineAt: orchestration.timeouts.acceptance.deadlineAt ?? now,
          joinDeadlineAt: orchestration.timeouts.join.deadlineAt,
        },
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

  getOrchestrationState(matchId: string): MatchOrchestrationSnapshot {
    const match = this.mustMatch(matchId);
    return {
      id: match.id,
      status: match.status,
      createdAt: match.createdAt,
      orchestration: this.toPublicOrchestration(match),
      recentEvents: match.events.slice(-25),
    };
  }

  getReport(matchId: string): MatchReport {
    const match = this.mustMatch(matchId);
    return {
      id: match.id,
      refereeName: match.refereeName,
      createdAt: match.createdAt,
      endedAt: match.endedAt,
      status: match.status,
      bo: 'BO1',
      winner: match.winner,
      summary: match.summary,
      totalTicks: match.tick,
      orchestration: this.toPublicOrchestration(match),
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
    this.enforcePreMatchOpen(match);
    this.evaluatePreMatchTimeouts(match);

    if (match.status === 'cancelled') {
      throw new Error('Challenge has been cancelled.');
    }

    // Protocol assumption: fighter token is an out-of-band shared secret issued by referee.
    const fighter = match.fighters.find((candidate) => candidate.token === token);
    if (!fighter) {
      throw new Error('Invalid fighter token.');
    }
    if (fighter.accepted) {
      throw new Error('Fighter already accepted the challenge.');
    }

    const role = this.roleBySlot(match, fighter.slot);
    if (role.invitation.status === 'declined') {
      throw new Error('Invitation was declined; challenge acceptance is blocked.');
    }

    fighter.accepted = true;
    fighter.acceptedAt = new Date().toISOString();
    fighter.name = fighterName?.trim() || fighter.name;

    role.displayName = fighter.name;
    role.acceptance.status = 'accepted';
    role.acceptance.acceptedAt = fighter.acceptedAt;

    if (role.invitation.status === 'sent') {
      role.invitation.status = 'accepted';
      role.invitation.respondedAt = fighter.acceptedAt;
      role.invitation.note = role.invitation.note ?? 'Auto-acknowledged by token acceptance.';
    }

    this.addEvent(match, 'accept', `${fighter.slot} accepted the challenge.`, {
      slot: fighter.slot,
      role: role.role,
    });

    const previousStatus = match.status;
    this.recomputePreMatchStatus(match);
    this.maybeAddLifecycleEvent(match, previousStatus);

    const state = this.toPublicState(match);
    this.emit(match.id, { kind: 'state', state });
    return state;
  }

  recordInvitationResponse(
    matchId: string,
    role: Exclude<OrchestrationRole, 'referee'>,
    decision: 'accepted' | 'declined',
    note?: string
  ): MatchPublicState {
    const match = this.mustMatch(matchId);
    this.enforcePreMatchOpen(match);

    const roleState = match.orchestration.roles[role];

    if (roleState.invitation.status === 'not_required') {
      throw new Error('Invitation responses are only valid for fighter roles.');
    }

    const now = new Date().toISOString();

    if (decision === 'accepted') {
      roleState.invitation.status = 'accepted';
      roleState.invitation.respondedAt = now;
      roleState.invitation.note = note?.trim() || roleState.invitation.note;
      this.addEvent(match, 'orchestration', `${role} acknowledged invitation.`, {
        role,
        decision,
      });

      const state = this.toPublicState(match);
      this.emit(match.id, { kind: 'state', state });
      return state;
    }

    roleState.invitation.status = 'declined';
    roleState.invitation.respondedAt = now;
    roleState.invitation.note = note?.trim() || roleState.invitation.note;

    this.addEvent(match, 'orchestration', `${role} declined invitation.`, {
      role,
      decision,
      note: roleState.invitation.note,
    });

    this.applyCancellation(match, 'fighter_declined_invitation', note, role);
    return this.toPublicState(match);
  }

  cancelChallenge(
    matchId: string,
    reason: ChallengeCancellationReason = 'referee_cancelled',
    note?: string,
    byRole: OrchestrationRole | 'system' = 'referee'
  ): MatchPublicState {
    const match = this.mustMatch(matchId);
    if (match.status === 'running') {
      throw new Error('Cannot cancel a running match.');
    }
    if (match.status === 'finished') {
      throw new Error('Cannot cancel a finished match.');
    }
    if (match.status === 'cancelled') {
      throw new Error('Challenge already cancelled.');
    }

    this.applyCancellation(match, reason, note, byRole);
    return this.toPublicState(match);
  }

  joinMatch(matchId: string, token: string, sourceIp: string, fighterName?: string): MatchPublicState {
    const match = this.mustMatch(matchId);
    this.evaluatePreMatchTimeouts(match);

    if (match.status === 'running') {
      throw new Error('Match is already running.');
    }
    if (match.status === 'finished') {
      throw new Error('Match has already finished.');
    }
    if (match.status === 'cancelled') {
      throw new Error('Challenge has been cancelled.');
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

    const role = this.roleBySlot(match, fighter.slot);
    role.displayName = fighter.name;
    role.join.status = 'joined';
    role.join.joinedAt = fighter.joinedAt;
    role.join.sourceIp = sourceIp;

    this.addEvent(match, 'join', `${fighter.slot} joined runtime from ${sourceIp}.`, {
      slot: fighter.slot,
      role: role.role,
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
      if (match.status === 'running') {
        this.resolveTick(match);
        continue;
      }
      this.evaluatePreMatchTimeouts(match);
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

  private roleBySlot(match: MatchInternalState, slot: FighterSlot): RoleInternalState {
    return slot === 'A' ? match.orchestration.roles.fighterA : match.orchestration.roles.fighterB;
  }

  private enforcePreMatchOpen(match: MatchInternalState): void {
    if (match.status === 'running' || match.status === 'finished') {
      throw new Error('Challenge is no longer accepting pre-match orchestration events.');
    }
    if (match.status === 'cancelled') {
      throw new Error('Challenge has been cancelled.');
    }
  }

  private evaluatePreMatchTimeouts(match: MatchInternalState): void {
    if (match.status === 'running' || match.status === 'finished' || match.status === 'cancelled') {
      return;
    }

    const now = Date.now();

    const acceptedCount = match.fighters.filter((fighter) => fighter.accepted).length;
    const allAccepted = acceptedCount === match.fighters.length;

    const acceptanceDeadline = match.orchestration.timeouts.acceptance.deadlineAt;
    if (!allAccepted && acceptanceDeadline && now > Date.parse(acceptanceDeadline)) {
      match.orchestration.timeouts.acceptance.expiredAt = new Date().toISOString();
      this.applyCancellation(
        match,
        'acceptance_timeout',
        'Not all fighters accepted before the acceptance timeout.',
        'system'
      );
      return;
    }

    if (allAccepted && !match.orchestration.timeouts.join.deadlineAt) {
      const joinDeadline = addSeconds(new Date().toISOString(), match.orchestration.timeouts.join.windowSec);
      match.orchestration.timeouts.join.deadlineAt = joinDeadline;
      this.addEvent(match, 'system', 'Join timeout window started after both acceptances.', {
        joinDeadlineAt: joinDeadline,
      });
      this.emit(match.id, { kind: 'state', state: this.toPublicState(match) });
    }

    if (match.status !== 'ready_to_join') {
      return;
    }

    const allJoined = match.fighters.every((fighter) => fighter.joined);
    const joinDeadline = match.orchestration.timeouts.join.deadlineAt;

    if (!allJoined && joinDeadline && now > Date.parse(joinDeadline)) {
      match.orchestration.timeouts.join.expiredAt = new Date().toISOString();
      this.applyCancellation(match, 'join_timeout', 'Both fighters did not join before join timeout.', 'system');
    }
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

  private applyCancellation(
    match: MatchInternalState,
    reason: ChallengeCancellationReason,
    note: string | undefined,
    byRole: OrchestrationRole | 'system'
  ): void {
    if (match.status === 'cancelled') {
      return;
    }

    match.status = 'cancelled';
    match.winner = null;
    match.endedAt = new Date().toISOString();

    match.orchestration.cancellation.reason = reason;
    match.orchestration.cancellation.byRole = byRole;
    match.orchestration.cancellation.at = match.endedAt;
    match.orchestration.cancellation.note = note?.trim() || null;

    const reasonText = describeCancellationReason(reason);
    const summaryNote = match.orchestration.cancellation.note;
    match.summary = summaryNote ? `Challenge cancelled: ${reasonText}. ${summaryNote}` : `Challenge cancelled: ${reasonText}.`;

    this.addEvent(match, 'cancel', match.summary, {
      reason,
      byRole,
      note: match.orchestration.cancellation.note,
    });

    this.emit(match.id, {
      kind: 'end',
      state: this.toPublicState(match),
      event: match.events.at(-1),
    });
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
    if (match.status === 'running' || match.status === 'finished' || match.status === 'cancelled') {
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

    if (!match.orchestration.timeouts.join.deadlineAt) {
      const joinDeadline = addSeconds(new Date().toISOString(), match.orchestration.timeouts.join.windowSec);
      match.orchestration.timeouts.join.deadlineAt = joinDeadline;
    }
  }

  private maybeAddLifecycleEvent(match: MatchInternalState, previousStatus: MatchStatus): void {
    if (match.status === previousStatus) {
      return;
    }

    if (match.status === 'awaiting_acceptance') {
      this.addEvent(match, 'system', 'First acceptance received. Waiting for second fighter acceptance.');
    } else if (match.status === 'ready_to_join') {
      this.addEvent(match, 'system', 'Both fighters accepted. Waiting for runtime joins.', {
        joinDeadlineAt: match.orchestration.timeouts.join.deadlineAt,
      });
    }
  }

  private toPublicOrchestration(match: MatchInternalState): MatchOrchestrationPublicState {
    const now = Date.now();

    const acceptanceDeadline = match.orchestration.timeouts.acceptance.deadlineAt;
    const acceptanceDeadlineMs = Date.parse(acceptanceDeadline ?? new Date().toISOString());
    const acceptanceRemainingSec = Math.max(0, Math.ceil((acceptanceDeadlineMs - now) / 1000));

    const joinDeadline = match.orchestration.timeouts.join.deadlineAt;
    const joinDeadlineMs = joinDeadline ? Date.parse(joinDeadline) : null;
    const joinRemainingSec =
      joinDeadlineMs === null ? null : Math.max(0, Math.ceil((joinDeadlineMs - now) / 1000));

    const fighterInvites = [match.orchestration.roles.fighterA, match.orchestration.roles.fighterB].map(
      (role) => role.invitation.status
    );

    const acceptedInvites = fighterInvites.filter((status) => status === 'accepted').length;
    const declinedInvites = fighterInvites.filter((status) => status === 'declined').length;

    return {
      protocolVersion: match.orchestration.protocolVersion,
      source: match.orchestration.source,
      triggerText: match.orchestration.triggerText,
      roles: {
        referee: toPublicRole(match.orchestration.roles.referee),
        fighterA: toPublicRole(match.orchestration.roles.fighterA),
        fighterB: toPublicRole(match.orchestration.roles.fighterB),
      },
      invitationSummary: {
        accepted: acceptedInvites,
        pending: 2 - acceptedInvites - declinedInvites,
        declined: declinedInvites,
        total: 2,
      },
      timeouts: {
        acceptance: {
          windowSec: match.orchestration.timeouts.acceptance.windowSec,
          deadlineAt: acceptanceDeadline ?? new Date().toISOString(),
          remainingSec: acceptanceRemainingSec,
          isExpired: Boolean(match.orchestration.timeouts.acceptance.expiredAt),
          expiredAt: match.orchestration.timeouts.acceptance.expiredAt ?? null,
        },
        join: {
          windowSec: match.orchestration.timeouts.join.windowSec,
          deadlineAt: joinDeadline,
          remainingSec: joinRemainingSec,
          isActive: joinDeadline !== null,
          isExpired: Boolean(match.orchestration.timeouts.join.expiredAt),
          expiredAt: match.orchestration.timeouts.join.expiredAt ?? null,
        },
      },
      cancellation: {
        isCancelled: match.status === 'cancelled',
        reason: match.orchestration.cancellation.reason,
        byRole: match.orchestration.cancellation.byRole,
        at: match.orchestration.cancellation.at,
        note: match.orchestration.cancellation.note,
      },
      groupChatBridge: {
        triggerEndpoint: '/api/orchestration/group-chat-trigger',
        invitationResponseEndpointTemplate:
          '/api/orchestration/challenges/{challengeId}/invitations/respond',
        refereeCancelEndpointTemplate: '/api/orchestration/challenges/{challengeId}/cancel',
      },
    };
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
      orchestration: this.toPublicOrchestration(match),
      winner: match.winner,
      summary: match.summary,
      recentEvents: match.events.slice(-25),
    };
  }
}

function toPublicRole(role: RoleInternalState): RolePublicState {
  return {
    role: role.role,
    slot: role.slot ?? null,
    displayName: role.displayName,
    actorId: role.actorId ?? null,
    invitationStatus: role.invitation.status,
    invitationSentAt: role.invitation.sentAt ?? null,
    invitationRespondedAt: role.invitation.respondedAt ?? null,
    invitationNote: role.invitation.note ?? null,
    acceptanceStatus: role.acceptance.status,
    acceptedAt: role.acceptance.acceptedAt ?? null,
    joinStatus: role.join.status,
    joinedAt: role.join.joinedAt ?? null,
    sourceIp: role.join.sourceIp ?? null,
  };
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

function sanitizeTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.min(7200, Math.floor(value));
}

function addSeconds(iso: string, sec: number): string {
  return new Date(Date.parse(iso) + sec * 1000).toISOString();
}

function describeCancellationReason(reason: ChallengeCancellationReason): string {
  if (reason === 'referee_cancelled') {
    return 'referee cancelled the challenge';
  }
  if (reason === 'fighter_declined_invitation') {
    return 'a fighter declined invitation';
  }
  if (reason === 'acceptance_timeout') {
    return 'acceptance timeout reached';
  }
  if (reason === 'join_timeout') {
    return 'join timeout reached';
  }
  return 'protocol violation';
}

export function isValidAction(action: string): action is FighterAction {
  return VALID_ACTIONS.includes(action as FighterAction);
}
