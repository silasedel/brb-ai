import type { Conversation, ConvoMeta, Health, StreamEvent } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  health: () => json<Health>('/api/health'),
  list: (q = '') => json<ConvoMeta[]>(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (id: string) => json<Conversation>(`/api/conversations/${id}`),
  create: () => json<Conversation>('/api/conversations', { method: 'POST' }),
  patch: (id: string, fields: Record<string, unknown>) =>
    json<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  remove: (id: string) => json<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
};

/**
 * POSTs a turn and yields server events as they arrive. The response is
 * newline-delimited JSON so a plain fetch reader is enough -- and aborting the
 * fetch is what tells the server to stop generating.
 */
export async function streamTurn(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(path, {
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
}
