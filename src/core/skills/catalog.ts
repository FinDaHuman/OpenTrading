import { estimateTokens } from "../prompt/budget"
import { matchToolPattern } from "../tools/patterns"
import type { Skill } from "./schema"

const MAX_ENTRY_CHARS = 250

/** Skills the model may see: every `requires_tools` entry matches some tool (see matchToolPattern). */
export function availableSkills(skills: Skill[], tools: ReadonlySet<string>) {
  return skills.filter((s) => (s.requires_tools ?? []).every((t) => tools.has(t) || matchToolPattern(t, tools).length > 0))
}

function entry(skill: Skill, withDescription: boolean) {
  if (!withDescription) return `- ${skill.name}`
  const text = skill.when_to_use ? `${skill.description} Dùng khi: ${skill.when_to_use}` : skill.description
  const oneLine = text.replace(/\s+/g, " ").trim()
  return `- ${skill.name}: ${oneLine.length > MAX_ENTRY_CHARS ? oneLine.slice(0, MAX_ENTRY_CHARS - 1) + "…" : oneLine}`
}

/**
 * Catalog of model-invocable skills (`activation: auto`) within a token budget.
 * Over budget: shorten descriptions evenly, then fall back to names only.
 */
export function renderCatalog(skills: Skill[], budgetTokens: number): { text: string; truncated: boolean } | undefined {
  const auto = skills.filter((s) => s.activation === "auto")
  if (auto.length === 0 || budgetTokens <= 0) return undefined
  const header =
    "Các skill dưới đây là hướng dẫn phân tích chuyên sâu. Khi câu hỏi khớp với một skill, gọi tool load_skill với tên skill để nạp hướng dẫn rồi làm theo. Không đoán nội dung skill khi chưa nạp."
  const full = [header, ...auto.map((s) => entry(s, true))].join("\n")
  if (estimateTokens(full) <= budgetTokens) return { text: full, truncated: false }

  // Shrink every description to a common length that fits.
  const fixed = estimateTokens(header) + auto.length * 4
  const perEntry = Math.floor(((budgetTokens - fixed) * 4) / auto.length)
  if (perEntry >= 40) {
    const lines = auto.map((s) => {
      const line = entry(s, true)
      return line.length > perEntry ? line.slice(0, perEntry - 1) + "…" : line
    })
    return { text: [header, ...lines].join("\n"), truncated: true }
  }
  return { text: [header, ...auto.map((s) => entry(s, false))].join("\n"), truncated: true }
}

/** Lowercase, strip Vietnamese diacritics (including đ) so "phan bien" matches "phản biện". */
export function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
}

/** Pre-routing layer 1: skills whose trigger keywords appear in the user's message. */
export function matchTriggers(input: string, skills: Skill[]): Skill[] {
  const text = ` ${fold(input).replace(/[^\p{L}\p{N}+]+/gu, " ")} `
  return skills.filter(
    (s) =>
      s.activation !== "manual" &&
      (s.triggers?.keywords ?? []).some((k) => {
        const key = fold(k).replace(/[^\p{L}\p{N}+]+/gu, " ").trim()
        return key.length > 0 && text.includes(` ${key} `)
      }),
  )
}
