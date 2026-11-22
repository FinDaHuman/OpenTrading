import { beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// /config, /effort and the effort step of /model.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, runtime, memory, CATALOG, state, setState, unwrap, loadConfig, saveConfig, show, connect } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("/config turns memory on and off without a restart", async () => {
  expect(runtime.memory.id).toBe("none")
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Memory"))
  // Memory has two choices (off, the notebook): enter opens them, type to pick.
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Sổ ghi nhớ"))
  await setup.mockInput.typeText("so ghi")
  await setup.waitForFrame((f) => !f.includes("không dùng memory"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => runtime.memory.id === "notebook")
  expect(runtime.registry.get("memory_read")).toBeDefined()
  expect(runtime.registry.get("propose_memory")).toBeUndefined()
  expect((await Bun.file(path.join(home, "config.json")).json()).memory).toEqual({ provider: "notebook" })
  await setup.waitForFrame((f) => f.includes("Cài đặt"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cho phép thẻ gợi ý"))
  await setup.mockInput.typeText("tat")
  await setup.waitForFrame((f) => !f.includes("ràng buộc, luận điểm, bài học"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => runtime.memory.id === "none")
  expect(runtime.registry.get("memory_read")).toBeUndefined()
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config turns the effort step of /model off and on", async () => {
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Hỏi effort khi chọn model"))
  await setup.mockInput.typeText("hoi effort")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => !state.askEffort)
  expect((await Bun.file(path.join(home, "config.json")).json()).ui?.askEffort).toBe(false)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.askEffort)
  expect((await Bun.file(path.join(home, "config.json")).json()).ui?.askEffort).toBe(true)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config suggests a faster web model only after a slow call for the selected model", async () => {
  const { measureWebModelCall } = await import("../src/core/tools/web/side-model")
  const provider = state.catalog[state.provider!]
  const model = state.model!
  let now = 0
  await measureWebModelCall({ provider: provider!, model }, async () => { now += 31_000 }, () => now)
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  await setup.mockInput.typeText("model cho tim kiem")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("gõ tên model"))
  await setup.waitForFrame((frame) => frame.includes("Lần gọi web gần nhất mất 31 giây"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await measureWebModelCall({ provider: provider!, model }, async () => { now += 30_000 }, () => now)
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  await setup.mockInput.typeText("model cho tim kiem")
  setup.mockInput.pressEnter()
  const fastFrame = await setup.waitForFrame((frame) => frame.includes("gõ tên model"))
  expect(fastFrame).not.toContain("Lần gọi web gần nhất")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await measureWebModelCall({ provider: provider!, model }, async () => { now += 31_000 }, () => now)
  setState("model", "another-model")
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  await setup.mockInput.typeText("model cho tim kiem")
  setup.mockInput.pressEnter()
  const otherFrame = await setup.waitForFrame((frame) => frame.includes("gõ tên model"))
  expect(otherFrame).not.toContain("Lần gọi web gần nhất")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes("Cài đặt"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  setState("model", model)
})

test("/config: the auto-compaction threshold is a preset % and an optional token cap, applied live", async () => {
  const configJson = async () => Bun.file(path.join(home, "config.json")).json()
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Ngưỡng tự nén") && f.includes("hết cửa sổ của model"))
  show(frame)
  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("95% (mặc định)") && f.includes("Trần theo token…"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · hết cửa sổ của model"))
  expect(state.compactPercent).toBe(90)
  expect((await configJson()).autoCompactPercent).toBe(90)

  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Trần theo token…"))
  await setup.mockInput.typeText("tran theo")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Trần cửa sổ context") && f.includes("250K token"))
  await setup.mockInput.typeText("1000")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Nhập số token từ 20.000 trở lên"))
  for (let i = 0; i < 4; i++) setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("200.000")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · trần 200k token"))
  expect(state.compactCap).toBe(200_000)
  expect((await configJson()).compactWindow).toBe(200_000)

  // "Bỏ trần token" appears once a cap is set and goes back to the model's whole window.
  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Bỏ trần token"))
  await setup.mockInput.typeText("bo tran")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · hết cửa sổ của model"))
  expect(state.compactCap).toBeUndefined()
  expect((await configJson()).compactWindow).toBeUndefined()
  await saveConfig({ autoCompactPercent: undefined })
  setState("compactPercent", 95)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config: subagent limit is a number ≥ 1 applied live; subagent model lists tool-capable models and can go back to the session's", async () => {
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Subagent chạy song song") && f.includes("Model cho subagent"))
  show(frame)
  expect(frame).toContain("10 cùng lúc")
  await setup.mockInput.typeText("song song")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Số subagent chạy cùng lúc"))
  await setup.mockInput.typeText("0")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Nhập một số nguyên từ 1 trở lên."))
  setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("3")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("3 cùng lúc"))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents).toEqual({ maxConcurrent: 3 })
  expect(runtime.subagents.limiter.stats().max).toBe(3)

  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)") && f.includes("Tự động (chọn model lite rẻ)"))
  show(frame)
  // Row 2 is "auto": the harness picks a lite model per run.
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  // Wait for the list to show the choice, then read the file once (reading while it is
  // being replaced is what Windows refuses).
  await setup.waitForFrame((f) => f.includes("Cài đặt") && /Model cho subagent\s+Tự động/.test(f))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents).toEqual({ maxConcurrent: 3, model: "auto" })
  // Row 3 onward are the tool-capable models of connected providers (groq, connected by the
  // /connect test above); picking one replaces "auto".
  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)") && f.includes("● Tự động"))
  show(frame)
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Model cho subagent") && !f.includes("Theo model của phiên · enter") && !/Model cho subagent\s+Tự động/.test(f))
  const saved = (await Bun.file(path.join(home, "config.json")).json()).subagents
  expect(saved.maxConcurrent).toBe(3)
  expect(saved.model).not.toBe("auto")
  expect(state.catalog[saved.provider]?.models[saved.model]).toBeDefined()
  expect(state.catalog[saved.provider]?.models[saved.model]?.tool_call).not.toBe(false)
  await setup.waitForFrame((f) => f.includes("Cài đặt"))
  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)"))
  setup.mockInput.pressEnter()
  // Back on the settings list (the sub-view closes after saving) before Esc closes the dialog.
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Theo model của phiên · enter"))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents?.model).toBeUndefined()
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await saveConfig({ subagents: undefined })
  runtime.subagents.setMax(10)
})

test("/effort: ←→ set each row and save at once; /effort <level>; ctrl+t steps through what the model takes", async () => {
  // The app's startup (catalog, config) must not overwrite what this test sets.
  await setup.waitFor(() => Object.keys(state.catalog).length > 0)
  const saved = { provider: state.provider, model: state.model }
  const groq = state.catalog.groq ? structuredClone(unwrap(state.catalog.groq)) : undefined
  // A model with an effort knob (gpt-oss on Groq takes low/medium/high).
  const gptOss = { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", reasoning: true, tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 } }
  setState("catalog", "groq", { ...(groq ?? CATALOG.groq), models: { ...(groq ?? CATALOG.groq).models, "openai/gpt-oss-120b": gptOss } } as never)
  setState({ provider: "groq", model: "openai/gpt-oss-120b", effort: undefined })
  await saveConfig({ effort: undefined, subagents: {}, desk: {} })
  try {
    await setup.mockInput.typeText("/effort")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Effort · Groq · openai/gpt-oss-120b") && f.includes("Quy mô ultradesk"))
    show(frame)
    expect(frame).toMatch(/❯ Phiên chính\s+◂ auto ▸\s+model nhận: low · medium · high/)
    setup.mockInput.pressArrow("right")
    await setup.waitFor(() => state.effort === "low")
    // Down to Ultradesk: ← from "như subagent" wraps to max.
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("left")
    await setup.waitFor(async () => (await loadConfig()).desk?.effort === "max")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("right")
    await setup.waitFor(async () => (await loadConfig()).desk?.size === "medium")
    frame = await setup.waitForFrame((f) => /Ultradesk\s+◂ ◉ max ▸/.test(f) && /Quy mô ultradesk\s+◂ medium ▸/.test(f))
    show(frame)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
    expect((await loadConfig()).effort).toBe("low")
    // The status bar shows the level the model gets.
    await setup.waitForFrame((f) => /gpt-oss-120b ○ low/.test(f))

    // /effort xhigh: saved as asked, sent as high (the model's top level).
    await setup.mockInput.typeText("/effort xhigh")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.effort === "xhigh")
    frame = await setup.waitForFrame((f) => /gpt-oss-120b ● high/.test(f))
    expect(state.notification?.text).toContain("xhigh chạy như high")
    await setup.mockInput.typeText("/effort ultra")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.notification?.level === "error")
    expect(state.effort).toBe("xhigh")

    // ctrl+t: xhigh → (past high) auto → low.
    setup.mockInput.pressKey("t", { ctrl: true })
    await setup.waitFor(() => state.effort === undefined)
    setup.mockInput.pressKey("t", { ctrl: true })
    await setup.waitFor(() => state.effort === "low")
    expect((await loadConfig()).effort).toBe("low")

    // A model without a knob: ctrl+t says so and changes nothing.
    setState({ model: "test-model" })
    setup.mockInput.pressKey("t", { ctrl: true })
    await setup.waitFor(() => state.notification?.text.includes("không có mức effort") === true)
    expect(state.effort).toBe("low")
  } finally {
    await saveConfig({ effort: undefined, subagents: {}, desk: {} })
    setState({ ...saved, effort: undefined })
    setState("catalog", "groq", groq as never)
  }
})

test("/model → a model with effort levels → the effort step; esc goes back, enter saves both", async () => {
  await setup.waitFor(() => Object.keys(state.catalog).length > 0)
  const saved = { provider: state.provider, model: state.model }
  const prefs = structuredClone(unwrap(state.modelPrefs))
  const groq = state.catalog.groq ? structuredClone(unwrap(state.catalog.groq)) : undefined
  const gptOss = { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", reasoning: true, tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 } }
  setState("catalog", "groq", { ...(groq ?? CATALOG.groq), models: { ...(groq ?? CATALOG.groq).models, "openai/gpt-oss-120b": gptOss } } as never)
  setState({ effort: undefined })
  await saveConfig({ effort: undefined })
  try {
    await setup.mockInput.typeText("/model")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Chọn model"))
    await setup.mockInput.typeText("gpt-oss")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Effort cho openai/gpt-oss-120b"))
    show(frame)
    expect(frame).toMatch(/❯\s+auto\s+đang dùng/)
    expect(frame).toMatch(/◐ medium\s+reasoningEffort medium/)
    setup.mockInput.pressEscape()
    frame = await setup.waitForFrame((f) => f.includes("Chọn model") && f.includes("› gpt-oss"))
    expect(state.model).toBe(saved.model)
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Effort cho openai/gpt-oss-120b"))
    setup.mockInput.pressArrow("up") // auto → high (wraps)
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.dialog === undefined)
    expect({ provider: state.provider, model: state.model, effort: state.effort }).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", effort: "high" })
    const config = await loadConfig()
    expect({ provider: config.provider, model: config.model, effort: config.effort }).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", effort: "high" })
    await setup.waitForFrame((f) => /gpt-oss-120b ● high/.test(f))
  } finally {
    await saveConfig({ ...saved, effort: undefined } as never)
    setState({ ...saved, effort: undefined, modelPrefs: prefs })
    setState("catalog", "groq", groq as never)
  }
})
