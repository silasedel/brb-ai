/**
 * Static build: no server at all.
 *
 * Conversations live in localStorage and the browser calls Anthropic directly,
 * using a key the visitor supplies. The key is kept in their own browser and is
 * only ever sent to api.anthropic.com -- there is nowhere else for it to go,
 * because this build has no backend.
 */
import { PERSONA, DETAIL_MODE } from '../../../server/persona.mjs';
import type { Conversation, ConvoMeta, Health, Message, StreamEvent } from '../types';
import type { Backend } from './types';
import { DEMO_CONVERSATIONS } from './demo';

const KEY_STORE = 'brb.key';
const CONVO_STORE = 'brb.convos.v1';
const API = 'https://api.anthropic.com/v1/messages';

const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'smartest' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'faster' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'fastest' },
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/* ------------------------------- storage ------------------------------- */

function readAll(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVO_STORE);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt or blocked storage falls through to the demo set */ }
  // First visit: show real conversations so the page is worth landing on
  // even before anyone has a key.
  const seeded = DEMO_CONVERSATIONS();
  writeAll(seeded);
  return seeded;
}

function writeAll(convos: Conversation[]) {
  try {
    localStorage.setItem(CONVO_STORE, JSON.stringify(convos));
  } catch {
    // Private browsing or a full quota. The session still works in memory.
  }
}

let cache: Conversation[] | null = null;
const all = () => (cache ??= readAll());
const save = () => writeAll(all());
const uuid = () => crypto.randomUUID();

function meta(c: Conversation): ConvoMeta {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    pinned: !!c.pinned,
    messageCount: c.messages.length,
    preview: [...c.messages].reverse().find((m) => m.role === 'assistant')?.content.slice(0, 160) ?? '',
  };
}

/* ------------------------------ API calls ------------------------------ */

/**
 * The Messages API needs strictly alternating roles starting with a user turn.
 * Our stored history can violate that after an error, an abort or an edit, so
 * empties are dropped and same-role runs are merged.
 */
function toApiMessages(history: Message[], newUser: string) {
  const usable = history.filter((m) => !m.error && m.content.trim());
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of usable) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  const last = out[out.length - 1];
  if (last?.role === 'user') last.content += `\n\n${newUser}`;
  else out.push({ role: 'user', content: newUser });
  return out;
}

function friendlyError(status: number, body: string): { kind: string; message: string } {
  if (status === 401 || /authentication|invalid x-api-key/i.test(body)) {
    return { kind: 'auth', message: 'that api key didnt work. check it and try again' };
  }
  if (status === 429 || /rate_limit/i.test(body)) {
    return { kind: 'rate_limit', message: 'rate limited. wait a sec and retry' };
  }
  if (status === 400 && /credit balance|billing/i.test(body)) {
    return { kind: 'billing', message: 'ur anthropic account needs credits. add some at console.anthropic.com' };
  }
  if (status === 529 || /overloaded/i.test(body)) {
    return { kind: 'overloaded', message: 'anthropic is overloaded rn. try again in a moment' };
  }
  return { kind: 'unknown', message: body.slice(0, 300) || `request failed (${status})` };
}

function buildBody(opts: {
  model: string; effort: string; webSearch: boolean; detail: boolean;
  messages: ReturnType<typeof toApiMessages>; stream: boolean;
}) {
  return {
    model: opts.model,
    max_tokens: 32000,
    stream: opts.stream,
    system: opts.detail ? `${PERSONA}\n\n# right now\n${DETAIL_MODE}` : PERSONA,
    messages: opts.messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort },
    ...(opts.webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search' }] } : {}),
  };
}

/* -------------------------------- backend -------------------------------- */

export const browserBackend: Backend = {
  standalone: true,

  getKey: () => {
    try { return localStorage.getItem(KEY_STORE); } catch { return null; }
  },
  setKey: (k) => {
    try {
      if (k) localStorage.setItem(KEY_STORE, k);
      else localStorage.removeItem(KEY_STORE);
    } catch { /* storage blocked */ }
  },

  async health(): Promise<Health> {
    const key = browserBackend.getKey?.() ?? null;
    return {
      ok: true,
      models: MODELS,
      efforts: EFFORTS,
      defaults: { model: 'claude-opus-5', effort: 'high', webSearch: true },
      auth: { ok: !!key, method: key ? 'api_key' : 'none' },
    };
  },

  async list(q = '') {
    const needle = q.trim().toLowerCase();
    return all()
      .filter((c) =>
        !needle ||
        c.title.toLowerCase().includes(needle) ||
        c.messages.some((m) => m.content.toLowerCase().includes(needle)))
      .map(meta)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  },

  async get(id) {
    const c = all().find((x) => x.id === id);
    if (!c) throw new Error('not found');
    return structuredClone(c);
  },

  async create() {
    const now = Date.now();
    const c: Conversation = { id: uuid(), title: 'new chat', createdAt: now, updatedAt: now, pinned: false, autoTitled: false, messages: [] };
    all().unshift(c);
    save();
    return structuredClone(c);
  },

  async patch(id, fields) {
    const c = all().find((x) => x.id === id);
    if (!c) return { ok: false };
    for (const k of ['title', 'pinned', 'autoTitled'] as const) {
      if (k in fields) (c as unknown as Record<string, unknown>)[k] = fields[k];
    }
    c.updatedAt = Date.now();
    save();
    return { ok: true };
  },

  async remove(id) {
    const list = all();
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) return { ok: false };
    list.splice(i, 1);
    save();
    return { ok: true };
  },

  async stream(convoId, op, body, signal, onEvent) {
    const convo = all().find((c) => c.id === convoId);
    if (!convo) throw new Error('not found');

    const key = browserBackend.getKey?.() ?? null;
    const detail = !!body.detail;
    const model = String(body.model ?? 'claude-opus-5');
    const effort = String(body.effort ?? 'high');
    const webSearch = body.webSearch !== false;

    // Work out the prompt and trim history, mirroring the server's routes.
    let history: Message[];
    let prompt: string;
    if (op === 'regenerate') {
      const i = convo.messages.map((m) => m.role).lastIndexOf('user');
      if (i === -1) throw new Error('nothing to regenerate');
      prompt = convo.messages[i].content;
      history = convo.messages.slice(0, i);
      convo.messages.length = i + 1;
    } else if (op === 'edit') {
      const i = convo.messages.findIndex((m) => m.id === body.messageId);
      if (i === -1) throw new Error('bad message');
      prompt = String(body.content ?? '');
      history = convo.messages.slice(0, i);
      convo.messages.length = i;
      convo.messages.push({ id: uuid(), role: 'user', content: prompt, createdAt: Date.now(), detail: detail || undefined });
    } else {
      prompt = String(body.content ?? '');
      history = convo.messages.slice();
      convo.messages.push({ id: uuid(), role: 'user', content: prompt, createdAt: Date.now(), detail: detail || undefined });
    }

    const placeholder: Message = { id: uuid(), role: 'assistant', content: '', createdAt: Date.now(), pending: true, model };
    convo.messages.push(placeholder);
    convo.updatedAt = Date.now();
    save();
    onEvent({ type: 'start', messageId: placeholder.id });

    if (!key) {
      const err = { kind: 'auth', message: 'add ur anthropic api key to start chatting — its free to make one' };
      Object.assign(placeholder, { pending: false, error: err });
      save();
      onEvent({ type: 'error', ...err });
      onEvent({ type: 'saved', messageId: placeholder.id });
      return;
    }

    let text = '';
    let usedSearch = false;
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(buildBody({ model, effort, webSearch, detail, messages: toApiMessages(history, prompt), stream: true })),
        signal,
      });

      if (!res.ok || !res.body) {
        const info = friendlyError(res.status, await res.text().catch(() => ''));
        Object.assign(placeholder, { pending: false, error: info });
        save();
        onEvent({ type: 'error', ...info });
        onEvent({ type: 'saved', messageId: placeholder.id });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let refused = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let ev: Record<string, any>;
          try { ev = JSON.parse(payload); } catch { continue; }

          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            text += ev.delta.text;
            onEvent({ type: 'delta', text: ev.delta.text });
          } else if (ev.type === 'content_block_start') {
            const b = ev.content_block;
            if (b?.type === 'thinking') onEvent({ type: 'thinking' });
            if (b?.type === 'server_tool_use' || b?.type === 'web_search_tool_result') {
              usedSearch = true;
              onEvent({ type: 'tool', name: 'WebSearch', detail: b?.input?.query ?? '' });
            }
          } else if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') {
            refused = true;
          } else if (ev.type === 'error') {
            throw new Error(ev.error?.message ?? 'stream error');
          }
        }
      }

      if (refused && !text) {
        const info = { kind: 'refusal', message: 'cant help w/ that one' };
        Object.assign(placeholder, { pending: false, error: info });
        save();
        onEvent({ type: 'error', ...info });
        onEvent({ type: 'saved', messageId: placeholder.id });
        return;
      }
    } catch (err) {
      const aborted = signal.aborted || (err as Error)?.name === 'AbortError';
      if (!aborted) {
        const info = friendlyError(0, (err as Error)?.message ?? '');
        Object.assign(placeholder, { pending: false, error: info });
        save();
        onEvent({ type: 'error', ...info });
        onEvent({ type: 'saved', messageId: placeholder.id });
        return;
      }
      Object.assign(placeholder, { aborted: true });
    }

    Object.assign(placeholder, {
      content: text,
      pending: false,
      usedSearch: usedSearch || undefined,
      detail: detail || undefined,
    });
    convo.updatedAt = Date.now();
    save();

    if (!convo.autoTitled && text) {
      titleFor(key, prompt, text).then((t) => {
        if (t) { convo.title = t; convo.autoTitled = true; save(); }
      });
    }

    onEvent({ type: 'saved', messageId: placeholder.id });
  },
};

/** Cheap background title generation. Worker task, so it runs on Haiku. */
async function titleFor(key: string, userText: string, reply: string): Promise<string | null> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 24,
        system: 'you write short plain conversation titles. output only the title.',
        messages: [{
          role: 'user',
          content: `write a title for this convo. 2-4 words, lowercase, no quotes, no trailing punctuation. output ONLY the title.\n\n---\nuser: ${userText}\n\nassistant: ${reply.slice(0, 600)}\n---`,
        }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const t = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    const clean = t.replace(/^["'`]|["'`.]+$/g, '').split('\n')[0].toLowerCase();
    return clean && clean.length <= 60 ? clean : null;
  } catch {
    return null; // A missing title is cosmetic.
  }
}
