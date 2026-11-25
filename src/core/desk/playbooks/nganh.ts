import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import { DeskNoData, type DeskContext, type DeskSize, type Playbook } from "../types"
import { capList, cardFor, Ticker, tierOf } from "./common"
import { rank, rankingTable, SCORECARD, type Scorecard } from "./sang-loc"

/**
 * nganh: a sector deep dive. One agent scopes the sector (leading companies, drivers); the
 * themes (money-flow cycle, macro, global assets) and a scorecard per company run in
 * parallel; the sector skill (#116, 3–4k tokens each) is loaded once, by the scope agent, which
 * hands the companies its 2–4 sector metrics instead; a critic names what is still
 * missing and one extra round answers it; a referee writes the sector picture — scenarios
 * and, when asked, which companies to buy.
 */

const Args = z.object({
  nganh: z.string().min(2).max(80).describe("Sector name, e.g. \"ngân hàng\", \"thép\""),
  tickers: z.array(Ticker).max(30).optional().describe("Tickers to consider; leave empty for the agent to pick the sector leaders"),
  cau_hoi: z.string().max(300).optional().describe("What the user wants to know about the sector"),
})
type Args = z.infer<typeof Args>

export const SCOPE = z.object({
  nganh: z.string().describe("The standard sector name"),
  doanh_nghiep: z.array(z.object({ ma: z.string(), ly_do: z.string().optional() })).max(15).describe("Sector-leading companies, largest market cap first"),
  dong_luc: z.array(z.string()).max(6).describe("The sector's main drivers (input prices, policy, demand…)"),
  chi_tieu_nganh: z.array(z.string()).max(4).describe("2–4 sector-specific metrics for scoring companies, e.g. NIM, CASA, NPL for banks"),
})
type Scope = z.infer<typeof SCOPE>

export const GAPS = z.object({
  thieu: z.array(z.object({ cau_hoi: z.string().describe("A question answerable with data"), ma: z.string().optional() })).max(4),
})
type Gaps = z.infer<typeof GAPS>

interface Theme {
  type: string
  ask: (nganh: string) => string
}

const CYCLE: Theme = { type: "chu-ky-nganh", ask: (n) => `Money flow and cycle position of the ${n} sector: is money flowing in or out, which phase is the sector in, what about the next month.` }
const MACRO: Theme = { type: "vi-mo", ask: (n) => `Vietnamese and global macro factors acting on the ${n} sector (rates, exchange rate, credit, policy); for each factor: hỗ trợ / trung lập / gây áp lực.` }
const GLOBAL: Theme = { type: "tai-san-toan-cau", ask: (n) => `Global commodity and asset prices relevant to the ${n} sector (inputs, outputs) and the general risk state; the effect on the sector in Vietnam.` }

const TIERS = {
  small: { companies: 3, themes: [CYCLE, MACRO], steps: 6, critic: false, gaps: 0 },
  medium: { companies: 6, themes: [CYCLE, MACRO, GLOBAL], steps: 6, critic: true, gaps: 2 },
  large: { companies: 12, themes: [CYCLE, MACRO, GLOBAL], steps: 8, critic: true, gaps: 4 },
} as const
const STEPS = { scope: 4, critic: 3, gap: 6, referee: 6 }

/** Sector name (any wording) → the sector skill of #116, when there is one. */
const SKILLS: [RegExp, string][] = [
  [/ngan hang|\bbank/, "ngan-hang-vn"],
  [/chung khoan|\bctck|moi gioi/, "chung-khoan-vn"],
  [/bao hiem/, "bao-hiem-vn"],
  [/bat dong san|\bbds\b|nha dat|khu cong nghiep|\bkcn\b/, "bat-dong-san-vn"],
  [/\bthep\b|\bton\b|steel/, "thep-vn"],
  [/dau khi|xang dau|khi dot|\boil\b/, "dau-khi-vn"],
  // "điện thoại / điện máy" is retail, not power.
  [/\bdien\b(?!\s*(thoai|may))|nang luong/, "dien-luc-vn"],
  [/hoa chat|phan bon|cao su|\bnhua\b/, "hoa-chat-vn"],
  [/ban le|tieu dung|thuc pham|do uong|\bsua\b/, "tieu-dung-ban-le-vn"],
  [/van tai|\bcang\b|logistics|hang khong|hang hai|tau bien/, "van-tai-vn"],
  [/cong nghe|phan mem|vien thong|\bcntt\b/, "cong-nghe-vn"],
  [/xuat khau|xuat nhap khau|det may|thuy san|\bgo\b/, "xuat-nhap-khau-vn"],
  [/vingroup|he sinh thai vin/, "vingroup-vn"],
]

export function sectorSkill(nganh: string): string | undefined {
  const t = nganh.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
  return SKILLS.find(([re]) => re.test(t))?.[1]
}

function scopePrompt(args: Args, skill: string | undefined) {
  return [
    `Scope the ${args.nganh} sector on the Vietnamese stock market${args.cau_hoi ? ` for the question: ${args.cau_hoi}` : ""}.`,
    args.tickers?.length ? `- The user picked these tickers: ${args.tickers.join(", ")}. Keep exactly these tickers and their order.` : "- Pick the sector leaders by market cap (use vs_industry_tree or a sector tool), largest first.",
    skill ? `- Load skill ${skill} with load_skill to choose 2–4 sector-specific metrics (chi_tieu_nganh) for scoring companies.` : "- Choose 2–4 sector-specific metrics (chi_tieu_nganh) for scoring companies.",
    "- Name the sector's 3–6 main drivers. Do not analyse individual companies at this step.",
    "Return the result with tra_ket_qua.",
  ].join("\n")
}

function themePrompt(theme: Theme, args: Args, scope: Scope | null) {
  return [
    theme.ask(scope?.nganh ?? args.nganh),
    scope?.dong_luc.length ? `Drivers identified: ${scope.dong_luc.join("; ")}.` : "",
    "- Report in at most 10 lines, every number with its source and time; leave ticker recommendations to the referee.",
  ]
    .filter(Boolean)
    .join("\n")
}

function cardPrompt(ticker: string, args: Args, metrics: string[]) {
  return [
    `Build a fundamentals scorecard for ${ticker} in the ${args.nganh} sector.`,
    "- Get the latest figures with read tools: P/E, P/B, ROE, gross margin, borrowings/equity (vn_fundamentals or financial_ratios); year-on-year net profit growth and 4 quarters of operating cash flow (financial_statements). Call independent tools together.",
    metrics.length > 0
      ? `- Also get the sector-specific metrics: ${metrics.join(", ")}; put them in diem_manh or rui_ro, with numbers.`
      : "- Sector-specific metrics (e.g. NIM for banks, selling prices for steel) go in diem_manh or rui_ro, with numbers.",
    "- Load no skills.",
    "- A number you cannot get stays null and goes into thieu_du_lieu; never estimate. Score each dimension 0–10 against companies in the same sector.",
    "Return the result with tra_ket_qua.",
  ]
    .filter(Boolean)
    .join("\n")
}

function criticPrompt(args: Args, themes: { type: string; text: string }[], cards: Scorecard[], max: number) {
  return [
    `Read the research on the ${args.nganh} sector${args.cau_hoi ? ` (question: ${args.cau_hoi})` : ""} and name at most ${max} gaps that keep it from a full answer.`,
    EVIDENCE_NOTE,
    ...themes.map((t) => evidence(t.text, `${t.type} report`)),
    evidence(JSON.stringify(cards), "company scorecards"),
    "- Each gap is one specific question answerable with data (one metric, one ticker, one period). If nothing is missing, leave the list empty.",
    "- No tool calls. Return the result with tra_ket_qua.",
  ].join("\n")
}

function refereePrompt(args: Args, scope: Scope | null, themes: { type: string; text: string }[], ranked: ReturnType<typeof rank>, extra: { q: string; a: string }[], missing: string[]) {
  return [
    `Write the ${scope?.nganh ?? args.nganh} sector report for the user${args.cau_hoi ? ` (question: ${args.cau_hoi})` : ""}. The company ranking is already computed; do not re-rank.`,
    EVIDENCE_NOTE,
    scope?.dong_luc.length ? evidence(scope.dong_luc.join("\n"), "sector drivers") : "",
    ...themes.map((t) => evidence(t.text, `${t.type} report`)),
    evidence(JSON.stringify(ranked.map((r, i) => ({ hang: i + 1, tong_diem: Number(r.score.toFixed(1)), ...r.card }))), "ranked company scorecards"),
    ...extra.map((e) => evidence(`${e.q}\n${e.a}`, "follow-up research")),
    "Write in Vietnamese, concisely:",
    "1. The sector picture: drivers, cycle position and money flow, macro winds (with numbers, sources, times).",
    "2. The company table: rank, ticker, score, P/E, P/B, ROE, net profit growth, a short note. One line of source and time under the table.",
    "3. Sector scenarios tích cực / cơ sở / tiêu cực, each with its triggers and milestones to watch.",
    `4. Limits: ${missing.length > 0 ? `missing ${missing.join(", ")}; ` : ""}old data or data missing from the scorecards.`,
    "5. The call, only when the question asks what to buy, hold or avoid: which ranked companies to buy, wait for or avoid, with the reason, main risks and what would make it wrong. If the data is too thin, say it does not support a call instead of picking one.",
  ]
    .filter(Boolean)
    .join("\n")
}

function plan(args: Args, size: DeskSize) {
  const tier = TIERS[tierOf(size)]
  const wanted = args.tickers?.length ? new Set(args.tickers).size : tier.companies
  return { tier, companies: Math.min(wanted, tier.companies) }
}

async function run(ctx: DeskContext<Args>): Promise<string> {
  const { tier } = plan(ctx.args, ctx.size)
  const skill = sectorSkill(ctx.args.nganh)
  if (skill) ctx.log(`Skill ngành: ${skill}`)

  ctx.phase("Phạm vi")
  const scope = await ctx
    .agent<Scope>(scopePrompt(ctx.args, skill), { label: `phạm vi ${ctx.args.nganh}`, type: "nganh", schema: SCOPE, effort: "low", maxSteps: STEPS.scope })
    .catch(() => null)
  const fromScope = (scope?.doanh_nghiep ?? []).map((d) => d.ma.trim().toUpperCase()).filter((m) => /^[A-Z0-9]{3,5}$/.test(m))
  const picked = ctx.args.tickers?.length ? [...new Set(ctx.args.tickers)] : [...new Set(fromScope)]
  const companies = capList(ctx, picked, tier.companies, "doanh nghiệp")
  if (companies.length === 0) return `Không xác định được doanh nghiệp nào của ngành ${ctx.args.nganh}. Thử ghi rõ mã (tickers) hoặc tên ngành khác.`

  // Themes and companies at once: neither needs the other.
  const [themeResults, cardResults] = await Promise.all([
    ctx.parallel(tier.themes.map((t) => () => ctx.agent<string>(themePrompt(t, ctx.args, scope), { label: `${t.type} ${ctx.args.nganh}`, type: t.type, phase: "Bối cảnh", maxSteps: tier.steps }))),
    ctx.pipeline(companies, (m: string) =>
      ctx.agent<Scorecard>(cardPrompt(m, ctx.args, scope?.chi_tieu_nganh ?? []), { label: `thẻ điểm ${m}`, type: "co-ban", phase: "Doanh nghiệp", schema: SCORECARD, effort: "low", maxSteps: tier.steps, accept: cardFor(m) }),
    ) as Promise<(Scorecard | null)[]>,
  ])
  const themes = tier.themes.flatMap((t, i) => (themeResults[i] ? [{ type: t.type, text: themeResults[i]! }] : []))
  const cards = cardResults.flatMap((c, i) => (c ? [{ ...c, ticker: companies[i]! }] : []))
  const missing = [...tier.themes.filter((_, i) => !themeResults[i]).map((t) => `báo cáo ${t.type}`), ...companies.filter((_, i) => !cardResults[i])]
  if (missing.length > 0) ctx.log(`Thiếu: ${missing.join(", ")}`)
  if (cards.length === 0 && themes.length === 0) throw new DeskNoData(`No data could be fetched for the sector ${ctx.args.nganh}. The user can continue with /desk resume.`)
  const ranked = rank(cards, ctx.args.cau_hoi)

  const extra: { q: string; a: string }[] = []
  if (tier.critic && !ctx.stopping()) {
    const gaps = await ctx
      .agent<Gaps>(criticPrompt(ctx.args, themes, cards, tier.gaps), { label: "phê bình mức đầy đủ", type: "phan-bien", phase: "Phê bình", schema: GAPS, maxSteps: STEPS.critic })
      .catch(() => null)
    const asks = (gaps?.thieu ?? []).slice(0, tier.gaps)
    if (asks.length > 0 && !ctx.stopping()) {
      const answers = await ctx.parallel(
        asks.map((g, i) => () =>
          ctx.agent<string>(
            [`Answer briefly, with numbers, sources and times (at most 6 lines), for the ${ctx.args.nganh} sector research:`, g.cau_hoi, g.ma ? `Related ticker: ${g.ma}.` : ""].filter(Boolean).join("\n"),
            { label: `bổ sung #${i + 1}`, type: "tra-cuu", phase: "Bổ sung", maxSteps: STEPS.gap },
          ),
        ),
      )
      asks.forEach((g, i) => answers[i] && extra.push({ q: g.cau_hoi, a: answers[i]! }))
    }
  }

  const tableText = ranked.length > 0 ? rankingTable(ranked) : ""
  if (ctx.stopping()) return `Run bị cắt trước bước tổng hợp.${tableText ? `\n\n${tableText}` : ""}`
  ctx.phase("Tổng hợp")
  const report = await ctx
    .agent<string>(refereePrompt(ctx.args, scope, themes, ranked, extra, missing), { label: `báo cáo ngành ${ctx.args.nganh}`, type: "tong-hop", maxSteps: STEPS.referee })
    .catch(() => null)
  const table = tableText ? `\n\n**Bảng điểm doanh nghiệp (tính bằng code, để đối chiếu):**\n\n${tableText}` : ""
  return report ? `${report}${table}` : `Bước tổng hợp lỗi.${table}`
}

export const nganh: Playbook<Args, string> = {
  meta: {
    name: "nganh",
    version: "1",
    description: "Phân tích sâu một ngành: phạm vi và động lực, chu kỳ dòng tiền, vĩ mô, hàng hóa toàn cầu, thẻ điểm doanh nghiệp đầu ngành, phê bình mức đầy đủ, báo cáo ngành kèm kịch bản",
    whenToUse: "A full study of one Vietnamese sector (\"ngành thép đang thế nào\", \"triển vọng nhóm ngân hàng\") needing both context and companies. To rank only a few tickers, use sang_loc.",
    args: Args,
    agentTypes: ["nganh", "chu-ky-nganh", "vi-mo", "tai-san-toan-cau", "co-ban", "phan-bien", "tra-cuu", "tong-hop"],
    phases: ["Phạm vi", "Bối cảnh", "Doanh nghiệp", "Phê bình", "Bổ sung", "Tổng hợp"],
    estimate(args, size) {
      const { tier, companies } = plan(args, size)
      const critic = tier.critic ? 1 : 0
      return {
        agents: 1 + tier.themes.length + companies + critic + tier.gaps + 1,
        requests: STEPS.scope + (tier.themes.length + companies) * tier.steps + critic * STEPS.critic + tier.gaps * STEPS.gap + STEPS.referee,
      }
    },
    summarize: (args) => `ngành ${args.nganh}${args.tickers?.length ? ` · ${args.tickers.length} mã` : ""}${args.cau_hoi ? ` · ${args.cau_hoi}` : ""}`,
  },
  run,
}
