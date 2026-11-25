---
name: thep-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN steel by the raw-material–product spread, trade defence, product mix and gross margin. Use for steel trends, mill results, gross margin or input costs."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành thép VN theo spread nguyên liệu–thành phẩm, phòng vệ thương mại, cơ cấu sản phẩm và biên lãi gộp. Dùng khi hỏi xu hướng nhóm thép, đọc kết quả nhà máy thép, lãi gộp hay chi phí đầu vào."
activation: auto
requires_tools: [financial_detail]
uses_tools: [financial_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company, web_search]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành thép, thép xây dựng, thép cuộn, nhà máy thép, sản xuất thép, biên lợi nhuận thép, thép nhập khẩu, sản lượng thép, lãi gộp thép, chi phí đầu vào thép]
version: 1.0.0
---

# Thép Việt Nam — framework phân tích

Steel profits come from **the finished-product price minus raw-material costs**, so
this skill reads the sector through four variables: the selling price, input costs (iron ore and coking coal),
the volume actually sold, and **trade-defence barriers** — which decide whether domestic selling
prices hold or are lost to imports. Reading finished-product prices without the matching input prices
leads to the opposite conclusion: there have been periods of higher sales where falling prices and
rising raw materials at once cut profit even as output rose.

Name the **production route** first, it decides the input: blast furnace (iron ore, coking coal), electric
furnace (scrap), coated sheet and pipe mills (hot-rolled coil bought in).

## Khi nào dùng

- Use when: the user asks about steel-group trends, why selling more did not lift profit,
  what steel faces from anti-dumping duties or coal/ore prices.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed Vietnamese macro figures → `danh-gia-vi-mo-viet-nam`.
  - Construction materials in general (cement, glass, others) → read alongside `thep-vn`
    but state the segment; never cross-infer.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Finished-product − raw-material spread | The spread is the selling price minus raw-material costs on the same unit; gross margin = (revenue − cost of goods) / revenue, not the same as the spread. Inputs follow the route: iron ore and coking coal for blast furnaces, scrap for electric furnaces, hot-rolled coil for coated sheet and pipe mills. Note: raw-material costs reach the reports **with a lag** through inventory and shipping time | Finished-product + ore/coal prices from mill, exchange or industry-body releases via `web_search`; same period, unit, grade and delivery terms; cross-check `financial_detail` |
| Real volume | Production and capacity utilisation explain fixed costs spread per unit; never multiply output by utilisation again. A new mill below capacity has low margins even with high revenue | Output and utilisation: `news_market`/`web_search` (mill releases) + `financial_detail` (revenue, cost of goods) |
| Trade defence | Anti-dumping/safeguard duties set a price wall for imports. Expiry or a scope change → immediate pressure on domestic prices | Trade-defence texts + changes: `news_market`/`web_search`, with source and date; imports by steel group from Customs/industry bodies via `web_search`, with clear period/unit |
| Product mix | Construction steel serves domestic projects, priced with the construction season. Hot-rolled coil trades internationally, priced with the region and export orders — two different price logics | Product weights: mill releases in `news_market`; margins by segment in `financial_detail` |
| Public investment demand | Public-investment disbursement drives demand for construction steel for infrastructure | Disbursement progress: `news_market`; system figures via `danh-gia-vi-mo-viet-nam` if the user needs depth |
| Exports and destination tariffs | Exports are the outlet for surplus, but the first place anti-dumping investigations hit and, in the EU, where the carbon border charge on steel applies | Exports by steel group: Customs/industry bodies via `web_search`; investigation risk: `news_market` |

## Các bước

**Bước 1: Identify the ticker + product mix (in parallel).**

`symbol_lookup` · `vn_company` (segments: construction/HRC/pipes and sheets/galvanised). Product
weights from mill releases (`news_market`), stating the period.

**Bước 2: Both ends of the spread (in parallel).**

An input-cost question ("what does coal/ore do to steel?") is a data question, not a general one: before concluding, fetch at least one dated iron ore or coking coal price and the mills' gross margin. Read the mills the user names; otherwise HPG (blast furnace: coal and ore are its own inputs) and HSG, NKG (they buy hot-rolled coil, so coal reaches them only through HRC prices). If no comparable input price is found, say that it is missing and what was searched; never answer from general knowledge alone.

`web_search` for prices from mill/exchange/industry-body releases (iron ore, coking coal, steel); record the date, period, unit, grade and delivery terms before comparing. `financial_detail` for revenue, cost of goods → quarterly gross margin. The default COMMO set of `yf_commodities` has no iron ore/coking coal/steel: do not use it to build the spread. Without comparable prices, do not compute the spread; the gross margin is only supporting data.

**Bước 3: Volume + defence barriers (in parallel).**

`news_market` (output, capacity utilisation, trade-defence texts,
imports) · `web_search` (steel exports by product group from Customs/industry bodies; never take `vs_xnk_detail`'s by-country series as a product group).

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` (the yearly plan) · `peer_compare` (overview metrics within the segment) · `analyst_consensus` (expectation anchor).

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: wherever this skill names it for sector figures, prices or legal texts, look them up with `web_search` (source + date) and keep `news_market` for the day's headlines.

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định nhà máy thép đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. Is the finished-product − raw-material price pair comparable?
├─ Spread widening, same period/unit/grade → record favourable, continue Q2
├─ Spread narrow → record cost/price pressure and the inventory lag, continue Q2
└─ Spread cannot be built → record missing, use the gross margin only as support, continue Q2

Q2. How are sales volume and capacity utilisation?
├─ Rising, enough to absorb fixed costs → record favourable, continue Q3
├─ Falling or a new mill below capacity → record capacity pressure, continue Q3
└─ No figures → record missing output data, continue Q3

Q3. How are defence barriers and the product mix changing?
├─ Selling prices held, destination markets stable → record favourable, continue Q4
├─ Duty/scope changes creating import or export pressure → record the risk with text/date, continue Q4
└─ Unverified → record policy/mix unclear, continue Q4

Q4. Do inventory and gross margin confirm the price/volume signal?
├─ Spread widening + output rising + margins improving, with same-period sources → ★ "Được tiếp sức; tách tác động giá, lượng và tồn kho"
├─ Evidence of a narrow spread or low capacity, margins contracting → ★ "Bị siết theo yếu tố đã xác minh; không khẳng định đã ở đáy"
└─ Data missing, conflicting or only the gross margin → ★ "Chưa đủ dữ liệu kết luận tổng thể; nêu tín hiệu đã biết và cần bổ sung"

## Chỉ báo đặc thù ngành

The steel indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Steel is cyclical: value with **EV/EBITDA through the cycle** and **P/B against the sector's
own troughs**, never P/E at the cycle peak. Profit per tonne must be read
with capacity utilisation — the same P/E can be a peak or a trough depending on the position
in the loop. Anchor expectations with `planned_targets` and `analyst_consensus`. For mills
in ramp-up: state the capacity running versus design.

## Rủi ro đặc thù

- **Double two-way spread risk**: selling prices falling and raw materials rising at once —
  the most common state in hard times, not an exception.
- **Raw-material inventory risk**: input prices reach the reports with a lag; margins keep
  worsening for a few quarters after market prices have turned.
- **Trade-defence reversal risk**: a text expiring or changing scope is a
  direct price shock to domestic market share.
- **Destination-market investigation risk**: high exports mean a high risk of investigation
  in that very market.
- **Carbon border risk**: steel sold to the EU carries a carbon cost; check the rule and the product scope in force.
- **New-mill risk**: low capacity utilisation during ramp-up.

## Ranh giới

- Do not determine the market phase or infer "thép sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell or set weights → `phan-tich-chuyen-sau-1-ma`.
- Never infer anti-dumping duty thresholds or investigation scope from memory: look up
  the current texts, citing the source and date (this rule lives only here).
- Never use outside world steel prices in place of the company's actual selling prices —
  the selling prices published in `news_market` are the ones that apply.

## Giới hạn

- Raw-material prices from dated releases are reference prices, not
  each mill's actual contract purchase prices — say so when using them.
- Product weights and capacity utilisation are disclosed irregularly; when missing,
  lower the confidence of the Q2/Q4 branches.
- Trade-defence texts have changing terms and scope: conclusions must state the
  date of the text in force.

## Ví dụ

**Ví dụ 1:**
Hỏi: Bán nhiều thép hơn mà lãi không theo, tại sao?
Đạt khi: the finished-product − raw-material pair with both ends' periods, output/utilisation,
quarterly gross margin, the inventory lag, and a verdict following the Q1→Q4 tree.

**Ví dụ 2:**
Hỏi: Thép chịu gì từ giá than?
Đạt khi: a dated coking coal (or ore) price from `web_search` and the gross margin of HPG/HSG/NKG
from `financial_detail` are fetched before the conclusion, each cited; the answer separates the
blast-furnace mill from the coil buyers and states any missing price instead of filling it in.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
waterfall from selling price minus raw materials to margin per tonne, multiline finished-product prices with
ore/coal prices, bar gross margins of the group. Draw with `chart_render` using `from_call`
(the `[ref …]` code) from tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read gross margin, financial costs carrying inventory, output and how to match inputs to outputs |
