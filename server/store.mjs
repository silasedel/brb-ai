/**
 * Conversation persistence: one JSON file per conversation, held in memory,
 * written back atomically and debounced. No native deps, no migrations,
 * and the whole history is a folder you can copy, diff or back up.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class Store {
  #dir;
  #convos = new Map(); // id -> conversation
  #pending = new Map(); // id -> timeout
  #writing = new Map(); // id -> promise, serialises writes per conversation

  constructor(dir) {
    this.#dir = dir;
  }

  async init() {
    await fs.mkdir(this.#dir, { recursive: true });
    const files = await fs.readdir(this.#dir);
    for (const f of files) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      try {
        const raw = await fs.readFile(path.join(this.#dir, f), 'utf8');
        const c = JSON.parse(raw);
        if (c && typeof c.id === 'string' && Array.isArray(c.messages)) {
          this.#convos.set(c.id, c);
        }
      } catch {
        // A single corrupt file must never stop the app from booting.
        console.warn(`[store] skipping unreadable conversation file: ${f}`);
      }
    }
    return this.#convos.size;
  }

  /** Sidebar payload: metadata only, newest first, pinned on top. */
  list() {
    return [...this.#convos.values()]
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        pinned: !!c.pinned,
        messageCount: c.messages.length,
        preview: c.messages.findLast?.((m) => m.role === 'assistant')?.content?.slice(0, 160) ?? '',
      }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }

  get(id) {
    return this.#convos.get(id) ?? null;
  }

  create({ title = 'new chat' } = {}) {
    const now = Date.now();
    const c = { id: randomUUID(), title, createdAt: now, updatedAt: now, pinned: false, autoTitled: false, messages: [] };
    this.#convos.set(c.id, c);
    this.#save(c.id);
    return c;
  }

  addMessage(id, msg) {
    const c = this.#convos.get(id);
    if (!c) return null;
    const full = { id: randomUUID(), createdAt: Date.now(), ...msg };
    c.messages.push(full);
    c.updatedAt = full.createdAt;
    this.#save(id);
    return full;
  }

  updateMessage(id, messageId, patch) {
    const c = this.#convos.get(id);
    if (!c) return null;
    const m = c.messages.find((x) => x.id === messageId);
    if (!m) return null;
    Object.assign(m, patch);
    c.updatedAt = Date.now();
    this.#save(id);
    return m;
  }

  /** Drops `messageId` and everything after it. Used by regenerate and edit. */
  truncateFrom(id, messageId) {
    const c = this.#convos.get(id);
    if (!c) return null;
    const i = c.messages.findIndex((m) => m.id === messageId);
    if (i === -1) return null;
    const removed = c.messages.splice(i);
    c.updatedAt = Date.now();
    this.#save(id);
    return removed;
  }

  patch(id, fields) {
    const c = this.#convos.get(id);
    if (!c) return null;
    const allowed = ['title', 'pinned', 'autoTitled'];
    for (const k of allowed) if (k in fields) c[k] = fields[k];
    c.updatedAt = Date.now();
    this.#save(id);
    return c;
  }

  async remove(id) {
    if (!this.#convos.delete(id)) return false;
    const t = this.#pending.get(id);
    if (t) { clearTimeout(t); this.#pending.delete(id); }
    await this.#writing.get(id)?.catch(() => {});
    await fs.rm(this.#file(id), { force: true });
    return true;
  }

  /** Full-text search across titles and message bodies. */
  search(q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((meta) => {
      const c = this.#convos.get(meta.id);
      if (meta.title.toLowerCase().includes(needle)) return true;
      return c.messages.some((m) => typeof m.content === 'string' && m.content.toLowerCase().includes(needle));
    });
  }

  /** Flush every dirty conversation. Called on shutdown. */
  async flushAll() {
    const ids = [...this.#pending.keys()];
    for (const id of ids) {
      clearTimeout(this.#pending.get(id));
      this.#pending.delete(id);
      this.#enqueueWrite(id);
    }
    await Promise.allSettled([...this.#writing.values()]);
  }

  #file(id) {
    return path.join(this.#dir, `${id}.json`);
  }

  #save(id) {
    clearTimeout(this.#pending.get(id));
    this.#pending.set(id, setTimeout(() => {
      this.#pending.delete(id);
      this.#enqueueWrite(id);
    }, 250));
  }

  #enqueueWrite(id) {
    const prev = this.#writing.get(id) ?? Promise.resolve();
    const next = prev.then(() => this.#write(id)).catch((e) => console.error('[store] write failed', id, e));
    this.#writing.set(id, next);
    next.finally(() => { if (this.#writing.get(id) === next) this.#writing.delete(id); });
  }

  async #write(id) {
    const c = this.#convos.get(id);
    if (!c) return;
    const target = this.#file(id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(c, null, 2), 'utf8');
    await fs.rename(tmp, target); // atomic on the same filesystem
  }
}
