import { SUMMARY_SECTIONS, type SummaryEvent } from "./compaction"

/**
 * Deterministic checks on a compaction summary:
 * 1. every pinned constraint appears verbatim under "Ràng buộc đang áp dụng" (a paraphrase like "tối đa 1/5 danh
 *    mục" for "không vượt 20%" fails);
 * 2. every line with a number under "Số liệu quan trọng kèm nguồn" cites an evidence id that really exists.
 */

const CONSTRAINTS = "Ràng buộc đang áp dụng"
const FIGURES = "Số liệu quan trọng kèm nguồn"

export function sections(summary: string): Map<string, string> {
  const out = new Map<string, string>()
  const text = summary.replace(/\r\n?/g, "\n")
  const heads = [...text.matchAll(/^##\s+(.+?)\s*$/gm)]
  heads.forEach((h, i) => {
    const start = h.index! + h[0].length
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : text.length
    out.set(h[1]!.trim(), text.slice(start, end).trim())
  })
  return out
}

export interface ValidationResult {
  ok: boolean
  missingSections: string[]
  missingConstraints: string[]
  unsourcedFigures: string[]
}

const EVIDENCE = /\[ev:([A-Za-z0-9_.:-]+)\]/g

export function validateSummary(
  summary: string,
  opts: { pinned: readonly string[]; evidenceIds: ReadonlySet<string> },
): ValidationResult {
  const parts = sections(summary)
  const missingSections = SUMMARY_SECTIONS.filter((s) => !parts.has(s))
  const constraintText = (parts.get(CONSTRAINTS) ?? "").normalize("NFC")
  const missingConstraints = opts.pinned.filter((p) => !constraintText.includes(p.normalize("NFC").trim()))
  const unsourcedFigures = (parts.get(FIGURES) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\p{N}/u.test(l.replace(EVIDENCE, "")))
    .filter((l) => {
      const cited = [...l.matchAll(EVIDENCE)].map((m) => m[1]!)
      return cited.length === 0 || cited.some((id) => !opts.evidenceIds.has(id))
    })
  return {
    ok: missingSections.length === 0 && missingConstraints.length === 0 && unsourcedFigures.length === 0,
    missingSections,
    missingConstraints,
    unsourcedFigures,
  }
}

/** Harness fallback after the rewrites: copy constraints from the store verbatim and drop unsourced figures. */
export function repairSummary(
  summary: string,
  opts: { pinned: readonly string[]; evidenceIds: ReadonlySet<string> },
): string {
  const check = validateSummary(summary, opts)
  const parts = sections(summary)
  const constraints = [
    ...new Set([
      ...(parts.get(CONSTRAINTS) ?? "").split("\n").filter((l) => l.trim() && l.trim() !== "- (không có)"),
      ...opts.pinned.map((p) => `- ${p}`),
    ]),
  ]
  const unsourced = new Set(check.unsourcedFigures)
  const figures = (parts.get(FIGURES) ?? "").split("\n").filter((l) => !unsourced.has(l.trim()))
  parts.set(CONSTRAINTS, constraints.join("\n") || "- (không có)")
  parts.set(FIGURES, figures.join("\n").trim() || "- (không có số liệu có nguồn)")
  return SUMMARY_SECTIONS.map((h) => `## ${h}\n${parts.get(h) ?? "- (không có)"}`).join("\n\n")
}

/**
 * Ask for a summary, validate it, and ask again with the problems listed (at most `maxRewrites` times). If it still
 * fails, the harness repairs it from the store. The result always passes validation and says whether it was repaired.
 */
export async function compactWithValidation(
  write: (feedback: string | undefined) => Promise<string>,
  opts: { pinned: readonly string[]; evidenceIds: ReadonlySet<string>; sourceSeqs: number[]; maxRewrites?: number },
): Promise<SummaryEvent & { attempts: number }> {
  const max = opts.maxRewrites ?? 2
  let feedback: string | undefined
  let summary = ""
  for (let attempt = 1; attempt <= max + 1; attempt++) {
    summary = await write(feedback)
    const check = validateSummary(summary, opts)
    if (check.ok)
      return {
        kind: "context.summary.created",
        summary,
        sourceSeqs: opts.sourceSeqs,
        repaired: false,
        attempts: attempt,
      }
    feedback = [
      check.missingSections.length ? `Thiếu mục: ${check.missingSections.join(", ")}.` : "",
      check.missingConstraints.length
        ? `Chép nguyên văn các ràng buộc: ${check.missingConstraints.map((c) => `"${c}"`).join("; ")}.`
        : "",
      check.unsourcedFigures.length
        ? `Các dòng số liệu thiếu [ev:id] hợp lệ: ${check.unsourcedFigures.join(" | ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
  }
  return {
    kind: "context.summary.created",
    summary: repairSummary(summary, opts),
    sourceSeqs: opts.sourceSeqs,
    repaired: true,
    attempts: max + 1,
  }
}
