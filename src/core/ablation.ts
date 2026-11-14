/**
 * Parts of the loop an eval can switch off one at a time, to see which ones earn their place.
 * Only the eval runner sets these: no config or flag reaches them, so a user's run has them all.
 */
export const ABLATIONS = [
  "gate-empty",
  "gate-fragment",
  "gate-length",
  "gate-malformed",
  "gate-text-call",
  "gate-promise",
  "gate-unfetched",
  "gate-draft",
  "strip-echoes",
  "strip-markup",
  "tool-nudge",
  "todo-nudge",
  "failure-nudge",
  "skill-hints",
  "citations-prompt",
] as const

export type Ablation = (typeof ABLATIONS)[number]
export type Ablations = ReadonlySet<Ablation>
