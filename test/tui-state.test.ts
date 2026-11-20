import { afterEach, expect, test } from "bun:test"
import { freshState, resetState, setState, state } from "../src/tui/state"

afterEach(resetState)

test("reset clears nested session/UI fields without mutating shared catalog data", () => {
  const catalog = { groq: { id: "groq", name: "Groq", env: [], npm: "@ai-sdk/groq", models: {} } }
  setState({ catalog, dialog: "config", queue: [{ text: "old" }] as typeof state.queue, streaming: true })
  resetState()
  expect(state.catalog).toEqual({})
  expect(state.dialog).toBeUndefined()
  expect(state.queue).toEqual([])
  expect(state.streaming).toBe(false)
  expect(catalog.groq.name).toBe("Groq")
  const first = freshState()
  const second = freshState()
  expect(first.lines).not.toBe(second.lines)
  expect(first.modelPrefs).not.toBe(second.modelPrefs)
})
