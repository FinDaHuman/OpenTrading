import { describe, expect, test } from "bun:test"
import { detectSubjects, typedText, type MatchEntry } from "../src/core/memory/notebook/topics"
import { noticesMessage, notificationText } from "../src/core/subagents/notification"
import type { SubagentView } from "../src/core/subagents/types"

const HPG = 2
const VNM = 5
const VCB = 6
const TIN = 9
const TABLE: MatchEntry[] = [
  { subjectId: HPG, aliases: ["HPG", "Hòa Phát"], uppercaseOnly: false },
  { subjectId: VNM, aliases: ["VNM", "Vinamilk"], uppercaseOnly: false },
  { subjectId: VCB, aliases: ["VCB"], uppercaseOnly: false },
  { subjectId: TIN, aliases: ["TIN"], uppercaseOnly: true },
]

function notice(text: string) {
  const view = {
    id: "ag-abc123",
    type: "nghien-cuu",
    description: "quét mã",
    prompt: "",
    background: true,
    model: "x · y",
    status: "completed",
    createdAt: 0,
    startedAt: 0,
    endedAt: 1000,
    tools: [],
    toolCount: 3,
    usage: { input: 10, output: 10 },
    text,
  } as unknown as SubagentView
  return noticesMessage([notificationText(view)])
}

const TWENTY = "HPG VNM VCB FPT MWG SSI VND HSG NKG ACB TCB MBB CTG BID STB VPB TPB GAS PLX POW"

describe("what the user typed", () => {
  test("a sub-agent's result in front of the message is not the user's words", () => {
    const query = `${notice(`Đã quét: ${TWENTY}`)}\n\nVCB có rẻ không?`
    const typed = typedText(query)
    expect(typed).toEqual({ text: "VCB có rẻ không?", noticeOnly: false })
    expect(detectSubjects(typed.text, TABLE)).toEqual([VCB])
  })

  test("a turn made of notifications only picks no subject", () => {
    expect(typedText(notice(`Đã quét: ${TWENTY}`))).toEqual({ text: "", noticeOnly: true })
  })

  test("a plain message is all typed", () => {
    expect(typedText("Hòa Phát?")).toEqual({ text: "Hòa Phát?", noticeOnly: false })
    expect(typedText("")).toEqual({ text: "", noticeOnly: false })
  })
})

describe("spotting subjects", () => {
  test("case does not matter", () => {
    expect(detectSubjects("hpg dạo này sao?", TABLE)).toEqual([HPG])
  })

  test("diacritics: precomposed, decomposed and none all match", () => {
    expect(detectSubjects("Luận điểm Hòa Phát của tôi còn đúng không?", TABLE)).toEqual([HPG])
    expect(detectSubjects("Luận điểm Hòa Phát còn đúng?".normalize("NFD"), TABLE)).toEqual([HPG])
    expect(detectSubjects("hoa phat thi sao", TABLE)).toEqual([HPG])
    expect(detectSubjects("Hoà  Phát", TABLE)).toEqual([HPG])
  })

  test("whole words only: HPGX is not HPG", () => {
    expect(detectSubjects("HPGX tăng", TABLE)).toEqual([])
    expect(detectSubjects("xHPG", TABLE)).toEqual([])
    expect(detectSubjects("(HPG), VNM.", TABLE)).toEqual([HPG, VNM])
  })

  test("an uppercase-only alias matches only when typed in capitals", () => {
    expect(detectSubjects("có tin gì mới không?", TABLE)).toEqual([])
    expect(detectSubjects("Có Tin gì mới không?", TABLE)).toEqual([])
    expect(detectSubjects("TIN có tốt không?", TABLE)).toEqual([TIN])
    expect(detectSubjects("TINX có tốt không?", TABLE)).toEqual([])
  })

  test("one subject named twice, or by two aliases, comes out once, in order of first appearance", () => {
    expect(detectSubjects("So sánh HPG và VNM", TABLE)).toEqual([HPG, VNM])
    expect(detectSubjects("So sánh Vinamilk với Hòa Phát, rồi HPG và VNM", TABLE)).toEqual([VNM, HPG])
    expect(detectSubjects("HPG, Hòa Phát, hpg", TABLE)).toEqual([HPG])
  })

  test("order holds after decomposed letters shift positions", () => {
    const text = "Điều kiện của Hòa Phát so với VNM".normalize("NFD")
    expect(detectSubjects(text, TABLE)).toEqual([HPG, VNM])
    expect(detectSubjects("Điều kiện ổn định, TIN rồi HPG", TABLE)).toEqual([TIN, HPG])
  })

  test("no table, no text: nothing", () => {
    expect(detectSubjects("HPG", [])).toEqual([])
    expect(detectSubjects("", TABLE)).toEqual([])
  })
})
