import { policyRule } from "../policy"
import type { LimitKey } from "../limits"
import { requiredText } from "../store/text"
import type { RawCardBlock } from "./block"
import type { CardDraft, CardKind } from "./types"

/**
 * Whether a card block becomes a card (spec 007 YC-018, YC-019, YC-022). Checked by code, never by the model:
 * - the kind is one the policy table lets the main agent propose (constraint, style, lesson; never a thesis
 *   or a decision);
 * - a constraint or style carries the user's own words of this turn, verbatim (research R-10), so text from a
 *   web page, a tool or a sub-agent cannot become a rule (MINJA);
 * - every field passes the same limits and secret check as the spec-003 form.
 */

const KINDS: Record<string, { kind: CardKind; fields: Record<string, LimitKey>; quote: boolean }> = {
  rang_buoc: { kind: "constraint", fields: { noi_dung: "constraintItem" }, quote: true },
  cach_trinh_bay: { kind: "style", fields: { noi_dung: "constraintItem" }, quote: true },
  bai_hoc: { kind: "lesson", fields: { tieu_de: "lessonTitle", tom_tat: "lessonSummary" }, quote: false },
}

/** A quote shorter than this proves little: "tôi", "không" are in most messages. */
const MIN_QUOTE_CHARS = 8

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi")

/** The quote is a run of the user's typed words (case, spacing and Unicode form aside). */
export function quoteMatches(quote: string, typed: string): boolean {
  const q = norm(quote.replace(/^["“«]|["”»]$/g, ""))
  return q.length >= MIN_QUOTE_CHARS && norm(typed).includes(q)
}

/** `typed`: the user's own words this turn, notifications stripped (topics.ts typedText). */
export function acceptCard(raw: RawCardBlock, ctx: { typed: string }): CardDraft | undefined {
  const spec = raw.loai ? KINDS[raw.loai] : undefined
  if (!spec || !raw.fields) return undefined
  if (!policyRule("main_agent", "propose", spec.kind)) return undefined
  const allowed = new Set([...Object.keys(spec.fields), ...(spec.quote ? ["cau_goc"] : [])])
  if (Object.keys(raw.fields).some((k) => !allowed.has(k))) return undefined
  const values: Record<string, string> = {}
  try {
    for (const [field, limit] of Object.entries(spec.fields)) values[field] = requiredText(field, raw.fields[field] ?? "", limit)
  } catch {
    return undefined
  }
  if (!ctx.typed.trim()) return undefined
  if (spec.quote) {
    const quote = raw.fields.cau_goc?.trim()
    if (!quote || !quoteMatches(quote, ctx.typed)) return undefined
    return { kind: spec.kind, text: values.noi_dung, quote }
  }
  return { kind: spec.kind, title: values.tieu_de, summary: values.tom_tat }
}
