import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { streamReply, generateTitle, checkAuth, MODELS, EFFORTS, DEFAULTS } from './agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT) || 4317;

const store = new Store(path.join(ROOT, 'data', 'conversations'));
const loaded = await store.init();

const app = express();
app.use(express.json({ limit: '10mb' }));

/* ------------------------------ helpers ------------------------------ */

/** Newline-delimited JSON stream. Works with plain fetch + AbortController. */
function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return {
    send(obj) {
      if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}

function settingsFrom(body) {
  const model = MODELS.some((m) => m.id === body?.model) ? body.model : DEFAULTS.model;
  const effort = EFFORTS.includes(body?.effort) ? body.effort : DEFAULTS.effort;
  const webSearch = typeof body?.webSearch === 'boolean' ? body.webSearch : DEFAULTS.webSearch;
  return { model, effort, webSearch };
}

/**
 * Shared generation path for send / regenerate / edit. `history` is everything
 * before the prompt; `message` is the user text being answered.
 */
async function runTurn({ req, res, convo, history, message, detail, settings }) {
  const stream = openStream(res);
  const ac = new AbortController();
  // Detect a real client disconnect. `req`'s 'close' is no good here: since
  // Node 16 it fires as soon as the request body has been consumed, which for
  // a POST is immediately, and it would abort every turn before it started.
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  const placeholder = store.addMessage(convo.id, {
    role: 'assistant',
    content: '',
    model: settings.model,
    pending: true,
  });
  stream.send({ type: 'start', messageId: placeholder.id });

  const result = await streamReply({
    history,
    message,
    detail,
    ...settings,
    signal: ac.signal,
    onEvent: (ev) => stream.send(ev),
  });

  store.updateMessage(convo.id, placeholder.id, {
    content: result.text,
    pending: false,
    usedSearch: result.usedSearch || undefined,
    aborted: result.aborted || undefined,
    error: result.error ?? undefined,
    meta: result.meta,
    detail: detail || undefined,
  });

  // First exchange in a fresh chat earns a real title.
  if (!convo.autoTitled && result.text && !result.error) {
    const firstUser = convo.messages.find((m) => m.role === 'user');
    if (firstUser) {
      generateTitle(firstUser.content, result.text).then((title) => {
        if (title) store.patch(convo.id, { title, autoTitled: true });
      });
    }
  }

  stream.send({ type: 'saved', messageId: placeholder.id });
  stream.end();
}

/* ------------------------------- routes ------------------------------- */

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    models: MODELS,
    efforts: EFFORTS,
    defaults: DEFAULTS,
    auth: await checkAuth(),
  });
});

app.get('/api/conversations', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(q ? store.search(q) : store.list());
});

app.post('/api/conversations', (_req, res) => {
  res.json(store.create());
});

app.get('/api/conversations/:id', (req, res) => {
  const c = store.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

app.patch('/api/conversations/:id', (req, res) => {
  const c = store.patch(req.params.id, req.body ?? {});
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/conversations/:id', async (req, res) => {
  const ok = await store.remove(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

/** Send a new user message. */
app.post('/api/conversations/:id/messages', async (req, res) => {
  const convo = store.get(req.params.id);
  if (!convo) return res.status(404).json({ error: 'not found' });

  const text = String(req.body?.content ?? '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });

  const history = convo.messages.slice();
  store.addMessage(convo.id, { role: 'user', content: text, detail: !!req.body?.detail || undefined });

  await runTurn({
    req, res, convo, history, message: text,
    detail: !!req.body?.detail,
    settings: settingsFrom(req.body),
  });
});

/** Re-answer the last user message, discarding the assistant reply. */
app.post('/api/conversations/:id/regenerate', async (req, res) => {
  const convo = store.get(req.params.id);
  if (!convo) return res.status(404).json({ error: 'not found' });

  const lastUserIdx = convo.messages.findLastIndex((m) => m.role === 'user');
  if (lastUserIdx === -1) return res.status(400).json({ error: 'nothing to regenerate' });

  const lastUser = convo.messages[lastUserIdx];
  const after = convo.messages[lastUserIdx + 1];
  if (after) store.truncateFrom(convo.id, after.id);

  await runTurn({
    req, res, convo,
    history: convo.messages.slice(0, lastUserIdx),
    message: lastUser.content,
    detail: !!(req.body?.detail ?? lastUser.detail),
    settings: settingsFrom(req.body),
  });
});

/** Edit a user message in place and re-answer from there. */
app.post('/api/conversations/:id/edit', async (req, res) => {
  const convo = store.get(req.params.id);
  if (!convo) return res.status(404).json({ error: 'not found' });

  const { messageId } = req.body ?? {};
  const text = String(req.body?.content ?? '').trim();
  const idx = convo.messages.findIndex((m) => m.id === messageId);
  if (idx === -1 || convo.messages[idx].role !== 'user') return res.status(400).json({ error: 'bad message' });
  if (!text) return res.status(400).json({ error: 'empty message' });

  const history = convo.messages.slice(0, idx);
  store.truncateFrom(convo.id, messageId);
  store.addMessage(convo.id, { role: 'user', content: text, detail: !!req.body?.detail || undefined });

  await runTurn({
    req, res, convo, history, message: text,
    detail: !!req.body?.detail,
    settings: settingsFrom(req.body),
  });
});

/* ----------------------------- static app ----------------------------- */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get(/^(?!\/api\/).*/, (_req, res) =>
    res.status(503).type('html').send('<pre>UI not built yet. Run: npm run build</pre>'));
}

const server = app.listen(PORT, async () => {
  console.log(`\n  brb  ->  http://localhost:${PORT}`);
  console.log(`  ${loaded} conversation${loaded === 1 ? '' : 's'} loaded`);
  const auth = await checkAuth();
  console.log(auth.ok
    ? `  signed in (${auth.method})\n`
    : `\n  ⚠  not signed in yet. run this once, in another terminal:\n       npm run login\n`);
});

async function shutdown() {
  server.close();
  await store.flushAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
