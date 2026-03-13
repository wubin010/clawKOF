import type { CreateChallengeInput, CreateChallengeResult, MatchEngine } from './matchEngine.ts';

export interface GroupChatParticipant {
  displayName: string;
  agentId?: string;
}

export interface GroupChatTriggerInput {
  triggerText?: string;
  participants: GroupChatParticipant[];
  durationSec?: number;
  acceptanceTimeoutSec?: number;
  joinTimeoutSec?: number;
}

export interface GroupChatRoleAssignment {
  referee: GroupChatParticipant;
  fighterA: GroupChatParticipant;
  fighterB: GroupChatParticipant;
}

export interface GroupChatTriggerResult {
  assignment: GroupChatRoleAssignment;
  challenge: CreateChallengeResult;
  protocol: {
    mode: 'STANDARD';
    note: string;
    implementedNow: string[];
    requiresExternalIntegration: string[];
  };
  nextStepHints: string[];
}

export function resolveGroupChatRoleAssignment(
  participants: GroupChatParticipant[]
): GroupChatRoleAssignment {
  if (!Array.isArray(participants) || participants.length !== 3) {
    throw new Error('participants must contain exactly three OpenClaw entries in mention order.');
  }

  const normalized = participants.map((entry, index) => {
    const displayName = typeof entry?.displayName === 'string' ? entry.displayName.trim() : '';
    if (!displayName) {
      throw new Error(`participants[${index}].displayName is required.`);
    }

    const actor: GroupChatParticipant = { displayName };
    if (typeof entry.agentId === 'string' && entry.agentId.trim()) {
      actor.agentId = entry.agentId.trim();
    }

    return actor;
  });

  return {
    referee: normalized[0],
    fighterA: normalized[1],
    fighterB: normalized[2],
  };
}

export function createChallengeFromGroupChatTrigger(
  engine: MatchEngine,
  input: GroupChatTriggerInput
): GroupChatTriggerResult {
  const assignment = resolveGroupChatRoleAssignment(input.participants);

  const challengeInput: CreateChallengeInput = {
    refereeName: assignment.referee.displayName,
    fighterAName: assignment.fighterA.displayName,
    fighterBName: assignment.fighterB.displayName,
    refereeAgentId: assignment.referee.agentId,
    fighterAAgentId: assignment.fighterA.agentId,
    fighterBAgentId: assignment.fighterB.agentId,
    durationSec: input.durationSec,
    acceptanceTimeoutSec: input.acceptanceTimeoutSec,
    joinTimeoutSec: input.joinTimeoutSec,
    orchestrationSource: 'group_chat_trigger',
    triggerText: input.triggerText?.trim() || null,
  };

  const challenge = engine.createChallenge(challengeInput);

  return {
    assignment,
    challenge,
    protocol: {
      mode: 'STANDARD',
      note: 'This endpoint maps a future group-chat trigger into HTTP orchestration state, without real chat transport.',
      implementedNow: [
        'three-role assignment in mention order',
        'challenge creation + fighter token issuance',
        'invitation response/cancellation state recording',
        'accept/join timeouts and cancellation reasons in challenge state',
      ],
      requiresExternalIntegration: [
        'real OpenClaw group-chat trigger listener',
        'cross-machine token delivery and endpoint calls',
      ],
    },
    nextStepHints: [
      `Send token A privately to ${assignment.fighterA.displayName}.`,
      `Send token B privately to ${assignment.fighterB.displayName}.`,
      'Use POST /api/orchestration/challenges/:id/invitations/respond to mirror chat invitation acknowledgements.',
      'Fighters must still call accept + join endpoints from their own machines.',
    ],
  };
}
