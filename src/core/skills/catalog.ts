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

/** Vietnamese function words (folded) that say nothing about which skill fits. */
const STOP_WORDS = new Set(
  "toi ban giup nhe vay khong co la cua va voi the nao gi cho duoc dang nay hay thi mot nhung cac de trong ra sao lai nhu khi neu se da con rat nhieu it hon nhat ve tu den o minh xem lam di oi a u nhi roi luon chi moi cai bao".split(
    " ",
  ),
)
const terms = (text: string) =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
const pairs = (words: string[]) => words.slice(1).map((w, i) => `${words[i]} ${w}`)

/** Soft routing only answers when the best skill scores this much… */
const SOFT_MIN_SCORE = 8
/** …and beats the runner-up by this factor; otherwise the message is ambiguous. */
const SOFT_MARGIN = 1.5

function skillIndex(skills: Skill[]) {
  const docs = skills.map((skill) => {
    // Name, description, when_to_use and keywords only: the body made routing worse in the eval.
    const fields = [skill.name.replace(/-/g, " "), skill.description, skill.when_to_use ?? "", ...(skill.triggers?.keywords ?? [])]
    return { skill, words: new Set(fields.flatMap(terms)), pairs: new Set(fields.flatMap((f) => pairs(terms(f)))) }
  })
  const df = { words: new Map<string, number>(), pairs: new Map<string, number>() }
  for (const d of docs) {
    for (const w of d.words) df.words.set(w, (df.words.get(w) ?? 0) + 1)
    for (const p of d.pairs) df.pairs.set(p, (df.pairs.get(p) ?? 0) + 1)
  }
  const idf = (term: string, kind: "words" | "pairs") => Math.log((docs.length + 1) / ((df[kind].get(term) ?? 0) + 0.5))
  return { docs, idf }
}

/**
 * Pre-routing layer 2: the one skill whose name, description, when_to_use and keywords
 * share the most distinctive words and word pairs with the message (IDF-weighted), when
 * it clearly beats the runner-up. Catches phrasings no keyword lists ("đang ở pha nào",
 * "P/E là gì"); measured in test/routing-eval.test.ts.
 */
export function matchSoft(input: string, skills: Skill[]): Skill | undefined {
  const candidates = skills.filter((s) => s.activation !== "manual")
  if (candidates.length === 0) return undefined
  const index = skillIndex(candidates)
  const words = [...new Set(terms(input))]
  const wordPairs = [...new Set(pairs(terms(input)))]
  const ranked = index.docs
    .map((d) => ({
      skill: d.skill,
      score:
        words.filter((w) => d.words.has(w)).reduce((n, w) => n + index.idf(w, "words"), 0) +
        wordPairs.filter((p) => d.pairs.has(p)).reduce((n, p) => n + index.idf(p, "pairs"), 0),
    }))
    .sort((a, b) => b.score - a.score)
  const [best, next] = ranked
  return best && best.score >= SOFT_MIN_SCORE && best.score >= SOFT_MARGIN * (next?.score ?? 0) ? best.skill : undefined
}

/** Skills to suggest for a message: every keyword hit, plus the soft match when there is one. */
export function suggestSkills(input: string, skills: Skill[]): Skill[] {
  const hits = matchTriggers(input, skills)
  const soft = matchSoft(input, skills)
  return soft && !hits.includes(soft) ? [...hits, soft] : hits
}
