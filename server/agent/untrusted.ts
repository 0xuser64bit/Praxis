/**
 * Normalization for strings that arrive from outside Praxis — a market
 * indexer, a quote feed, an LLM. None of them are attackers by assumption,
 * but all of them carry text that someone else authored: a token's `name` and
 * `symbol` are chosen by whoever minted it, and anyone can mint.
 *
 * React escapes markup, so this is not about XSS. It is about the two things
 * that survive escaping: a thousand-character "symbol" that destroys the
 * layout of the card it lands on, and control characters (newlines, bidi
 * overrides, zero-width marks) that let a value rewrite the line it appears
 * in. Both are cheap to strip and neither is ever legitimate in a ticker.
 */

/** Control characters, bidi overrides, and zero-width marks. */
const UNSAFE_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Collapse untrusted text to a single safe line, or `undefined` when nothing
 * legible is left. Truncation is visible (an ellipsis) so a cut value never
 * reads as the whole value.
 */
export function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}\u2026` : cleaned;
}

/** Longest ticker any real token needs; anything longer is noise or an attack. */
export const MAX_SYMBOL_LENGTH = 24;
/** A project name is a headline, not a paragraph. */
export const MAX_NAME_LENGTH = 64;
/** A provider-supplied URL or blurb, bounded before it reaches agent copy. */
export const MAX_DETAIL_LENGTH = 200;
