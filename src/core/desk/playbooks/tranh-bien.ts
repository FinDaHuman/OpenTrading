import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import type { DeskContext, DeskSize, Playbook } from "../types"
import { Ticker, tierOf } from "./common"
import { kiemChung } from "./kiem-chung"

/**
 * tranh-bien: a bull/bear debate on one ticker (TauricResearch/TradingAgents' shape, driven by
 * code instead of the main agent pasting reports around). Analysts report in parallel; bull
 * and bear open, then rebut each other for 0–2 rounds; at the large tier the key numbers of
 * both sides go through a small kiem-chung; a referee weighs the evidence into scenarios —
 * never a buy/sell call.
 */

const Args = z.object({
  ticker: Ticker.describe("Mã cần tranh biện, ví dụ FPT"),
  cau_hoi: z.string().max(300).optional().describe("Điều người dùng muốn biết, ví dụ \"có nên giữ qua BCTC quý 3\""),
})
type Args = z.infer<typeof Args>

interface Analyst {
  type: string
  role: string
}

const CORE: Analyst[] = [
  { type: "co-ban", role: "cơ bản: chất lượng lợi nhuận, dòng tiền, sức khỏe tài chính" },
  { type: "dinh-gia", role: "định giá: vùng giá trị hợp lý và biên an toàn" },
  { type: "tin-tuc", role: "tin tức và sự kiện 30 ngày gần nhất" },
]
const MORE: Analyst[] = [
  { type: "ky-thuat", role: "kỹ thuật: xu hướng, động lượng, điểm vô hiệu" },
  { type: "vi-mo", role: "vĩ mô: gió thuận hay nghịch cho mã này" },
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
    `Phân tích mã ${args.ticker} ở góc ${a.role}.${args.cau_hoi ? ` Người dùng quan tâm: ${args.cau_hoi}.` : ""}`,
    "- Gọi ít tool nhất đủ để kết luận; các tool độc lập gọi cùng lúc. Nạp skill chỉ khi thật cần.",
    "- Báo cáo tối đa 12 dòng: kết luận một câu, rồi các ý có số. Mọi số kèm nguồn và thời điểm. Thiếu dữ liệu thì nói thiếu, không ước đoán.",
    "- Báo cáo này sẽ được hai phe lạc quan và thận trọng dùng làm bằng chứng: chỉ nêu sự thật và đánh giá của góc mình, không khuyến nghị mua bán.",
  ].join("\n")
}

function reportsBlock(reports: { a: Analyst; text: string }[]) {
  return reports.map((r) => evidence(r.text, `báo cáo ${r.a.type}`)).join("\n")
}

function openingPrompt(side: "bull" | "bear", ticker: string, reports: string) {
  return [
    `Dựng lập luận ${side === "bull" ? "lạc quan (giá có thể tăng)" : "thận trọng (rủi ro giá giảm)"} mạnh nhất cho ${ticker} từ các báo cáo dưới đây.`,
    EVIDENCE_NOTE,
    reports,
    "- 4–6 luận điểm, mỗi luận điểm dẫn bằng chứng (số, nguồn, thời điểm) từ báo cáo; tối đa 1–2 tool để đối chiếu số đang tranh cãi.",
    "- Nói rõ điều gì sẽ khiến lập luận của bạn sai. Không khuyên người dùng mua hay bán.",
  ].join("\n")
}

function rebuttalPrompt(side: "bull" | "bear", ticker: string, round: number, mine: string, theirs: string) {
  return [
    `Vòng phản bác ${round} về ${ticker}. Bạn là phe ${side === "bull" ? "lạc quan" : "thận trọng"}.`,
    EVIDENCE_NOTE,
    evidence(mine, "lập luận gần nhất của bạn"),
    evidence(theirs, `lập luận gần nhất của phe ${side === "bull" ? "thận trọng" : "lạc quan"}`),
    "- Bẻ từng điểm mạnh nhất của phe kia bằng số liệu cụ thể; thừa nhận điểm nào của họ đứng vững.",
    "- Cập nhật lập luận của bạn (tối đa 10 dòng). Không lặp lại nguyên văn vòng trước, không khuyến nghị mua bán.",
  ].join("\n")
}

function judgePrompt(args: Args, reports: string, bull: string[], bear: string[], check: string | undefined, missing: string[]) {
  return [
    `Làm trọng tài cuộc tranh biện về ${args.ticker}${args.cau_hoi ? ` (người dùng hỏi: ${args.cau_hoi})` : ""}. Cân bằng chứng, không theo phe nói sau.`,
    EVIDENCE_NOTE,
    reports,
    ...bull.map((t, i) => evidence(t, i === 0 ? "phe lạc quan mở màn" : `phe lạc quan vòng ${i}`)),
    ...bear.map((t, i) => evidence(t, i === 0 ? "phe thận trọng mở màn" : `phe thận trọng vòng ${i}`)),
    ...(check ? [evidence(check, "kết quả kiểm chứng số liệu của hai phe")] : []),
    "Trình bày bằng tiếng Việt, gọn:",
    "1. Kịch bản chính (nghiêng tăng / giảm / đi ngang) và mức tin cậy (cao / trung bình / thấp), với 2–3 bằng chứng quyết định (số, nguồn, thời điểm).",
    "2. Ba kịch bản tích cực / cơ sở / tiêu cực: khả năng định tính, điều kiện kích hoạt, mốc cần theo dõi.",
    "3. Luận điểm mạnh nhất còn đứng vững của mỗi phe; số liệu nào bị kiểm chứng là sai thì nói rõ.",
    `4. Giới hạn: ${missing.length > 0 ? `thiếu báo cáo ${missing.join(", ")}; ` : ""}dữ liệu nào cũ hoặc chưa kiểm chứng.`,
    "Không khuyến nghị mua, bán, giữ hay tỷ trọng: quyết định thuộc về người dùng.",
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
  if (reports.length === 0) return `Không lấy được báo cáo nào về ${ticker}: không đủ bằng chứng để tranh biện. Chạy tiếp bằng /desk resume.`
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
    else check = await ctx.playbook<string>("kiem-chung", { noi_dung: noi_dung.slice(0, 30_000), boi_canh: `mã ${ticker}` }, { size: "small" }).catch(() => undefined)
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
    description: "Tranh biện một mã: các analyst báo cáo song song, phe lạc quan và thận trọng phản bác nhau, trọng tài đưa ra kịch bản",
    whenToUse: "Phân tích nhiều chiều một mã kèm phản biện lạc quan/thận trọng, ví dụ \"FPT có đáng giữ không, nhìn cả hai phía\". Không dùng cho câu hỏi một chiều (chỉ RSI, chỉ P/E).",
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
