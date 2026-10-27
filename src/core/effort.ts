import { sdkOf } from "./providers"
import type { CatalogProvider } from "./catalog"

/**
 * Reasoning effort, named as Claude Code names it. Each provider spells it its own way
 * (Gemini thinkingLevel/thinkingBudget, Anthropic effort, OpenAI and Groq reasoningEffort);
 * effortOptions() translates. A level a model lacks steps down to the highest one it has
 * (Claude Code: "xhigh runs as high on Opus 4.6"; codex validates against the model's levels).
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const
export type Effort = (typeof EFFORT_LEVELS)[number]

export const isEffort = (value: unknown): value is Effort => typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value)

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }
type JsonObject = { [key: string]: Json | undefined }
type ProviderOptions = Record<string, JsonObject>
type EffortTarget = { provider: CatalogProvider; model: string }

const ALL: Effort[] = [...EFFORT_LEVELS]
const UP_TO_HIGH: Effort[] = ["low", "medium", "high"]

/** Gemini 2.5 thinking budgets (tokens) per level; Pro allows up to 32k, Flash up to 24k. */
const GEMINI_BUDGET: Record<Effort, number> = { low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768 }

interface Scheme {
  levels: Effort[]
  options: (level: Effort) => ProviderOptions
  /** What the provider receives for `level`, for the effort step of /model. */
  detail: (level: Effort) => string
}

/** How a model takes effort, or undefined when it has no knob (or is not a reasoning model). */
function schemeFor(target: EffortTarget): Scheme | undefined {
  const info = target.provider.models[target.model]
  if (info?.reasoning === false) return undefined
  const { npm, baseURL } = sdkOf(target.provider, target.model)
  const id = target.model.toLowerCase()
  if (npm === "@ai-sdk/google") {
    if (/gemini-3/.test(id)) {
      // Gemini 3 Pro takes low/high; Flash and Flash-Lite also take medium.
      const levels: Effort[] = /pro/.test(id) ? ["low", "high"] : UP_TO_HIGH
      return { levels, options: (level) => ({ google: { thinkingConfig: { thinkingLevel: level } } }), detail: (level) => `thinkingLevel ${level}` }
    }
    if (/gemini-2\.5/.test(id)) {
      const levels: Effort[] = /pro/.test(id) ? ALL : ["low", "medium", "high", "xhigh"]
      return {
        levels,
        options: (level) => ({ google: { thinkingConfig: { thinkingBudget: GEMINI_BUDGET[level] } } }),
        detail: (level) => `thinkingBudget ${GEMINI_BUDGET[level]}`,
      }
    }
    return undefined
  }
  if (npm === "@ai-sdk/anthropic") {
    // Above high only where thinking is always on: harness requests never turn thinking on,
    // and Claude Code sends high instead to models (Opus 5) that reject the combination.
    if (/claude-(opus-5-5|sonnet-5-5|haiku-5-5|fable)/.test(id)) return anthropic(ALL)
    if (/claude-(opus-4-[5-8]|sonnet-4-6|opus-5|sonnet-5)/.test(id)) return anthropic(UP_TO_HIGH)
    return undefined
  }
  // The official OpenAI endpoint only: a third party behind @ai-sdk/openai may reject the field.
  if (npm === "@ai-sdk/openai" && !baseURL) {
    if (/^gpt-5\.([2-9]|\d{2,})|^gpt-([6-9]|\d{2,})/.test(id)) return openai(["low", "medium", "high", "xhigh"])
    if (/^(gpt-5|o\d)/.test(id)) return openai(UP_TO_HIGH)
    return undefined
  }
  if (npm === "@ai-sdk/groq" && /gpt-oss/.test(id)) {
    return { levels: UP_TO_HIGH, options: (level) => ({ groq: { reasoningEffort: level } }), detail: (level) => `reasoningEffort ${level}` }
  }
  return undefined
}

const anthropic = (levels: Effort[]): Scheme => ({ levels, options: (level) => ({ anthropic: { effort: level } }), detail: (level) => `effort ${level}` })
const openai = (levels: Effort[]): Scheme => ({ levels, options: (level) => ({ openai: { reasoningEffort: level } }), detail: (level) => `reasoningEffort ${level}` })

/** Levels the model accepts, lowest first; empty when it has no effort knob. */
export function supportedEfforts(target: EffortTarget): Effort[] {
  return schemeFor(target)?.levels ?? []
}

/** The provider's own setting for `level` ("thinkingLevel high", "thinkingBudget 8192"…). */
export function effortDetail(target: EffortTarget, level: Effort): string | undefined {
  const scheme = schemeFor(target)
  return scheme?.levels.includes(level) ? scheme.detail(level) : undefined
}

/** The level actually sent: the highest supported one at or below `wanted` (else the lowest). */
export function effectiveEffort(target: EffortTarget, wanted: Effort | undefined): Effort | undefined {
  if (!wanted) return undefined
  const levels = schemeFor(target)?.levels
  if (!levels?.length) return undefined
  const rank = EFFORT_LEVELS.indexOf(wanted)
  return levels.filter((l) => EFFORT_LEVELS.indexOf(l) <= rank).at(-1) ?? levels[0]
}

/** Provider options for `wanted`, or undefined (no level asked, or the model has no knob). */
export function effortOptions(target: EffortTarget, wanted: Effort | undefined): ProviderOptions | undefined {
  const level = effectiveEffort(target, wanted)
  return level ? schemeFor(target)!.options(level) : undefined
}

/** Claude Code's effort glyphs (○ ◐ ● ◉), shown next to the level. */
export const EFFORT_SYMBOL: Record<Effort, string> = { low: "○", medium: "◐", high: "●", xhigh: "◉", max: "◉" }

/**
 * One step through `choices` (undefined = the provider's default, "auto"), wrapping around:
 * ←/→ in /effort, ctrl+t in the prompt. A value not in `choices` moves to its neighbour.
 */
export function stepEffort(current: Effort | undefined, choices: (Effort | undefined)[], dir: 1 | -1): Effort | undefined {
  if (choices.length === 0) return current
  let at = choices.indexOf(current)
  if (at < 0) {
    // A level the model lacks: start from where it would sit among the choices.
    const rank = current ? EFFORT_LEVELS.indexOf(current) : -1
    at = choices.findLastIndex((c) => (c ? EFFORT_LEVELS.indexOf(c) : -1) <= rank)
    if (dir < 0) at += 1
  }
  return choices[(at + dir + choices.length) % choices.length]
}

/** Deep-merges provider options (two levels: provider, then its keys; thinkingConfig merged too). */
export function mergeProviderOptions(...parts: (ProviderOptions | undefined)[]): ProviderOptions | undefined {
  let out: ProviderOptions | undefined
  for (const part of parts) {
    if (!part) continue
    out ??= {}
    for (const [provider, opts] of Object.entries(part)) {
      const prev = out[provider] ?? {}
      const merged: JsonObject = { ...prev, ...opts }
      for (const [key, value] of Object.entries(opts)) {
        const before = prev[key]
        if (isPlain(before) && isPlain(value)) merged[key] = { ...before, ...value }
      }
      out[provider] = merged
    }
  }
  return out
}

const isPlain = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v)

/** Settings that keep a thinking model from spending the whole budget before answering. */
export function lowThinking(target: EffortTarget): Record<string, Record<string, unknown>> | undefined {
  const { npm } = sdkOf(target.provider, target.model)
  const id = target.model.toLowerCase()
  if (npm === "@ai-sdk/google") {
    if (/gemini-2\.5-pro/.test(id)) return { google: { thinkingConfig: { thinkingBudget: 128, includeThoughts: false } } }
    if (/gemini-2\.5/.test(id)) return { google: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } }
    if (/gemini-3/.test(id)) return { google: { thinkingConfig: { thinkingLevel: "low", includeThoughts: false } } }
    return undefined
  }
  if (npm === "@ai-sdk/openai" && /^(gpt-5|o\d)/.test(id)) return { openai: { reasoningEffort: "low" } }
  if (npm === "@ai-sdk/groq" && /gpt-oss/.test(id)) return { groq: { reasoningEffort: "low" } }
  return undefined
}
