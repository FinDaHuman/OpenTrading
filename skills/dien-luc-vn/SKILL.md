---
name: dien-luc-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN power by electricity price reform, generation mix, hydrology and grid development plans. Use for power trends, power plant results or electricity price effects."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành điện Việt Nam theo cải cách giá điện, cơ cấu nguồn, thủy văn và kế hoạch phát triển lưới. Dùng khi hỏi xu hướng nhóm điện, đọc kết quả nhà máy điện hay tác động giá điện."
activation: auto
requires_tools: [financial_detail, yf_commodities]
uses_tools: [financial_detail, yf_commodities, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, company_events, symbol_lookup, vn_company, vn_forex_ohlcv]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành điện, phát điện, tác động giá điện, thủy điện, nhiệt điện, sản lượng điện, kế hoạch phát triển điện lực, lưới điện truyền tải, nhà máy điện, chi phí phát điện]
version: 1.0.0
---

# Điện lực Việt Nam — framework phân tích

Vietnamese power has **one structural point that decides everything else**: most plant revenue rests on power purchase agreements with the power buyer; verify the contract mechanism and any direct power purchase arrangement that applies to each project. So the key variable is **the electricity pricing and contract mechanism**, together with real demand/dispatch: retail prices that do not cover costs can create financial pressure on the buyer and payment risk. Price adjustments can ease that pressure, but the plant's actual collections must still be checked. Expecting demand growth while ignoring this variable misreads the whole sector.

The second factor: **the source type**. Hydropower, gas, coal and grid equipment are
four entirely different cycles, and hydrology (reservoir levels) decides which group gets
de-rated in the dry season.

## Khi nào dùng

- Use when: the user asks about power-group trends, what a power plant faces, how electricity price
  adjustments act, which group hydrology hurts.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed Vietnamese macro figures → `danh-gia-vi-mo-viet-nam`.
  - Industrial parks (industrial real estate in general) → `bat-dong-san-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Electricity prices and retail tariff reform | Most plants sell power under contracts with the power buyer; also verify direct purchase mechanisms where they apply. Retail prices below cost can cause financial and payment pressure; price adjustments must be confirmed by receivables and actual cash flow. This is the sector's re-rating variable | Price frameworks and adjustment mechanisms: `news_market`/`web_search`, stating the text + date. Plant receivables from the power buyer: `financial_detail` |
| Generation mix | The generation mix by source type decides which group is dispatched first. Falling water raises the share of thermal power running as backup | Generation mix by period: `news_market` (sector reports), otherwise sourced `web_search` |
| Hydrology | Reservoir levels decide hydropower output and the backup dispatch order. A long dry season de-rates the hydropower group for several periods | Reservoir levels/operations: `news_market`, stating the period and region |
| Grid development plans | Decide future capacity scale and reserve margins; plan revisions change which projects get capital priority | Plan texts + revisions: `news_market`/`web_search`, stating the text + date |
| New load | Data-centre load (flat) and EVs reshape the demand curve: favouring baseload and transmission | New-load expectations: `news_market`/`web_search` |
| Input fuel | Coal, imported gas and the exchange rate decide thermal costs; imported gas is more FX-sensitive than domestic coal | Reference natural gas: `yf_commodities`; thermal coal/LNG and contract prices: dated published sources via `web_search`, with unit and grade; exchange rate: `vn_forex_ohlcv` if context is needed |

## Các bước

**Bước 1: Identify the source group (in parallel).**

`symbol_lookup` · `vn_company` (segments: hydro / gas / thermal / renewable / transmission /
equipment) · `financial_detail` (revenue by segment if available). State the source group
being analysed.

**Bước 2: Electricity prices + receivables (in parallel).**

`financial_detail` (revenue, receivables — receivables from the power buyer are
where the sector's main risk sits) · `news_market` (price frameworks, retail tariff adjustments,
incentive pricing mechanisms).

**Bước 3: Mix + hydrology + projects (in parallel).**

`news_market` (generation mix by period, reservoir status, project progress) ·
`company_events` (the ticker's own project events, new PPAs) · `yf_commodities` (reference natural gas; look up thermal coal/LNG from published sources via `web_search`; do not assume they are in the default COMMO set).

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` · `analyst_consensus` · `peer_compare` (compare within the same source
group — the rule is in §Ranh giới, not repeated here).

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định nhà máy điện đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. Which source group is the company in?
├─ Hydropower → Q3 (hydro)
├─ Gas/LNG or coal → Q2 (thermal)
├─ Renewables → record the PPA mechanism, curtailment and grid connection, continue Q4
├─ Transmission/equipment → ★ "Đánh giá đầu tư lưới, backlog và hợp đồng; thiếu thì chưa đủ dữ liệu mảng thiết bị"
├─ Several sources → assess each source separately per Q1, then combine by the disclosed weights
└─ Mix unclear → ★ "Chưa đủ dữ liệu phân nguồn; không chọn một nguồn đại diện"

Q2 (thermal). Do contract and fuel prices allow profitable generation?
├─ A suitable cost pass-through/contract price mechanism exists → record favourable, continue Q5
├─ Fuel rising but prices not yet compensating, with evidence → record margin pressure, continue Q5
└─ PPA/realised fuel prices unclear → record missing, continue Q5

Q3 (hydro). How are hydrology and output?
├─ Favourable water flow/output → record favourable, continue Q4
├─ Low reservoirs/falling output confirmed → record hydrology pressure, continue Q4
└─ No data by region/period → record missing, continue Q4

Q4 (common). Do cash flow and receivables confirm revenue?
├─ Collections on time, margins/output confirm the favourable state → ★ "Được tiếp sức trong nguồn đang phân tích"
├─ Receivables rising with evidence of late payment or falling margins → ★ "Có áp lực dòng tiền/biên; xác minh nguyên nhân, không mặc định do giá bán lẻ"
└─ Data missing or conflicting → ★ "Chưa đủ dữ liệu kết luận tổng thể; nêu tín hiệu nguồn và công nợ đã biết"

Q5 (thermal). How are dispatch and variable costs?
├─ Dispatched output rising, contract costs under control → record favourable, continue Q4
├─ Low dispatch due to variable costs, grid or contract constraints → record pressure with its cause, continue Q4
└─ Dispatch order/output unclear → record missing, continue Q4

The reserve margin is available capacity in excess of peak load; dispatch order depends on variable costs, technical constraints, the grid and contracts. Never use a high reserve margin alone to conclude that a plant's dispatch falls.

## Chỉ báo đặc thù ngành

The power indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value power **by source group**; there is no single multiple pair for the whole sector: the
thermal group in the dry season and the hydropower group in the same period are two different cycles. Use
P/E and P/B within **the same source group** (the comparison rule is in §Ranh giới), with cash flow from
receivables to judge revenue quality. Anchor expectations with `planned_targets` (output/revenue
plans) and `analyst_consensus`. For plants that have not yet signed a power purchase
agreement: state that the revenue is not yet certain.

## Rủi ro đặc thù

- **Frozen-tariff risk**: retail prices below cost for long → income turns
  into receivables.
- **Hydrology risk**: a long dry season de-rates the hydropower group for several periods in a row.
- **Imported-fuel risk**: imported gas and the exchange rate decide gas-power costs.
- **Dispatch risk**: a high reserve margin creates competition, but each plant's output also depends on variable costs, the grid, technical factors and contracts.
- **Contracting risk**: projects without a signed purchase agreement have uncertain revenue,
  even with the infrastructure finished.

## Ranh giới

- Do not determine the market phase or say "điện sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer price thresholds or expected adjustments from memory: look up the current texts,
  citing the source and date.
- Rank only within the same source group; comparing hydropower with thermal power is forbidden.

## Giới hạn

- The generation mix and reservoir levels are periodic sector releases, lagging 1–2 months.
- Electricity price reform is a multi-step process: conclusions about the stage must state the text
  milestone in force.
- Receivables from the power buyer are not disclosed separately every period: when missing, lower the
  confidence of the Q4 branch.

## Ví dụ

**Ví dụ 1:**
Hỏi: Nhóm thủy điện đang bị siết vì đâu?
Đạt khi: the generation mix + source, hydrology status, receivables from the power
buyer, and a verdict following the Q1→Q3 tree stating the source group.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
stacked bar of the source mix by period, multiline output/cost of goods by group, scatter
receivables versus revenue. Draw with `chart_render` using `from_call` (the `[ref …]` code) from
tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need the source grouping, reading receivables from the power buyer, and output/margin indicators by group |
