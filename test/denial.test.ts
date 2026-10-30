import { expect, test } from "bun:test"
import { z } from "zod"
import type { Target } from "../src/core/chat"
import { AUTO_BLOCK_PREFIX, blockedMessage, deniedMessage, PermissionGate, USER_DENY_PREFIX, userNoteOf } from "../src/core/permission"
import { AutoReviewer } from "../src/core/permission/auto"
import { toolErrorText } from "../src/core/tools/errors"
import type { ToolDef } from "../src/core/tools/types"

const NO_WORKAROUND = "Đừng làm đúng việc này bằng tool hay lệnh khác"
const subagent = { type: "tra-cuu", id: "a1", description: "tra cứu" }

test("a classifier block: summary on line 1, then no-workaround, go on with other work, stop, and how the user allows it", () => {
  const text = blockedMessage("shell", { label: "Git phá huỷ", reason: "Xoá nhánh remote khi người dùng chưa nêu tên nhánh." })
  const [first, ...rest] = text.split("\n\n")
  expect(first).toBe(`${AUTO_BLOCK_PREFIX}shell [Git phá huỷ]: Xoá nhánh remote khi người dùng chưa nêu tên nhánh.`)
  const guidance = rest.join("\n\n")
  expect(guidance).toContain(NO_WORKAROUND)
  expect(guidance).toContain("write_file, edit_file, tool MCP, subagent")
  expect(guidance).toContain("làm tiếp")
  expect(guidance).toContain("DỪNG")
  // The user changes permissions; the model never edits them itself (a hard deny).
  expect(guidance).toContain("người dùng tự làm; bạn đừng tự sửa cấu hình quyền")
  expect(guidance).toContain("/permissions")
  // One final period whatever the classifier wrote; fits the tool-error cap with room to spare.
  expect(blockedMessage("shell", { reason: "Ghi đè file. " }).split("\n")[0]).toBe(`${AUTO_BLOCK_PREFIX}shell: Ghi đè file.`)
  expect(text.length).toBeLessThan(1_500)
})

test("the tool-error cleaner keeps the summary line and the guidance", () => {
  const text = blockedMessage("shell", { label: "Git phá huỷ", reason: "x".repeat(300) })
  expect(toolErrorText(new Error(text))).toBe(text)
})

test("a subagent is told to report the block in its result, not to ask the user", () => {
  const text = deniedMessage({ reason: "classifier", auto: { reason: "Gửi file ra host lạ." } }, { tool: "shell", agent: subagent })
  expect(text).toContain(NO_WORKAROUND)
  expect(text).toContain("ghi rõ trong kết quả")
  expect(text).not.toContain("DỪNG")
})

test("every denial says not to reach the same effect another way; a plain user 'no' still asks the user", () => {
  for (const reason of ["rule", "headless", "blocked", "user"] as const) {
    expect(deniedMessage({ reason }, { tool: "shell" })).toContain(NO_WORKAROUND)
  }
  const no = deniedMessage({ reason: "user" }, { tool: "shell" })
  expect(no.startsWith(USER_DENY_PREFIX)).toBe(true)
  expect(no).toContain("hỏi người dùng muốn làm gì khác")
  expect(no).not.toContain("làm tiếp")
  // The rule text no longer says "do it another way".
  expect(deniedMessage({ reason: "rule" }, { tool: "shell" })).not.toContain("làm cách khác")
  // Cancelled and an unsaved "always" are not refusals of the action.
  expect(deniedMessage({ reason: "cancelled" })).toBe("Lời gọi tool đã bị huỷ.")
  expect(deniedMessage({ reason: "unsaved", message: "EACCES" })).not.toContain(NO_WORKAROUND)
})

test("the user's note is read back without the guidance after it", () => {
  const text = deniedMessage({ reason: "user", message: "dùng repo khác" }, { tool: "shell" })
  expect(userNoteOf(text)).toBe("dùng repo khác")
  expect(userNoteOf(deniedMessage({ reason: "user" }))).toBeUndefined()
})

// ── the gate: a block handed to the user keeps the classifier's reason ─────────

const target: Target = {
  provider: { id: "groq", name: "Groq", npm: "@ai-sdk/groq", env: [], models: { m: { id: "m", name: "m" } } } as unknown as Target["provider"],
  model: "m",
  apiKey: "k",
}
const mcpWrite: ToolDef = { name: "mcp__x__create", description: "", input: z.object({}), readOnly: false, execute: async () => "ok" }
const signal = () => new AbortController().signal
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function autoGate(answers: (string | Error)[]) {
  const call = async () => {
    const next = answers.shift() ?? ""
    if (next instanceof Error) throw next
    return next
  }
  const auto = new AutoReviewer({ target: async () => target, config: async () => undefined, environment: () => [], classifier: { call, retryDelayMs: 0 } })
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.auto = auto
  gate.setMode("auto")
  return gate
}

const BLOCK = ["<block>yes</block>", "<block>yes</block><rule>Data Exfiltration</rule><reason>Gửi ra ngoài.</reason>"]

test("the third block goes to the user; their 'no' tells the model what auto mode said", async () => {
  const gate = autoGate([...BLOCK, ...BLOCK, ...BLOCK])
  gate.interactive = true
  for (const a of [1, 2]) {
    const d = await gate.check(mcpWrite, { a }, signal())
    expect(d).toMatchObject({ allow: false, reason: "classifier", auto: { label: "Gửi dữ liệu ra ngoài", reason: "Gửi ra ngoài." } })
  }
  const pending = gate.check(mcpWrite, { a: 3 }, signal())
  await tick()
  const head = gate.head()!
  expect(head.notice).toContain("bạn quyết định")
  await gate.respond(head.id, "deny")
  const decision = await pending
  expect(decision).toMatchObject({ allow: false, reason: "user", auto: { label: "Gửi dữ liệu ra ngoài" } })
  const text = deniedMessage(decision, { tool: "mcp__x__create" })
  expect(text.split("\n")[0]).toBe(`${USER_DENY_PREFIX} (auto mode đã chặn [Gửi dữ liệu ra ngoài]: Gửi ra ngoài).`)
  expect(text).toContain(NO_WORKAROUND)
})

test("headless: a block handed to the user is a block; a quota hand-off carries no made-up reason", async () => {
  const headless = autoGate([...BLOCK, ...BLOCK, ...BLOCK])
  await headless.check(mcpWrite, { a: 1 }, signal())
  await headless.check(mcpWrite, { a: 2 }, signal())
  const third = await headless.check(mcpWrite, { a: 3 }, signal())
  expect(third).toMatchObject({ reason: "headless", auto: { label: "Gửi dữ liệu ra ngoài" } })
  expect(deniedMessage(third, { tool: "mcp__x__create" }).startsWith(AUTO_BLOCK_PREFIX)).toBe(true)

  const quota = autoGate([Object.assign(new Error("Resource exhausted"), { name: "AI_APICallError", statusCode: 429 })])
  quota.interactive = true
  const pending = quota.check(mcpWrite, {}, signal())
  await tick()
  const head = quota.head()!
  expect(head.notice).toContain("hết quota")
  await quota.respond(head.id, "deny")
  const decision = await pending
  expect(decision.auto).toBeUndefined()
  expect(deniedMessage(decision, { tool: "mcp__x__create" })).not.toContain("auto mode đã chặn")
})
