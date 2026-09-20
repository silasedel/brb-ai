/**
 * Turns one raw reply into what actually gets rendered: an optional tapback
 * reaction, plus the separate message bubbles it should arrive as.
 */

/** Markers that mean the reply is structured and must not be chopped up. */
const STRUCTURED = /(^|\n)\s*(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/;

const REACTION = /^\s*<r>\s*(\S{1,12}?)\s*<\/r>\s*/;

export interface ParsedReply {
  reaction: string | null;
  bubbles: string[];
  /** True while a reaction tag is still streaming in and shouldn't be shown raw. */
  holding: boolean;
}

/**
 * Splits on blank lines so a casual reply arrives as a few short texts, the way
 * a person actually types. Code, lists and tables stay whole -- splitting those
 * would break the formatting they depend on.
 */
export function splitBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (STRUCTURED.test(trimmed)) return [trimmed];

  const parts = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // A runaway split would look like spam rather than texting.
  return parts.length > 1 && parts.length <= 5 ? parts : [trimmed];
}

export function parseReply(raw: string): ParsedReply {
  const m = raw.match(REACTION);
  if (m) {
    return { reaction: m[1], bubbles: splitBubbles(raw.slice(m[0].length)), holding: false };
  }

  // Mid-stream the tag arrives in pieces; don't flash "<r>" at the reader.
  const head = raw.trimStart();
  if (head && '<r>'.startsWith(head.slice(0, 3)) && !head.includes('</r>') && head.length < 20) {
    return { reaction: null, bubbles: [], holding: true };
  }

  return { reaction: null, bubbles: splitBubbles(raw), holding: false };
}
