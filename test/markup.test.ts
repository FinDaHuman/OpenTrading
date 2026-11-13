import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { CALL_TAGS, HARNESS_TAGS, markupStreamFilter, NOTE_TAGS, stripMarkup } from "../src/core/loop/markup"
import { isEmptyAnswer, stripEchoes } from "../src/core/loop/stop-gate"
import { REMINDER_TAG } from "../src/core/reminder-tag"
import { COMPACT_TAG } from "../src/core/compact-marker"
import { DESK_TAG } from "../src/core/desk/notification"
import { NOTICE_TAG } from "../src/core/subagents/notification"
import { META_TAG } from "../src/core/subagents/result"
import { MENTION_TAG } from "../src/core/mentions"

/** Every way of cutting `text` into two or three chunks gives what the whole text gives. */
function streamed(text: string, cuts: number[]) {
  const f = markupStreamFilter()
  let out = ""
  let at = 0
  for (const cut of [...cuts, text.length]) {
    out += f.push(text.slice(at, cut))
    at = cut
  }
  return out + f.end()
}

function expectStreamAgrees(text: string) {
  const f = markupStreamFilter()
  const whole = f.push(text) + f.end()
  for (let i = 0; i <= text.length; i++) {
    expect(streamed(text, [i])).toBe(whole)
    for (let j = i; j <= text.length; j += 7) expect(streamed(text, [i, j])).toBe(whole)
  }
}

// --- Real samples (13/11 eval m6, 08/11 40a, stored sessions) ---

const M6 =
  "<nhac_nho>\nViệc cần làm: Lấy giá đóng cửa HPG ngày 31/10/2026 và 30/09/2026. Sau đó trả lời câu hỏi của người dùng.\n</nhac_nho>\n<nhac_nho>\nDanh sách việc của bạn:\n- [in_progress] Lấy giá đóng cửa HPG ngày 31/10/2026 và 30/09/2026\n- [pending] Tính % thay đổi và tổng tiền mua 1.500 cổ phiếu\n</nhac_nho>"

test("13/11 m6: an answer made only of self-made <nhac_nho> blocks is empty", () => {
  expect(stripMarkup(M6)).toEqual({ text: "", tags: ["nhac_nho"] })
  expect(isEmptyAnswer(M6)).toBe(true)
  expectStreamAgrees(M6)
})

test("40a: a todo_write call written as text around the answer goes, the answer stays", () => {
  const text =
    '<todo_write>{ "todos": [{ "content": "Lấy giá FPT", "status": "in_progress" }] }</todo_write>\n\nFPT đóng cửa 96.500 đồng ngày 07/11/2026.\n\n<todo_write>\n{ "todos": [{ "content": "Lấy giá FPT", "status": "completed" }] }\n</todo_write>'
  expect(stripMarkup(text)).toEqual({ text: "FPT đóng cửa 96.500 đồng ngày 07/11/2026.", tags: ["todo_write"] })
  expectStreamAgrees(text)
})

test("fake tool calls in Hermes/Qwen/GLM form go, stray closing tags too", () => {
  expect(stripMarkup("Tôi sẽ gọi các tool cùng lúc.<tool_call>vn_quote_history<param_key>limit</param_key><param_value>60</param_value></tool_call>").text).toBe(
    "Tôi sẽ gọi các tool cùng lúc.",
  )
  expect(stripMarkup("<function=mcp__opentrading__vn_quote_history>\n<parameter=symbol>\nHPG\n</parameter>\n</function>\nGiá HPG?").text).toBe("Giá HPG?")
  expect(stripMarkup("T the the réforme\n</parameter>\n>\n</function>\n").text).toBe("T the the réforme\n>")
})

test("working notes go; a note that never closes takes the rest of the step with it", () => {
  expect(stripMarkup("\n\n<thought>\nDữ liệu đã có: P/E = 4.77\n</thought>\nVCB: P/E 4,77 lần.").text).toBe("VCB: P/E 4,77 lần.")
  expect(stripMarkup("\n\n<phan_tich_tool>\n- `stock_overview`: P/E ~8.36\n- OCF/LNST: Tôi cần OCF.").text).toBe("")
})

test("a tag named in prose or code is left alone (stored answers 21/10, 03/11)", () => {
  for (const text of [
    "Kịch bản Bull và Bear, không khuyến nghị mua/bán (theo `<bat_bien>`).",
    "Kết quả sẽ tự động gửi đến trong thông báo `<thong_bao_desk>` khi quá trình hoàn tất.",
    "Không khuyến nghị (theo <bat_bien> của hệ thống) — VIC tăng 6,99%.",
    "```xml\n<nhac_nho>\nví dụ\n</nhac_nho>\n```",
    "Giá < 20.000 đồng, P/E <10 lần, <b>đậm</b>, a<br>b, <data> rồi chữ.",
    "| Mã | Ghi chú |\n|---|---|\n| HPG | <br> |",
  ]) {
    expect(stripMarkup(text)).toEqual({ text, tags: [] })
    expectStreamAgrees(text)
  }
})

test("an unknown tag is a tool call only when JSON follows it", () => {
  expect(stripMarkup('<watchlist_add>{"symbol":"FPT"}</watchlist_add>Đã xong.').text).toBe("Đã xong.")
  expect(stripMarkup("<ghi_chu>FPT tốt</ghi_chu>").tags).toEqual([])
})

test("stripEchoes keeps its line rules and adds the markup; markup: false keeps markup", () => {
  expect(stripEchoes("<nhac_nho>\nx\n</nhac_nho>\n*(Đã hoàn thành các việc cần làm)*\nVCB tốt.")).toBe("VCB tốt.")
  expect(stripEchoes("<nhac_nho>x</nhac_nho>", { markup: false })).toBe("<nhac_nho>x</nhac_nho>")
})

test("the stream never shows a piece of a block, at any chunk boundary", () => {
  const text = "Mở đầu.\n<nhac_nho>\nbí mật\n</nhac_nho>\nKết luận `<x>` và ```\n<thought>giữ</thought>\n```\nHết."
  expectStreamAgrees(text)
  for (let i = 0; i <= text.length; i++) {
    const f = markupStreamFilter()
    const shown = f.push(text.slice(0, i))
    expect(shown).not.toContain("bí mật")
    expect(shown).not.toMatch(/<n(h(a(c(_(n(ho?)?)?)?)?)?)?$/)
  }
})

// --- The tag lists stay in step with what the harness sends ---

test("HARNESS_TAGS holds every tag the harness emits and every tag in prompts/", () => {
  const listed = new Set<string>(HARNESS_TAGS)
  for (const tag of [REMINDER_TAG, COMPACT_TAG, DESK_TAG, NOTICE_TAG, META_TAG, MENTION_TAG, "viec_can_lam_luu", "memory_lien_quan", "ket_qua", "quyen_tep", "tool_hoan"])
    expect(listed.has(tag)).toBe(true)
  const dir = path.join(import.meta.dir, "..", "prompts")
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    for (const m of readFileSync(path.join(dir, file), "utf8").matchAll(/<([a-z][a-z_]{2,30})>/g)) expect(listed.has(m[1]!)).toBe(true)
  }
  // The memory card is an answer part (cards/stream.ts), never markup.
  expect([...HARNESS_TAGS, ...CALL_TAGS, ...NOTE_TAGS]).not.toContain("the_goi_y")
})
