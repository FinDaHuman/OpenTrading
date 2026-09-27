import { createStore } from "solid-js/store"
import type { Catalog } from "../core/catalog"
import type { ProviderId } from "../core/providers"
import type { Skill } from "../core/skills"

export type Line =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; done: boolean }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }

export type DialogName = "connect" | "model" | "skills" | "help"

export const [state, setState] = createStore({
  lines: [] as Line[],
  streaming: false,
  provider: undefined as ProviderId | undefined,
  model: undefined as string | undefined,
  catalog: {} as Catalog,
  /** Providers that have a stored key or env var. */
  connected: [] as ProviderId[],
  /** Pre-filled filter for the next /model dialog (e.g. right after /connect). */
  modelFilter: "",
  skills: [] as Skill[],
  activeSkills: [] as string[],
  dialog: undefined as DialogName | undefined,
})

export function pushLine(line: Line) {
  setState("lines", (lines) => [...lines, line])
}

export const closeDialog = () => setState("dialog", undefined)

export const providerName = (id?: ProviderId) => (id ? (state.catalog[id]?.name ?? id) : "")
