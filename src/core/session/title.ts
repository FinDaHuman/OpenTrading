import { generateText } from "ai"
import { resolveTarget, type Target } from "../chat"
import { promptFile } from "../prompt/assemble"
import { languageModel } from "../providers"

/**
 * Session title generator (Claude Code pattern): one small request after the
 * first turn, noun-phrase title, injection-proof (instructions inside the
 * conversation are described, never obeyed). Failures keep the 60-char
 * fallback title from the session store.
 */
export function titlePrompt(): string {
  return (
    promptFile("title") ??
    "Đặt tiêu đề ngắn cho cuộc hội thoại dưới đây. Chỉ trả về một dòng, không giải thích."
  )
}

/** Strip quotes/punctuation/whitespace to a ≤50-char title line. */
export function cleanTitle(text: string): string {
  return text
    .replace(/["'“”‘’.!?…\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
}

export async function generateTitleText(target: Target, firstText: string): Promise<string | undefined> {
  const input = firstText.replace(/\s+/g, " ").trim().slice(0, 500)
  if (!input) return undefined
  try {
    const result = await generateText({
      model: languageModel(target.provider, target.model, target.apiKey),
      system: titlePrompt(),
      messages: [{ role: "user", content: input }],
      maxOutputTokens: 30,
      maxRetries: 0,
    })
    return cleanTitle(result.text) || undefined
  } catch {
    return undefined
  }
}

/** Resolve the session target and generate a title; never throws. */
export async function generateTitle(firstText: string): Promise<string | undefined> {
  try {
    return await generateTitleText(await resolveTarget(), firstText)
  } catch {
    return undefined
  }
}
