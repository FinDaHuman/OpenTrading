import { authFile } from "../../src/core/paths"
import { render, useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { ChartData } from "../../src/core/tools/chart/data"
import type { ToolResult } from "../../src/core/tools/types"
import { chartCompareTool, type ChartCompareInput } from "../../src/core/tools/chart/compare"
import { chartDepthTool, chartRenderTool, type ChartRenderInput } from "../../src/core/tools/chart/render"
import { color } from "../../src/tui/theme"
import { ChartBox } from "../../src/tui/ui/chart-box"

/**
 * Data THẬT từng skill có hook Trực quan hóa: fetch MCP → vẽ mọi case + diễn giải.
 * Cách chạy: bun scripts/skills-visualization.tsx
 * Pager: ←/→ chuyển skill (21) · ↑/↓ chuyển chart trong skill · q thoát.
 * Mỗi skill tải data khi mở lần đầu (cache), thiếu data thì báo trung thực.
 */
const ctx = () => ({ signal: new AbortController().signal, callId: "demo" })
const renderTool = chartRenderTool()
const compareTool = chartCompareTool()
const chartOf = async (input: ChartRenderInput) => ((await renderTool.execute(input, ctx())) as ToolResult).chart!
const compareOf = async (input: ChartCompareInput) => ((await compareTool.execute(input, ctx())) as ToolResult).chart!

type Page = { note: string; data?: ChartData; explain: string } | { note: string; error: string }
type SkillSec = { skill: string; hook: string; load: () => Promise<Page[]> }

// ---- MCP (connect 1 lần, tools fetch song song theo skill) ----
let mcp: Client | undefined
let mcpError = ""
try {
  const auth = (await Bun.file(authFile()).json()) as Record<string, { key: string }>
  mcp = new Client({ name: "skills-demo", version: "0.1.0" })
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL("https://opentrading-mcp-web.onrender.com/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${auth._env_OPENTRADING_MCP_TOKEN.key}` } },
    }),
  )
} catch (e) {
  mcpError = `Không nối được MCP: ${(e as Error).message.slice(0, 120)}`
}

async function call(name: string, args: Record<string, unknown>): Promise<{ data: unknown; warnings: string[] } | { error: string }> {
  if (!mcp) return { error: mcpError || "MCP chưa nối" }
  try {
    const r = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 170000 } as never)
    const text = (r.content as { type: string; text?: string }[] | undefined)?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? ""
    const j = JSON.parse(text) as { data?: unknown; warnings?: string[]; availability?: string }
    if (j.availability && j.availability !== "available") {
      return { error: `${name}: ${(j.warnings ?? []).join("; ") || j.availability}` }
    }
    return { data: j.data, warnings: j.warnings ?? [] }
  } catch (e) {
    return { error: `${name}: ${(e as Error).message.slice(0, 100)}` }
  }
}
const isErr = (r: unknown): r is { error: string } => !!r && typeof r === "object" && "error" in (r as object)

// ---- helpers parse ----
type Bar = { o: number; h: number; l: number; c: number; v?: number }
const closesOf = (candles: { c: number }[]) => candles.map((b) => b.c)
const pct = (v: number) => v * 100

// ---- 21 skills ----
const skills: SkillSec[] = [
  {
    skill: "co-ban-chuyen-sau",
    hook: "P&L 4 quý, holders %, dividends, KH năm %",
    load: async () => {
      const pages: Page[] = []
      const holders = await call("holders", { symbol: "VCB" })
      if (!isErr(holders)) {
        const hs = ((holders.data as { holders?: { share_holder: string; share_own_percent: number }[] }).holders ?? []).filter((h) => h.share_own_percent > 0).slice(0, 5)
        if (hs.length >= 2) {
          pages.push({
            note: "pie: tỷ trọng cổ đông lớn VCB",
            data: await chartOf({ kind: "pie", symbol: "VCB", series: hs.map((h) => h.share_own_percent * 100), labels: hs.map((h) => h.share_holder.slice(0, 14)) }),
            explain: `NHNN và Mizuho giữ ~${(hs.slice(0, 2).reduce((s, h) => s + h.share_own_percent, 0) * 100).toFixed(1)}% — free-float thấp, giá dễ biến động khi khối ngoại mua/bán.`,
          })
        }
      } else pages.push({ note: "pie holders", error: holders.error })
      const divs = await call("dividends_splits", { symbol: "VCB" })
      if (!isErr(divs)) {
        const cash = ((divs.data as { events?: { value_per_share: number; exright_date: string; is_cash_dividend: boolean }[] }).events ?? []).filter((e) => e.is_cash_dividend)
        const byYear = new Map<string, number>()
        for (const e of cash) {
          const y = (e.exright_date ?? "").slice(0, 4) || "?"
          byYear.set(y, (byYear.get(y) ?? 0) + e.value_per_share)
        }
        const years = [...byYear.keys()].sort().slice(-6)
        if (years.length >= 2) {
          pages.push({
            note: "bar: cổ tức tiền mặt VCB theo năm (đồng/cp)",
            data: await chartOf({ kind: "bar", symbol: "VCB", series: years.map((y) => byYear.get(y)!), labels: years }),
            explain: `Cổ tức ${years[0]}→${years[years.length - 1]}: ${byYear.get(years[0])}đ → ${byYear.get(years[years.length - 1])}đ/cp — chính sách chi trả ổn định, hợp bank quốc doanh.`,
          })
        }
      } else pages.push({ note: "bar dividends", error: divs.error })
      pages.push({ note: "stacked P&L 4 quý", error: "financial_detail: VIETSTOCK_COOKIE_HEADER/HAR not configured — thiếu data BCTC nên không vẽ stacked, báo trung thực theo skill." })
      return pages
    },
  },
  {
    skill: "danh-gia-truoc-bctc",
    hook: "trend giá, consensus, sentiment score, NN flow theo phiên, scenario %",
    load: async () => {
      const pages: Page[] = []
      const [q, se, mf] = await Promise.all([
        call("vn_quote_history", { symbol: "HPG", days: 30 }),
        call("sentiment_score", { symbol: "HPG" }),
        call("money_flow", { symbols: ["HPG"] }),
      ])
      if (!isErr(q)) {
        const candles = (q.data as { candles: { o: number; h: number; l: number; c: number }[] }).candles ?? []
        if (candles.length >= 5) {
          pages.push({
            note: "line: trend giá HPG 30 phiên trước BCTC",
            data: await chartOf({ kind: "line", symbol: "HPG", series: closesOf(candles) }),
            explain: `Giá cuối ${candles[candles.length - 1]!.c} so đầu kỳ ${candles[0]!.c} — trend trước BCTC cho biết kỳ vọng đã phản ánh bao nhiêu.`,
          })
        }
      } else pages.push({ note: "line trend HPG", error: q.error })
      if (!isErr(se)) {
        const s = se.data as { score_heuristic: number; posts: number }
        pages.push({
          note: "gauge: sentiment HPG",
          data: await chartOf({ kind: "gauge", symbol: "HPG sentiment", value: (s.score_heuristic + 1) * 50, max: 100 }),
          explain: `Heuristic ${s.score_heuristic} trên ${s.posts} posts (${s.score_heuristic > 0.3 ? "lạc quan" : s.score_heuristic < -0.3 ? "bi quan" : "trung tính"}) — crowd hưng phấn trước BCTC thường là cờ FOMO.`,
        })
      } else pages.push({ note: "gauge sentiment", error: se.error })
      if (!isErr(mf)) {
        const sessions = (mf.data as { flow: [unknown[], { BuyVal: number; SellVal: number }[]] }).flow[1].slice(-5)
        if (sessions.length >= 1) {
          pages.push({
            note: "waterfall: dòng tiền ròng HPG 5 phiên",
            data: await chartOf({ kind: "waterfall", symbol: "HPG", start: 0, series: sessions.map((s) => s.BuyVal - s.SellVal), labels: sessions.map((_, i) => `P${i + 1}`) }),
            explain: `Ròng ${sessions.reduce((t, s) => t + s.BuyVal - s.SellVal, 0).toFixed(0)} tỷ/5 phiên — tiền vào trước BCTC hay rút ra quyết định grade.`,
          })
        }
      } else pages.push({ note: "waterfall money flow", error: mf.error })
      return pages
    },
  },
  {
    skill: "dinh-gia-chuyen-sau",
    hook: "PER/PB hiện vs TB 2–3y, fair value % upside",
    load: async () => {
      const [v, q] = await Promise.all([call("valuation_run", { symbol: "FPT" }), call("vn_quote_history", { symbol: "FPT", days: 30 })])
      const pages: Page[] = []
      if (!isErr(q)) {
        const candles = (q.data as { candles: { c: number }[] }).candles ?? []
        const method = !isErr(v) ? `(${(v.data as { method: string }).method}, giá ${(v.data as { price: number }).price})` : "(valuation_run chỉ trả method+price)"
        pages.push({
          note: `line: giá FPT 30 phiên ${method}`,
          data: await chartOf({ kind: "line", symbol: "FPT", series: closesOf(candles) }),
          explain: `Tool định giá chỉ trả phương pháp + giá hiện tại — upside % do model tính từ fair value, chart giá cho thấy vị trí hiện tại trong biên độ tháng.`,
        })
      } else pages.push({ note: "line giá FPT", error: q.error })
      return pages
    },
  },
  {
    skill: "ky-thuat-chuyen-sau",
    hook: "chuỗi OHLC/giá, RSI/MACD/Stoch theo khung, sổ lệnh",
    load: async () => {
      const pages: Page[] = []
      const [o, st, ob] = await Promise.all([
        call("vn_equity_ohlcv", { symbol: "FPT", count: 30 }),
        call("signals_technical", { symbol: "FPT" }),
        call("dnse_orderbook", { symbol: "FPT" }),
      ])
      if (!isErr(o)) {
        const bars = (o.data as { bars: (Bar & { time: string; volume: number })[] }).bars ?? []
        if (bars.length >= 5) {
          pages.push({
            note: "nến FPT + volume + trục X",
            data: await chartOf({ kind: "candlestick", symbol: "FPT", bars: bars.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })), times: bars.map((b) => b.time.slice(5, 10)) }),
            explain: `Nến + volume cùng cột: nến xanh vol to = tiền vào thật; nến đỏ vol to = phân phối. Trục X khớp cột nến.`,
          })
        }
      } else pages.push({ note: "nến FPT", error: o.error })
      if (!isErr(st)) {
        const rsi = (st.data as { rsi14: number }).rsi14
        pages.push({
          note: "gauge: RSI(14) FPT",
          data: await chartOf({ kind: "gauge", symbol: "FPT RSI14", value: rsi, max: 100 }),
          explain: `RSI ${rsi} — ${rsi > 70 ? "quá mua, chờ pullback" : rsi < 30 ? "quá bán, canh hồi" : "vùng trung tính"}.`,
        })
      } else pages.push({ note: "gauge RSI", error: st.error })
      if (!isErr(ob)) {
        const d = ob.data as Record<string, unknown>
        const bids = ((d.bids ?? d.bid ?? d.buy ?? []) as { price: number; volume: number }[]).slice(0, 10)
        const asks = ((d.asks ?? d.ask ?? d.sell ?? []) as { price: number; volume: number }[]).slice(0, 10)
        if (bids.length || asks.length) {
          const res = (await chartDepthTool().execute({ symbol: "FPT", bids, asks, depth: 5 }, ctx())) as ToolResult
          pages.push({
            note: "depth: sổ lệnh FPT (ASK đỏ / BID xanh)",
            data: res.chart!,
            explain: `Chênh bid/ask + độ dày các mức cho biết cung cầu tức thời — mỏng + spread rộng thì không đua lệnh.`,
          })
        } else {
          pages.push({ note: "depth orderbook", error: "Sổ lệnh rỗng cả hai bên (ngoài giờ DNSE thì đúng là vậy) — báo trung thực, không retry." })
        }
      } else pages.push({ note: "depth orderbook", error: ob.error })
      return pages
    },
  },
  {
    skill: "kiem-chien-luoc-backtest",
    hook: "net return best/worst vs benchmark, CAR ±N, seasonality 12 tháng, ma trận tương quan",
    load: async () => {
      const pages: Page[] = []
      const [qb, st, se, cm] = await Promise.all([
        call("quant_backtest", { symbol: "VCB", strategy: "sma" }),
        call("backtest_strategies", { symbol: "VCB", strategy: "sma_cross" }),
        call("seasonality", { symbol: "VCB" }),
        call("correlation_matrix", { symbols: ["VCB", "HPG", "VNM"], days: 60 }),
      ])
      if (!isErr(qb) && !isErr(st)) {
        const q = qb.data as { gross_return: number; net_return: number }
        const s = st.data as { net_return: number; trades: number; win_rate: number; max_drawdown: number }
        pages.push({
          note: "bar diverging: so chiến lược VCB (gross/net, sma_cross)",
          data: await chartOf({ kind: "bar", symbol: "VCB backtest", series: [pct(q.gross_return), pct(q.net_return), pct(s.net_return)], labels: ["sma gross", "sma net", "sma_cross"] }),
          explain: `sma_cross net ${(s.net_return * 100).toFixed(1)}% sau ${s.trades} trades (win ${(s.win_rate * 100).toFixed(0)}%, maxDD ${(s.max_drawdown * 100).toFixed(0)}%) — cả 3 cột đỏ = chiến lược thua buy-hold kỳ này.`,
        })
      } else pages.push({ note: "bar backtest", error: isErr(qb) ? qb.error : (st as { error: string }).error })
      if (!isErr(se)) {
        const months = (se.data as { months: Record<string, { mean_pct: number }> }).months
        const keys = Object.keys(months).sort((a, b) => Number(a) - Number(b))
        pages.push({
          note: "bar diverging: seasonality VCB (mean % theo tháng)",
          data: await chartOf({ kind: "bar", symbol: "VCB seasonality", series: keys.map((k) => months[k]!.mean_pct), labels: keys.map((k) => `T${k}`) }),
          explain: `Tháng xanh/đỏ theo mean lịch sử — chỉ dùng làm cửa sổ thời gian (vd months=[1]), không phải tín hiệu mua.`,
        })
      } else pages.push({ note: "bar seasonality", error: se.error })
      if (!isErr(cm)) {
        const m = (cm.data as { matrix: Record<string, Record<string, number>> }).matrix
        const syms = Object.keys(m)
        pages.push({
          note: "heatmap: tương quan VCB-HPG-VNM",
          data: await chartOf({ kind: "heatmap", symbol: "tương quan 60 phiên", matrix: syms.map((r) => syms.map((c) => m[r]![c]!)), labels: [...syms, ...syms] }),
          explain: `VCB-HPG ${(m.VCB!.HPG! * 1).toFixed(2)} — tương quan càng cao càng ít tác dụng đa dạng hóa khi backtest đa mã.`,
        })
      } else pages.push({ note: "heatmap correlation", error: cm.error })
      return pages
    },
  },
  {
    skill: "phan-tich-chuyen-sau-1-ma",
    hook: "chuỗi OHLC/giá (nến 30–90 phiên), P&L 4 quý",
    load: async () => {
      const q = await call("vn_quote_history", { symbol: "VCB", days: 60 })
      if (isErr(q)) return [{ note: "nến VCB", error: q.error }]
      const candles = (q.data as { candles: { o: number; h: number; l: number; c: number; v: number }[] }).candles ?? []
      if (candles.length < 5) return [{ note: "nến VCB", error: "thiếu nến (<5), không vẽ per skill" }]
      return [
        {
          note: "nến VCB 60 phiên + volume",
          data: await chartOf({ kind: "candlestick", symbol: "VCB", bars: candles.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })) }),
          explain: `Khung chính của phân tích 8 bước: trend, HH/LL và volume xác nhận — đọc trước khi vào sub-skill kỹ thuật/định giá.`,
        },
      ]
    },
  },
  {
    skill: "so-sanh-cung-nganh",
    hook: "PE/ROE/momentum theo peers, correlation",
    load: async () => {
      const pages: Page[] = []
      const [pe, qv, qi] = await Promise.all([
        call("compare_equities", { symbols: ["VCB", "BID", "CTG"] }),
        call("vn_quote_history", { symbol: "VCB", days: 30 }),
        call("vn_index_ohlcv", { symbol: "VNINDEX", count: 30 }),
      ])
      if (!isErr(pe)) {
        const rows = (pe.data as { rows: { symbol: string; quote: { percent_change: number } }[] }).rows ?? []
        if (rows.length >= 2) {
          pages.push({
            note: "bar diverging: % giá bank hôm nay",
            data: await chartOf({ kind: "bar", symbol: "bank %", series: rows.map((r) => r.quote.percent_change), labels: rows.map((r) => r.symbol) }),
            explain: `Momentum phiên: mã xanh đứng đầu bảng là leader ngắn hạn của ngành bank.`,
          })
        }
      } else pages.push({ note: "bar peers", error: pe.error })
      if (!isErr(qv) && !isErr(qi)) {
        const vc = closesOf((qv.data as { candles: { c: number }[] }).candles ?? [])
        const vi = ((qi.data as { bars: { close: number }[] }).bars ?? []).map((b) => b.close)
        if (vc.length >= 2 && vi.length >= 2) {
          pages.push({
            note: "compare: VCB vs VNINDEX (% từ điểm đầu)",
            data: await compareOf({ title: "VCB vs VNINDEX", series: [{ label: "VCB", values: vc }, { label: "VNINDEX", values: vi }] }),
            explain: `VCB ${vc[vc.length - 1]! >= vc[0]! ? "khỏe hơn" : "yếu hơn"} index trong 30 phiên — sức mạnh tương đối quyết định có chọn leader không.`,
          })
        }
      } else pages.push({ note: "compare VCB vs index", error: isErr(qv) ? qv.error : (qi as { error: string }).error })
      return pages
    },
  },
  {
    skill: "phan-tich-vang-ty-gia",
    hook: "giá vàng + SMA/RSI, premium %, USDVND, rate gap",
    load: async () => {
      const pages: Page[] = []
      const yc = await call("yf_commodities", { tickers: ["GC=F", "CL=F"] })
      if (!isErr(yc)) {
        const items = (yc.data as { items: { ticker: string; price: number; prev: number }[] }).items ?? []
        if (items.length >= 1) {
          pages.push({
            note: "bar diverging: vàng/dầu vs phiên trước",
            data: await chartOf({ kind: "bar", symbol: "hàng hóa", series: items.map((x) => ((x.price - x.prev) / x.prev) * 100), labels: items.map((x) => x.ticker) }),
            explain: `Vàng ${items[0]!.price} attractive khi đỏ cùng DXY mạnh — SJC premium theo sau với độ trễ.`,
          })
        }
      } else pages.push({ note: "bar hàng hóa", error: yc.error })
      pages.push({ note: "line SJC / XAUUSD series", error: "vn_retail_gold timed out; vn_msn_fx_gold chỉ trả last bar (không có points array) — thiếu series nên không vẽ line, báo trung thực." })
      return pages
    },
  },
  {
    skill: "phan-tich-sentiment",
    hook: "sentiment score ±",
    load: async () => {
      const se = await call("sentiment_score", { symbol: "FPT" })
      if (isErr(se)) return [{ note: "gauge sentiment", error: se.error }]
      const s = se.data as { score_heuristic: number; posts: number }
      return [
        {
          note: "gauge: sentiment FPT",
          data: await chartOf({ kind: "gauge", symbol: "FPT sentiment", value: (s.score_heuristic + 1) * 50, max: 100 }),
          explain: `Heuristic ${s.score_heuristic} trên ${s.posts} posts — crowd ≠ fundamentals, FOMO khi điểm quá lạc quan.`,
        },
      ]
    },
  },
  {
    skill: "nhip-dap-crypto",
    hook: "%24h các coin, funding, fear/greed",
    load: async () => {
      const pages: Page[] = []
      const [bc, fg] = await Promise.all([call("vn_crypto_ohlv", { symbol: "BTC", count: 30 }), call("world_fear_greed", {})])
      if (!isErr(bc)) {
        const bars = (bc.data as { bars: { time: string; open: number; high: number; low: number; close: number; volume: number }[] }).bars ?? []
        if (bars.length >= 5) {
          pages.push({
            note: "nến BTC (VND) + volume",
            data: await chartOf({ kind: "candlestick", symbol: "BTC", bars: bars.map((b) => ({ o: b.open / 1e9, h: b.high / 1e9, l: b.low / 1e9, c: b.close / 1e9, v: b.volume })), times: bars.map((b) => b.time.slice(5, 10)) }),
            explain: `Giá đơn vị tỷ VND (chia 1e9 cho gọn trục). crypto_spot USD hiện lỗi 418 nên dùng nến VND.`,
          })
        }
      } else pages.push({ note: "nến BTC", error: bc.error })
      if (!isErr(fg)) {
        const series = (fg.data as { series: { v: string }[] }).series ?? []
        const v = Number(series[0]?.v ?? 50)
        pages.push({
          note: "gauge: fear & greed crypto",
          data: await chartOf({ kind: "gauge", symbol: "Fear & Greed", value: v, max: 100 }),
          explain: `Index ${v}/100 — cực tham lam là lúc deskill dần, cực sợ hãi là lúc tìm điểm vào.`,
        })
      } else pages.push({ note: "gauge fear/greed", error: fg.error })
      return pages
    },
  },
  {
    skill: "du-doan-fed",
    hook: "odds % per scenario, US10Y/2Y, curve",
    load: async () => {
      const pages: Page[] = []
      const [od, fr] = await Promise.all([call("world_prediction_odds", { query: "Fed" }), call("fred_series", { series_id: "DGS10", limit: 30 })])
      if (!isErr(od)) {
        const evs = (od.data as { events: { title: string; volume24h: number; outcomes: { outcome: string; prob_pct: number }[] }[] }).events ?? []
        const fed = evs.find((e) => /fed/i.test(e.title)) ?? evs[0]
        if (fed && fed.outcomes?.length >= 2) {
          pages.push({
            note: `bar: odds "${fed.title.slice(0, 40)}"`,
            data: await chartOf({ kind: "bar", symbol: "Fed odds %", series: fed.outcomes.map((o) => o.prob_pct), labels: fed.outcomes.map((o) => o.outcome.slice(0, 12)) }),
            explain: `Thị trường định giá ${(fed.outcomes.find((o) => o.prob_pct > 50)?.outcome ?? "?")} ${(fed.outcomes.find((o) => o.prob_pct > 50)?.prob_pct ?? 0).toFixed(1)}% — đặt cược ngược khi prob >90% mà catalyst yếu.`,
          })
        }
      } else pages.push({ note: "bar Fed odds", error: od.error })
      if (!isErr(fr)) {
        const pts = (fr.data as { points: { t: string; v: string }[] }).points ?? []
        if (pts.length >= 2) {
          pages.push({
            note: "line: US10Y (DGS10)",
            data: await chartOf({ kind: "line", symbol: "US10Y %", series: pts.map((p) => Number(p.v)), times: pts.map((p) => p.t.slice(5)) }),
            explain: `US10Y ${pts[pts.length - 1]!.v}% — vượt đỉnh gần nhất thì áp lực lên VNINDEX qua kênh tỷ giá.`,
          })
        }
      } else pages.push({ note: "line US10Y", error: fr.error })
      return pages
    },
  },
  {
    skill: "du-doan-polymarket",
    hook: "prob_pct per outcome",
    load: async () => {
      const od = await call("world_prediction_odds", { query: "Fed" })
      if (isErr(od)) return [{ note: "bar outcomes", error: od.error }]
      const evs = (od.data as { events: { title: string; outcomes: { outcome: string; prob_pct: number }[] }[] }).events ?? []
      const fed = evs.find((e) => /fed/i.test(e.title)) ?? evs[0]
      if (!fed?.outcomes?.length) return [{ note: "bar outcomes", error: "thiếu outcomes, không vẽ" }]
      return [
        {
          note: `bar: outcomes "${fed.title.slice(0, 40)}"`,
          data: await chartOf({ kind: "bar", symbol: "prob %", series: fed.outcomes.map((o) => o.prob_pct), labels: fed.outcomes.map((o) => o.outcome.slice(0, 12)) }),
          explain: `Yes ${fed.outcomes[0]!.prob_pct}% vs No — chênh lệch càng lớn càng ít edge, chỉ vào khi có thông tin riêng.`,
        },
      ]
    },
  },
  {
    skill: "danh-gia-tinh-hinh-chinh-tri-toan-cau",
    hook: "odds % per event, GDELT counts",
    load: async () => {
      const od = await call("world_prediction_odds", { query: "election" })
      if (isErr(od)) return [{ note: "bar odds events", error: od.error }]
      const evs = (od.data as { events: { title: string; volume24h: number }[] }).events ?? []
      const top = evs.slice(0, 5)
      if (!top.length) return [{ note: "bar odds events", error: "không có events, không vẽ" }]
      return [
        {
          note: "bar: volume24h top events chính trị",
          data: await chartOf({ kind: "bar", symbol: "vol24h USD", series: top.map((e) => e.volume24h / 1e6), labels: top.map((e) => e.title.slice(0, 12)) }),
          explain: `Volume tập trung = sự kiện market đang định giá; GDELT (event_stats) hiện timeout nên phần tin chỉ dùng bảng.`,
        },
      ]
    },
  },
  {
    skill: "danh-gia-tinh-hinh-xung-dot",
    hook: "oil/gold vs baseline, escalation odds %",
    load: async () => {
      const yc = await call("yf_commodities", { tickers: ["GC=F", "CL=F"] })
      if (isErr(yc)) return [{ note: "bar oil/gold", error: yc.error }]
      const items = (yc.data as { items: { ticker: string; price: number; prev: number }[] }).items ?? []
      return [
        {
          note: "bar diverging: vàng/dầu vs phiên trước",
          data: await chartOf({ kind: "bar", symbol: "xung đột → hàng hóa", series: items.map((x) => ((x.price - x.prev) / x.prev) * 100), labels: items.map((x) => (x.ticker === "GC=F" ? "Vàng" : "Dầu")) }),
          explain: `Vàng xanh + dầu xanh cùng lúc = thị trường định giá leo thang thật; GDELT timeout nên intensity xung đột đọc bằng bảng tin.`,
        },
      ]
    },
  },
  {
    skill: "bat-on-quoc-gia",
    hook: "GDELT counts vs baseline, oil/gold",
    load: async () => {
      const yc = await call("yf_commodities", { tickers: ["GC=F", "CL=F"] })
      if (isErr(yc)) return [{ note: "bar oil/gold", error: `${yc.error} (GDELT event_stats cũng timeout — low-coverage ≠ stable)` }]
      const items = (yc.data as { items: { ticker: string; price: number; prev: number }[] }).items ?? []
      return [
        {
          note: "bar: kênh tác động thị trường (vàng/dầu)",
          data: await chartOf({ kind: "bar", symbol: "kênh thị trường", series: items.map((x) => ((x.price - x.prev) / x.prev) * 100), labels: items.map((x) => (x.ticker === "GC=F" ? "Vàng" : "Dầu")) }),
          explain: `GDELT timeout nên không vẽ được event counts (low-coverage ≠ stable) — chỉ còn kênh giá hàng hóa để đo tác động.`,
        },
      ]
    },
  },
  {
    skill: "danh-gia-vi-mo-viet-nam",
    hook: "GDP/CPI yoy series, XNK, rates",
    load: async () => {
      const sb = await call("sbv_rates", {})
      if (isErr(sb)) return [{ note: "bar SBV rates", error: sb.error }]
      const policy = (sb.data as { policy: { name: string; value: string }[] }).policy ?? []
      const rows = policy.map((p) => ({ name: p.name.replace("Lãi suất ", ""), v: Number(p.value.replace("%", "").replace(",", ".")) })).filter((r) => Number.isFinite(r.v))
      if (!rows.length) return [{ note: "bar SBV rates", error: "không parse được rates" }]
      return [
        {
          note: "bar: lãi suất điều hành SBV (%)",
          data: await chartOf({ kind: "bar", symbol: "SBV %", series: rows.map((r) => r.v), labels: rows.map((r) => r.name.slice(0, 12)) }),
          explain: `Tái cấp vốn ${rows.find((r) => /cấp vốn/.test(r.name))?.v ?? "?"}% — GDP/CPI/XNK cần Vietstock auth (thiếu) nên phần vĩ mô còn lại đọc bảng.`,
        },
      ]
    },
  },
  {
    skill: "danh-gia-vi-mo-quoc-te",
    hook: "10Y/2Y, CPI, fear/greed, curve",
    load: async () => {
      const pages: Page[] = []
      const [fr, fg] = await Promise.all([call("fred_series", { series_id: "DGS10", limit: 30 }), call("world_fear_greed", {})])
      if (!isErr(fr)) {
        const pts = (fr.data as { points: { t: string; v: string }[] }).points ?? []
        if (pts.length >= 2) {
          pages.push({
            note: "line: US10Y chu kỳ hiện tại",
            data: await chartOf({ kind: "line", symbol: "US10Y %", series: pts.map((p) => Number(p.v)), times: pts.map((p) => p.t.slice(5)) }),
            explain: `Đọc cùng curve (yf_yield_curve hiện lỗi yfinance) — 10Y đi lên trong khi 2Y đứng = steepening, risk-on cho EM.`,
          })
        }
      } else pages.push({ note: "line US10Y", error: fr.error })
      if (!isErr(fg)) {
        const series = (fg.data as { series: { v: string; label: string }[] }).series ?? []
        const v = Number(series[0]?.v ?? 50)
        pages.push({
          note: "gauge: fear & greed toàn cầu",
          data: await chartOf({ kind: "gauge", symbol: "Fear & Greed", value: v, max: 100 }),
          explain: `${v}/100 (${series[0]?.label ?? "?"}) — cực trị 2 đầu là tín hiệu contrarian cho phân bổ risk-on/off.`,
        })
      } else pages.push({ note: "gauge fear/greed", error: fg.error })
      return pages
    },
  },
  {
    skill: "tim-co-hoi-bao-cao-ctck",
    hook: "upside % theo ticker",
    load: async () => {
      const pages: Page[] = []
      pages.push({ note: "bar diverging upside %", error: "upside % cần giá hiện tại từng mã (chưa có batch quotes) — demo dùng pie ratings bên dưới." })
      const an = await call("analyst_consensus", {})
      if (isErr(an)) {
        pages.push({ note: "pie ratings", error: an.error })
        return pages
      }
      const reports = (an.data as { reports: { rating: string }[] }).reports ?? []
      const counts = new Map<string, number>()
      for (const r of reports) counts.set(r.rating || "?", (counts.get(r.rating || "?") ?? 0) + 1)
      const keys = [...counts.keys()]
      if (keys.length < 2) {
        pages.push({ note: "pie ratings", error: "ít hơn 2 loại rating, không vẽ pie" })
        return pages
      }
      pages.push({
        note: `pie: phân bổ ${reports.length} khuyến nghị CTCK`,
        data: await chartOf({ kind: "pie", symbol: "ratings", series: keys.map((k) => counts.get(k)!), labels: keys.map((k) => k.slice(0, 12)) }),
        explain: `MUA áp đảo mà giá không lên = smart money chưa vào — kiểm chứng 2 mã top trước khi theo.`,
      })
      return pages
    },
  },
  {
    skill: "tim-kiem-tin-tuc",
    hook: "sentiment score nếu có (tin trình bày bảng)",
    load: async () => {
      const se = await call("sentiment_score", { symbol: "VCB" })
      if (isErr(se)) return [{ note: "gauge sentiment", error: se.error }]
      const s = se.data as { score_heuristic: number; posts: number }
      return [
        {
          note: "gauge: sentiment VCB (tin vẫn trình bày bảng)",
          data: await chartOf({ kind: "gauge", symbol: "VCB sentiment", value: (s.score_heuristic + 1) * 50, max: 100 }),
          explain: `Heuristic ${s.score_heuristic}/${s.posts} posts — điểm đám đông chỉ để đối chiếu, verdict tin vẫn đọc bảng 4 cột + nhãn CHƯA XÁC NHẬN.`,
        },
      ]
    },
  },
  {
    skill: "tin-tuc-nong-quoc-te",
    hook: "sentiment score nếu có (tin trình bày bảng)",
    load: async () => {
      const fg = await call("world_fear_greed", {})
      if (isErr(fg)) return [{ note: "gauge fear/greed", error: fg.error }]
      const series = (fg.data as { series: { v: string; label: string }[] }).series ?? []
      const v = Number(series[0]?.v ?? 50)
      return [
        {
          note: "gauge: fear & greed (bối cảnh tin TG)",
          data: await chartOf({ kind: "gauge", symbol: "Fear & Greed", value: v, max: 100 }),
          explain: `${v}/100 — tin nóng đọc kèm bối cảnh tham lam/sợ hãi để biết reaction giá đã phản ánh chưa.`,
        },
      ]
    },
  },
  {
    skill: "tin-tuc-nong-viet-nam",
    hook: "sentiment score nếu có (tin trình bày bảng)",
    load: async () => {
      const se = await call("sentiment_score", { symbol: "VCB" })
      if (isErr(se)) return [{ note: "gauge sentiment", error: se.error }]
      const s = se.data as { score_heuristic: number; posts: number }
      return [
        {
          note: "gauge: sentiment VCB (headline vẫn cần provenance)",
          data: await chartOf({ kind: "gauge", symbol: "VCB sentiment", value: (s.score_heuristic + 1) * 50, max: 100 }),
          explain: `Điểm ${s.score_heuristic} không thay thế provenance từng headline — headline thiếu nguồn thì chưa đạt.`,
        },
      ]
    },
  },
]

const cache = new Map<number, Page[]>()

function Demo() {
  const width = process.stdout.columns ?? 80
  const [si, setSi] = createSignal(0)
  const [ci, setCi] = createSignal(0)
  const [pages, setPages] = createSignal<Page[] | undefined>(undefined)
  const current = () => skills[si()]!
  const page = (): Page | undefined => pages()?.[Math.min(ci(), (pages()?.length ?? 1) - 1)]

  const load = (i: number) => {
    setCi(0)
    const hit = cache.get(i)
    if (hit) {
      setPages(hit)
      return
    }
    setPages(undefined)
    current()
    skills[i]!.load()
      .then((p) => {
        cache.set(i, p)
        setPages(p)
      })
      .catch((e) => setPages([{ note: "lỗi tải", error: String((e as Error)?.message ?? e).slice(0, 120) }]))
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "q" || evt.name === "escape") process.exit(0)
    if (evt.name === "right" || evt.name === "n") {
      const n = Math.min(skills.length - 1, si() + 1)
      if (n !== si()) {
        setSi(n)
        load(n)
      }
    }
    if (evt.name === "left" || evt.name === "p") {
      const n = Math.max(0, si() - 1)
      if (n !== si()) {
        setSi(n)
        load(n)
      }
    }
    if (evt.name === "down" || evt.name === "space" || evt.name === "enter") {
      const len = pages()?.length ?? 1
      setCi((c) => Math.min(len - 1, c + 1))
    }
    if (evt.name === "up") setCi((c) => Math.max(0, c - 1))
    if (evt.name === "home") {
      setSi(0)
      load(0)
    }
    if (evt.name === "end") {
      const n = skills.length - 1
      setSi(n)
      load(n)
    }
  })

  load(0)

  return (
    <box flexDirection="column" padding={1} backgroundColor={color.bg}>
      <text fg={color.tx}>{`Skills visualization ${si() + 1}/${skills.length} · ←/→ skill, ↑/↓ chart, q thoát`}</text>
      <text fg={color.tx3}>{`— skill: ${current().skill}`}</text>
      <text fg={color.tx3}>{`— hook data: ${current().hook}`}</text>
      {pages() === undefined ? (
        <text fg={color.tham}>Đang tải data thật từ MCP…</text>
      ) : (
        <>
          <text fg={color.tx}>{`— chart ${Math.min(ci(), (pages()?.length ?? 1) - 1) + 1}/${pages()?.length} · ${page()?.note}`}</text>
          {page() && "error" in page()! ? (
            <text fg={color.giam}>{`Thiếu data (trung thực, không vẽ): ${page()!.error}`}</text>
          ) : (
            <>
              <ChartBox data={(page() as { data: ChartData }).data} width={width - 4} />
              <text fg={color.tx2}>{`Diễn giải: ${(page() as { explain: string }).explain}`}</text>
            </>
          )}
        </>
      )}
    </box>
  )
}

await render(() => <Demo />, { exitOnCtrlC: true, targetFps: 5, backgroundColor: color.bg })
