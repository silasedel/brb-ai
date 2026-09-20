/**
 * Check-ins: the assistant messaging you first.
 *
 * Every chatbot waits to be spoken to. This one periodically looks at what it
 * knows about you and what you were last working on, searches the web if that
 * would help, and decides whether it has something genuinely worth saying. Most
 * of the time it decides no -- that restraint is the whole feature. A bot that
 * pings you daily with "just checking in!" gets muted in a week.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PERSONA } from './persona.mjs';

const DEFAULTS = { enabled: true, everyHours: 6, quietFrom: 23, quietTo: 8 };

const SHARED = `only send something that earns the interruption:
- a real follow up on what they were building ("did u get the streaming working")
- news or a release that genuinely matters to their projects or interests — SEARCH THE WEB, dont guess or assume nothing happened
- something u thought of later about a problem they had
- a specific useful thing that fits what theyre into

never send:
- "hey, just checking in" with nothing behind it
- a repeat of something u already told them
- vague encouragement

write it like a normal text. 1-2 lines, casual, straight to the point, no greeting preamble. if u found something online, drop the link.`;

/** Scheduled runs: silence is usually correct, and is always an acceptable answer. */
const DECIDE = `ur deciding whether to text them first, unprompted — like a friend who remembered something, not like a notification.

${SHARED}

a follow up on something theyre actively building counts, even with no news, IF u can ask something specific about it. "hows it going" does not count; "did u end up using SSE or websockets for the streaming" does.

if u genuinely have nothing: output exactly PASS and nothing else.
otherwise: output just the message.`;

/** Manual "nudge me": they asked for it, so PASS is not an answer. */
const DECIDE_FORCED = `they just tapped the button asking u to text them, so they DO want a message right now.

${SHARED}

find the best thing u have. search the web for something genuinely new and relevant to what theyre building or into — that is usually the strongest option. if theres really no news, ask one specific, useful question about the thing they were last working on.

do NOT output PASS. they asked. send something worth reading.`;

export class CheckIns {
  #file;
  #cfg = { ...DEFAULTS, lastRunAt: 0, lastSentAt: 0 };

  constructor(dir) {
    this.#file = path.join(dir, 'checkins.json');
  }

  async init() {
    try {
      this.#cfg = { ...this.#cfg, ...JSON.parse(await fs.readFile(this.#file, 'utf8')) };
    } catch { /* first run */ }
    return this.config();
  }

  config() {
    const { enabled, everyHours, lastSentAt } = this.#cfg;
    return { enabled, everyHours, lastSentAt };
  }

  async setConfig(patch) {
    if (typeof patch.enabled === 'boolean') this.#cfg.enabled = patch.enabled;
    if (Number.isFinite(patch.everyHours)) this.#cfg.everyHours = Math.max(1, Math.min(72, patch.everyHours));
    await this.#save();
    return this.config();
  }

  /** True when enough time has passed and we're not in the quiet hours. */
  #due(now) {
    if (!this.#cfg.enabled) return false;
    const hour = new Date(now).getHours();
    const { quietFrom, quietTo } = this.#cfg;
    const quiet = quietFrom > quietTo ? hour >= quietFrom || hour < quietTo : hour >= quietFrom && hour < quietTo;
    if (quiet) return false;
    return now - (this.#cfg.lastSentAt || 0) >= this.#cfg.everyHours * 3_600_000;
  }

  /**
   * Runs one check-in attempt. `force` skips the schedule for the "nudge me"
   * button. Returns the conversation it posted into, or null for no-message.
   */
  async run({ store, memory, childEnv, force = false }) {
    const now = Date.now();
    if (!force && !this.#due(now)) return null;

    this.#cfg.lastRunAt = now;

    const convos = store.list().filter((c) => c.messageCount > 0);
    if (!convos.length) return null; // nothing to follow up on yet

    const target = store.get(convos[0].id);
    const hoursSince = Math.round((now - target.updatedAt) / 3_600_000);
    if (!force && hoursSince < 2) return null; // they were literally just here

    const recent = convos.slice(0, 5)
      .map((c) => `- "${c.title}" (${Math.round((now - c.updatedAt) / 3_600_000)}h ago): ${c.preview.slice(0, 120)}`)
      .join('\n');

    const prompt = `${force ? DECIDE_FORCED : DECIDE}

# what u know abt them
${memory.list().map((i) => `- ${i.text}`).join('\n') || '(nothing yet)'}

# recent convos
${recent}

# timing
last talked ${hoursSince}h ago. today is ${new Date(now).toDateString()}.`;

    let out = '';
    try {
      for await (const msg of query({
        prompt,
        options: {
          model: 'claude-opus-5',
          effort: 'medium',
          systemPrompt: { type: 'custom', prompt: PERSONA },
          tools: ['WebSearch', 'WebFetch'],
          allowedTools: ['WebSearch', 'WebFetch'],
          permissionMode: 'bypassPermissions',
          settingSources: [],
          persistSession: false,
          maxTurns: 8,
          env: childEnv,
        },
      })) {
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content ?? []) if (b.type === 'text') out += b.text;
        }
      }
    } catch {
      return null; // a failed check-in is a non-event
    }

    const text = out.trim();
    if (!text || text.length < 4 || (!force && /^PASS\b/i.test(text))) {
      await this.#save();
      return null;
    }

    store.addMessage(target.id, { role: 'assistant', content: text, checkin: true });
    store.patch(target.id, { unread: true });
    this.#cfg.lastSentAt = now;
    await this.#save();
    return { conversationId: target.id, text };
  }

  async #save() {
    try {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      await fs.writeFile(this.#file, JSON.stringify(this.#cfg, null, 2), 'utf8');
    } catch { /* non-fatal */ }
  }
}
