/**
 * Stored memory text is the user's, but it may hold anything pasted from elsewhere: a closing tag that
 * would end the prompt section it sits in, or a line that looks like a memory label. Every piece of it
 * goes through here before it reaches a prompt or a tool result.
 *
 * Two rules make that safe:
 * - `&`, `<`, `>` become entities, so no tag can open or close (the model reads "P/E &lt; 15" fine);
 * - stored text never starts a line. A one-line field folds its line breaks into spaces and always sits
 *   after the provider's own words; multi-line content follows a fixed prefix on its first line and two
 *   spaces on every other line. The core prints recalled items after "- ", so the column a real label
 *   starts at is not something to rely on: the prefix is.
 */

// Every character a model may read as a new line, not only \n.
const LINE_BREAK = /\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029]/g

const entities = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** A name, a title, an alias: one line, placed after fixed words. */
export function escapeMemoryLine(text: string): string {
  return entities(text).replace(LINE_BREAK, " ")
}

/** Multi-line content after `prefix` (a field label such as "Luận điểm: "); later lines are indented. */
export function escapeMemoryText(prefix: string, text: string): string {
  if (!prefix) throw new Error("Stored memory text must follow a prefix")
  return prefix + entities(text).replace(LINE_BREAK, "\n  ")
}
