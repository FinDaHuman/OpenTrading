import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { PermissionGate, type AllowRule } from "../src/core/permission"
import { webFetchTool } from "../src/core/tools/web/fetch"
import { ApprovalPrompt } from "../src/tui/approval"

let setup: Awaited<ReturnType<typeof testRender>> | undefined
afterAll(() => setup?.renderer.destroy())

async function frameWith(text: string) {
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes(text); i++) {
    await new Promise((r) => setTimeout(r, 50))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  return frame
}

test("web_fetch on a new domain: the prompt says it reads that domain (not a write), and 'always' is stored for that domain only", async () => {
  const saved: AllowRule[] = []
  const gate = new PermissionGate({ load: async () => [...saved], save: async (rules) => void saved.splice(0, saved.length, ...rules) })
  gate.interactive = true
  const fetchTool = webFetchTool()
  const decision = gate.check(fetchTool, { url: "https://evil.example/report?id=1" }, new AbortController().signal, "web_fetch https://evil.example/report?id=1", "call_1")
  await new Promise((r) => setTimeout(r, 10))
  const request = gate.head()!
  expect(request.scope).toBe("domain:evil.example")

  setup = await testRender(() => <ApprovalPrompt gate={gate} request={request} />, { width: 100, height: 30 })
  const frame = await frameWith("Cho phép chạy?")
  expect(frame).toContain("đọc trang từ domain mới: evil.example")
  expect(frame).not.toContain("tool ghi")
  expect(frame).toContain("lưu vào cấu hình, cho domain này")
  await new Promise((r) => setTimeout(r, 450)) // the answer guard
  setup.mockInput.pressKey("3")
  expect(await decision).toEqual({ allow: true })
  expect(saved).toEqual([{ tool: "web_fetch", scope: "native#domain:evil.example" }])

  // Same domain next time: no prompt. Another unknown domain: asks again.
  const again = new PermissionGate({ load: async () => [...saved], save: async () => {} })
  expect((await again.check(fetchTool, { url: "https://evil.example/other" }, new AbortController().signal)).allow).toBe(true)
  expect((await again.check(fetchTool, { url: "https://unknown.example/" }, new AbortController().signal)).reason).toBe("headless")
})
