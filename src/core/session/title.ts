import { generateText } from "ai"
import { resolveTarget, type Target } from "../chat"
import { promptFile } from "../prompt/assemble"
import { languageModel } from "../providers"
import { webTarget } from "../tools/web/side-model"

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
      // Room for a thinking model's reasoning before the few words of the title
      // (Gemini 2.5/3 count thoughts as output; 30 tokens came back empty).
      maxOutputTokens: 256,
      // A side request: a failure keeps the fallback title, never spends more quota.
      maxRetries: 0,
    })
    return cleanTitle(result.text) || undefined
  } catch {
    return undefined
  }
}

/**
 * Generate a title with the side model (`webModel`, the cheap one the user picked for side
 * calls; Claude Code uses Haiku, opencode its small_model), else the session's; never throws.
 */
export async function generateTitle(firstText: string): Promise<string | undefined> {
  try {
    const target = (await webTarget()) ?? (await resolveTarget())
    return await generateTitleText(target, firstText)
  } catch {
    return undefined
  }
}
