import path from "node:path"
import { dataDir } from "./paths"
import { readJson, writeJson } from "./store"

/**
 * Favourite and recently used models (opencode's model.json): `~/.opentrading/model.json`,
 * kept apart from config.json because the TUI writes it on every model switch.
 */

export interface ModelRef {
  provider: string
  model: string
}

export interface ModelPrefs {
  /** Newest first. */
  favorite: ModelRef[]
  /** Newest first, at most MAX_RECENT. */
  recent: ModelRef[]
}

export const MAX_RECENT = 10

export const modelPrefsFile = () => path.join(dataDir(), "model.json")

export const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.model === b.model

const refs = (value: unknown): ModelRef[] =>
  Array.isArray(value)
    ? value.filter((r): r is ModelRef => typeof r?.provider === "string" && typeof r?.model === "string").map((r) => ({ provider: r.provider, model: r.model }))
    : []

export async function loadModelPrefs(): Promise<ModelPrefs> {
  const raw = await readJson<Partial<ModelPrefs>>(modelPrefsFile(), {})
  return { favorite: refs(raw.favorite), recent: refs(raw.recent).slice(0, MAX_RECENT) }
}

export const saveModelPrefs = (prefs: ModelPrefs) => writeJson(modelPrefsFile(), prefs)

/** `ref` becomes the most recent model. */
export function withRecent(prefs: ModelPrefs, ref: ModelRef): ModelPrefs {
  return { ...prefs, recent: [ref, ...prefs.recent.filter((r) => !sameModel(r, ref))].slice(0, MAX_RECENT) }
}

/** Add `ref` to the favourites (first), or take it out. */
export function toggleFavorite(prefs: ModelPrefs, ref: ModelRef): ModelPrefs {
  const on = prefs.favorite.some((r) => sameModel(r, ref))
  return { ...prefs, favorite: on ? prefs.favorite.filter((r) => !sameModel(r, ref)) : [ref, ...prefs.favorite] }
}
