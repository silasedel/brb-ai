import type { CheckInConfig, CheckInResult, Conversation, ConvoMeta, Health, MemoryItem, StreamEvent } from '../types';
import type { Backend } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

/** Talks to the local Express app. Conversations live on disk. */
export const serverBackend: Backend = {
  standalone: false,

  health: () => json<Health>('/api/health'),
  list: (q = '') => json<ConvoMeta[]>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (id) => json<Conversation>(`/api/conversations/${id}`),
  create: () => json<Conversation>('/api/conversations', { method: 'POST' }),
  patch: (id, fields) =>
    json<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  remove: (id) => json<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),

  listMemory: () => json<MemoryItem[]>('/api/memory'),
  addMemory: (text) =>
    fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((r) => (r.ok ? r.json() : null)),
  updateMemory: async (id, text) => {
    await fetch(`/api/memory/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  },
  removeMemory: async (id) => { await fetch(`/api/memory/${id}`, { method: 'DELETE' }); },
  clearMemory: async () => { await fetch('/api/memory', { method: 'DELETE' }); },

  getCheckins: () => json<CheckInConfig>('/api/checkins'),
  setCheckins: (patch) =>
    json<CheckInConfig>('/api/checkins', { method: 'PATCH', body: JSON.stringify(patch) }),
  runCheckin: () => json<CheckInResult>('/api/checkins/run', { method: 'POST', body: '{}' }),

  /**
   * The response is newline-delimited JSON, so a plain fetch reader is enough --
   * and aborting the fetch is what tells the server to stop generating.
   */
  async stream(convoId, op, body, signal, onEvent) {
    const res = await fetch(`/api/conversations/${convoId}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as StreamEvent);
        } catch {
          // A partial or malformed frame should never kill the stream.
        }
      }
    }
  },
};
