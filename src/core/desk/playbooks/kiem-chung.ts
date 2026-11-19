import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import type { DeskContext, DeskSize, Playbook } from "../types"
import { capList, table, tierOf } from "./common"

/**
 * kiem-chung: fact-check the numbers in a text (an answer, a report, a broker note). One agent
 * pulls out the checkable quantitative claims; each claim is checked against data by 1–3
 * independent voters with different lenses; code tallies the votes. A claim no voter could
 * check (errors, quota) is "chưa kiểm chứng" — never counted as wrong (Claude Code's
 * deep-research rule).
 */

const Args = z.object({
  noi_dung: z.string().min(40, "needs a passage with figures to check").max(30_000).describe("The text to fact-check (a previous answer, a report, a view)"),
  boi_canh: z.string().max(300).optional().describe("Context: ticker, reporting period, date… to read the figures right"),
})
type Args = z.infer<typeof Args>

const IMPORTANCE = ["cao", "vua", "thap"] as const

export const CLAIMS = z.object({
  claims: z
    .array(
      z.object({
        ma: z.string().optional().describe("Ticker, if any"),
        chi_tieu: z.string().describe("Metric, e.g. Q2 net profit, P/E, closing price"),
        gia_tri: z.string().describe("The claimed value, with its unit"),
        ky: z.string().optional().describe("Period or date of the figure"),
        nguyen_van: z.string().describe("The original sentence in the text"),
        muc_quan_trong: z.enum(IMPORTANCE),
      }),
    )
    .max(40),
})
export type Claim = z.infer<typeof CLAIMS>["claims"][number]

export const CHECK = z.object({
  ket_luan: z.enum(["dung", "sai", "khong_kiem_duoc"]).describe("dung: matches the data (rounding gaps still count as correct); sai: clearly off, or wrong period/unit; khong_kiem_duoc: no data to check against"),
  gia_tri_tim_thay: z.string().optional(),
  nguon: z.string().optional().describe("Tool or source used"),
  thoi_diem: z.string().optional(),
  giai_thich: z.string(),
})
type Check = z.infer<typeof CHECK>

const TIERS = {
  small: { claims: 5, votes: 1 },
  medium: { claims: 10, votes: 3 },
  large: { claims: 20, votes: 3 },
} as const

const STEPS = { extract: 2, check: 4 }
const LENSES = [
  "source data: fetch that exact metric with a tool and compare the number",
  "period and unit: is the figure for the right period, in the right unit (tỷ/triệu, %, times), computed the right way (year on year or vs the previous quarter)",
  "context: is the figure used misleadingly (skewed comparison, one-offs left out, a convenient base date)",
]

export type Outcome = "dung" | "sai" | "chua_kiem_chung"

/** Votes → one outcome: a majority of the valid votes decides; no valid vote, or no majority, is unchecked. */
export function tally(votes: (Check | null)[]): { outcome: Outcome; valid: number; errored: number; best?: Check } {
  const valid = votes.filter((v): v is Check => !!v)
  const errored = votes.length - valid.length
  const count = (k: Check["ket_luan"]) => valid.filter((v) => v.ket_luan === k).length
  const half = votes.length / 2
  const outcome: Outcome = count("sai") > half ? "sai" : count("dung") > half ? "dung" : "chua_kiem_chung"
  const best = valid.find((v) => (outcome === "chua_kiem_chung" ? true : v.ket_luan === outcome))
  return { outcome, valid: valid.length, errored, best }
}

function extractPrompt(args: Args, max: number) {
  return [
    `Extract at most ${max} checkable QUANTITATIVE claims from the text below (financial figures, prices, ratios, growth, numeric rankings).${args.boi_canh ? ` Context: ${args.boi_canh}.` : ""}`,
    EVIDENCE_NOTE,
    evidence(args.noi_dung, "text to fact-check"),
    "- Skip qualitative views, forecasts, opinions. For each claim record the ticker, metric, value with unit, period, original sentence.",
    "- muc_quan_trong: cao if the text's conclusion rests on it.",
    "- No tool calls needed. Return the result with tra_ket_qua.",
  ].join("\n")
}

function checkPrompt(claim: Claim, lens: string, boiCanh?: string) {
  return [
    `Check one claim against data. Your lens: ${lens}.${boiCanh ? ` Context: ${boiCanh}.` : ""}`,
    EVIDENCE_NOTE,
    evidence(JSON.stringify(claim), "claim extracted from the text"),
    "- Get the figures with read tools (financial statements, ratios, prices for the exact period). Record the value found, the source, the time.",
    "- ket_luan=sai when clearly off (beyond rounding), wrong period or wrong unit; dung when it matches; khong_kiem_duoc when there is no data to check against — never guess.",
    "Return the result with tra_ket_qua.",
  ].join("\n")
}

const MARK: Record<Outcome, string> = { dung: "✓ đúng", sai: "✘ sai", chua_kiem_chung: "? chưa kiểm chứng" }

export function report(rows: { claim: Claim; outcome: Outcome; valid: number; errored: number; best?: Check }[], votes: number, dropped: number) {
  const n = (o: Outcome) => rows.filter((r) => r.outcome === o).length
  const infra = rows.filter((r) => r.outcome === "chua_kiem_chung" && r.valid === 0).length
  const lines = [
    `Kiểm chứng ${rows.length} khẳng định định lượng (${votes} phiếu mỗi khẳng định): ${n("dung")} đúng, ${n("sai")} sai, ${n("chua_kiem_chung")} chưa kiểm chứng.`,
    "",
    table(
      ["#", "Khẳng định", "Kết luận", "Dữ liệu tìm thấy", "Nguồn · thời điểm", "Ghi chú"],
      rows.map((r, i) => [
        i + 1,
        `${r.claim.ma ? `${r.claim.ma} · ` : ""}${r.claim.chi_tieu}${r.claim.ky ? ` (${r.claim.ky})` : ""}: ${r.claim.gia_tri}`,
        MARK[r.outcome],
        r.best?.gia_tri_tim_thay,
        [r.best?.nguon, r.best?.thoi_diem].filter(Boolean).join(" · "),
        r.valid === 0 ? "không agent nào kiểm được (lỗi hoặc hết quota)" : r.best?.giai_thich,
      ]),
    ),
  ]
  if (infra > 0) lines.push("", `${infra} khẳng định chưa kiểm chứng vì agent lỗi hoặc hết quota: đây không phải kết luận "sai". Chạy tiếp bằng /desk resume.`)
  if (dropped > 0) lines.push("", `${dropped} khẳng định ít quan trọng hơn không được kiểm ở quy mô này.`)
  return lines.join("\n")
}

function plan(size: DeskSize) {
  return TIERS[tierOf(size)]
}

async function run(ctx: DeskContext<Args>): Promise<string> {
  const tier = plan(ctx.size)

  ctx.phase("Trích")
  const extracted = await ctx.agent<{ claims: Claim[] }>(extractPrompt(ctx.args, tier.claims), {
    label: "trích khẳng định",
    type: "tra-cuu",
    schema: CLAIMS,
    effort: "low",
    maxSteps: STEPS.extract,
  })
  // Most important first; the order within a level stays as in the text.
  const ordered = [...extracted.claims].sort((a, b) => IMPORTANCE.indexOf(a.muc_quan_trong) - IMPORTANCE.indexOf(b.muc_quan_trong))
  const claims = capList(ctx, ordered, tier.claims, "khẳng định", (c) => `${c.ma ?? ""} ${c.chi_tieu}`.trim())
  if (claims.length === 0) return "Không tìm thấy khẳng định định lượng nào kiểm chứng được trong văn bản."

  ctx.phase("Kiểm chứng")
  const rows = (await ctx.pipeline(claims, (claim: Claim, _item: Claim, i: number) =>
    ctx
      .parallel(
        Array.from({ length: tier.votes }, (_, v) => () =>
          ctx.agent<Check>(checkPrompt(claim, LENSES[v % LENSES.length]!, ctx.args.boi_canh), {
            label: `kiểm #${i + 1}${tier.votes > 1 ? ` phiếu ${v + 1}` : ""}: ${claim.ma ? `${claim.ma} ` : ""}${claim.chi_tieu}`,
            type: "tra-cuu",
            schema: CHECK,
            maxSteps: STEPS.check,
          }),
        ),
      )
      .then((votes) => ({ claim, ...tally(votes) })),
  )) as ({ claim: Claim } & ReturnType<typeof tally>)[]
  const done = rows.map((r, i) => r ?? { claim: claims[i]!, outcome: "chua_kiem_chung" as const, valid: 0, errored: tier.votes })
  for (const r of done) ctx.log(`${MARK[r.outcome]}: ${r.claim.ma ? `${r.claim.ma} ` : ""}${r.claim.chi_tieu}${r.errored > 0 ? ` (${r.errored} phiếu lỗi)` : ""}`)
  return report(done, tier.votes, ordered.length - claims.length)
}

export const kiemChung: Playbook<Args, string> = {
  meta: {
    name: "kiem-chung",
    version: "1",
    description: "Kiểm chứng các con số trong một văn bản: trích khẳng định định lượng, mỗi khẳng định được 1–3 agent độc lập đối chiếu dữ liệu, kết luận đúng / sai / chưa kiểm chứng",
    whenToUse: "The user wants the figures of an answer, report or view checked (including your own previous answer: paste it verbatim into noi_dung). Not for looking up a single figure.",
    args: Args,
    agentTypes: ["tra-cuu"],
    phases: ["Trích", "Kiểm chứng"],
    estimate(_args, size) {
      const tier = plan(size)
      return { agents: 1 + tier.claims * tier.votes, requests: STEPS.extract + tier.claims * tier.votes * STEPS.check }
    },
    summarize: (args) => `${args.noi_dung.replace(/\s+/g, " ").slice(0, 60)}${args.noi_dung.length > 60 ? "…" : ""}`,
  },
  run,
}
