export type Role = 'user' | 'assistant';

export interface AgentError { kind: string; message: string }

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  pending?: boolean;
  aborted?: boolean;
  usedSearch?: boolean;
  detail?: boolean;
  checkin?: boolean;
  model?: string;
  error?: AgentError;
  meta?: { costUsd?: number | null; durationMs?: number | null; turns?: number | null };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  autoTitled: boolean;
  messages: Message[];
}

export interface ConvoMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  unread?: boolean;
  messageCount: number;
  preview: string;
}

export interface ModelInfo { id: string; label: string; hint: string }

export interface Health {
  ok: boolean;
  models: ModelInfo[];
  efforts: string[];
  defaults: { model: string; effort: string; webSearch: boolean };
  auth: { ok: boolean; method: string; reason?: string };
}

export interface Settings {
  model: string;
  effort: string;
  webSearch: boolean;
  theme: 'dark' | 'light';
}

export type StreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'done'; text: string; usedSearch: boolean; aborted?: boolean; meta?: Message['meta'] }
  | { type: 'error'; kind: string; message: string }
  | { type: 'saved'; messageId: string };

export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
  source: 'auto' | 'manual';
}

export interface CheckInConfig {
  enabled: boolean;
  everyHours: number;
  lastSentAt: number;
}

export interface CheckInResult {
  conversationId?: string;
  text?: string;
  skipped?: boolean;
}
