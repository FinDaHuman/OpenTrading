import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import type { DeskContext, DeskSize, Playbook } from "../types"
import { capList, Ticker, tierOf } from "./common"
import { rank, rankingTable, SCORECARD, type Scorecard } from "./sang-loc"

/**
 * nganh: a sector deep dive. One agent scopes the sector (leading companies, drivers); the
 * themes (money-flow cycle, macro, global assets) and a scorecard per company run in
 * parallel; the sector skill (#116, 3–4k tokens each) is loaded once, by the scope agent, which
 * hands the companies its 2–4 sector metrics instead; a critic names what is still
 * missing and one extra round answers it; a referee writes the sector picture — scenarios,
 * never a buy/sell call.
 */

const Args = z.object({
  nganh: z.string().min(2).max(80).describe("Tên ngành, ví dụ \"ngân hàng\", \"thép\""),
  tickers: z.array(Ticker).max(30).optional().describe("Các mã muốn xét; bỏ trống để agent tự chọn doanh nghiệp đầu ngành"),
  cau_hoi: z.string().max(300).optional().describe("Điều người dùng muốn biết về ngành"),
})
type Args = z.infer<typeof Args>

export const SCOPE = z.object({
  nganh: z.string().describe("Tên ngành chuẩn"),
  doanh_nghiep: z.array(z.object({ ma: z.string(), ly_do: z.string().optional() })).max(15).describe("Doanh nghiệp đầu ngành, vốn hóa lớn trước"),
  dong_luc: z.array(z.string()).max(6).describe("Các động lực chính của ngành (giá đầu vào, chính sách, cầu…)"),
  chi_tieu_nganh: z.array(z.string()).max(4).describe("2–4 chỉ tiêu riêng của ngành để chấm doanh nghiệp, ví dụ NIM, CASA, NPL với ngân hàng"),
})
type Scope = z.infer<typeof SCOPE>

export const GAPS = z.object({
  thieu: z.array(z.object({ cau_hoi: z.string().describe("Một câu hỏi trả lời được bằng dữ liệu"), ma: z.string().optional() })).max(4),
})
type Gaps = z.infer<typeof GAPS>

interface Theme {
  type: string
  ask: (nganh: string) => string
}

const CYCLE: Theme = { type: "chu-ky-nganh", ask: (n) => `Dòng tiền và vị trí chu kỳ của ngành ${n}: tiền đang vào hay ra ngành này, ngành ở pha nào, 1 tháng tới thế nào.` }
const MACRO: Theme = { type: "vi-mo", ask: (n) => `Các yếu tố vĩ mô VN và thế giới tác động lên ngành ${n} (lãi suất, tỷ giá, tín dụng, chính sách); mỗi yếu tố: hỗ trợ / trung lập / gây áp lực.` }
const GLOBAL: Theme = { type: "tai-san-toan-cau", ask: (n) => `Giá hàng hóa và tài sản toàn cầu liên quan tới ngành ${n} (đầu vào, đầu ra) và trạng thái rủi ro chung; tác động lên ngành ở VN.` }

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
    `Xác định phạm vi ngành ${args.nganh} ở thị trường chứng khoán Việt Nam${args.cau_hoi ? ` cho câu hỏi: ${args.cau_hoi}` : ""}.`,
    args.tickers?.length ? `- Người dùng đã chọn các mã: ${args.tickers.join(", ")}. Giữ đúng các mã này và thứ tự của chúng.` : "- Chọn các doanh nghiệp đầu ngành theo vốn hóa (dùng vs_industry_tree hoặc tool ngành), lớn trước.",
    skill ? `- Nạp skill ${skill} bằng load_skill để chọn 2–4 chỉ tiêu riêng của ngành (chi_tieu_nganh) dùng chấm doanh nghiệp.` : "- Chọn 2–4 chỉ tiêu riêng của ngành (chi_tieu_nganh) dùng chấm doanh nghiệp.",
    "- Nêu 3–6 động lực chính của ngành. Không phân tích từng doanh nghiệp ở bước này.",
    "Trả kết quả bằng tra_ket_qua.",
  ].join("\n")
}

function themePrompt(theme: Theme, args: Args, scope: Scope | null) {
  return [
    theme.ask(scope?.nganh ?? args.nganh),
    scope?.dong_luc.length ? `Động lực đã xác định: ${scope.dong_luc.join("; ")}.` : "",
    "- Báo cáo tối đa 10 dòng, mọi số kèm nguồn và thời điểm; không khuyến nghị mã cụ thể.",
  ]
    .filter(Boolean)
    .join("\n")
}

function cardPrompt(ticker: string, args: Args, metrics: string[]) {
  return [
    `Lập thẻ điểm cơ bản cho mã ${ticker} trong ngành ${args.nganh}.`,
    "- Lấy số liệu mới nhất bằng tool đọc: P/E, P/B, ROE, biên gộp, nợ vay/vốn chủ (vn_fundamentals hoặc financial_ratios); tăng trưởng LNST cùng kỳ và dòng tiền HĐKD 4 quý (financial_statements). Các tool độc lập gọi cùng lúc.",
    metrics.length > 0
      ? `- Lấy thêm chỉ tiêu riêng của ngành: ${metrics.join(", ")}; ghi vào diem_manh hoặc rui_ro, kèm số.`
      : "- Chỉ tiêu riêng của ngành (ví dụ NIM với ngân hàng, giá bán với thép) ghi vào diem_manh hoặc rui_ro, kèm số.",
    "- Không nạp skill.",
    "- Số nào không lấy được thì để null và ghi vào thieu_du_lieu; không ước đoán. Chấm 0–10 từng chiều, so với các doanh nghiệp cùng ngành.",
    "Trả kết quả bằng tra_ket_qua.",
  ]
    .filter(Boolean)
    .join("\n")
}

function criticPrompt(args: Args, themes: { type: string; text: string }[], cards: Scorecard[], max: number) {
  return [
    `Đọc kết quả nghiên cứu ngành ${args.nganh}${args.cau_hoi ? ` (câu hỏi: ${args.cau_hoi})` : ""} và chỉ ra tối đa ${max} chỗ còn thiếu để trả lời đầy đủ.`,
    EVIDENCE_NOTE,
    ...themes.map((t) => evidence(t.text, `báo cáo ${t.type}`)),
    evidence(JSON.stringify(cards), "thẻ điểm doanh nghiệp"),
    "- Mỗi chỗ thiếu là một câu hỏi cụ thể trả lời được bằng dữ liệu (một chỉ tiêu, một mã, một kỳ). Đủ rồi thì để danh sách rỗng.",
    "- Không gọi tool. Trả kết quả bằng tra_ket_qua.",
  ].join("\n")
}

function refereePrompt(args: Args, scope: Scope | null, themes: { type: string; text: string }[], ranked: ReturnType<typeof rank>, extra: { q: string; a: string }[], missing: string[]) {
  return [
    `Viết báo cáo ngành ${scope?.nganh ?? args.nganh} cho người dùng${args.cau_hoi ? ` (câu hỏi: ${args.cau_hoi})` : ""}. Thứ hạng doanh nghiệp đã được tính; không xếp lại.`,
    EVIDENCE_NOTE,
    scope?.dong_luc.length ? evidence(scope.dong_luc.join("\n"), "động lực ngành") : "",
    ...themes.map((t) => evidence(t.text, `báo cáo ${t.type}`)),
    evidence(JSON.stringify(ranked.map((r, i) => ({ hang: i + 1, tong_diem: Number(r.score.toFixed(1)), ...r.card }))), "thẻ điểm doanh nghiệp đã xếp hạng"),
    ...extra.map((e) => evidence(`${e.q}\n${e.a}`, "nghiên cứu bổ sung")),
    "Trình bày bằng tiếng Việt, gọn:",
    "1. Bức tranh ngành: động lực, vị trí chu kỳ và dòng tiền, gió vĩ mô (có số, nguồn, thời điểm).",
    "2. Bảng doanh nghiệp: hạng, mã, điểm, P/E, P/B, ROE, tăng trưởng LNST, một ghi chú ngắn. Một dòng nguồn và thời điểm dưới bảng.",
    "3. Kịch bản ngành tích cực / cơ sở / tiêu cực, mỗi kịch bản kèm điều kiện kích hoạt và mốc theo dõi.",
    `4. Giới hạn: ${missing.length > 0 ? `thiếu ${missing.join(", ")}; ` : ""}dữ liệu cũ hoặc thiếu trong thẻ.`,
    "Không khuyến nghị mua, bán hay tỷ trọng.",
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
      ctx.agent<Scorecard>(cardPrompt(m, ctx.args, scope?.chi_tieu_nganh ?? []), { label: `thẻ điểm ${m}`, type: "co-ban", phase: "Doanh nghiệp", schema: SCORECARD, effort: "low", maxSteps: tier.steps }),
    ) as Promise<(Scorecard | null)[]>,
  ])
  const themes = tier.themes.flatMap((t, i) => (themeResults[i] ? [{ type: t.type, text: themeResults[i]! }] : []))
  const cards = cardResults.flatMap((c, i) => (c ? [{ ...c, ticker: companies[i]! }] : []))
  const missing = [...tier.themes.filter((_, i) => !themeResults[i]).map((t) => `báo cáo ${t.type}`), ...companies.filter((_, i) => !cardResults[i])]
  if (missing.length > 0) ctx.log(`Thiếu: ${missing.join(", ")}`)
  if (cards.length === 0 && themes.length === 0) return `Không lấy được dữ liệu nào cho ngành ${ctx.args.nganh}. Chạy tiếp bằng /desk resume.`
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
            [`Trả lời ngắn, có số, nguồn và thời điểm (tối đa 6 dòng), cho nghiên cứu ngành ${ctx.args.nganh}:`, g.cau_hoi, g.ma ? `Mã liên quan: ${g.ma}.` : ""].filter(Boolean).join("\n"),
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
    whenToUse: "Nghiên cứu toàn cảnh một ngành ở VN (\"ngành thép đang thế nào\", \"triển vọng nhóm ngân hàng\") cần cả bối cảnh lẫn doanh nghiệp. Chỉ xếp hạng vài mã thì dùng sang_loc.",
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
