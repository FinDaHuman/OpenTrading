---
name: hoa-chat-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN chemicals and fertilisers by the urea price cycle, Chinese export policy, export share and gas input costs. Use for chemicals trends or fertiliser companies."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành hoá chất và phân bón Việt Nam theo chu kỳ giá ure, chính sách xuất khẩu Trung Quốc, tỷ lệ xuất khẩu và chi phí khí đầu vào. Dùng khi hỏi xu hướng nhóm hoá chất hoặc công ty phân bón."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, vs_categories, vs_indicator_data, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành hoá chất, phân bón, sản xuất phân bón, biên lợi nhuận phân bón, nhà máy hoá chất, khí đầu vào phân bón, chu kỳ giá phân bón]
version: 1.0.0
---

# Hoá chất & phân bón Việt Nam — framework phân tích

This sector earns by **price windows**: profit comes from periods when the selling price exceeds
input costs, and such a window can open and close within a quarter. This skill reads the sector
through the fertiliser price cycle, **China's export policy** (the global supply
variable), the export share (whether a company tracks domestic or international prices), and
gas input costs.

Separate the **product groups** first, each with its own price, inputs and policy: nitrogen (urea) from gas or
coal; phosphate and NPK, sold mainly at home by crop season; the phosphorus chain (yellow phosphorus,
phosphoric acid and derivatives); basic chemicals (caustic soda, chlorine, acids) sold to industry.

One easy misreading sits in the driver table below (**historical-cost inventory**): when market prices
jump, margins stay supported for a few quarters by inventory bought before the rise, then reverse —
one good quarter's margin says nothing about capability yet.

## Khi nào dùng

- Use when: the user asks about chemicals/fertiliser trends, why profit jumped then fell,
  what fertiliser companies face from international prices and China.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Agricultural exports (rice, coffee, cashews) → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Fertiliser price cycle | The selling price is variable no. 1: prices jump on supply shocks (geopolitics, weather, exports) then fall back. The sector lives on **price windows**, not long trends | International and domestic fertiliser prices: `news_market`/`web_search`, stating the price index + date |
| China's export policy | China is a large supplier; export controls (quotas, bans, duties) make global prices jump, and the reverse | Export policy: `news_market`/`web_search`, stating the text/notice + date |
| Export share | A company exporting most of its output tracks international prices and trade; a domestic seller's profit is set by domestic market prices and demand (the state does not set fertiliser prices; nitrogen, DAP and NPK are only on the price-stabilisation list) | Export share: company disclosures via `news_symbol`/`web_search`; fertiliser exports by product group: Customs figures with a clear period and unit, via `web_search` |
| Gas input costs | Gas is the large cost of gas-based urea plants; contract length differs by plant (yearly or multi-year) and the price is usually tied to fuel oil/Brent, so oil up = input cost up. Coal-based plants follow coal instead | Contract terms: company disclosures via `news_symbol`/`web_search`; direction: Brent in `yf_commodities` (it has no fuel oil, and Henry Hub is not the VN gas price); cost of goods in `financial_detail` |
| Phosphorus chain | Costs sit in apatite ore, electricity, coke and sulphur; ore supply (own mine or bought) and the export duty decide an exporter's margin. The duty can rise by steps set in advance: use the rate in force on the date analysed | Export duty schedule and ore supply: `web_search` (text + effective date); reference prices: `web_search` (grade, place, date); costs: company disclosures via `news_symbol` |
| VAT on fertiliser | Whether fertiliser sales are taxed decides if the producer's input VAT is deductible or becomes cost, so a change of rule moves cost of goods and the position against imports | Text in force (number + effective date): `web_search`; deductible VAT: `financial_detail` (`CDKT`) |
| Season and plant outages | Sales follow the crop seasons; a maintenance stop cuts a whole quarter's volume | Season, crop prices: `web_search`; outages, output: `news_symbol` |
| Domestic demand | Domestic demand is sensitive to farm prices (e.g. rice); weak when farm prices are low or fertiliser prices high | Domestic demand: `news_market`, `vs_categories` → `vs_indicator_data` (look up the agricultural-production category codes that exist; if missing, use the statistics office's releases) |
| Historical-cost inventory | Inventory bought before a rise supports margins for 1–2 quarters, then reverses — the "window" label of the whole sector | Inventory in `financial_detail`; export share in company disclosures |

## Các bước

**Bước 1: Identify the segment mix (in parallel).**

`symbol_lookup` · `vn_company` (product groups: urea / phosphate–NPK / phosphorus chain / basic chemicals / trading) ·
`financial_detail` (revenue by segment). State the export share if disclosed.

**Bước 2: Both ends of the price (in parallel).**

`news_market` (international + domestic fertiliser prices, China policy, supply
status) · `yf_commodities` (reference energy for input costs) ·
`web_search` (fertiliser exports by product group from Customs, with a clear period and unit; `vs_xnk_detail` does not provide product-group series).

**Bước 3: Margin + inventory (in parallel).**

`financial_detail`: revenue, cost of goods → quarterly gross margin; inventory; financial
costs. Read 4 consecutive quarters to tell a "price window" from durable capability.

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` · `peer_compare` (overview metrics within the group) · `analyst_consensus`.

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: wherever this skill names it for sector figures, prices or legal texts, look them up with `web_search` (source + date) and keep `news_market` for the day's headlines.

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định công ty hoá chất đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. What is the company's market mix?
├─ Exports most of its output → Q2 (international)
├─ Sells mainly domestically → Q4 (domestic)
├─ Mixed → consider Q2 and Q4 separately by the disclosed mix
└─ Share unclear → record the missing mix, continue Q2 and Q4 with low confidence

Q2 (international). Is the selling-price window widening?
├─ Selling prices rising relative to costs → record favourable, continue Q3
├─ Selling prices falling or costs catching up → record pressure, continue Q3
└─ No comparable price pair → record missing, continue Q3

Q3 (international). What does verified Chinese export policy say?
├─ Export controls reducing supply in target markets → record source/date and conditional benefit, continue Q5
├─ Easing or supply returning → record competitive pressure, continue Q5
└─ Unverified or irrelevant to the product → assume no effect, continue Q5

Q4 (domestic). How are demand and realised prices?
├─ Sales volume up, prices held → record favourable, continue Q5
├─ Volume down or prices not covering costs → record pressure, continue Q5
└─ Not disclosed → record missing, continue Q5

Q5 (common). Do margins and inventory confirm the signal?
├─ Margins improving over several periods, favourable price/volume, not just cheap inventory → ★ "Được tiếp sức; nêu điều kiện duy trì cửa sổ giá"
├─ Margins contracting or high-cost inventory creating pressure, with evidence → ★ "Bị siết theo giá/chi phí đã xác minh"
└─ Data missing or conflicting → ★ "Chưa đủ dữ liệu kết luận tổng thể; không coi chính sách chưa rõ là bất lợi"

## Chỉ báo đặc thù ngành

The chemicals/fertiliser indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Chemicals/fertilisers are a price cycle: value with **EV/EBITDA through the cycle** and **P/B against
the sector's own troughs**, never P/E at the peak of a price window. Mark an unusual profit period clearly
as a "price window" and do not extrapolate it. Compare only within the same product group. Cash-rich companies: separate deposit interest from operating profit, it can hold profit up after the window closes. Anchor expectations with `planned_targets` and
`analyst_consensus`.

## Rủi ro đặc thù

- **Window-closing risk**: prices recover after a supply shock and margins shrink back within 1–2 quarters.
- **Chinese policy reversal risk**: easing exports lowers global prices,
  affecting domestic sellers too through competing imports.
- **High-cost inventory risk**: inputs bought before a rise, then prices fall → margins squeezed
  from both sides.
- **Domestic demand risk**: demand is sensitive to farm prices; weak farm prices mean weak fertiliser
  demand.
- **Domestic price risk**: domestic sellers do not capture the full international
  window (competition, farm demand).
- **Input–output divergence risk**: oil-linked gas costs rise while urea prices fall.
- **Tax and duty risk**: a change in VAT or export duty moves costs and selling prices from its effective date.
- **Outage and ore-supply risk**: a maintenance stop or a closed mine cuts volume or forces dearer purchases.

## Ranh giới

- Do not determine the market phase or infer "hoá chất sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never state Chinese export policy, VAT, export duties or contract gas prices from memory: look up current
  notices/texts, stating the source and date.
- Never use international prices in place of the company's actual selling prices — the prices in the company's
  disclosures are the ones that apply.

## Giới hạn

- Energy prices from `yf_commodities` are a reference, not each plant's contract gas
  price.
- The export share is disclosed irregularly: when missing, lower the confidence of the Q1 branch.
- Price cycles are short: every conclusion must state the date prices were checked.

## Ví dụ

**Ví dụ 1:**
Hỏi: Giá ure tăng mạnh thì công ty phân bón hưởng không?
Đạt khi: the international price + check date, China policy, the export share, 2 consecutive quarters of
margins, and a verdict following the Q1→Q5 tree.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
multiline fertiliser prices with the gross margin, bar margins by group, waterfall selling price
minus input costs. Draw with `chart_render` using `from_call` (the `[ref …]` code) from
tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read price windows, separate domestic from international, and read historical-cost inventory |
