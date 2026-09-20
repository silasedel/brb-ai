/**
 * Claude Agent SDK wrapper.
 *
 * Auth: the SDK spawns Claude Code, which uses whatever credentials are already
 * on the machine -- an `ANTHROPIC_API_KEY` if one is exported, otherwise the
 * OAuth login from `claude /login`. That is why this app needs no key of its own.
 *
 * History: we replay our own stored transcript on every turn instead of using
 * the SDK's resumable sessions. Those live under ~/.claude and get garbage
 * collected after ~30 days, which would silently drop context out from under
 * old conversations while the UI still showed them.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { PERSONA, DETAIL_MODE, TITLE_PROMPT } from './persona.mjs';

const require_ = createRequire(import.meta.url);

/**
 * The Claude binary the SDK will spawn. It ships a per-platform build, so the
 * app works even if the user never installed the `claude` CLI themselves --
 * but signing in still writes to the same shared credential store.
 */
function claudeBinary() {
  try {
    return require_.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch {
    return 'claude'; // fall back to whatever is on PATH
  }
}

/**
 * Cheap, no-tokens auth probe so the UI can show setup guidance on first load
 * rather than after a failed message.
 */
export function checkAuth() {
  if (process.env.ANTHROPIC_API_KEY) {
    return Promise.resolve({ ok: true, method: 'api_key' });
  }
  return new Promise((resolve) => {
    execFile(claudeBinary(), ['auth', 'status'], { env: childEnv(), timeout: 15_000 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, method: 'unknown', reason: 'probe_failed' });
      try {
        const j = JSON.parse(stdout);
        resolve({ ok: !!j.loggedIn, method: j.authMethod ?? 'none' });
      } catch {
        resolve({ ok: false, method: 'unknown', reason: 'unparsable' });
      }
    });
  });
}

export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'smartest' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'faster' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'fastest' },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULTS = { model: 'claude-opus-5', effort: 'high', webSearch: true };

/** Roughly 4 chars/token; 600k chars (~150k tokens) leaves plenty of 1M headroom. */
const HISTORY_BUDGET_CHARS = 600_000;

/**
 * Claude Code passes host-bridge variables to its children. If they leak into
 * our spawn the child waits for a host that can hand it an auth token, and we
 * are not that host. Strip them so a spawn from inside Claude Code behaves the
 * same as one from a plain terminal.
 */
export function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'CLAUDECODE') continue;
    if (/^CLAUDE_(CODE|AGENT|PID|EFFORT|PREVIEW)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/**
 * Stop a message from breaking out of its frame, without mangling its content.
 * Escaping `<`/`>`/`&` wholesale would corrupt every code sample in the history,
 * so only the literal delimiters we use are neutralised -- a sequence that
 * effectively never occurs in a real message.
 */
const fence = (s) => String(s).replace(/<\/(msg|chat_so_far|new_message)>/gi, '<\\/$1>');

/**
 * Renders prior turns plus the new message into one prompt. Oldest messages are
 * dropped first when over budget, and the model is told that happened so it does
 * not confidently reference something it can no longer see.
 */
export function buildPrompt(history, newMessage) {
  const usable = history.filter((m) => !m.error && typeof m.content === 'string' && m.content.trim());
  if (!usable.length) return newMessage;

  const rendered = [];
  let chars = 0;
  let dropped = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    const line = `<msg from="${m.role === 'user' ? 'user' : 'you'}">\n${fence(m.content)}\n</msg>`;
    if (chars + line.length > HISTORY_BUDGET_CHARS) { dropped = i + 1; break; }
    chars += line.length;
    rendered.unshift(line);
  }

  const note = dropped ? `\n<note>${dropped} older msgs trimmed for length</note>` : '';
  return `<chat_so_far>${note}\n${rendered.join('\n')}\n</chat_so_far>\n\n<new_message>\n${fence(newMessage)}\n</new_message>`;
}

/** Turns SDK/CLI failures into something the UI can act on. */
function classifyError(err) {
  const raw = err?.message ?? String(err);
  if (/authenticat|not logged in|OAuth|invalid[_ ]api[_ ]key|401|unauthorized/i.test(raw)) {
    return { kind: 'auth', message: 'not signed in. run `npm run login` in a terminal (one time), then hit retry.' };
  }
  if (/rate[_ ]?limit|429|usage limit/i.test(raw)) {
    return { kind: 'rate_limit', message: 'hit ur usage limit. wait a bit or switch to a smaller model in settings.' };
  }
  if (/ENOENT|executable not found|spawn/i.test(raw)) {
    return { kind: 'install', message: 'couldnt start claude code. try `npm install` again.' };
  }
  if (/aborted|AbortError/i.test(raw)) return { kind: 'aborted', message: 'stopped' };
  return { kind: 'unknown', message: raw.slice(0, 400) };
}

function baseOptions({ model, effort, webSearch, signal }) {
  const tools = webSearch ? ['WebSearch', 'WebFetch'] : [];
  return {
    model,
    effort,
    thinking: { type: 'adaptive' },
    // A custom prompt, not the Claude Code preset -- this is a chat app, not a coding agent.
    systemPrompt: { type: 'custom', prompt: PERSONA },
    tools,
    allowedTools: tools,
    // Only read-only web tools are ever available, so nothing here can touch the disk.
    permissionMode: 'bypassPermissions',
    // Ignore the user's CLAUDE.md and global settings; they would leak coding-agent
    // instructions into a chatbot and fight the persona.
    settingSources: [],
    persistSession: false,
    includePartialMessages: true,
    maxTurns: 12,
    cwd: process.cwd(),
    env: childEnv(),
    abortController: signal ? abortControllerFrom(signal) : undefined,
  };
}

function abortControllerFrom(signal) {
  const ac = new AbortController();
  if (signal.aborted) ac.abort();
  else signal.addEventListener('abort', () => ac.abort(), { once: true });
  return ac;
}

/**
 * Streams one assistant reply.
 * `onEvent` receives {type:'delta'|'tool'|'thinking'|'done'|'error', ...}.
 */
export async function streamReply({ history, message, detail, model, effort, webSearch, memoryBlock = '', signal, onEvent }) {
  const opts = baseOptions({ model, effort, webSearch, signal });
  const base = `${PERSONA}${memoryBlock}`;
  opts.systemPrompt = { type: 'custom', prompt: detail ? `${base}\n\n# right now\n${DETAIL_MODE}` : base };

  let text = '';
  let usedSearch = false;
  let meta = {};

  try {
    for await (const msg of query({ prompt: buildPrompt(history, message), options: opts })) {
      if (signal?.aborted) break;

      if (msg.type === 'stream_event') {
        const e = msg.event;
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
          text += e.delta.text;
          onEvent({ type: 'delta', text: e.delta.text });
        } else if (e.type === 'content_block_start' && e.content_block?.type === 'thinking') {
          onEvent({ type: 'thinking' });
        }
        continue;
      }

      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            usedSearch = true;
            onEvent({
              type: 'tool',
              name: block.name,
              detail: block.input?.query ?? block.input?.url ?? '',
            });
          }
        }
        continue;
      }

      if (msg.type === 'result') {
        meta = {
          costUsd: msg.total_cost_usd ?? null,
          durationMs: msg.duration_ms ?? null,
          turns: msg.num_turns ?? null,
        };
        if (msg.is_error) {
          const detailText = msg.subtype === 'success' ? msg.result : (msg.errors ?? []).join('; ');
          throw new Error(detailText || 'the model returned an error');
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      onEvent({ type: 'done', text, usedSearch, meta, aborted: true });
      return { text, usedSearch, meta, aborted: true };
    }
    const info = classifyError(err);
    onEvent({ type: 'error', ...info });
    return { text, usedSearch, meta, error: info };
  }

  if (signal?.aborted) {
    onEvent({ type: 'done', text, usedSearch, meta, aborted: true });
    return { text, usedSearch, meta, aborted: true };
  }

  onEvent({ type: 'done', text, usedSearch, meta });
  return { text, usedSearch, meta };
}

/** Cheap background title generation. Worker task, so it runs on Haiku. */
export async function generateTitle(firstUser, firstAssistant) {
  const convo = `user: ${firstUser}\n\nassistant: ${(firstAssistant || '').slice(0, 600)}`;
  let out = '';
  try {
    for await (const msg of query({
      prompt: `${TITLE_PROMPT}\n\n---\n${convo}\n---`,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: { type: 'custom', prompt: 'you write short plain conversation titles. output only the title.' },
        tools: [],
        allowedTools: [],
        settingSources: [],
        persistSession: false,
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
        env: childEnv(),
      },
    })) {
      if (msg.type === 'assistant') {
        for (const b of msg.message?.content ?? []) if (b.type === 'text') out += b.text;
      }
    }
  } catch {
    return null; // A missing title is cosmetic; never surface this.
  }
  const title = out.trim().replace(/^["'`]|["'`.]+$/g, '').split('\n')[0].toLowerCase();
  return title && title.length <= 60 ? title : null;
}
