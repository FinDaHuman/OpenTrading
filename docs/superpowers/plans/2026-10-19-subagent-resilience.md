# Cứu subagent khỏi "watchdog im lặng" + chuyển subagent sang Gemini Lite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subagent không còn bị giết oan khi model đang suy luận hoặc provider treo; kết quả tool đã chạy được giữ lại khi lượt bị dừng; thêm `subagents.model: "auto"` tự chọn model lite cho subagent (model chính vẫn do người dùng chọn); có số liệu MCP chống lưng.

**Architecture:** Ba sửa đổi trong lõi agent (`src/core/agent.ts`, `src/core/subagents/manager.ts`) + một tham số cấu hình mới (`subagents.idleMs`). `reasoning-delta` trở thành event tiến triển; một bộ đếm "không có part nào trong N giây" báo lỗi rõ thay vì treo; đường abort/failure dựng lại history từ các tool call/result đã hoàn thành và vá bằng `closeDanglingToolCalls` sẵn có.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK 7 (`streamText`), SolidJS TUI (không đổi), MCP HTTP từ xa.

**Spec (bối cảnh điều tra 19/10/2026 — các quyết định dưới đây dựa vào đây):**
- Sự cố thật: phiên `20261019-035309-p4zy`, 4/5 subagent bị dừng với "Subagent không có tiến triển trong 5 phút"; sidechain mất sạch 6–21 tool call đã chạy; 3 lần tương tự trong phiên 18/10. Nguyên nhân: `relay()` tại `src/core/agent.ts:322` nuốt `reasoning-delta` (không yield event) nên watchdog 5 phút của manager coi model đang suy luận/stall là đã chết; abort làm history chỉ giữ plain text (`agent.ts:851-866`).
- `z-ai/glm-5.3-flash` và cả `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` đều `reasoning=True` (cache models.dev) → cùng cần fix #1.
- Gemini Lite (đo 19/10/2026 trên key của user): `gemini-3.5-flash-lite` sống, 1 request 8 token = 0.72s; quota free theo docs repo: 15 RPM / 250K TPM / 500 RPD (`gemini-2.5-flash-lite` chỉ 20 RPD — không dùng).
- MCP `opentrading-mcp-web.onrender.com` đo 19/10/2026 (server warm): `source_status` p50 0.21s ở mức đồng thời 1–4, 0.58s ở mức 8 (p95 1.08s, 0 lỗi/16 call); `vn_equity_quote_batch` 3 mã × 4 đồng thời = 1.15s/call; `vn_equity_ohlcv` 0.64s; `financial_ratios` 1.13s. Kết luận: MCP không phải nút cổ chai khi 5 subagent; harness vẫn giữ cap `maxConcurrent: 4` mỗi server (docs/mcp.md khuyến nghị 2–4 cho Render free).

## Global Constraints

- Chuỗi lỗi/UI giữ tiếng Việt, đúng văn phong hiện có ("Subagent", "lượt", "phiên").
- Không thêm dependency. Không đổi hành vi mặc định: `idleMs` mặc định vẫn 5 phút, không có env thì stall = 120s.
- Mọi event mới của `AgentEvent` phải được consumer bỏ qua an toàn (TUI `src/tui/app.tsx:277`, `src/core/chat.ts:82`, manager `src/core/subagents/manager.ts:410` — cả ba đều là switch/if không exhaustive).
- `bun run typecheck` và `bun test` (444 test hiện có) phải xanh sau từng task.
- Test dùng pattern hiện có của `test/subagent.test.ts`: chặn `globalThis.fetch`, giả lập SSE `/chat/completions`, `process.env.OPENTRADING_HOME` tách biệt, `OPENTRADING_RETRY_SCALE=0`.

## Review Focus (input/hoàn cảnh dễ vỡ nhất, kèm test ở task sở hữu)

1. Provider **không phản hồi trước part đầu tiên** (fetch treo) — phải bị bắt bởi stall timer (armed trước `parts.next()` đầu), không chỉ treo giữa stream. → test (i) Task 2.
2. **Abort khi tool-call đã stream nhưng chưa có result** — history gửi ở lượt sau phải hợp lệ với provider (`closeDanglingToolCalls(...).patched === 0`). → test Task 3.
3. **Watchdog vẫn phải giết run im lặng thật** — không được nới thành "không bao giờ giết". → test (iii) Task 1.
4. **reasoning-delta tần suất cao** (hàng trăm delta nhỏ) không được làm event phình to/làm hỏng UI — `progress` không đổi bất kỳ trạng thái UI nào. → assertion Task 1 (a).
5. **idleMs mặc định 5 phút giữ nguyên** khi không cấu hình — không phá hành vi hiện có. → test (ii)/(iii) Task 1 kiểm tra cả nhánh mặc định không bị đổi (chỉ đổi khi config có `idleMs`).

---

### Task 1: "Suy luận là tiến triển" — progress event + `subagents.idleMs`

**Files:**
- Modify: `src/core/events.ts` (thêm variant `progress`)
- Modify: `src/core/agent.ts:322-324` (relay yield progress khi `reasoning-delta`)
- Modify: `src/core/config.ts:29-34` (thêm `subagents.idleMs`)
- Modify: `src/core/subagents/manager.ts:22` (`SUBAGENT_IDLE_MS` giữ nguyên làm default), `:123`, `:343-345`, `:381-389`, `:465`
- Test: `test/subagent.test.ts`

**Interfaces:**
- Consumes: pattern mock fetch sẵn có trong `test/subagent.test.ts` (biến `childBodies`, `childGate`, helper `sse`/`chunk`/`answer`).
- Produces: `AgentEvent` có thêm `{ type: "progress" }`; `Config["subagents"]` có thêm `idleMs?: number`; manager đọc `idleMs` trong `setup` (cùng chỗ đọc `maxConcurrent`).

- [ ] **Step 1: Viết test thất bại** — thêm vào `test/subagent.test.ts`:

```ts
// Test (a): reasoning-delta phát event progress (chạy trực tiếp runAgent với mock chỉ stream reasoning_content).
test("reasoning-delta của model tạo event progress", async () => {
  const { registry } = setup()
  const events = await collect(runAgent({ history: [], input: "chào", skills: [], registry }))
  expect(events.some((e) => e.type === "progress")).toBe(true)
})

// Test (b): run đang suy luận (reasoning chảy đều) không bị watchdog giết — status completed.
test("watchdog không giết run còn reasoning: idleMs cấu hình được", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { idleMs: 400, maxConcurrent: 5 } })
  // Mock (thêm biến điều khiển mới childSlowReasoning): request của child trả ReadableStream
  // enqueue 1 chunk reasoning_content mỗi 80ms trong ~1.2s rồi mới trả answer "Báo cáo xong."
  childSlowReasoning = true
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  const events = await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(manager.list()[0]).toMatchObject({ status: "completed" })
})

// Test (c): run im lặng thật vẫn bị giết, thông báo nêu thời lượng theo idleMs.
test("watchdog vẫn dừng run im lặng, thông báo theo idleMs", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { idleMs: 400, maxConcurrent: 5 } })
  childGate = new Promise(() => {}) // request của child treo hẳn, không trả gì
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  const view = manager.list()[0]!
  expect(view.status).toBe("stopped")
  expect(view.error).toContain("không có tiến triển trong")
})
```

Cần thêm trong mock fetch: biến `childSlowReasoning = false`; khi bật, nhánh child trả `Response` với `ReadableStream` enqueue dần (helper mới `sseSlow(deltas, gapMs)`: mỗi delta là chunk `{reasoning_content: "..."}` rồi cuối cùng chunk content `childReport` + `[DONE]`). Reset biến trong `beforeEach`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test test/subagent.test.ts -t "reasoning-delta"` → FAIL (không có event `progress`).
Run: `bun test test/subagent.test.ts -t "watchdog"` → (b) FAIL (`status` là `stopped`), (c) FAIL (chưa đọc `idleMs` nên phải chờ 5 phút — nói cách khác test timeout; sau khi sửa sẽ nhanh).

- [ ] **Step 3: Implement**

`src/core/events.ts` — thêm variant (sau dòng `step-usage`):

```ts
/** Model đang chảy phần suy luận (reasoning): không hiển thị, nhưng là tiến triển (watchdog). */
| { type: "progress" }
```

`src/core/agent.ts` relay, case `reasoning-delta` (giữ `outcome.reasoned = true`):

```ts
case "reasoning-delta":
  outcome.reasoned = true
  yield { type: "progress" }
  break
```

`src/core/config.ts` — mở rộng type và comment:

```ts
subagents?: { maxConcurrent?: number; idleMs?: number; provider?: string; model?: string }
```
(comment thêm: "`idleMs`: không có event nào trong bao lâu thì dừng subagent đó; mặc định 300000 (5 phút); suy luận tính là tiến triển.")

`src/core/subagents/manager.ts`:
- Thêm field `private idleMs = SUBAGENT_IDLE_MS` cạnh `private max` (dòng 123).
- Trong `setup` (dòng 343-345), sau dòng đọc `maxConcurrent`: `this.idleMs = config.subagents?.idleMs ?? SUBAGENT_IDLE_MS` (đọc lại mỗi run như `max`).
- Watchdog (dòng 381-389): đổi kỳ hạn tick thành `setInterval(..., Math.min(10_000, this.idleMs))` và điều kiện `Date.now() - last > this.idleMs`.
- Thông báo (dòng 465) đổi thành dùng helper:

```ts
const idleText = (ms: number) =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} phút` : `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} giây`
// ...
if (idleStop) run.error = `Subagent không có tiến triển trong ${idleText(this.idleMs)} nên đã bị dừng.`
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test test/subagent.test.ts` → PASS toàn bộ file.
Run: `bun run typecheck` → sạch (không switch nào cần case `progress`).

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts src/core/agent.ts src/core/config.ts src/core/subagents/manager.ts test/subagent.test.ts
git commit -m "fix(subagents): suy luận (reasoning) tính là tiến triển, idleMs cấu hình được"
```

---

### Task 2: Provider treo thì báo lỗi rõ — stall timeout 120s

**Files:**
- Modify: `src/core/agent.ts` (constant mới cạnh `NUDGE_PROMPT`; `relay` nhận thêm tham số `stall`; hai chỗ gọi `streamText` ở dòng 748 và 799 dùng signal gộp; sau mỗi `yield* relay(...)` kiểm tra cờ stalled)
- Test: `test/subagent.test.ts`

**Interfaces:**
- Consumes: `relay(result, registry, signal, outcome, notices)` hiện có; `AbortSignal.any` (đã dùng ở `manager.ts:328`).
- Produces: `export const LLM_STALL_MS = 120_000`; env test-only `OPENTRADING_STALL_MS` (mirror cách `retry.ts:132` đọc `OPENTRADING_RETRY_SCALE`); lỗi mới hiển thị qua `describeError` với văn bản cố định bên dưới.

- [ ] **Step 1: Viết test thất bại**

```ts
// Test (i): request chưa từng trả part nào (fetch treo) — bị stall timer cắt, không đợi watchdog.
test("request treo trước part đầu bị cắt bằng lỗi stall", async () => {
  process.env.OPENTRADING_STALL_MS = "300"
  try {
    childGate = new Promise(() => {}) // treo hẳn
    const { registry } = setup()
    parentCalls = [spawn("Kỹ thuật HPG")]
    const events = await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
    const [end] = ends(events)
    expect(end!.output).toContain("không gửi dữ liệu")
  } finally {
    delete process.env.OPENTRADING_STALL_MS
  }
})

// Test (i2): part đầu đã tới rồi stream treo — cũng bị cắt.
test("stream treo giữa chừng (sau 1 reasoning chunk) bị cắt bằng lỗi stall", async () => {
  process.env.OPENTRADING_STALL_MS = "300"
  try {
    childDanglingStream = true // helper mới: SSE gửi 1 delta rồi không bao giờ đóng
    const { registry } = setup()
    parentCalls = [spawn("Kỹ thuật HPG")]
    const events = await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
    expect(ends(events)[0]!.output).toContain("không gửi dữ liệu")
  } finally {
    delete process.env.OPENTRADING_STALL_MS
  }
})
```

Helper `childDanglingStream` trong mock: trả `Response` với `ReadableStream` enqueue 1 chunk `{reasoning_content: "..."}` rồi treo (không đóng, không `[DONE]`). Reset trong `beforeEach`. Lưu ý test (i) trước fix sẽ treo tới khi bun test timeout (5s) — đó là trạng thái fail chấp nhận được của TDD ở đây.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test test/subagent.test.ts -t "stall"` → FAIL (timeout / không thấy chuỗi "không gửi dữ liệu").

- [ ] **Step 3: Implement**

`src/core/agent.ts`:

```ts
/** Không có part nào từ model trong bao lâu thì cắt request (provider/mạng treo). */
export const LLM_STALL_MS = 120_000
```

Trong `runAgent`, trước khi tạo `streamText` đầu tiên:

```ts
const stall = new AbortController()
let stalled = false
const stallMs = Number(process.env.OPENTRADING_STALL_MS ?? LLM_STALL_MS)
const abortSignal = AbortSignal.any([opts.signal, stall.signal])   // dùng cho CẢ HAI streamText
```

`streamText` dòng 748 và 799: đổi `abortSignal: opts.signal` → `abortSignal: abortSignal`, và truyền thêm vào cả hai `relay`: `yield* relay(result, opts.registry, opts.signal, outcome, notices, { ms: stallMs, onStall: () => { stalled = true; stall.abort() } })`.

`relay` — tham số thứ 6 tuỳ chọn `stall?: { ms: number; onStall: () => void }`; trước vòng `for (;;)` arm timer và trong mỗi vòng (khi nhận bất kỳ part nào kể cả `reasoning-delta`) reset:

```ts
let timer: ReturnType<typeof setTimeout> | undefined
const rearm = () => {
  if (!stall) return
  clearTimeout(timer)
  timer = setTimeout(stall.onStall, stall.ms)
  timer.unref?.()
}
rearm()
// sau khi nhận 1 part (mọi nhánh của switch): rearm()
// trong finally của try (cuối hàm): clearTimeout(timer)
```

Sau mỗi `yield* relay(...)` trong `runAgent` (cả stream chính lẫn stream nudge), nếu `stalled`:

```ts
if (stalled) {
  outcome.aborted = false
  outcome.failure = new Error(
    `Model không gửi dữ liệu trong ${Math.round(stallMs / 1000)}s (provider hoặc mạng treo); đã dừng lượt để báo lỗi thay vì treo. Gửi lại tin nhắn hoặc đổi model.`,
  )
}
```

(Ghi chú: SDK có thể đã set `outcome.aborted = true` từ part `abort` — dòng override phía trên phải chạy sau relay để phân loại đúng thành lỗi, không phải người dùng bấm Esc.)

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test test/subagent.test.ts -t "stall"` → PASS trong <2s.
Run: `bun run typecheck && bun test test/retry.test.ts test/agent.test.ts` → PASS (không phá hành vi abort của Esc: `opts.signal` vẫn là kênh duy nhất set `aborted`).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts test/subagent.test.ts
git commit -m "fix(agent): stall timeout 120s báo lỗi rõ thay vì treo im lặng"
```

---

### Task 3: Giữ tool call/result đã chạy khi lượt bị dừng

**Files:**
- Modify: `src/core/session/store.ts` — `closeDanglingToolCalls(messages, reason?)` nhận lý do vá (mặc định giữ nguyên chuỗi cũ; dòng 311)
- Modify: `src/core/agent.ts` — `Outcome.progress: ModelMessage[]`; relay gom call/result theo step; nhánh abort/failure (dòng 850-866) ghép history
- Test: `test/subagent.test.ts`, `test/session.test.ts` (một ca cho tham số `reason`)

**Interfaces:**
- Consumes: `closeDanglingToolCalls` từ `src/core/session/store.ts:282` (store không import agent.ts nên không có vòng import).
- Produces: `closeDanglingToolCalls(messages: ModelMessage[], reason?: string)`; không đổi shape `LoadedSession`; `Outcome` thêm `progress` nội bộ.

- [ ] **Step 1: Viết test thất bại**

```ts
// Trong test/subagent.test.ts — con chạy 1 tool xong, rồi request thứ 2 treo; stop giữa chừng.
test("dừng giữa chừng vẫn giữ tool call/result đã hoàn thành trong sidechain", async () => {
  const { registry, manager } = setup()
  const sessionDir = path.join(home, "sessions", "2026", "10", "s-keep")
  manager.attachSession({ id: "s-keep", dir: sessionDir })
  parentCalls = [spawn("Kỹ thuật HPG")]
  childCall = { name: "current_time", args: {} }
  childGate = new Promise(() => {}) // request thứ 2 của con treo (sau khi tool đã xong)
  const running = collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  // chờ con gọi tool xong (tool-end xuất hiện trong childBodies) rồi dừng nó
  for (let i = 0; i < 200 && !childBodies.some((b) => b.messages.some((m) => m.role === "tool")); i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  manager.stop(manager.list()[0]!.id)
  await running
  const log = await readFile(path.join(sessionDir, "subagents", `agent-${manager.list()[0]!.id}.jsonl`), "utf8")
  expect(log).toContain('"tool-result"')          // kết quả tool được giữ
  expect(log).toContain("2026-09-28")              // output của current_time (đồng hồ test)
  const run = manager.get(manager.list()[0]!.id)!
  const { patched } = closeDanglingToolCalls(run.messages)
  expect(patched).toBe(0)                          // history hợp lệ cho lượt sau
})

// Trong test/session.test.ts — reason tuỳ biến cho lỗi vá.
test("closeDanglingToolCalls nhận lý do vá tuỳ biến", () => {
  const messages = [/* assistant có tool-call call_x không có result */]
  const { messages: out } = closeDanglingToolCalls(messages, "Tool bị ngắt vì lượt bị dừng giữa chừng.")
  expect(JSON.stringify(out)).toContain("Tool bị ngắt vì lượt bị dừng giữa chừng.")
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test test/subagent.test.ts -t "giữ tool"` → FAIL (log chỉ có text).
Run: `bun test test/session.test.ts -t "lý do vá"` → FAIL (hàm chưa nhận tham số thứ 2 — lỗi type hoặc chuỗi mặc định).

- [ ] **Step 3: Implement**

`src/core/session/store.ts:282` — chữ ký `closeDanglingToolCalls(messages: ModelMessage[], reason = "Tool bị ngắt vì phiên trước kết thúc giữa chừng.")`, dùng `reason` ở dòng 311.

`src/core/agent.ts`:
- `Outcome` thêm `progress: ModelMessage[]` (khởi tạo `[]` ở cả hai nơi tạo Outcome: dòng 781 và 811).
- Trong `relay`, thêm buffer per-step:

```ts
let stepText = ""
const calls: { toolCallId: string; toolName: string; input: unknown }[] = []
const results: { toolCallId: string; toolName: string; output: unknown; error?: boolean }[] = []
const toOutput = (o: unknown) => (typeof o === "string" ? { type: "text" as const, value: o } : { type: "json" as const, value: o })
const flush = () => {
  if (calls.length === 0 && results.length === 0 && !stepText) return
  const assistant: ModelMessage = {
    role: "assistant",
    content: [...(stepText ? [{ type: "text" as const, text: stepText }] : []), ...calls.map((c) => ({ type: "tool-call" as const, ...c }))],
  }
  const tool: ModelMessage = { role: "tool", content: results.map((r) => ({ type: "tool-result" as const, toolCallId: r.toolCallId, toolName: r.toolName, output: r.error ? { type: "error-text" as const, value: String(r.output) } : toOutput(r.output) })) }
  outcome.progress.push(assistant, ...(results.length > 0 ? [tool] : []))
  stepText = ""; calls.length = 0; results.length = 0
}
```

  Trong switch: `text-delta` thêm `stepText += part.text`; `tool-call` push calls; `tool-result`/`tool-error` push results; `finish-step` gọi `flush()`; sau vòng lặp (mọi nhánh thoát, kể cả abort) gọi `flush()`.
- Nhánh abort/failure (dòng 850-866) ghép lại:

```ts
const kept = closeDanglingToolCalls(outcome.progress, "Tool bị ngắt vì lượt bị dừng giữa chừng.").messages
const text = outcome.text
yield {
  type: "done",
  messages: [user, ...kept, { role: "assistant", content: text || (outcome.aborted ? "(đã dừng)" : "(lỗi)") }],
  // ...phần clock/usage giữ nguyên
}
```

  (import `closeDanglingToolCalls` from `./session/store` — kiểm tra không vòng import: store.ts không import agent.ts.)

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test test/subagent.test.ts test/session.test.ts` → PASS.
Run: `bun run typecheck` → sạch. Ghi chú: các test cũ về abort (nếu có assert "chỉ giữ text") phải cập nhật theo hành vi mới.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts src/core/session/store.ts test/subagent.test.ts test/session.test.ts
git commit -m "fix(agent): giữ tool call/result đã hoàn thành khi lượt bị dừng giữa chừng"
```

---

### Task 4: Ghi lại số liệu + hướng dẫn vận hành (docs)

**Files:**
- Modify: `docs/subagents.md` (bảng "Cho người phát triển" đang ghi "watchdog im lặng 5 phút")
- Modify: `docs/mcp.md` (mục "Số lệnh gọi cùng lúc", dòng ~146)
- Modify: `docs/gemini-limits.md` (mục kinh nghiệm, dòng ~81-104)

**Interfaces:** không (docs-only; không cần test mới, chỉ cần `bun test` vẫn xanh).

- [ ] **Step 1: Sửa `docs/subagents.md`** — cập nhật phần watchdog: mặc định 5 phút, đổi được bằng `subagents.idleMs` trong `~/.opentrading/config.json`; "phần suy luận (reasoning) của model được tính là tiến triển (19/10/2026)"; thêm ví dụ config:

```json
{
  "subagents": { "provider": "google", "model": "gemini-3.5-flash-lite", "maxConcurrent": 3 }
}
```

- [ ] **Step 2: Sửa `docs/mcp.md`** — thêm đoạn "Đo 19/10/2026 (server warm, Render free)": `source_status` p50 0.21s (1–4 đồng thời), 0.58s (8 đồng thời, p95 1.08s, 0/16 lỗi); `vn_equity_quote_batch` 3 mã × 4 đồng thời 1.15s/call; `vn_equity_ohlcv` 0.64s; `financial_ratios` 1.13s; kết luận: MCP không phải nút cổ chai khi 2–5 subagent; giữ `maxConcurrent` 4; lưu ý cold start sau spin-down chưa đo.

- [ ] **Step 3: Sửa `docs/gemini-limits.md`** — thêm vào "Cài đặt nên dùng" (dòng ~104): "Khi chạy 5 subagent: đặt `subagents.maxConcurrent` = 2–3 và dùng `gemini-3.5-flash-lite` (500 RPD); xác nhận 19/10/2026: model sống, `tool_call=True`, `reasoning=True` (reasoning tính là tiến triển nên không bị watchdog giết)."

- [ ] **Step 4: Kiểm tra + commit**

Run: `bun run typecheck && bun test test/subagent.test.ts` → xanh.
```bash
git add docs/subagents.md docs/mcp.md docs/gemini-limits.md
git commit -m "docs: số liệu tải MCP 19/10 và hướng dẫn chạy subagent với Gemini Lite"
```

### Task 5: `subagents.model: "auto"` — tự chọn model lite cho subagent

**Files:**
- Create: `src/core/subagents/model-pick.ts`
- Modify: `src/core/subagents/manager.ts` (`targetFor`, dòng ~518-529 — nhánh auto)
- Modify: `src/core/config.ts` (comment dòng 29-34: `model` có thể là `"auto"`)
- Modify: `src/tui/dialogs/config.tsx` (thêm lựa chọn "Tự động" trong picker model cho subagent)
- Modify: `docs/subagents.md` (mục "Tự chọn model cho subagent (`auto`)")
- Test: `test/model-pick.test.ts` (mới), `test/subagent.test.ts` (2 ca tích hợp)

**Interfaces:**
- Consumes: `loadCatalog()` (`src/core/catalog.ts`), `connectedProviders()` (`src/core/auth.ts`), `chatModels()` + `isSupported()` (`src/core/providers.ts`), `resolveTarget()` và `Target` (`src/core/chat.ts`), `TypeSpec`/`targetFor` (manager).
- Produces: `export const AUTO_MODEL = "auto"`; `export function pickAutoModel(catalog: Catalog, connected: readonly string[], restrictTo?: string): { provider: string; model: string } | undefined` — hàm thuần, xác định; `export async function autoTarget(restrictTo?: string): Promise<Target | undefined>`; `export const LITE_SHORTLIST` — dữ liệu ưu tiên (sửa một chỗ).

**Shortlist v1** (đối chiếu catalog thật của user ngày 19/10/2026; duyệt từ trên xuống, entry đầu tiên khớp thắng):

| # | Provider | Pattern (theo thứ tự) | Khớp thực tế |
|---|---|---|---|
| 1 | `google` | `^gemini-3\.5-flash-lite$`, `^gemini-3\.1-flash-lite$`, `flash-lite$` | gemini-3.5-flash-lite (500 RPD free) |
| 2 | `opencode-go` | `^claude-haiku-5-5$`, `^glm-5\.3-flash$`, `flash$` | claude-haiku-5-5 |
| 3 | `alibaba` | `^qwen3\.7-flash$`, `^qwen-flash$`, `flash$` | qwen3.7-flash |
| 4 | `anthropic` | `haiku` | claude-haiku-* |
| 5 | `openai` | `gpt-.*-mini$` | gpt-*-mini |
| 6 | `groq` | `^llama-3\.1-8b-instant$`, `^qwen/` | llama-3.1-8b-instant (free tier) |
| 7 | `openrouter` | `haiku`, `gemini-3\.5-flash-lite` | anthropic/claude-haiku-5.5 |
| 8 | `nvidia` | `^deepseek-ai/deepseek-v4\.1-flash$`, `flash` | deepseek-v4.1-flash |
| 9 | `ollama-cloud` | `^deepseek-v4-flash$`, `flash` | deepseek-v4-flash |

Chỉ xét model qua `chatModels()` (gọi tool được, không deprecated/alpha) và `limit.context >= 64_000`. `restrictTo` (khi config có `provider`) chỉ xét đúng provider đó. Không khớp gì → `undefined`.

- [ ] **Step 1: Viết test thất bại**

`test/model-pick.test.ts` (mới — dựng catalog giả tối thiểu):

```ts
import { expect, test } from "bun:test"
import { pickAutoModel } from "../src/core/subagents/model-pick"

// catalog giả: helper tạo CatalogProvider/CatalogModel theo type sẵn có (xem src/core/catalog.ts).
test("google kết nối thì chọn gemini-3.5-flash-lite", ...)
test("google không kết nối, groq kết nối thì chọn llama", ...)
test("không có ứng viên nào thì trả undefined", ...)
test("restrictTo chỉ xét đúng provider đó", ...)
test("bỏ qua model không gọi được tool hoặc context < 64k", ...)
```

`test/subagent.test.ts` (tích hợp — mở rộng mock CATALOG đang có ở dòng ~19: thêm model lite cho groq, ví dụ `llama-3.1-8b-instant`):

```ts
test("subagents.model auto: con chạy model lite tự chọn và có notice", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { model: "auto", maxConcurrent: 5 } })
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(childBodies[0]!.model).toBe("llama-3.1-8b-instant")   // hoặc model lite có trong catalog giả
})

test("subagents.model auto: không có model khớp thì fallback về model phiên + notice", async () => {
  // catalog giả không có entry nào khớp shortlist (đổi CATALOG trong test này)
  // kỳ vọng: childBodies[0]!.model === "tooly" và có notice "Không tìm thấy model lite"
})
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test test/model-pick.test.ts` → FAIL (chưa có module).
Run: `bun test test/subagent.test.ts -t "auto"` → FAIL.

- [ ] **Step 3: Implement**

`src/core/subagents/model-pick.ts`:

```ts
export const AUTO_MODEL = "auto"
/** Dữ liệu ưu tiên: [provider, ...regex theo thứ tự]. Sửa một chỗ để đổi chính sách. */
export const LITE_SHORTLIST: [string, ...RegExp[]][] = [ /* bảng shortlist ở trên */ ]
const MIN_CONTEXT = 64_000

export function pickAutoModel(catalog: Catalog, connected: readonly string[], restrictTo?: string) {
  for (const [providerId, ...patterns] of LITE_SHORTLIST) {
    if (restrictTo && providerId !== restrictTo) continue
    if (!connected.includes(providerId)) continue
    const provider = catalog[providerId]
    if (!provider || !isSupported(provider)) continue
    for (const pattern of patterns) {
      const match = chatModels(provider).find((m) => pattern.test(m.id) && (m.limit?.context ?? 0) >= MIN_CONTEXT)
      if (match) return { provider: providerId, model: match.id }
    }
  }
  return undefined
}

export async function autoTarget(restrictTo?: string): Promise<Target | undefined> {
  const [catalog, connected] = await Promise.all([loadCatalog(), connectedProviders()])
  const picked = pickAutoModel(catalog, connected, restrictTo)
  return picked ? resolveTarget(picked) : undefined
}
```

`manager.targetFor` — chèn trước nhánh `chosen` hiện có:

```ts
if (chosen?.model === AUTO_MODEL) {
  const picked = await autoTarget(chosen.provider)
  if (picked) {
    notes.push({ type: "notice", ts: new Date().toISOString(), text: `Subagent tự chọn model: ${picked.provider.name} · ${picked.model} (đổi trong /config).` })
    return picked
  }
  notes.push({ type: "notice", ts: new Date().toISOString(), text: "Không tìm thấy model lite phù hợp cho subagent; dùng model của phiên." })
  return resolveTarget()
}
```

`src/core/config.ts` — comment `subagents`: thêm "`model`: `\"auto\"` = tự chọn model lite từ provider đã kết nối (giữ nguyên: agent type > config > phiên)."

`src/tui/dialogs/config.tsx` — đọc kỹ picker hiện có (dòng 28-99, 158) rồi thêm lựa chọn "Tự động (model lite)" lên đầu danh sách model cho subagent; khi chọn: `saveConfig({ subagents: { ...config().subagents, provider: undefined, model: "auto" } })`; hiển thị giá trị hiện tại là "Tự động (chọn model lite)" khi `subagents?.model === "auto"`.

`docs/subagents.md` — thêm mục ngắn: cách `auto` chọn (bảng shortlist ở trên, xác định từ trên xuống), fallback về model phiên, và `agents/*.md`/pin thủ công vẫn thắng auto.

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test test/model-pick.test.ts test/subagent.test.ts` → PASS.
Run: `bun run typecheck` → sạch.

- [ ] **Step 5: Commit**

```bash
git add src/core/subagents/model-pick.ts src/core/subagents/manager.ts src/core/config.ts src/tui/dialogs/config.tsx docs/subagents.md test/model-pick.test.ts test/subagent.test.ts
git commit -m "feat(subagents): subagents.model=auto tự chọn model lite từ provider đã kết nối"
```

---

## Rollout (việc của người dùng, không nằm trong mã nguồn)

1. Sau khi merge: đặt `~/.opentrading/config.json` (khuyến nghị — auto tự tìm model lite, model chính không đổi):
   ```json
   { "subagents": { "model": "auto", "maxConcurrent": 3 } }
   ```
   Hoặc pin cứng nếu muốn cố định: `{ "subagents": { "provider": "google", "model": "gemini-3.5-flash-lite", "maxConcurrent": 3 } }`.
2. Smoke thật: điều 5 subagent một lượt, `ky-thuat` 1–2 mã; theo dõi `/tasks`, xem sidechain còn giữ tool result khi có agent bị dừng.
3. Nếu vẫn gặp 429 dồn dập → giảm `maxConcurrent` xuống 2 (15 RPM là trần cứng của free tier).

## Self-review notes

- Coverage: cả 3 fix đều có task (1/2/3) + docs (4) + `auto` (Task 5); yêu cầu "kiểm chứng MCP" → số liệu ở Spec + Task 4; "Gemini Lite" → Spec + Rollout; "auto chọn model lite" → Task 5 (bảng shortlist đối chiếu catalog thật 19/10/2026).
- Type consistency: `idleMs` (Task 1) chỉ xuất hiện ở `Config.subagents`, manager; `OPENTRADING_STALL_MS` (Task 2) test-only; `closeDanglingToolCalls(_, reason?)` (Task 3) dùng lại đúng tên ở cả store/agent/test.
- Điểm chưa phủ (chấp nhận): cold start Render chưa đo; provider-side rejection của history dựng tay chỉ chứng minh gián tiếp qua mock — xác nhận thật ở bước Rollout 2.
