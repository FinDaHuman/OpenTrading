import { z } from "zod"
import { EVIDENCE_NOTE, evidence } from "../sanitize"
import type { DeskContext, DeskSize, Playbook } from "../types"
import { capList, listSummary, num, table, Ticker, tierOf } from "./common"

/**
 * sang-loc: screen and rank several tickers. Every ticker gets a fundamentals scorecard
 * (pipeline, no barrier); code ranks them (rules for a few, z-scores for many); the top ones
 * are challenged by independent refuters; a referee writes the table and scenarios — never
 * a buy/sell call.
 */

const Args = z.object({
  tickers: z.array(Ticker).min(2, "cần ít nhất 2 mã").max(60).describe("Các mã cần sàng lọc, ví dụ [\"FPT\",\"MWG\"]"),
  tieu_chi: z.string().max(300).optional().describe("Tiêu chí người dùng nhấn mạnh, ví dụ \"định giá rẻ, nợ thấp\""),
})
type Args = z.infer<typeof Args>

const metric = z.number().nullable().optional()
const score = z.number().min(0).max(10)

export const SCORECARD = z.object({
  ticker: z.string(),
  nganh: z.string().optional().describe("Ngành của mã"),
  data_time: z.string().describe("Thời điểm số liệu mới nhất, ví dụ Q2/2026 hoặc ngày giá"),
  chi_so: z.object({
    pe: metric.describe("P/E (lần)"),
    pb: metric.describe("P/B (lần)"),
    roe: metric.describe("ROE (%)"),
    tang_truong_lnst: metric.describe("Tăng trưởng LNST so với cùng kỳ (%)"),
    bien_gop: metric.describe("Biên lợi nhuận gộp (%)"),
    no_vay_von_chu: metric.describe("Nợ vay / vốn chủ (lần)"),
    ocf_lnst: metric.describe("Dòng tiền HĐKD / LNST, 4 quý gần nhất (lần)"),
  }),
  diem: z.object({ chat_luong: score, dinh_gia: score, tang_truong: score, suc_khoe: score }),
  diem_manh: z.array(z.string()).max(3),
  rui_ro: z.array(z.string()).max(3),
  thieu_du_lieu: z.array(z.string()).max(8),
  nguon: z.array(z.string()).max(6).describe("Tool hoặc nguồn đã dùng"),
})
export type Scorecard = z.infer<typeof SCORECARD>

export const VERDICT = z.object({
  giu_nguyen: z.boolean().describe("true chỉ khi các số liệu quyết định thứ hạng khớp và điểm hợp lý"),
  dieu_chinh: z.number().int().min(-3).max(3).describe("Cộng/trừ vào tổng điểm 0–10"),
  so_lieu_sai: z.array(z.string()).max(5).describe("Số sai hoặc khác kỳ: giá trị đúng, nguồn, thời điểm"),
  ly_do: z.string(),
})
type Verdict = z.infer<typeof VERDICT>

/** Tickers, refuted top ranks and votes per size (estimates and the run use the same table). */
const TIERS = {
  small: { tickers: 5, top: 0, votes: 0 },
  medium: { tickers: 10, top: 3, votes: 1 },
  large: { tickers: 30, top: 5, votes: 3 },
} as const

const STEPS = { card: 6, verify: 6, referee: 6 }
const LENSES = ["số liệu gốc (kiểm lại từng con số bằng tool)", "so với cùng ngành (điểm có hợp lý không)", "chất lượng lợi nhuận (lãi thật hay lãi giấy, khoản bất thường)"]

const unique = (tickers: string[]) => [...new Set(tickers)]

function plan(args: Args, size: DeskSize) {
  const tier = TIERS[tierOf(size)]
  const n = Math.min(unique(args.tickers).length, tier.tickers)
  return { tier, n, top: Math.min(tier.top, n) }
}

/** Weights of the four scores from the user's criteria (accent-insensitive). */
export function weights(tieuChi = "") {
  const t = tieuChi.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase()
  return {
    chat_luong: /chat luong|roe|bien|loi nhuan/.test(t) ? 2 : 1,
    dinh_gia: /dinh gia|\bre\b|p\/?e|p\/?b|gia tri/.test(t) ? 2 : 1,
    tang_truong: /tang truong|growth/.test(t) ? 2 : 1,
    suc_khoe: /suc khoe|\bno\b|no vay|an toan|dong tien/.test(t) ? 2 : 1,
  }
}

export interface Ranked {
  card: Scorecard
  score: number
  note?: string
}

/**
 * Ranking in code: the weighted scorecard; with more than 10 tickers it is blended with
 * z-scores of the raw ratios (a handful of tickers makes z-scores noise).
 */
export function rank(cards: Scorecard[], tieuChi?: string): Ranked[] {
  const w = weights(tieuChi)
  const total = w.chat_luong + w.dinh_gia + w.tang_truong + w.suc_khoe
  const base = (c: Scorecard) => (c.diem.chat_luong * w.chat_luong + c.diem.dinh_gia * w.dinh_gia + c.diem.tang_truong * w.tang_truong + c.diem.suc_khoe * w.suc_khoe) / total
  let scored = cards.map((card) => ({ card, score: base(card) }))
  if (cards.length > 10) {
    // Higher is better for these; P/E (positive only), P/B and leverage are better lower.
    const keys: [keyof Scorecard["chi_so"], 1 | -1][] = [
      ["roe", 1],
      ["tang_truong_lnst", 1],
      ["bien_gop", 1],
      ["ocf_lnst", 1],
      ["pe", -1],
      ["pb", -1],
      ["no_vay_von_chu", -1],
    ]
    const value = (c: Scorecard, k: keyof Scorecard["chi_so"]) => {
      const v = c.chi_so[k]
      return typeof v === "number" && Number.isFinite(v) && !(k === "pe" && v <= 0) ? v : undefined
    }
    const z = new Map<Scorecard, number[]>()
    for (const [k, sign] of keys) {
      const values = cards.map((c) => value(c, k)).filter((v): v is number => v !== undefined)
      if (values.length < 3) continue
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
      if (sd === 0) continue
      for (const c of cards) {
        const v = value(c, k)
        if (v === undefined) continue
        z.set(c, [...(z.get(c) ?? []), Math.max(-3, Math.min(3, (sign * (v - mean)) / sd))])
      }
    }
    scored = scored.map(({ card, score }) => {
      const zs = z.get(card) ?? []
      const quant = zs.length > 0 ? Math.max(0, Math.min(10, 5 + 1.5 * (zs.reduce((a, b) => a + b, 0) / zs.length))) : score
      return { card, score: (score + quant) / 2 }
    })
  }
  return scored.sort((a, b) => b.score - a.score || (b.card.chi_so.roe ?? -Infinity) - (a.card.chi_so.roe ?? -Infinity) || a.card.ticker.localeCompare(b.card.ticker))
}

function cardPrompt(ticker: string, tieuChi?: string) {
  return [
    `Lập thẻ điểm cơ bản cho mã ${ticker}${tieuChi ? `, người dùng nhấn mạnh: ${tieuChi}` : ""}.`,
    "Cách làm:",
    "- Lấy số liệu mới nhất bằng tool đọc: P/E, P/B, ROE, biên gộp, nợ vay/vốn chủ (vn_fundamentals hoặc financial_ratios); tăng trưởng LNST cùng kỳ và dòng tiền HĐKD 4 quý (financial_statements). Gọi các tool độc lập cùng lúc.",
    "- Không nạp skill, không phân tích ngoài thẻ điểm. Số nào không lấy được thì để null và ghi vào thieu_du_lieu; không ước đoán.",
    "- Chấm 0–10 từng chiều, so với mặt bằng ngành của mã: chat_luong (ROE, biên, lãi có phải tiền thật), dinh_gia (10 = rẻ so với lịch sử và ngành), tang_truong (LNST, doanh thu gần nhất), suc_khoe (nợ vay, dòng tiền HĐKD so với LNST).",
    "- data_time là thời điểm của số liệu mới nhất; nguon là tool hoặc nguồn đã dùng.",
    "Trả kết quả bằng tra_ket_qua.",
  ].join("\n")
}

function verifyPrompt(r: Ranked, place: number, n: number, lens: string) {
  return [
    `Phản biện thẻ điểm của mã ${r.card.ticker}, đang xếp hạng ${place}/${n} (điểm ${num(r.score, 1)}). Góc nhìn của bạn: ${lens}.`,
    EVIDENCE_NOTE,
    evidence(JSON.stringify(r.card), "thẻ điểm do agent khác lập"),
    "- Kiểm lại bằng tool 2–3 số liệu quyết định thứ hạng (P/E, ROE, tăng trưởng LNST…). Số sai hoặc khác kỳ ghi vào so_lieu_sai kèm giá trị đúng, nguồn, thời điểm.",
    "- giu_nguyen=true chỉ khi các số đó khớp và điểm hợp lý; nghi ngờ thì để false. dieu_chinh là điểm cộng/trừ (−3..3) cho tổng điểm.",
    "Trả kết quả bằng tra_ket_qua.",
  ].join("\n")
}

function refereePrompt(rows: Ranked[], tieuChi: string | undefined, missing: string[], unverified: boolean) {
  const data = rows.map((r, i) => ({ hang: i + 1, tong_diem: Number(r.score.toFixed(1)), ...r.card, ...(r.note ? { phan_bien: r.note } : {}) }))
  return [
    `Viết kết quả sàng lọc ${rows.length} mã cho người dùng${tieuChi ? ` (tiêu chí: ${tieuChi})` : ""}. Thứ hạng đã được tính; không xếp lại.`,
    EVIDENCE_NOTE,
    evidence(JSON.stringify(data), "thẻ điểm và kết quả phản biện"),
    "Trình bày bằng tiếng Việt, gọn:",
    "1. Bảng xếp hạng: hạng, mã, điểm, P/E, P/B, ROE, tăng trưởng LNST, một ghi chú ngắn (điểm mạnh hoặc rủi ro chính, bị phản biện thì nói). Một dòng nguồn và thời điểm dữ liệu dưới bảng.",
    "2. Nhóm dẫn đầu nổi bật ở đâu, nhóm cuối yếu ở đâu (2–4 gạch đầu dòng, có số).",
    "3. Kịch bản cho nhóm dẫn đầu: tích cực / cơ sở / tiêu cực, mỗi kịch bản kèm điều kiện kích hoạt. Không khuyến nghị mua, bán hay tỷ trọng.",
    `4. Giới hạn: ${[missing.length > 0 ? `không lấy được dữ liệu của ${missing.join(", ")}` : "", unverified ? "thứ hạng chưa được phản biện ở quy mô này" : "", "số liệu thiếu trong các thẻ"].filter(Boolean).join("; ")}.`,
    "Không gọi tool, trừ khi cần đối chiếu một con số mâu thuẫn.",
  ].join("\n")
}

/** The ranking as a table from code: kept under the referee's text, and the whole result when it fails. */
export function rankingTable(rows: Ranked[]) {
  return table(
    ["Hạng", "Mã", "Điểm", "P/E", "P/B", "ROE %", "Tăng trưởng LNST %", "Dữ liệu", "Ghi chú"],
    rows.map((r, i) => [i + 1, r.card.ticker, num(r.score, 1), num(r.card.chi_so.pe, 1), num(r.card.chi_so.pb, 1), num(r.card.chi_so.roe, 1), num(r.card.chi_so.tang_truong_lnst, 1), r.card.data_time, r.note]),
  )
}

async function run(ctx: DeskContext<Args>): Promise<string> {
  const { tier, top } = plan(ctx.args, ctx.size)
  const tickers = capList(ctx, unique(ctx.args.tickers), tier.tickers, "mã")

  ctx.phase("Thu thập")
  const cards = (await ctx.pipeline(tickers, (t: string) =>
    ctx.agent<Scorecard>(cardPrompt(t, ctx.args.tieu_chi), { label: `thẻ điểm ${t}`, type: "co-ban", schema: SCORECARD, effort: "low", maxSteps: STEPS.card }),
  )) as (Scorecard | null)[]
  const valid = cards.flatMap((c, i) => (c ? [{ ...c, ticker: tickers[i]! }] : []))
  const missing = tickers.filter((_, i) => !cards[i])
  if (missing.length > 0) ctx.log(`Không lấy được thẻ điểm: ${missing.join(", ")}`)
  if (valid.length < 2) {
    return `Không đủ dữ liệu để sàng lọc: chỉ lấy được ${valid.length}/${tickers.length} thẻ điểm${missing.length ? ` (thiếu ${missing.join(", ")})` : ""}. Có thể do hết quota hoặc nguồn dữ liệu lỗi; chạy tiếp bằng /desk resume.`
  }

  let ranked = rank(valid, ctx.args.tieu_chi)
  ctx.log(valid.length > 10 ? `Xếp hạng ${valid.length} mã: điểm thẻ kết hợp z-score các chỉ số.` : `Xếp hạng ${valid.length} mã theo điểm thẻ có trọng số.`)

  const k = Math.min(top, ranked.length)
  if (k > 0 && tier.votes > 0 && !ctx.stopping()) {
    ctx.phase("Kiểm chứng")
    const head = ranked.slice(0, k)
    const judged = await ctx.parallel(
      head.map((r, place) => () =>
        ctx
          .parallel(
            Array.from({ length: tier.votes }, (_, v) => () =>
              ctx.agent<Verdict>(verifyPrompt(r, place + 1, ranked.length, LENSES[v % LENSES.length]!), {
                label: `phản biện ${r.card.ticker} #${v + 1}`,
                type: "phan-bien",
                schema: VERDICT,
                effort: "high",
                maxSteps: STEPS.verify,
              }),
            ),
          )
          .then((votes) => ({ r, votes: votes.filter((v): v is Verdict => !!v) })),
      ),
    )
    const notes = new Map<string, { adjust: number; note: string }>()
    for (const j of judged) {
      if (!j) continue
      if (j.votes.length === 0) {
        notes.set(j.r.card.ticker, { adjust: 0, note: "chưa phản biện được (agent lỗi)" })
        continue
      }
      const refuted = j.votes.filter((v) => !v.giu_nguyen).length
      const adjust = j.votes.reduce((a, v) => a + v.dieu_chinh, 0) / j.votes.length
      const wrong = j.votes.flatMap((v) => v.so_lieu_sai).slice(0, 2)
      const note =
        refuted * 2 >= j.votes.length
          ? `bị phản biện (${refuted}/${j.votes.length})${wrong.length ? `: ${wrong.join("; ")}` : ""}`
          : `giữ hạng (${j.votes.length - refuted}/${j.votes.length})`
      notes.set(j.r.card.ticker, { adjust, note })
    }
    ranked = ranked
      .map((r) => {
        const n = notes.get(r.card.ticker)
        return n ? { ...r, score: Math.max(0, Math.min(10, r.score + n.adjust)), note: n.note } : r
      })
      .sort((a, b) => b.score - a.score || a.card.ticker.localeCompare(b.card.ticker))
  }

  const tableText = rankingTable(ranked)
  if (ctx.stopping()) return `Run bị cắt trước bước tổng hợp. Bảng xếp hạng theo thẻ điểm:\n\n${tableText}`
  ctx.phase("Tổng hợp")
  const report = await ctx
    .agent<string>(refereePrompt(ranked, ctx.args.tieu_chi, missing, tier.votes === 0), { label: "tổng hợp xếp hạng", type: "tong-hop", maxSteps: STEPS.referee })
    .catch(() => null)
  return report ? `${report}\n\n**Bảng điểm (tính bằng code, để đối chiếu):**\n\n${tableText}` : `Bước tổng hợp lỗi; bảng xếp hạng theo thẻ điểm:\n\n${tableText}`
}

export const sangLoc: Playbook<Args, string> = {
  meta: {
    name: "sang-loc",
    version: "1",
    description: "Sàng lọc và xếp hạng nhiều mã: thẻ điểm cơ bản từng mã (song song), xếp hạng bằng code, phản biện các mã dẫn đầu, bảng xếp hạng kèm kịch bản",
    whenToUse: "So sánh, xếp hạng hoặc lọc từ 2 mã trở lên theo cơ bản/định giá (ví dụ 8 mã ngân hàng, rổ VN30 theo ROE). 1 mã thì không dùng.",
    args: Args,
    agentTypes: ["co-ban", "phan-bien", "tong-hop"],
    phases: ["Thu thập", "Kiểm chứng", "Tổng hợp"],
    estimate(args, size) {
      const { tier, n, top } = plan(args, size)
      const votes = top * tier.votes
      return { agents: n + votes + 1, requests: n * STEPS.card + votes * STEPS.verify + STEPS.referee }
    },
    summarize: (args) => listSummary(unique(args.tickers), "mã") + (args.tieu_chi ? ` · ${args.tieu_chi}` : ""),
  },
  run,
}
