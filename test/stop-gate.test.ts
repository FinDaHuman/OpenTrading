import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { claimsFetch, figureSources, isDraft, isEmptyAnswer, isFragment, judgeStop, MAX_RECOVERIES, RESCUE_ANSWER_NOW, RESCUE_DRAFT, RESCUE_DRAFT_FETCH, ranDataTool, stripEchoes, ungroundedInTurn, unfetchedFigures, type LastStep } from "../src/core/loop/stop-gate"
import { DRAFT } from "./fixtures/draft-answer"

const step = (over: Partial<LastStep>): LastStep => ({ text: "", toolNames: [], finish: "stop", ...over })

test("a real answer is accepted, with or without a todo_write beside it", () => {
  expect(judgeStop(step({ text: "VCB: LNST quý 2 tăng 54%." }), [])).toEqual({ action: "accept" })
  expect(judgeStop(step({ text: "Xong.", toolNames: ["todo_write"] }), [])).toEqual({ action: "accept" })
})

test("an empty answer right after tool results: tools off first, then on, then give up", () => {
  const empty = step({ afterTools: true })
  expect(judgeStop(empty, [])).toMatchObject({ action: "continue", kind: "empty", toolChoice: "none" })
  expect(judgeStop(empty, ["empty"])).toMatchObject({ action: "continue", kind: "empty", toolChoice: "auto" })
  expect(judgeStop(empty, ["empty", "empty"])).toEqual({ action: "give-up", kind: "empty" })
})

test("an empty answer with no tool result before it may still call a tool first", () => {
  expect(judgeStop(step({ reasoned: true }), [])).toMatchObject({ action: "continue", kind: "empty", toolChoice: "auto" })
  expect(judgeStop(step({}), ["empty"])).toMatchObject({ toolChoice: "none" })
})

test("Gemini's malformed call is retried once with tools on; filters give up at once", () => {
  expect(judgeStop(step({ rawFinish: "MALFORMED_FUNCTION_CALL" }), [])).toMatchObject({ action: "continue", kind: "malformed", toolChoice: "auto" })
  expect(judgeStop(step({ rawFinish: "MALFORMED_FUNCTION_CALL" }), ["malformed"])).toEqual({ action: "give-up", kind: "malformed" })
  expect(judgeStop(step({ rawFinish: "UNEXPECTED_TOOL_CALL" }), [])).toMatchObject({ kind: "malformed" })
  expect(judgeStop(step({ rawFinish: "SAFETY" }), [])).toEqual({ action: "give-up", kind: "blocked" })
  expect(judgeStop(step({ rawFinish: "RECITATION", finish: "content-filter" }), [])).toEqual({ action: "give-up", kind: "blocked" })
})

test("a cut answer is continued while the budget lasts, then kept as it is", () => {
  const cut = step({ text: "Phần đầu", finish: "length" })
  expect(judgeStop(cut, [])).toMatchObject({ action: "continue", kind: "length" })
  expect(judgeStop(cut, ["length", "length"])).toEqual({ action: "accept" })
})

test("the budget is shared: never more than MAX_RECOVERIES extra requests", () => {
  const used = Array.from({ length: MAX_RECOVERIES }, () => "length" as const)
  expect(judgeStop(step({}), used)).toEqual({ action: "give-up", kind: "empty" })
})

test("a step still calling data tools is not judged (the step cap ended the run)", () => {
  expect(judgeStop(step({ toolNames: ["mcp__opentrading__vn_quote"] }), [])).toEqual({ action: "accept" })
})

test("stripEchoes drops the echoed status lines and the item list under them", () => {
  expect(stripEchoes("\n*(Đã hoàn thành các việc cần làm)*")).toBe("")
  expect(stripEchoes("Kết luận: tích cực.\n\n*(Đã cập nhật việc cần làm: 1/3 xong)*\n\n")).toBe("Kết luận: tích cực.")
  expect(stripEchoes("Đã cập nhật việc cần làm: 2/3 xong.\n[x] Lấy BCTC\n[>] Phân tích\nVCB tốt.")).toBe("VCB tốt.")
  expect(stripEchoes("_Cập nhật việc cần làm (3/3 xong)_")).toBe("")
})

test("stripEchoes leaves an answer alone when nothing is echoed (checklists included)", () => {
  const answer = "Các bước:\n[x] Lấy dữ liệu xong\n- [ ] Theo dõi Q3\nViệc cần làm tiếp: chờ BCTC."
  expect(stripEchoes(answer)).toBe(answer)
})

test("isEmptyAnswer: invisible characters and HTML comments are no answer", () => {
  expect(isEmptyAnswer("\u200B <!-- x --> \n")).toBe(true)
  expect(isEmptyAnswer("**(Đã hoàn thành tất cả các việc cần làm)**")).toBe(true)
  expect(isEmptyAnswer("Có.")).toBe(false)
})

test("a bare promise to act is sent back once, tools on; offers, questions and real answers are not", async () => {
  const { isPromise } = await import("../src/core/loop/stop-gate")
  for (const text of [
    "Mình sẽ lấy BCTC 4 quý gần nhất của VCB:",
    "Để mình kiểm tra lại giá đóng cửa.",
    "Đang lấy dữ liệu VIX và S&P 500",
    "Snapshot giá không trả về trường chi tiết. Thử các nguồn dữ liệu khác.",
    "Các tool đã nạp, giờ gọi chúng để lấy dữ liệu.",
    "Let me fetch the quarterly report.",
  ])
    expect([text, isPromise(text)]).toEqual([text, true])
  for (const text of [
    "Bạn có muốn mình phân tích sâu hơn về VCB không?",
    "Nếu bạn muốn, mình sẽ lấy thêm dữ liệu dòng tiền khối ngoại.",
    "VCB đóng cửa 57.200đ (-0,5%). Mình sẽ cập nhật khi có BCTC quý 3.",
    "Thử đặt lệnh mua khi giá điều chỉnh về vùng hỗ trợ.",
    "Tiếp tục nghiên cứu thêm ngành ngân hàng.",
    "Thử đặt lệnh mua quanh 55.000đ.",
    "| Mã | Giá |\n|---|---|\n| VCB | 57.200 |\nTiếp theo mình sẽ lấy dữ liệu FPT:",
    "Kết luận: VCB tích cực, rủi ro chính là trích lập dự phòng.",
  ])
    expect([text, isPromise(text)]).toEqual([text, false])
  const promise = step({ text: "Mình sẽ lấy BCTC 4 quý gần nhất của VCB:" })
  expect(judgeStop(promise, [])).toMatchObject({ action: "continue", kind: "promise", toolChoice: "auto" })
  expect(judgeStop(promise, ["promise"])).toEqual({ action: "accept" })
  expect(judgeStop({ ...promise, finish: "length" }, ["length", "length"])).toEqual({ action: "accept" })
})

test("a fragment continuing an old sentence (30/10) is sent back once, only in a turn without tools", () => {
  for (const text of [
    " hay FPT sẽ mang lại góc nhìn rõ hơn về định giá hoặc kỹ thuật nếu bạn quan tâm.",
    " hoặc FPT không, hoặc bạn muốn mình phản biện lại các số liệu này để tìm rủi ro tiềm ẩn?",
    ", bạn có thể phân tích thêm cho mình về nợ xấu, khả năng trích lập dự phòng và câu chuyện thoái vốn.",
    "… và đó là lý do biên lãi giảm.",
  ])
    expect([text, isFragment(text)]).toEqual([text, true])
  for (const text of [
    "VCB đóng cửa 57.200đ (-0,5%).",
    "Đã ghi nhớ anh sống ở Việt Nam.",
    "57.200đ là giá đóng cửa phiên gần nhất.",
    "**VCB** tăng 0,5%.",
    "- VCB: tích cực",
    "Vâng, mình sẽ ghi nhớ.",
    "Bạn muốn phân tích mã nào?",
    "\n\nDưới đây là phân tích.",
    // Lowercase without a leading space is a real (if odd) start: tickers, ids, test data.
    "m0 m1 m2 HẾT",
    "iPhone 17 bán chạy.",
  ])
    expect([text, isFragment(text)]).toEqual([text, false])
  // A long text is an answer of its own, whatever its first letter.
  expect(isFragment(`và ${"x".repeat(400)}`)).toBe(false)
  const fragment = step({ text: " hoặc FPT không?" })
  expect(judgeStop(fragment, [])).toMatchObject({ action: "continue", kind: "fragment", toolChoice: "auto" })
  expect(judgeStop(fragment, ["fragment"])).toEqual({ action: "accept" })
  expect(judgeStop({ ...fragment, toolsInTurn: true }, [])).toEqual({ action: "accept" })
  expect(judgeStop(fragment, ["empty", "empty"])).toEqual({ action: "accept" })
  // The continuation of a cut answer starts mid-sentence on purpose.
  expect(judgeStop(fragment, ["length"])).toEqual({ action: "accept" })
})

/** gemini-3.1-flash-lite's answer of 05/11: no tool in the turn, every figure invented. */
const INVENTED = [
  "Tôi đã lấy dữ liệu tài chính của FPT. Dưới đây là các chỉ số chính và nhận xét theo yêu cầu của bạn.",
  "",
  "Nguồn: `default_api:mcp__opentrading__financial_ratios` · 05/11/2026.",
  "",
  "| Chỉ tiêu | Giá trị |",
  "| --- | --- |",
  "| P/E (số năm hoàn vốn nếu lợi nhuận không đổi) | 19,5 |",
  "| ROE (lợi nhuận trên vốn chủ sở hữu) | 27,2% |",
  "| Doanh thu quý gần nhất (tỷ đồng) | 16.800 |",
].join("\n")

test("the invented answer of 05/11 has three figures nothing backs", () => {
  expect(unfetchedFigures(INVENTED, "Phân tích FPT")).toEqual(["19,5", "27,2%", "16.800"])
})

test("figures no tool fetched are sent back once with tools on, then the answer stands", () => {
  const invented = step({ text: INVENTED, unfetched: 3 })
  expect(judgeStop(invented, [])).toMatchObject({ action: "continue", kind: "unfetched", toolChoice: "auto" })
  // Closing a todo list beside the answer fetched nothing.
  expect(judgeStop({ ...invented, toolNames: ["todo_write"] }, [])).toMatchObject({ kind: "unfetched" })
  // As it really comes: a step with a function call finishes as "tool-calls".
  expect(judgeStop({ ...invented, toolNames: ["todo_write"], finish: "tool-calls" }, [])).toMatchObject({ kind: "unfetched" })
  expect(judgeStop({ ...invented, toolNames: ["todo_write"], finish: "other" }, [])).toEqual({ action: "accept" })
  expect(judgeStop(invented, ["unfetched"])).toEqual({ action: "accept" })
  expect(judgeStop(invented, ["promise", "fragment"])).toEqual({ action: "accept" })
  // The step holds only the rest of a cut answer.
  expect(judgeStop(invented, ["length"])).toEqual({ action: "accept" })
  expect(judgeStop({ ...invented, finish: "length" }, [])).toMatchObject({ kind: "length" })
  expect(judgeStop(step({ text: INVENTED, unfetched: 1 }), [])).toEqual({ action: "accept" })
})

test("what claims fetched data, and what does not", () => {
  for (const text of ["Nguồn: Vietstock · 05/11/2026", "**Nguồn:** Vietstock", "(Nguồn: CafeF)", "Theo mcp__opentrading__vs_trading_info", "Mình vừa tra cứu dữ liệu FPT"]) {
    expect(claimsFetch(text)).toBe(true)
  }
  for (const text of [
    "Nguồn: số liệu bạn cung cấp",
    "Nguồn: người dùng",
    "Nguồn: tự tính từ giá vốn",
    "Ví dụ P/E 12,5 lần",
    "Mình chưa lấy dữ liệu nên không có số.",
    "Nguồn dữ liệu là Vietstock",
  ]) {
    expect(claimsFetch(text)).toBe(false)
  }
})

test("figures the conversation already holds are not counted", () => {
  const cited = "Nguồn: Vietstock · 30/10/2026.\n\nP/E 18,2 lần, ROE 24,1%, giá 128.400đ, vốn hoá 2,5 tỷ đồng."
  expect(unfetchedFigures(cited, "")).toHaveLength(4)
  // The user's words, an earlier answer, or a tool's raw numbers at another unit and precision.
  expect(unfetchedFigures(cited, "P/E 18,2; ROE 24,1%; giá 128.400đ; vốn hoá 2,5 tỷ")).toEqual([])
  expect(unfetchedFigures(cited, JSON.stringify({ pe: 18.2174, roe: 0.241, price: 128.4, cap: 2500000000 }))).toEqual([])
})

test("a follow-up computing on fetched figures is not judged as invented", () => {
  const known = "Giá FPT 100.000đ, giá mục tiêu 125.000đ, EPS 5.000đ."
  const marked = "Nguồn: Vietstock · 30/10/2026.\n\nGiá 100.000đ, mục tiêu 125.000đ.\n- Upside 25,0% (tính từ giá mục tiêu và giá hiện tại).\n- P/E 20,0 lần, tính từ giá và EPS."
  expect(unfetchedFigures(marked, known)).toEqual([])
  // Unmarked, but most of its figures are the ones already fetched.
  const mostly = "Nguồn: Vietstock.\n\nGiá 100.000đ, mục tiêu 125.000đ, EPS 5.000đ, upside 25,0%, P/E 20,0 lần."
  expect(unfetchedFigures(mostly, known)).toEqual([])
})

test("a date, a month or a clock time is not a figure", () => {
  expect(unfetchedFigures("Nguồn: Vietstock · 30/10/2026, quý 3/2026, lúc 14:30.", "")).toEqual([])
})

test("the user's own figures with arithmetic on them never claim a fetch", () => {
  const answer = "Nguồn: số liệu bạn cung cấp.\n\nLãi 5.000.000đ, tức 20%, trên giá vốn 25.000đ."
  expect(unfetchedFigures(answer, "mua 1.000 cp giá 25.000đ, giờ 30.000đ")).toEqual([])
})

test("a list of tools names them but states no figure", () => {
  expect(unfetchedFigures("1. **`mcp__demo__add`**: Cộng hai số.\n2. **`mcp__demo__echo`**: Kiểm tra kết nối.", "")).toEqual([])
})

test("an image or a file in the conversation leaves the figures uncheckable", () => {
  expect(figureSources([{ role: "user", content: "giá FPT" }])).toContain("giá FPT")
  expect(figureSources([{ role: "user", content: [{ type: "file", data: "AAAA", mediaType: "image/png" }] }])).toBeUndefined()
})

test("only a tool other than the todo list counts as fetching", () => {
  const result = (toolName: string) => ({
    role: "tool" as const,
    content: [{ type: "tool-result" as const, toolCallId: "c", toolName, output: { type: "text" as const, value: "ok" } }],
  })
  expect(ranDataTool([result("todo_write")])).toBe(false)
  expect(ranDataTool([result("todo_write"), result("mcp__opentrading__financial_ratios")])).toBe(true)
})

test("a figure in a compact JSON array is known, and 'tính từ đầu năm' is no arithmetic", () => {
  const known = JSON.stringify({ c: [64.27, 64.5, 65.1] })
  expect(unfetchedFigures("Đã lấy dữ liệu: giá 64,27 và 65,1.", known)).toEqual([])
  expect(unfetchedFigures("Đã lấy dữ liệu: tăng 99,9% tính từ đầu năm, 88,8% trong quý.", "")).toEqual(["99,9%", "88,8%"])
})

test("'nghìn tỷ' and '…T' figures trace at the rounding they were written with", () => {
  // The scorer learned this in #251; the gate read them with a ±0.05 tỷ tolerance and sent back
  // correct answers whose source holds the exact dong.
  const answer = "Nguồn: Vietstock.\n\nDoanh thu 95,8 nghìn tỷ, LNST 2,49T."
  const known = JSON.stringify({ revenue: 95812345678901, profit: 2493000000000 })
  expect(unfetchedFigures(answer, known)).toEqual([])
  expect(unfetchedFigures(answer, "")).toEqual(["95,8 nghìn tỷ", "2,49T"])
})

test("a fall written in words matches a negative source", () => {
  expect(unfetchedFigures("Đã lấy dữ liệu: giá giảm 3,2%, khối lượng giảm 12,5%.", JSON.stringify({ change: -0.032, volume: -0.125 }))).toEqual([])
})

test("a figure written twice counts once", () => {
  expect(unfetchedFigures("Đã lấy dữ liệu: P/E 19,5; nhắc lại P/E 19,5 và ROE 27,2%.", "")).toEqual(["19,5", "27,2%"])
})

const toolTurn = (answer: string, output: string): ModelMessage[] => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "q", input: {} }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "q", output: { type: "text", value: output } }] },
  { role: "assistant", content: answer },
]

test("a tool turn reports the figure next to the real ones, however few", () => {
  const user: ModelMessage = { role: "user", content: "Giá FPT?" }
  const turn = toolTurn("Giá 64,27 đ, 64,5 đ, 65,1 đ, P/E 12,3 lần.", '[ref r1] {"c":[64.27,64.5,65.1]}')
  expect(ungroundedInTurn([user], turn)).toEqual(["12,3 lần"])
})

test("a figure from an earlier turn or from the profile is grounded", () => {
  const earlier: ModelMessage[] = [{ role: "user", content: "x" }, { role: "assistant", content: "P/E 12,3 lần" }]
  expect(ungroundedInTurn(earlier, toolTurn("P/E 12,3 lần, mục tiêu 15,5%.", "{}"), "mục tiêu lợi nhuận 15,5%")).toEqual([])
})

test("no tool in the turn, or an image: nothing to judge", () => {
  const user: ModelMessage = { role: "user", content: "x" }
  expect(ungroundedInTurn([user], [{ role: "assistant", content: "P/E 12,3 lần" }])).toBeUndefined()
  const image: ModelMessage = { role: "user", content: [{ type: "image", image: "data:x" }] }
  expect(ungroundedInTurn([image], toolTurn("12,3 lần", "{}"))).toBeUndefined()
})

test("an ablated rule never sends the model back, and the rules after it still run", () => {
  const promise = { text: "Để tôi tra cứu giá FPT:", toolNames: [], finish: "stop" as const }
  expect(judgeStop(promise, [])).toMatchObject({ action: "continue", kind: "promise" })
  expect(judgeStop(promise, [], new Set(["gate-promise"]))).toEqual({ action: "accept" })
  const invented = { text: "Giá 10.", toolNames: [], finish: "stop" as const, unfetched: 2 }
  expect(judgeStop(invented, [], new Set(["gate-promise"]))).toMatchObject({ action: "continue", kind: "unfetched" })
  expect(judgeStop({ text: "", toolNames: [], finish: "stop" }, [], new Set(["gate-empty"]))).toEqual({ action: "give-up", kind: "empty" })
})


test("the draft of 08/11 is no answer: sent back once with tools off, the data is already there", () => {
  expect(isDraft(DRAFT)).toBe(true)
  const draft = step({ text: DRAFT, toolNames: ["todo_write"], finish: "tool-calls", afterTools: true, toolsInTurn: true, dataInTurn: true })
  expect(judgeStop(draft, [])).toMatchObject({ action: "continue", kind: "draft", toolChoice: "none", nudge: RESCUE_DRAFT })
  // The nudge stands on its own: the dropped draft is never mentioned to the model.
  expect(RESCUE_DRAFT).not.toContain("nháp")
  // A plan written before any data came may fetch first (the todo_write's own result is no data).
  expect(judgeStop({ ...draft, dataInTurn: false }, [])).toMatchObject({ kind: "draft", toolChoice: "auto", nudge: RESCUE_DRAFT_FETCH })
  expect(judgeStop({ ...draft, toolNames: [] }, [])).toMatchObject({ kind: "draft" })
  // Once: a second draft stands rather than spend the whole budget.
  expect(judgeStop(draft, ["draft"])).toEqual({ action: "accept" })
  expect(judgeStop(draft, ["empty", "empty"])).toEqual({ action: "accept" })
  expect(judgeStop(draft, [], new Set(["gate-draft"]))).toEqual({ action: "accept" })
  // Still calling a data tool, or the rest of a cut answer: not judged.
  expect(judgeStop({ ...draft, toolNames: ["todo_write", "vn_company"] }, [])).toEqual({ action: "accept" })
  expect(judgeStop(draft, ["length"])).toEqual({ action: "accept" })
})

test("one draft signal alone is a real answer (stored answers it would have hit)", () => {
  for (const text of [
    // Answering "which tools do you have" names them.
    "Mình có các công cụ sau:\n1. **`current_time`**: Lấy giờ Việt Nam.\n2. **`load_skill`**: Nạp hướng dẫn phân tích.",
    // A promise names a tool (the promise check judges it, not this one).
    "Sau khi xác định mã, mình sẽ:\n1. Tạo **todo list** 3 việc.\n2. Gọi **spawn_subagent** cho 3 mã song song.",
    // A company's plan is not the model's.
    "*   **Kế hoạch:** Công ty đặt mục tiêu DT 58.580 tỷ đồng và LNTT 11.629 tỷ.",
    "Kỹ thuật: chưa có dữ liệu trong lượt này, sẽ cập nhật khi bạn yêu cầu.",
    "Kết quả đã lấy: P/E 8,44x, P/B 1,98x. FPT đang rẻ hơn trung bình ngành.",
  ])
    expect([text, isDraft(text)]).toEqual([text, false])
})

// Pilot or15 (2026-11-11): both empty rescues came back reasoning-only after a tool loop.
test("after both empty rescues, one answer-only rescue when the turn has data, then give up", () => {
  const empty: LastStep = { text: "", toolNames: [], finish: "stop", afterTools: true, dataInTurn: true, reasoned: true }
  const done = Array(MAX_RECOVERIES).fill("empty")
  expect(judgeStop(empty, done)).toEqual({ action: "continue", kind: "empty", nudge: RESCUE_ANSWER_NOW, toolChoice: "none" })
  expect(judgeStop(empty, [...done, "empty"])).toEqual({ action: "give-up", kind: "empty" })
  expect(judgeStop({ ...empty, dataInTurn: false }, done)).toEqual({ action: "give-up", kind: "empty" })
})

test("empty after every source failed: the gap rescue, tools off then on; then give-up, never the answer-only rescue", async () => {
  const { rescueGaps } = await import("../src/core/loop/stop-gate")
  const failed = step({ afterTools: true, dataInTurn: true, gaps: ["vn_quote_history"], usableData: false })
  expect(judgeStop(failed, [])).toEqual({ action: "continue", kind: "empty", nudge: rescueGaps(["vn_quote_history"]), toolChoice: "none" })
  expect(judgeStop(failed, ["empty"])).toEqual({ action: "continue", kind: "empty", nudge: rescueGaps(["vn_quote_history"]), toolChoice: "auto" })
  expect(judgeStop(failed, ["empty", "empty"])).toEqual({ action: "give-up", kind: "empty" })
  // Some data came back: the usual rescues, and the answer-only one at the end.
  const some = step({ afterTools: true, dataInTurn: true, gaps: ["vn_quote_history"], usableData: true })
  expect(judgeStop(some, []).action === "continue" && (judgeStop(some, []) as { nudge: string }).nudge).not.toContain("chưa trả dữ liệu")
  expect(judgeStop(some, ["empty", "empty"])).toMatchObject({ action: "continue", nudge: RESCUE_ANSWER_NOW, toolChoice: "none" })
  expect(rescueGaps(["a", "b"])).toContain("a, b")
})
