import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { createChallengeFromGroupChatTrigger } from './orchestration.ts';
import { runDemoMode } from './demoMode.ts';
import {
  type ChallengeCancellationReason,
  type ChallengeOrchestrationSource,
  isValidAction,
  MatchEngine,
  type OrchestrationRole,
} from './matchEngine.ts';

const engine = new MatchEngine();

const PORT = Number(process.env.PORT ?? 3000);
const ENABLE_DEMO = process.env.DEMO_MODE === '1';
const TICK_INTERVAL_MS = 1000;

const publicDir = path.join(process.cwd(), 'public');

setInterval(() => {
  engine.tickAll();
}, TICK_INTERVAL_MS);

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, async () => {
  console.log(`Lobster KOF Arena listening on http://localhost:${PORT}`);

  if (ENABLE_DEMO) {
    try {
      const demo = await runDemoMode(`http://localhost:${PORT}`);
      console.log(`Demo challenge/match created: ${demo.matchId}`);
      console.log(`Spectator page: http://localhost:${PORT}/match/${demo.matchId}`);
    } catch (error) {
      console.error('Failed to start demo mode', error);
    }
  } else {
    console.log('STANDARD mode active. Create challenge via /api/orchestration/group-chat-trigger or /api/challenges.');
  }
});

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/') {
    const latest = engine.getLatestMatchId();
    if (latest) {
      res.statusCode = 302;
      res.setHeader('Location', `/match/${latest}`);
      res.end();
      return;
    }

    sendHtml(
      res,
      `
      <!doctype html>
      <html>
        <head><meta charset="utf-8" /><title>Lobster KOF Arena</title></head>
        <body style="font-family: sans-serif; padding: 24px;">
          <h1>Lobster King of Fighters</h1>
          <p>No active challenges yet.</p>
          <p>Create one with POST <code>/api/orchestration/group-chat-trigger</code> (STANDARD simulation) or POST <code>/api/challenges</code> (manual).</p>
          <p>Optional local shortcut demo can be enabled with <code>DEMO_MODE=1</code>.</p>
        </body>
      </html>
      `
    );
    return;
  }

  if (method === 'GET' && pathname.startsWith('/static/')) {
    await serveStatic(pathname, res);
    return;
  }

  const matchView = pathname.match(/^\/match\/([^/]+)$/);
  if (method === 'GET' && matchView) {
    await serveFile(path.join(publicDir, 'spectator.html'), 'text/html; charset=utf-8', res);
    return;
  }

  const stateRoute = pathname.match(/^\/api\/matches\/([^/]+)\/state$/);
  if (method === 'GET' && stateRoute) {
    const state = engine.getState(stateRoute[1]);
    sendJson(res, 200, state);
    return;
  }

  const orchestrationRoute = pathname.match(/^\/api\/challenges\/([^/]+)\/orchestration$/);
  if (method === 'GET' && orchestrationRoute) {
    const snapshot = engine.getOrchestrationState(orchestrationRoute[1]);
    sendJson(res, 200, snapshot);
    return;
  }

  const orchestrationRouteAlt = pathname.match(/^\/api\/orchestration\/challenges\/([^/]+)$/);
  if (method === 'GET' && orchestrationRouteAlt) {
    const snapshot = engine.getOrchestrationState(orchestrationRouteAlt[1]);
    sendJson(res, 200, snapshot);
    return;
  }

  const reportRoute = pathname.match(/^\/api\/matches\/([^/]+)\/report$/);
  if (method === 'GET' && reportRoute) {
    const report = engine.getReport(reportRoute[1]);
    sendJson(res, 200, report);
    return;
  }

  const eventsRoute = pathname.match(/^\/api\/matches\/([^/]+)\/events$/);
  if (method === 'GET' && eventsRoute) {
    const matchId = eventsRoute[1];
    engine.getState(matchId);
    serveEvents(matchId, req, res);
    return;
  }

  if (method === 'POST' && pathname === '/api/orchestration/group-chat-trigger') {
    if (process.env.NODE_ENV === 'production') {
      sendJson(res, 403, { error: 'Group-chat trigger simulation endpoint is disabled outside dev mode.' });
      return;
    }

    const body = await readJsonBody(req);
    const participants = Array.isArray(body.participants)
      ? body.participants.map((entry) => ({
          displayName: asOptionalString((entry as Record<string, unknown>).displayName) ?? '',
          agentId: asOptionalString((entry as Record<string, unknown>).agentId),
        }))
      : [];

    const result = createChallengeFromGroupChatTrigger(engine, {
      triggerText: asOptionalString(body.triggerText),
      participants,
      durationSec: toOptionalNumber(body.durationSec),
      acceptanceTimeoutSec: toOptionalNumber(body.acceptanceTimeoutSec),
      joinTimeoutSec: toOptionalNumber(body.joinTimeoutSec),
    });

    sendJson(res, 201, {
      ...result,
      spectatorUrl: `/match/${result.challenge.matchId}`,
      protocolNote: 'No real OpenClaw group-chat wiring yet; this endpoint is the mapping boundary.',
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/challenges') {
    if (process.env.NODE_ENV === 'production') {
      sendJson(res, 403, { error: 'Challenge creation endpoint is disabled outside dev mode.' });
      return;
    }

    const body = await readJsonBody(req);
    const created = engine.createChallenge({
      refereeName: asOptionalString(body.refereeName),
      fighterAName: asOptionalString(body.fighterAName),
      fighterBName: asOptionalString(body.fighterBName),
      refereeAgentId: asOptionalString(body.refereeAgentId),
      fighterAAgentId: asOptionalString(body.fighterAAgentId),
      fighterBAgentId: asOptionalString(body.fighterBAgentId),
      durationSec: toOptionalNumber(body.durationSec),
      acceptanceTimeoutSec: toOptionalNumber(body.acceptanceTimeoutSec),
      joinTimeoutSec: toOptionalNumber(body.joinTimeoutSec),
      orchestrationSource: asOrchestrationSource(body.orchestrationSource) ?? 'manual_api',
      triggerText: asOptionalString(body.triggerText),
    });

    sendJson(res, 201, {
      ...created,
      note: 'STANDARD protocol keeps challengeId == matchId in this in-memory scaffold.',
      spectatorUrl: `/match/${created.matchId}`,
    });
    return;
  }

  // Backward-compatible alias for older scripts and docs in this repo.
  if (method === 'POST' && pathname === '/api/matches') {
    if (process.env.NODE_ENV === 'production') {
      sendJson(res, 403, { error: 'Challenge creation endpoint is disabled outside dev mode.' });
      return;
    }

    const body = await readJsonBody(req);
    const created = engine.createChallenge({
      refereeName: asOptionalString(body.refereeName),
      fighterAName: asOptionalString(body.fighterAName),
      fighterBName: asOptionalString(body.fighterBName),
      refereeAgentId: asOptionalString(body.refereeAgentId),
      fighterAAgentId: asOptionalString(body.fighterAAgentId),
      fighterBAgentId: asOptionalString(body.fighterBAgentId),
      durationSec: toOptionalNumber(body.durationSec),
      acceptanceTimeoutSec: toOptionalNumber(body.acceptanceTimeoutSec),
      joinTimeoutSec: toOptionalNumber(body.joinTimeoutSec),
      orchestrationSource: asOrchestrationSource(body.orchestrationSource) ?? 'manual_api',
      triggerText: asOptionalString(body.triggerText),
    });

    sendJson(res, 201, {
      ...created,
      note: 'Use POST /api/challenges or /api/orchestration/group-chat-trigger in new clients.',
      spectatorUrl: `/match/${created.matchId}`,
    });
    return;
  }

  const invitationResponseRoute = pathname.match(
    /^\/api\/orchestration\/challenges\/([^/]+)\/invitations\/respond$/
  );
  if (method === 'POST' && invitationResponseRoute) {
    const challengeId = invitationResponseRoute[1];
    const body = await readJsonBody(req);
    const role = asInvitationRole(body.role);
    const decision = asInvitationDecision(body.decision);

    if (!role) {
      sendJson(res, 400, { error: 'role must be fighterA or fighterB.' });
      return;
    }
    if (!decision) {
      sendJson(res, 400, { error: 'decision must be accepted or declined.' });
      return;
    }

    const state = engine.recordInvitationResponse(
      challengeId,
      role,
      decision,
      asOptionalString(body.note)
    );

    sendJson(res, 200, state);
    return;
  }

  const cancelRoute = pathname.match(/^\/api\/orchestration\/challenges\/([^/]+)\/cancel$/);
  if (method === 'POST' && cancelRoute) {
    const challengeId = cancelRoute[1];
    const body = await readJsonBody(req);

    const reason = asCancellationReason(body.reason) ?? 'referee_cancelled';
    const byRole = asCancelByRole(body.byRole) ?? 'referee';

    const state = engine.cancelChallenge(challengeId, reason, asOptionalString(body.note), byRole);
    sendJson(res, 200, state);
    return;
  }

  const acceptRoute = pathname.match(/^\/api\/challenges\/([^/]+)\/accept$/);
  if (method === 'POST' && acceptRoute) {
    const challengeId = acceptRoute[1];
    const body = await readJsonBody(req);
    const token = String(body.token ?? '');
    if (!token) {
      sendJson(res, 400, { error: 'token is required.' });
      return;
    }

    const state = engine.acceptChallenge(challengeId, token, asOptionalString(body.fighterName));
    sendJson(res, 200, state);
    return;
  }

  const joinRoute = pathname.match(/^\/api\/matches\/([^/]+)\/join$/);
  if (method === 'POST' && joinRoute) {
    const matchId = joinRoute[1];
    const body = await readJsonBody(req);
    const token = String(body.token ?? '');
    if (!token) {
      sendJson(res, 400, { error: 'token is required.' });
      return;
    }

    const sourceIp = extractSourceIp(req);
    const state = engine.joinMatch(matchId, token, sourceIp, asOptionalString(body.fighterName));
    sendJson(res, 200, state);
    return;
  }

  const actionRoute = pathname.match(/^\/api\/matches\/([^/]+)\/action$/);
  if (method === 'POST' && actionRoute) {
    const matchId = actionRoute[1];
    const body = await readJsonBody(req);
    const token = String(body.token ?? '');
    const action = String(body.action ?? '');

    if (!token || !action) {
      sendJson(res, 400, { error: 'token and action are required.' });
      return;
    }
    if (!isValidAction(action)) {
      sendJson(res, 400, { error: `invalid action: ${action}` });
      return;
    }

    const state = engine.submitAction(matchId, token, action);
    sendJson(res, 200, state);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveEvents(matchId: string, req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sendSseEvent(res, 'hello', { ok: true, matchId });

  const unsubscribe = engine.subscribe(matchId, (update) => {
    sendSseEvent(res, update.kind, update);
  });

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function sendSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relPath = pathname.replace('/static/', '');
  const cleanPath = relPath.replace(/\.\./g, '');
  const target = path.join(publicDir, cleanPath);

  const ext = path.extname(target);
  const contentType =
    ext === '.js'
      ? 'application/javascript; charset=utf-8'
      : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.html'
          ? 'text/html; charset=utf-8'
          : 'application/octet-stream';

  await serveFile(target, contentType, res);
}

async function serveFile(filePath: string, contentType: string, res: ServerResponse): Promise<void> {
  try {
    const data = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'File not found' });
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function sendError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = message === 'Match not found.' ? 404 : 400;
  sendJson(res, status, { error: message });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    if (chunks.reduce((total, item) => total + item.length, 0) > 1_000_000) {
      throw new Error('Request body too large.');
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function extractSourceIp(req: IncomingMessage): string {
  // Protocol assumption: behind a trusted internal proxy; first X-Forwarded-For
  // entry is treated as fighter source IP (also used by local mock mode).
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function asInvitationRole(value: unknown): Exclude<OrchestrationRole, 'referee'> | null {
  if (value === 'fighterA' || value === 'fighterB') {
    return value;
  }
  return null;
}

function asInvitationDecision(value: unknown): 'accepted' | 'declined' | null {
  if (value === 'accepted' || value === 'declined') {
    return value;
  }
  return null;
}

function asCancellationReason(value: unknown): ChallengeCancellationReason | null {
  if (
    value === 'referee_cancelled' ||
    value === 'fighter_declined_invitation' ||
    value === 'acceptance_timeout' ||
    value === 'join_timeout' ||
    value === 'protocol_violation'
  ) {
    return value;
  }
  return null;
}

function asCancelByRole(value: unknown): OrchestrationRole | 'system' | null {
  if (value === 'referee' || value === 'fighterA' || value === 'fighterB' || value === 'system') {
    return value;
  }
  return null;
}

function asOrchestrationSource(value: unknown): ChallengeOrchestrationSource | null {
  if (value === 'manual_api' || value === 'group_chat_trigger' || value === 'demo_mode') {
    return value;
  }
  return null;
}
