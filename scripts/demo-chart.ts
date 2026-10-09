import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { chartRenderTool, type ChartRenderInput } from "../src/core/tools/chart/render"

/**
 * Demo chart mới: lấy data thật từ OpenTrading MCP rồi chạy qua chart_render.
 * Cách chạy: bun scripts/demo-chart.ts [kind] [symbol]
 * Không kind = vẽ tất cả kinds mới.
 */

type OhlcvBar = { time: string; open: number; high: number; low: number; close: number; volume: number }
type Candles = { t: string; o: number; h: number; l: number; c: number; v: number }

const auth = (await Bun.file(`${process.env.HOME}/.opentrading/auth.json`).json()) as Record<string, { key: string }>
const token = auth._env_OPENTRADING_MCP_TOKEN?.key
if (!token) throw new Error("Không thấy token MCP trong ~/.opentrading/auth.json")

const client = new Client({ name: "chart-demo", version: "0.1.0" })
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://opentrading-mcp-web.onrender.com/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
)
const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const r = await client.callTool({ name, arguments: args })
  const text = (r.content as { type: string; text?: string }[] | undefined)
    ?.filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
  try {
    return JSON.parse(text ?? "null")
  } catch {
    return text
  }
}
const ohlcv = async (sym: string, count = 20): Promise<OhlcvBar[]> =>
  ((await call("vn_equity_ohlcv", { symbol: sym, count })) as { data: { bars: OhlcvBar[] } }).data.bars
const closes = async (sym: string, days = 20): Promise<number[]> =>
  ((await call("vn_quote_history", { symbol: sym, days })) as { data: { candles: Candles[] } }).data.candles.map((b) => b.c)
const holders = async (sym: string): Promise<{ name: string; pct: number }[]> =>
  ((await call("holders", { symbol: sym })) as { data: { holders: { share_holder: string; share_own_percent: number }[] } }).data.holders
    .filter((h) => h.share_own_percent > 0)
    .slice(0, 5)
    .map((h) => ({ name: h.share_holder, pct: h.share_own_percent * 100 }))
const moneyFlow = async (sym: string, limit = 8): Promise<{ buy: number; sell: number; net: number }[]> =>
  ((await call("money_flow", { symbols: [sym] })) as { data: { flow: [unknown[], { BuyVal: number; SellVal: number }[]] } }).data.flow[1]
    .slice(-limit)
    .map((s) => ({ buy: s.BuyVal, sell: s.SellVal, net: s.BuyVal - s.SellVal }))

const tool = chartRenderTool()
const ctx = () => ({ signal: new AbortController().signal, callId: "demo" })
const draw = async (input: ChartRenderInput) => {
  console.log(`\n───── ${input.kind}${input.symbol ? ` ${input.symbol}` : ""} ─────`)
  try {
    console.log((await tool.execute(input, ctx())) as string)
  } catch (e) {
    console.error(`LỖI: ${(e as Error).message}`)
  }
}
const short = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name)

const kind = process.argv[2] ?? "all"
const sym = process.argv[3] ?? "VCB"

if (kind === "all" || kind === "candlestick")
  await draw({
    kind: "candlestick",
    symbol: sym,
    bars: (await ohlcv(sym, 15)).map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close })),
  })
if (kind === "all" || kind === "multiline") {
  const [a, b] = await Promise.all([closes(sym, 15), closes("HPG", 15)])
  await draw({ kind: "multiline", symbol: `${sym} vs HPG`, matrix: [a, b], labels: [sym, "HPG"] })
}
if (kind === "all" || kind === "pie") {
  const h = await holders(sym)
  await draw({ kind: "pie", symbol: `${sym} cổ đông lớn`, series: h.map((x) => x.pct), labels: h.map((x) => short(x.name)) })
}
if (kind === "all" || kind === "waterfall") {
  const flow = await moneyFlow(sym, 5)
  await draw({ kind: "waterfall", symbol: `${sym} dòng tiền`, start: 0, series: flow.map((s) => s.net), labels: flow.map((_, i) => `Phiên ${i + 1}`) })
}
if (kind === "all" || kind === "stacked") {
  const flow = await moneyFlow(sym, 6)
  await draw({
    kind: "stacked",
    symbol: `${sym} giá trị mua/bán`,
    matrix: flow.map((s) => [s.buy, s.sell]),
    labels: [...flow.map((_, i) => `Phiên ${i + 1}`), "Mua", "Bán"],
  })
}
if (kind === "all" || kind === "boxplot") {
  const [a, b] = await Promise.all([closes(sym, 20), closes("HPG", 20)])
  await draw({ kind: "boxplot", symbol: "biên động giá 20 phiên", matrix: [a, b], labels: [sym, "HPG"] })
}
if (kind === "all" || kind === "scatter") {
  const bars = await ohlcv(sym, 20)
  await draw({ kind: "scatter", symbol: `${sym} khối lượng vs giá`, points: bars.map((b) => ({ x: b.volume, y: b.close })) })
}
if (kind === "all" || kind === "sparkcolumn") {
  const cs = await closes(sym, 20)
  await draw({ kind: "sparkcolumn", symbol: `${sym} giá đóng cửa`, series: cs })
}
if (kind === "all" || kind === "linebox") {
  await draw({ kind: "linebox", symbol: `${sym} 15 phiên`, series: await closes(sym, 15) })
}
await client.close()
