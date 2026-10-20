import { sameModel, type ModelPrefs, type ModelRef } from "../../core/model-prefs"
import { chatModels } from "../../core/providers"
import { state } from "../state"
import { color } from "../theme"
import type { PickerItem } from "./picker"

/**
 * Model lists grouped like opencode's model dialog: ★ Yêu thích, then Gần đây (minus the
 * favourites), then one group per connected provider (the current one first, the rest by
 * name). The two shortcut groups disappear while filtering, so a search lists each model
 * once with its provider beside it.
 */

export const FAVORITES = "★ Yêu thích"
export const RECENT = "Gần đây"

export type ModelChoice = ModelRef & { unavailable?: string }

export function contextLabel(tokens?: number) {
  if (!tokens) return ""
  return tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}k`
}

/** Why a saved model cannot be used now, or undefined when it can. */
export function unavailable(ref: ModelRef): string | undefined {
  if (!state.connected.includes(ref.provider)) return "provider chưa kết nối"
  if (!state.catalog[ref.provider]?.models[ref.model]) return "không còn trong danh mục"
  return undefined
}

const name = (ref: ModelRef) => state.catalog[ref.provider]?.models[ref.model]?.name ?? ref.model
const providerLabel = (id: string) => state.catalog[id]?.name ?? id
const context = (ref: ModelRef) => contextLabel(state.catalog[ref.provider]?.models[ref.model]?.limit?.context)

/** Stable row identity (the same model sits in a shortcut group and in its provider's). */
export const choiceKey = (item: PickerItem<ModelChoice>) => `${item.group ?? ""}|${item.value.provider}/${item.value.model}`

export function modelChoices(opts: { prefs: ModelPrefs; current?: ModelRef; keep?: (ModelRef | undefined)[] }): PickerItem<ModelChoice>[] {
  const { prefs, current } = opts
  const isCurrent = (ref: ModelRef) => current !== undefined && sameModel(ref, current)
  const isFavorite = (ref: ModelRef) => prefs.favorite.some((f) => sameModel(f, ref))

  const shortcut = (ref: ModelRef, group: string): PickerItem<ModelChoice> => {
    const why = unavailable(ref)
    return {
      label: name(ref),
      hint: [providerLabel(ref.provider), context(ref)].filter(Boolean).join(" · "),
      mark: isCurrent(ref) ? "●" : " ",
      right: why ? `[${why}]` : undefined,
      rightColor: color.tx3,
      group,
      shortcut: true,
      value: why ? { ...ref, unavailable: why } : ref,
    }
  }
  const favorites = prefs.favorite.map((ref) => shortcut(ref, FAVORITES))
  const recent = prefs.recent.filter((ref) => !isFavorite(ref) && !unavailable(ref)).map((ref) => shortcut(ref, RECENT))

  const providers = [...state.connected].sort((a, b) => Number(b === current?.provider) - Number(a === current?.provider) || providerLabel(a).localeCompare(providerLabel(b)))
  const byProvider = providers.flatMap((id) => {
    const provider = state.catalog[id]
    if (!provider) return []
    // Chosen, favourite and recent models stay listed whatever the chat filters say.
    const keep = [...(opts.keep ?? []), current, ...prefs.favorite, ...prefs.recent].filter((r): r is ModelRef => r?.provider === id).map((r) => r.model)
    return chatModels(provider, keep).map((m): PickerItem<ModelChoice> => {
      const ref = { provider: id, model: m.id }
      return {
        label: m.name,
        hint: [provider.name, contextLabel(m.limit?.context)].filter(Boolean).join(" · "),
        mark: isCurrent(ref) ? "●" : isFavorite(ref) ? "★" : " ",
        markColor: isCurrent(ref) ? color.tang : color.tham,
        group: provider.name,
        value: ref,
      }
    })
  })
  return [...favorites, ...recent, ...byProvider]
}
