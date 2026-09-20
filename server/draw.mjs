/**
 * The drawing tool.
 *
 * Claude cannot produce an image. It can, however, call a generator that was
 * trained from scratch on this machine -- so the chat gains an ability the
 * underlying model genuinely does not have.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const GEN = `http://127.0.0.1:${process.env.GEN_PORT ?? 4319}`;

export const DRAW_TOOL_NAME = 'mcp__doodle__draw';

async function genFetch(path, init, timeoutMs = 120_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(`${GEN}${path}`, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** What the generator can currently draw, for the system prompt. */
export async function drawStatus() {
  try {
    const r = await genFetch('/status', {}, 4000);
    if (!r.ok) return { ready: false, classes: [] };
    return await r.json();
  } catch {
    return { ready: false, classes: [] };
  }
}

export const doodleServer = createSdkMcpServer({
  name: 'doodle',
  version: '1.0.0',
  instructions: 'A hand-trained image generator running locally. Use it whenever someone asks for a drawing.',
  tools: [
    tool(
      'draw',
      "Draw a picture. Uses a diffusion model trained from scratch on this machine -- it's the only way you can produce an image, since you can't generate images yourself. Only works for subjects it was trained on; the system prompt lists them.",
      {
        subject: z.string().describe('What to draw. Must be one of the trained subjects, e.g. "cat", "pizza", "cactus".'),
        count: z.number().int().min(1).max(4).optional().describe('How many to draw. Default 1.'),
      },
      async ({ subject, count }) => {
        let res;
        try {
          res = await genFetch('/draw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, n: count ?? 1 }),
          });
        } catch {
          return { content: [{ type: 'text', text: 'the drawing model isnt running. tell them to start it with `npm run draw`.' }] };
        }

        const data = await res.json().catch(() => ({}));

        if (res.status === 422) {
          return {
            content: [{
              type: 'text',
              text: `cant draw "${subject}" — not trained on it. trained subjects: ${(data.classes ?? []).join(', ')}. `
                  + `pick the closest one and tell them what u drew instead.`,
            }],
          };
        }
        if (!res.ok) {
          return { content: [{ type: 'text', text: data.error ?? 'drawing failed' }] };
        }

        // The model pastes these straight into its reply; the chat renders markdown.
        const md = data.images.map((u) => `![${data.subject}](${u})`).join('\n');
        return {
          content: [{
            type: 'text',
            text: `drew ${data.images.length} ${data.subject}(s) in ${data.ms}ms.\n\n`
                + `put this in ur reply EXACTLY as written, on its own line:\n${md}`,
          }],
        };
      },
    ),
  ],
});
