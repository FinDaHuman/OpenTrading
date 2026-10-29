import { expect, test } from "bun:test"
import { isEmptyAnswer, judgeStop, MAX_RECOVERIES, stripEchoes, type LastStep } from "../src/core/loop/stop-gate"

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
