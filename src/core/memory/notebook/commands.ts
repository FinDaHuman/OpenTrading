/**
 * The notebook's write commands. Each opens a form that runs on this machine only; none is a chat turn.
 * Recognised before the prompt history is written, so only "/<name>" is ever kept there: what follows the
 * name (a pasted key, a private thesis) must not land in a file on disk.
 */

export const NOTEBOOK_COMMANDS = ["nho", "luandiem", "baihoc", "quyetdinh"] as const
export type NotebookCommand = (typeof NOTEBOOK_COMMANDS)[number]

/**
 * "/NHO  Không dùng margin" → "nho"; "/memory", "Phân tích HPG" → undefined. Splits the name the way the
 * TUI's command parser does (first run of non-space after "/"), so both agree on what is a command; works on
 * text that still holds paste chips, since the name always comes first.
 */
export function notebookCommandOf(text: string): NotebookCommand | undefined {
  const name = text.trim().match(/^\/(\S+)/)?.[1]?.toLowerCase()
  return (NOTEBOOK_COMMANDS as readonly string[]).includes(name ?? "") ? (name as NotebookCommand) : undefined
}
