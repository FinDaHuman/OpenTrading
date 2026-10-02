import { describe, expect, test } from "bun:test"
import { loadInstruments, TickerIndex } from "../../src/core/market/tickers"

const index = new TickerIndex(loadInstruments())
const codes = (text: string, mentions?: string[]) => index.extract(text, mentions).map((m) => `${m.type}:${m.code}`)

describe("TickerIndex", () => {
  test("the bundled listing parses and has the ambiguous codes flagged", () => {
    expect(index.get("VCB")).toMatchObject({ type: "ticker", sector: "banking" })
    for (const c of ["CEO", "VND", "GAS"]) expect(index.get(c)?.ambiguous).toBe(true)
  })

  test.each([
    ["CEO của HPG nói gì?", ["ticker:HPG"]],
    ["giá 25.000 VND", []],
    ["mã CEO có gì mới", ["ticker:CEO"]],
    ["@VND hôm nay", ["ticker:VND"]],
    ["VN30F1M hôm nay", ["future:VN30F1M"]],
    ["so sánh VCB với VN30", ["ticker:VCB", "index:VN30"]],
    ["Phân tích vcb", []],
    ["cổ phiếu vcb thế nào", ["ticker:VCB"]],
    ["cp hpg", ["ticker:HPG"]],
    ["USD và GDP tăng", []],
    ["VCB, VCB và VCB", ["ticker:VCB"]],
    ["quỹ E1VFVN30", ["ticker:E1VFVN30"]],
    ["CEOVCB", []],
  ])("%p → %p", (text, expected) => {
    expect(codes(text)).toEqual(expected)
  })

  test("explicit UI mentions count even for ambiguous codes", () => {
    expect(codes("tin tức", ["@GAS"])).toEqual(["ticker:GAS"])
  })

  test("scopes include the sector of each stock", () => {
    expect(
      index.scopesOf([
        { code: "VCB", type: "ticker" },
        { code: "VN30", type: "index" },
      ]),
    ).toEqual(["index:VN30", "sector:banking", "ticker:VCB"])
    expect(index.sectorsOf(["VCB", "MBB", "HPG", "VN30"])).toEqual(["banking", "steel"])
  })
})
