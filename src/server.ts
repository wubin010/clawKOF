import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { runDemoMode } from './demoMode.ts';
import { isValidAction, MatchEngine } from './matchEngine.ts';

const engine = new MatchEngine();

const PORT = Number(process.env.PORT ?? 3000);
const ENABLE_DEMO = process.env.DEMO_MODE === '1';
const publicDir = path.resolve(process.cwd(), 'public');

setInterval(() => {
  engine.housekeep();
}, 5000);

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

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
      console.log(`Demo match created: ${demo.matchId}`);
      console.log(`Spectator page: http://localhost:${PORT}/match/${demo.matchId}`);
    } catch (error) {
      console.error('Failed to start demo mode', error);
    }
  } else {
    console.log('Waiting for fighters. Run: npm run fighter -- --server http://localhost:' + PORT + ' --name "YourName"');
  }
});

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // GET /health
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

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
          <p>No active matches yet.</p>
          <p>Run <code>npm run fighter -- --server http://localhost:${PORT} --name "YourName"</code> to start.</p>
          <p>Demo mode: <code>DEMO_MODE=1 npm start</code></p>
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

  // GET /api/matches — list all matches
  if (method === 'GET' && pathname === '/api/matches') {
    sendJson(res, 200, engine.listMatches());
    return;
  }

  // POST /api/matches — create a new match
  if (method === 'POST' && pathname === '/api/matches') {
    const body = await readJsonBody(req);
    const name = asRequiredString(body.name, 'name');
    const durationSec = toOptionalNumber(body.duration);
    const result = engine.createMatch({ name, durationSec });
    sendJson(res, 201, { ...result, spectatorUrl: `/match/${result.matchId}` });
    return;
  }

  // POST /api/matches/join — auto find-or-create
  if (method === 'POST' && pathname === '/api/matches/join') {
    const body = await readJsonBody(req);
    const name = asRequiredString(body.name, 'name');
    const durationSec = toOptionalNumber(body.duration);

    const waitingId = engine.findWaitingMatch();
    if (waitingId) {
      const result = engine.joinMatch(waitingId, name);
      sendJson(res, 200, { ...result, spectatorUrl: `/match/${result.matchId}` });
    } else {
      const result = engine.createMatch({ name, durationSec });
      sendJson(res, 201, { ...result, spectatorUrl: `/match/${result.matchId}` });
    }
    return;
  }

  // POST /api/matches/:id/join — join a specific match
  const joinRoute = pathname.match(/^\/api\/matches\/([^/]+)\/join$/);
  if (method === 'POST' && joinRoute) {
    const matchId = joinRoute[1];
    const body = await readJsonBody(req);
    const name = asRequiredString(body.name, 'name');
    const result = engine.joinMatch(matchId, name);
    sendJson(res, 200, { ...result, spectatorUrl: `/match/${result.matchId}` });
    return;
  }

  // POST /api/matches/:id/action — submit action by name
  const actionRoute = pathname.match(/^\/api\/matches\/([^/]+)\/action$/);
  if (method === 'POST' && actionRoute) {
    const matchId = actionRoute[1];
    const body = await readJsonBody(req);
    const name = asRequiredString(body.name, 'name');
    const action = String(body.action ?? '');

    if (!action) {
      sendJson(res, 400, { error: 'action is required.' });
      return;
    }
    if (!isValidAction(action)) {
      sendJson(res, 400, { error: `invalid action: ${action}` });
      return;
    }

    const state = await engine.submitAction(matchId, name, action);
    sendJson(res, 200, state);
    return;
  }

  // GET /api/matches/:id/state
  const stateRoute = pathname.match(/^\/api\/matches\/([^/]+)\/state$/);
  if (method === 'GET' && stateRoute) {
    const state = engine.getState(stateRoute[1]);
    sendJson(res, 200, state);
    return;
  }

  // GET /api/matches/:id/wait-for-start — long-poll until match leaves 'waiting'
  const waitRoute = pathname.match(/^\/api\/matches\/([^/]+)\/wait-for-start$/);
  if (method === 'GET' && waitRoute) {
    const state = await engine.waitForStart(waitRoute[1]);
    sendJson(res, 200, state);
    return;
  }

  // GET /api/matches/:id/events — SSE
  const eventsRoute = pathname.match(/^\/api\/matches\/([^/]+)\/events$/);
  if (method === 'GET' && eventsRoute) {
    const matchId = eventsRoute[1];
    engine.getState(matchId);
    serveEvents(matchId, req, res);
    return;
  }

  // GET /api/matches/:id/report
  const reportRoute = pathname.match(/^\/api\/matches\/([^/]+)\/report$/);
  if (method === 'GET' && reportRoute) {
    const report = engine.getReport(reportRoute[1]);
    sendJson(res, 200, report);
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

  // Push current state immediately so reconnecting clients aren't blank
  try {
    const currentState = engine.getState(matchId);
    sendSseEvent(res, 'state', { kind: 'state', state: currentState });
  } catch {
    // match may have been GC'd between check and here
  }

  const unsubscribe = engine.subscribe(matchId, (update) => {
    sendSseEvent(res, update.kind, update);
  });

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 5000);

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
  const target = path.resolve(publicDir, relPath);

  // Path traversal protection
  if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

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

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
