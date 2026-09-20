/**
 * Cross-conversation memory.
 *
 * After a turn, a cheap model reads the exchange and pulls out durable facts
 * about the person -- preferences, projects, constraints, how they like answers.
 * Those get injected into the system prompt of every later conversation, which
 * is what makes a new chat feel like it already knows you.
 *
 * Everything is visible and deletable in the UI. Nothing is hidden from the
 * person it is about.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ITEMS = 80;

const EXTRACT_PROMPT = `u read one exchange between a user and an assistant, and pull out durable facts about the USER worth remembering for future conversations.

remember things like:
- who they are: name, job, where they live, what they study
- preferences + tastes: languages they use, tools, food, how they like answers
- ongoing projects or goals
- constraints: allergies, budget, deadlines, skill level
- relationships: pets, family, teammates they mention

do NOT remember:
- what they asked in this one message (thats not a fact abt them)
- anything the ASSISTANT said or knows
- one-off trivia, or facts about the world
- anything already in the existing list (below)
- sensitive stuff they clearly said in passing and wouldnt want kept

each fact: one short sentence, third person, starts with "they". self-contained — it has to make sense months later with no context.

output STRICT json only, no markdown fence, no prose:
{"facts": ["they ...", "they ..."]}

if theres nothing worth keeping, output {"facts": []}. that is the common case — be strict.`;

export class Memory {
  #file;
  #items = [];
  #writing = Promise.resolve();

  constructor(dir) {
    this.#file = path.join(dir, 'memory.json');
  }

  async init() {
    try {
      const raw = await fs.readFile(this.#file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.items)) this.#items = parsed.items;
    } catch {
      this.#items = []; // first run, or an unreadable file
    }
    return this.#items.length;
  }

  list() {
    return [...this.#items].sort((a, b) => b.createdAt - a.createdAt);
  }

  add(text, source = 'manual') {
    const clean = String(text).trim();
    if (!clean) return null;
    if (this.#isDuplicate(clean)) return null;
    const item = { id: randomUUID(), text: clean, createdAt: Date.now(), source };
    this.#items.push(item);
    if (this.#items.length > MAX_ITEMS) this.#items = this.#items.slice(-MAX_ITEMS);
    this.#save();
    return item;
  }

  update(id, text) {
    const item = this.#items.find((i) => i.id === id);
    if (!item) return null;
    item.text = String(text).trim();
    this.#save();
    return item;
  }

  remove(id) {
    const i = this.#items.findIndex((x) => x.id === id);
    if (i === -1) return false;
    this.#items.splice(i, 1);
    this.#save();
    return true;
  }

  clear() {
    this.#items = [];
    this.#save();
  }

  /** The block appended to the system prompt. Empty string when nothing is known. */
  promptBlock() {
    if (!this.#items.length) return '';
    const lines = this.list().map((i) => `- ${i.text}`).join('\n');
    return `\n\n# stuff u know abt them
these carried over from past convos. use them when they're relevant — naturally, like a friend who remembers, not like a database readout. never announce "according to my memory". if one contradicts what they say now, believe what they say now.

${lines}`;
  }

  /** Rough duplicate guard so the list doesn't fill with restatements. */
  #isDuplicate(text) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    const incoming = new Set(norm(text));
    return this.#items.some((item) => {
      const existing = new Set(norm(item.text));
      const overlap = [...incoming].filter((w) => existing.has(w)).length;
      return overlap / Math.max(incoming.size, existing.size) > 0.7;
    });
  }

  #save() {
    this.#writing = this.#writing.then(async () => {
      const tmp = `${this.#file}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ items: this.#items }, null, 2), 'utf8');
      await fs.rename(tmp, this.#file);
    }).catch((e) => console.error('[memory] write failed', e));
  }

  async flush() {
    await this.#writing;
  }

  /**
   * Reads one exchange and stores anything durable. Runs in the background after
   * a reply, so it never delays the response.
   */
  async learn(userText, assistantText, childEnv) {
    const existing = this.#items.length
      ? `\n\nexisting list (do not repeat these):\n${this.list().map((i) => `- ${i.text}`).join('\n')}`
      : '';
    const input = `${EXTRACT_PROMPT}${existing}\n\n---\nuser: ${userText}\n\nassistant: ${String(assistantText).slice(0, 1500)}\n---`;

    let out = '';
    try {
      for await (const msg of query({
        prompt: input,
        options: {
          model: 'claude-haiku-4-5',
          systemPrompt: { type: 'custom', prompt: 'you extract durable user facts and reply with strict json only.' },
          tools: [], allowedTools: [],
          settingSources: [], persistSession: false,
          permissionMode: 'bypassPermissions', maxTurns: 1,
          env: childEnv,
        },
      })) {
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content ?? []) if (b.type === 'text') out += b.text;
        }
      }
    } catch {
      return []; // extraction is best-effort and must never surface an error
    }

    return this.#ingest(out);
  }

  #ingest(raw) {
    // Models sometimes wrap JSON in a fence despite instructions.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    let facts;
    try {
      facts = JSON.parse(match[0])?.facts;
    } catch {
      return [];
    }
    if (!Array.isArray(facts)) return [];
    const added = [];
    for (const f of facts.slice(0, 5)) {
      if (typeof f !== 'string' || f.length > 220) continue;
      const item = this.add(f, 'auto');
      if (item) added.push(item);
    }
    return added;
  }
}
