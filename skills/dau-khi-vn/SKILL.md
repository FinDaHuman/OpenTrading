---
name: dau-khi-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN oil and gas by world oil prices, shipping routes, reserve replacement and upstream vs refining. Use for oil & gas trends or a company's exposure."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành dầu khí VN theo giá dầu quốc tế, tuyến vận chuyển, thay thế trữ lượng và ranh giới giữa khai thác với lọc hoá dầu. Dùng khi hỏi xu hướng nhóm dầu khí hay công ty dầu khí chịu gì."
activation: auto
requires_tools: [yf_commodities, financial_detail]
uses_tools: [yf_commodities, financial_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, company_events, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [nhóm dầu khí, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, giá dầu Brent hôm nay, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [nhóm dầu khí, ngành dầu khí, khai thác dầu khí, chi phí khí đầu vào, lọc hoá dầu, giếng khoan, dự án khai thác, tỷ trọng dầu khí, tác động giá dầu, công ty dầu khí]
version: 1.0.0
---

# Dầu khí Việt Nam — framework phân tích

Vietnamese oil & gas holds **five different business loops** under one label: upstream
production, shipping, refining/petrochemicals, technical services, and gas/petroleum distribution. The shared label is a
trap: upstream margins depend on oil prices, refining margins on the crude
refining spread, services margins on capital spending, distribution margins on sales volume and the pricing mechanism. This skill reads the sector
through international oil prices, **the distance oil travels (tonne-miles)** — what pushes
freight rates up even when the volume through a shipping lane falls — and the company's
reserve replacement. And one hard boundary: **this sector is not treated as a link
in the sector rotation chain** (that is the cycle skill's job).

## Khi nào dùng

- Use when: the user asks about oil & gas group trends, what an oil & gas company faces from oil prices,
  the difference between upstream and refining, what a geopolitical shock changes for the sector.
- Do NOT use (use another skill instead):
  - Market phase, sector rotation, the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed international macro figures (global supply forecasts) → `danh-gia-vi-mo-quoc-te`.
  - Shipping in general (containers, logistics) → `van-tai-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Crude oil price | Most of the sector's revenue tracks oil prices. Sensitivity depends on the loop: upstream directly, refining through the refining spread, services through investment budgets | `yf_commodities` (WTI, Brent) by cycle; cross-check oil prices in `news_market` |
| Distance oil travels (tonne-miles) | When shipping routes lengthen, tanker freight rises even if total oil volume is unchanged. This drives the shipping loop, distinct from the upstream driver | Shipping-route status: `news_market`/`web_search`, stating the source and period |
| Reserve replacement | Current output lasts only if new reserves replace it. Replacement below production for long = output will fall in the near future | Output + new discoveries: sector disclosures in `news_market`/`web_search`; capitalised exploration costs in `financial_detail` |
| Capital spending | The group's E&P budget decides the technical-services loop's revenue, and project ordering decides the upstream loop | The 5-year investment plan: `news_market`/`web_search`; ticker-specific: projects in `company_events` |
| Gas and petroleum distribution | Earns on sales volume and the margin the pricing mechanism leaves: retail petrol prices follow a state mechanism, gas to power and fertiliser plants follows contracts. Fast oil moves create one-off inventory gains or losses | Mechanism in force (number + date; it can change): `web_search`; volumes and contracts: `news_symbol`; inventory: `financial_detail` (`CDKT`) |
| Refining spread and inventory | Product prices minus crude input set the margin; crude and product stock turns a price reversal into a one-quarter gain or loss | Regional spread: `web_search`; gross margin and inventory: `financial_detail` |
| Segment mix | The same sector label, entirely different margins. Misreading the business loop leads to the opposite conclusion | Segments in `financial_detail` + the segment table in `vn_company` |
| International seasonality | Seasonal demand and producer-group meetings set the price rhythm; they affect the sector's rhythm without changing long-term expectations | Periodic rhythm: `yf_commodities` by cycle |

## Các bước

**Bước 1: Identify the business loop (in parallel).**

`symbol_lookup` · `vn_company` + `financial_detail` to see which segment feeds profit:
upstream / refining / shipping / services / gas and petroleum distribution. State which loop you are analysing.

**Bước 2: Oil prices + shipping-route shocks (in parallel).**

`yf_commodities` (oil prices by cycle) · `news_market` (shipping-route status,
tanker freight if relevant, geopolitical developments).

**Bước 3: Output + reserves + projects (in parallel).**

`news_market` (output, discovered reserves, new projects, groundbreakings) ·
`company_events` (the ticker's own project events). `financial_detail`: exploration costs,
the cost-of-goods trend.

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` · `analyst_consensus` · `peer_compare` (compare only within **the same business
loop** — comparing upstream with refining is meaningless).

If the yearly plan states an oil price assumption, compare it with the current price before judging the plan.

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: wherever this skill names it for sector figures, prices or legal texts, look them up with `web_search` (source + date) and keep `news_market` for the day's headlines.

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định công ty dầu khí đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. Which segment feeds the company's profit?
├─ Upstream → continue Q2
├─ Refining/petrochemicals → ★ "Đánh giá chênh lệch tinh chế, tồn kho và công suất; thiếu thì chưa đủ dữ liệu cho mảng lọc dầu"
├─ Shipping → ★ "Đánh giá riêng cước tàu, tonne-mile và hợp đồng dài hạn; tuyến dài không mặc nhiên tăng lãi toàn công ty"
├─ Technical services → ★ "Đánh giá ngân sách E&P, backlog và tiến độ nghiệm thu; thiếu thì chưa đủ dữ liệu mảng dịch vụ"
├─ Gas/petroleum distribution → ★ "Đánh giá sản lượng bán, biên theo cơ chế giá hoặc hợp đồng, và lãi/lỗ tồn kho một lần; thiếu thì chưa đủ dữ liệu mảng phân phối"
├─ Several segments → analyse each segment independently per Q1, then combine by the disclosed profit weights
└─ Mix unclear → ★ "Chưa đủ dữ liệu phân mảng; không dùng giá dầu đại diện cả công ty"

Q2. How do oil prices compare with realised prices and sourced expectations?
├─ Higher or rising → record favourable for upstream, continue Q3
├─ Lower or falling → record upstream pressure, continue Q3
└─ No expectations/realised prices → record missing, continue Q3

Q3. Are output and reserves sustained?
├─ Output stable/rising, reserve replacement confirmed → record favourable, continue Q4
├─ Reserves declining or replacement projects late → record verified pressure, continue Q4
└─ Not disclosed → record missing reserves/output, continue Q4

Q4. Do margins and concentration confirm resilience through the cycle?
├─ Margins held at low prices, diversified projects, enough data → ★ "Thượng nguồn có sức chống chịu; nêu điều kiện về giá và sản lượng"
├─ Margins falling or dependent on one project/contract → ★ "Thượng nguồn chịu áp lực hoặc tập trung rủi ro theo bằng chứng; không suy lợi ích từ cước tàu"
└─ No data/periods misaligned → ★ "Chưa đủ dữ liệu kết luận thượng nguồn; tách rõ tín hiệu giá đã biết"

## Chỉ báo đặc thù ngành

The oil & gas indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value oil & gas with **EV/EBITDA** (only when EBITDA is positive and comparable; with non-positive EBITDA, do not interpret the multiple — switch to normalised cash flow or assets) and **reserve
value** for the upstream loop; the refining loop by cyclical EV/EBITDA; the services
loop by the investment-budget outlook; the distribution loop by P/E and dividends (steadier cash flow). Strip inventory gains/losses from refining and distribution profit first. Never use P/E at the cycle peak: the same P/E
can be a trough or a peak depending on the position in the loop. Anchor expectations with `planned_targets` and
`analyst_consensus`.

## Rủi ro đặc thù

- **Oil price reversal risk**: within half a year, not one quarter.
- **Reserve decline risk**: current output does not last when reserves are not
  replaced — a risk that shows only years later.
- **Energy transition risk**: makes new projects harder to finance, especially deep-water
  exploration.
- **Concentration risk**: one project or one recurring transaction can feed a whole year.
- **Inventory risk**: refining and distribution book losses when oil falls fast.
- **Pricing-mechanism risk**: a new rule on retail petrol prices changes the distribution margin.
- **Business-loop misreading risk**: the sector label hides five different cycles.

## Ranh giới

- Do not determine the market phase, treat oil & gas as a link in the sector rotation
  chain, or infer "dầu khí sẽ theo sau nhóm X" → `dinh-vi-chu-ky-vn` (which
  holds the chain rules).
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer expected oil prices from one reporting period: use published expectations with a clear source,
  stating the period.
- Rank only within the same business loop; comparing upstream with refining is forbidden.

## Giới hạn

- Oil prices from `yf_commodities` are by the cycle available, not each company's contract
  realised prices — say so when using them.
- Shipping-route status and freight rates are lagged news; state the source date.
- Output and reserves are disclosed irregularly: state the disclosure period; never extrapolate.

## Ví dụ

**Ví dụ 1:**
Hỏi: Giá dầu giảm thì nhóm dầu khí chịu gì?
Đạt khi: the business loop asked about is identified, oil prices + source, the effect on
each loop per the Q1 tree, and a verdict stating which loop is supported and which is squeezed.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
multiline oil prices with upstream revenue, bar margins by business loop,
waterfall from the oil price to a simple margin. Draw with `chart_render` using `from_call`
(the `[ref …]` code) from tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to separate the four business loops, read margins by loop and reserve–output indicators |
