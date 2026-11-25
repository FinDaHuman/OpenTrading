import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import { DeskNoData, type DeskContext, type DeskSize, type Playbook } from "../types"
import { Ticker, tierOf } from "./common"
import { kiemChung } from "./kiem-chung"

/**
 * tranh-bien: a bull/bear debate on one ticker (TauricResearch/TradingAgents' shape, driven by
 * code instead of the main agent pasting reports around). Analysts report in parallel; bull
 * and bear open, then rebut each other for 0–2 rounds; at the large tier the key numbers of
 * both sides go through a small kiem-chung; a referee weighs the evidence into scenarios and
 * makes the buy/hold/sell call, when the evidence supports one.
 */

const Args = z.object({
  ticker: Ticker.describe("The ticker to debate, e.g. FPT"),
  cau_hoi: z.string().max(300).optional().describe("What the user wants to know, e.g. \"có nên giữ qua BCTC quý 3\""),
})
type Args = z.infer<typeof Args>

interface Analyst {
  type: string
  role: string
}

const CORE: Analyst[] = [
  { type: "co-ban", role: "fundamentals: earnings quality, cash flow, financial health" },
  { type: "dinh-gia", role: "valuation: the fair-value range and margin of safety" },
  { type: "tin-tuc", role: "news and events of the last 30 days" },
]
const MORE: Analyst[] = [
  { type: "ky-thuat", role: "technicals: trend, momentum, invalidation point" },
  { type: "vi-mo", role: "macro: tailwind or headwind for this ticker" },
]

const TIERS = {
  small: { analysts: CORE, analystSteps: 6, rounds: 0, check: false, judgeSteps: 4 },
  medium: { analysts: [...CORE, ...MORE], analystSteps: 6, rounds: 1, check: false, judgeSteps: 4 },
  large: { analysts: [...CORE, ...MORE], analystSteps: 8, rounds: 2, check: true, judgeSteps: 6 },
} as const
const DEBATE_STEPS = 4
/** kiem-chung at small inside a large debate, from its own estimate (the tables cannot drift apart). */
const CHECK = kiemChung.meta.estimate(kiemChung.meta.args.parse({ noi_dung: "x".repeat(40) }), "small")

function analystPrompt(a: Analyst, args: Args) {
  return [
    `Analyse ${args.ticker} from the angle of ${a.role}.${args.cau_hoi ? ` The user cares about: ${args.cau_hoi}.` : ""}`,
    "- Call the fewest tools that let you conclude; call independent tools together. Load a skill only when truly needed.",
    "- Report in at most 12 lines: a one-sentence conclusion, then points with numbers. Every number with its source and time. If data is missing, say so; never estimate.",
    "- The bull and bear sides will use this report as evidence: state only the facts and your angle's assessment; leave the buy/hold/sell call to the referee.",
  ].join("\n")
}

function reportsBlock(reports: { a: Analyst; text: string }[]) {
  return reports.map((r) => evidence(r.text, `${r.a.type} report`)).join("\n")
}

function openingPrompt(side: "bull" | "bear", ticker: string, reports: string) {
  return [
    `Build the strongest ${side === "bull" ? "bull case (the price may rise)" : "bear case (downside risk)"} for ${ticker} from the reports below.`,
    EVIDENCE_NOTE,
    reports,
    "- 4–6 points, each citing evidence (number, source, time) from the reports; at most 1–2 tools to check a disputed number.",
    "- Say clearly what would make your case wrong. Leave the buy/hold/sell call to the referee.",
  ].join("\n")
}

function rebuttalPrompt(side: "bull" | "bear", ticker: string, round: number, mine: string, theirs: string) {
  return [
    `Rebuttal round ${round} on ${ticker}. You are the ${side === "bull" ? "bull" : "bear"} side.`,
    EVIDENCE_NOTE,
    evidence(mine, "your latest case"),
    evidence(theirs, `the ${side === "bull" ? "bear" : "bull"} side's latest case`),
    "- Break each of the other side's strongest points with specific figures; concede the points of theirs that hold.",
    "- Update your case (at most 10 lines). Never repeat the previous round verbatim; leave the buy/hold/sell call to the referee.",
  ].join("\n")
}

function judgePrompt(args: Args, reports: string, bull: string[], bear: string[], check: string | undefined, missing: string[]) {
  return [
    `Referee the debate on ${args.ticker}${args.cau_hoi ? ` (the user asks: ${args.cau_hoi})` : ""}. Weigh the evidence; do not side with whoever spoke last.`,
    EVIDENCE_NOTE,
    reports,
    ...bull.map((t, i) => evidence(t, i === 0 ? "bull opening" : `bull round ${i}`)),
    ...bear.map((t, i) => evidence(t, i === 0 ? "bear opening" : `bear round ${i}`)),
    ...(check ? [evidence(check, "fact-check of both sides' figures")] : []),
    "Write in Vietnamese, concisely:",
    "1. The main scenario (nghiêng tăng / giảm / đi ngang) and confidence (cao / trung bình / thấp), with 2–3 deciding pieces of evidence (number, source, time).",
    "2. Three scenarios tích cực / cơ sở / tiêu cực: qualitative likelihood, triggers, milestones to watch.",
    "3. Each side's strongest point that still stands; say clearly which figures the fact-check found wrong.",
    `4. Limits: ${missing.length > 0 ? `missing ${missing.join(", ")} reports; ` : ""}which data is old or unchecked.`,
    "5. The call (mua / giữ / bán / chờ), answering the user's question: the evidence it rests on, its main risks, what would make it wrong. Any price level comes from the reports' figures. If the evidence is balanced or too thin, say it does not support a call instead of picking one.",
  ].join("\n")
}

function plan(size: DeskSize) {
  return TIERS[tierOf(size)]
}

async function run(ctx: DeskContext<Args>): Promise<string> {
  const tier = plan(ctx.size)
  const { ticker } = ctx.args

  ctx.phase("Phân tích")
  const results = await ctx.parallel(
    tier.analysts.map((a) => () => ctx.agent<string>(analystPrompt(a, ctx.args), { label: `${a.type} ${ticker}`, type: a.type, maxSteps: tier.analystSteps })),
  )
  const reports = tier.analysts.flatMap((a, i) => (results[i] ? [{ a, text: results[i]! }] : []))
  const missing = tier.analysts.filter((_, i) => !results[i]).map((a) => a.type)
  if (missing.length > 0) ctx.log(`Thiếu báo cáo: ${missing.join(", ")}`)
  if (reports.length === 0) throw new DeskNoData(`No analyst report on ${ticker} could be fetched: not enough evidence for a debate. The user can continue with /desk resume.`)
  const block = reportsBlock(reports)

  ctx.phase("Tranh luận")
  const debate = (side: "bull" | "bear", prompt: string, label: string) => ctx.agent<string>(prompt, { label, type: side, maxSteps: DEBATE_STEPS })
  const [bull0, bear0] = await ctx.parallel([
    () => debate("bull", openingPrompt("bull", ticker, block), `bull mở màn ${ticker}`),
    () => debate("bear", openingPrompt("bear", ticker, block), `bear mở màn ${ticker}`),
  ])
  const bull = bull0 ? [bull0] : []
  const bear = bear0 ? [bear0] : []
  for (let round = 1; round <= tier.rounds && bull.length > 0 && bear.length > 0 && !ctx.stopping(); round++) {
    const [b, r] = await ctx.parallel([
      () => debate("bull", rebuttalPrompt("bull", ticker, round, bull.at(-1)!, bear.at(-1)!), `bull vòng ${round}`),
      () => debate("bear", rebuttalPrompt("bear", ticker, round, bear.at(-1)!, bull.at(-1)!), `bear vòng ${round}`),
    ])
    if (b) bull.push(b)
    if (r) bear.push(r)
  }
  if (bull.length === 0 && bear.length === 0) ctx.log("Cả hai phe đều lỗi: trọng tài chỉ dựa vào báo cáo analyst.")

  let check: string | undefined
  if (tier.check && !ctx.stopping() && bull.length + bear.length > 0) {
    // The numbers both sides lean on, checked at the small tier (5 claims, 1 voter each).
    const noi_dung = [bull.at(-1), bear.at(-1)].filter(Boolean).join("\n\n")
    if (noi_dung.length < 40) ctx.log("Lập luận quá ngắn để kiểm chứng số liệu.")
    else check = await ctx.playbook<string>("kiem-chung", { noi_dung: noi_dung.slice(0, 30_000), boi_canh: `ticker ${ticker}` }, { size: "small" }).catch(() => undefined)
  }

  if (ctx.stopping()) return ["Run bị cắt trước bước trọng tài. Lập luận đã có:", ...bull.map((t) => `**Lạc quan:** ${t}`), ...bear.map((t) => `**Thận trọng:** ${t}`)].join("\n\n")
  ctx.phase("Trọng tài")
  const verdict = await ctx
    .agent<string>(judgePrompt(ctx.args, block, bull, bear, check, missing), { label: `trọng tài ${ticker}`, type: "tong-hop", maxSteps: tier.judgeSteps })
    .catch(() => null)
  const tail = check ? `\n\n**Kiểm chứng số liệu của hai phe:**\n\n${check}` : ""
  if (verdict) return `${verdict}${tail}`
  return ["Bước trọng tài lỗi; lập luận cuối của hai phe:", bull.at(-1) ? `**Lạc quan:** ${bull.at(-1)}` : "", bear.at(-1) ? `**Thận trọng:** ${bear.at(-1)}` : ""].filter(Boolean).join("\n\n") + tail
}

export const tranhBien: Playbook<Args, string> = {
  meta: {
    name: "tranh-bien",
    version: "1",
    description: "Tranh biện một mã: các analyst báo cáo song song, phe lạc quan và thận trọng phản bác nhau, trọng tài đưa ra kịch bản và khuyến nghị",
    whenToUse: "A multi-angle analysis of one ticker with a bull/bear debate, e.g. \"FPT có đáng giữ không, nhìn cả hai phía\". Not for one-dimensional questions (only RSI, only P/E).",
    args: Args,
    // kiem-chung (large) runs with its own agent types.
    agentTypes: ["co-ban", "dinh-gia", "tin-tuc", "ky-thuat", "vi-mo", "bull", "bear", "tong-hop"],
    phases: ["Phân tích", "Tranh luận", "Trọng tài"],
    estimate(_args, size) {
      const tier = plan(size)
      const debaters = 2 * (1 + tier.rounds)
      return {
        agents: tier.analysts.length + debaters + (tier.check ? CHECK.agents : 0) + 1,
        requests: tier.analysts.length * tier.analystSteps + debaters * DEBATE_STEPS + (tier.check ? CHECK.requests : 0) + tier.judgeSteps,
      }
    },
    summarize: (args) => `${args.ticker}${args.cau_hoi ? ` · ${args.cau_hoi}` : ""}`,
  },
  run,
}
