import { describe, expect, test } from "bun:test"
import {
  compactionInput,
  type HistoryEntry,
  planCompaction,
  reservedTokens,
  shouldCompact,
  SUMMARY_SECTIONS,
  summaryInstructions,
  tailBudget,
} from "../../src/core/context/compaction"
import { planPrune, prunePlaceholder } from "../../src/core/context/prune"
import { compactWithValidation, repairSummary, sections, validateSummary } from "../../src/core/context/validate"

describe("compaction formula (OpenCode v1)", () => {
  test("reserve = min(20k, output); compact when tokens ≥ context − reserve", () => {
    expect(reservedTokens({ context: 128_000, output: 8_000 })).toBe(8_000)
    expect(reservedTokens({ context: 128_000 })).toBe(20_000)
    expect(shouldCompact(107_999, { context: 128_000 })).toBe(false)
    expect(shouldCompact(108_000, { context: 128_000 })).toBe(true)
  })

  test("verbatim tail = clamp(usable × 0.25, 2k, 15k)", () => {
    expect(tailBudget({ context: 128_000 })).toBe(15_000)
    expect(tailBudget({ context: 32_000, output: 4_000 })).toBe(7_000)
    expect(tailBudget({ context: 8_000, output: 4_000 })).toBe(2_000)
  })

  test("plan keeps a tail within budget, never starting with a tool result, and lists source seqs", () => {
    const e = (seq: number, role: HistoryEntry["role"], tokens: number): HistoryEntry => ({
      seq,
      role,
      text: "x",
      tokens,
    })
    const history = [
      e(1, "user", 5000),
      e(2, "assistant", 5000),
      e(3, "tool", 1000),
      e(4, "assistant", 900),
      e(5, "user", 900),
    ]
    const plan = planCompaction(history, { context: 8_000, output: 4_000 }) // tail budget 2k
    expect(plan.tail.map((x) => x.seq)).toEqual([4, 5])
    expect(plan.sourceSeqs).toEqual([1, 2, 3])
    const toolFirst = planCompaction([e(1, "user", 9000), e(2, "tool", 900), e(3, "user", 900)], {
      context: 8_000,
      output: 4_000,
    })
    expect(toolFirst.tail[0]!.role).not.toBe("tool")
  })

  test("compaction input carries memory ids, not memory text; cuts tool output; leaves restricted entries out", () => {
    const head: HistoryEntry[] = [
      {
        seq: 1,
        role: "user",
        text: "<memory_context>\n  <content>Tôi không dùng margin</content>\n</memory_context>\nPhân tích VCB",
        memoryIds: ["m1"],
      },
      { seq: 2, role: "tool", text: "x".repeat(5000) },
      { seq: 3, role: "assistant", text: "Dựa trên khoản vay của bạn…", restricted: true },
    ]
    const input = compactionInput(head)
    expect(input.text).toContain("[memory: m1]")
    expect(input.text).not.toContain("margin")
    expect(input.text).toContain("[… đã cắt]")
    expect(input.text).not.toContain("khoản vay")
    expect(input.sourceSeqs).toEqual([1, 2])
  })

  test("instructions list the fixed sections and the pinned constraints verbatim", () => {
    const text = summaryInstructions(["không vượt 20% danh mục cho một mã"])
    for (const s of SUMMARY_SECTIONS) expect(text).toContain(`## ${s}`)
    expect(text).toContain("- không vượt 20% danh mục cho một mã")
  })
})

const good = (constraints: string, figures: string) =>
  SUMMARY_SECTIONS.map(
    (h) =>
      `## ${h}\n${h === "Ràng buộc đang áp dụng" ? constraints : h === "Số liệu quan trọng kèm nguồn" ? figures : "- …"}`,
  ).join("\n\n")
const pinned = ["không vượt 20% danh mục cho một mã"]
const evidenceIds = new Set(["e1"])

describe("validator", () => {
  test("passes a summary with constraints verbatim and sourced figures", () => {
    const s = good("- không vượt 20% danh mục cho một mã", "- P/E VCB 12,4x [ev:e1]")
    expect(sections(s).size).toBe(SUMMARY_SECTIONS.length)
    expect(validateSummary(s, { pinned, evidenceIds }).ok).toBe(true)
  })

  test("catches a paraphrased constraint and an unsourced or fake-sourced figure", () => {
    const bad = good("- tối đa 1/5 danh mục", "- P/E 12,4x\n- ROE 18% [ev:nope]\n- Không có số ở đây")
    const r = validateSummary(bad, { pinned, evidenceIds })
    expect(r.ok).toBe(false)
    expect(r.missingConstraints).toEqual(pinned)
    expect(r.unsourcedFigures).toEqual(["- P/E 12,4x", "- ROE 18% [ev:nope]"])
  })

  test("missing sections fail", () => {
    expect(validateSummary("## Mục tiêu\nx", { pinned: [], evidenceIds }).missingSections.length).toBe(
      SUMMARY_SECTIONS.length - 1,
    )
  })

  test("repair copies constraints from the store and drops unsourced figures", () => {
    const fixed = repairSummary(good("- tối đa 1/5 danh mục", "- P/E 12,4x\n- EPS 3.200 [ev:e1]"), {
      pinned,
      evidenceIds,
    })
    expect(validateSummary(fixed, { pinned, evidenceIds }).ok).toBe(true)
    expect(fixed).toContain("- không vượt 20% danh mục cho một mã")
    expect(fixed).not.toContain("P/E 12,4x")
    expect(fixed).toContain("EPS 3.200 [ev:e1]")
  })

  test("asks for rewrites with the problems listed, at most twice, then repairs", async () => {
    const feedback: (string | undefined)[] = []
    const ok = await compactWithValidation(
      async (f) => {
        feedback.push(f)
        return feedback.length === 1
          ? good("- tối đa 1/5", "- (không)")
          : good("- không vượt 20% danh mục cho một mã", "- (không)")
      },
      { pinned, evidenceIds, sourceSeqs: [1, 2] },
    )
    expect(ok).toMatchObject({ kind: "context.summary.created", repaired: false, attempts: 2, sourceSeqs: [1, 2] })
    expect(feedback[1]).toContain("không vượt 20% danh mục cho một mã")

    let calls = 0
    const repaired = await compactWithValidation(async () => (calls++, good("- sai", "- P/E 9x")), {
      pinned,
      evidenceIds,
      sourceSeqs: [1],
    })
    expect(calls).toBe(3)
    expect(repaired.repaired).toBe(true)
    expect(validateSummary(repaired.summary, { pinned, evidenceIds }).ok).toBe(true)
  })
})

describe("prune", () => {
  const r = (id: string, position: number, tokens: number) => ({ id, position, tokens, artifactId: `a-${id}` })

  test("keeps the three most recent results; prunes older ones only when ≥ 20k tokens are freed", () => {
    const results = [r("1", 1, 15_000), r("2", 2, 10_000), r("3", 3, 500), r("4", 4, 500), r("5", 5, 500)]
    expect(planPrune(results)).toEqual({ ids: ["1", "2"], freedTokens: 25_000 - 24 })
    expect(planPrune([r("1", 1, 5_000), ...results.slice(2)])).toBeNull()
    expect(planPrune([{ ...r("1", 1, 50_000), pruned: true }, ...results.slice(2)])).toBeNull()
    expect(prunePlaceholder("a-1")).toBe("[đã dọn: artifact a-1]")
  })
})
