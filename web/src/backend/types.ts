import type { Conversation, ConvoMeta, Health, MemoryItem, StreamEvent } from '../types';

/**
 * Everything the UI needs from a data source. Two implementations:
 *  - `server.ts`  talks to the local Express app (the desktop build)
 *  - `browser.ts` keeps data in localStorage and calls Anthropic directly
 *                 (the static GitHub Pages build)
 * App.tsx is written against this interface and doesn't know which is live.
 */
export interface Backend {
  readonly standalone: boolean;
  health(): Promise<Health>;
  list(q?: string): Promise<ConvoMeta[]>;
  get(id: string): Promise<Conversation>;
  create(): Promise<Conversation>;
  patch(id: string, fields: Record<string, unknown>): Promise<{ ok: boolean }>;
  remove(id: string): Promise<{ ok: boolean }>;
  /** Streams one turn. `path` names the operation: messages | regenerate | edit. */
  stream(
    convoId: string,
    op: 'messages' | 'regenerate' | 'edit',
    body: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (e: StreamEvent) => void,
  ): Promise<void>;
  /** What it remembers about the person, across all conversations. */
  listMemory(): Promise<MemoryItem[]>;
  addMemory(text: string): Promise<MemoryItem | null>;
  updateMemory(id: string, text: string): Promise<void>;
  removeMemory(id: string): Promise<void>;
  clearMemory(): Promise<void>;

  /** Standalone only: the visitor's own API key. */
  getKey?(): string | null;
  setKey?(k: string | null): void;
}
