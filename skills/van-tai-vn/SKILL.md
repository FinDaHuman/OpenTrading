---
name: van-tai-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN transport and logistics by freight rates, export demand, port capacity and fuel costs. Use for transport trends, port companies or freight rates."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành vận tải và logistics Việt Nam theo cước vận chuyển, cầu xuất khẩu, công suất cảng và chi phí nhiên liệu. Dùng khi hỏi xu hướng nhóm vận tải, công ty cảng hay cước vận chuyển."
activation: auto
requires_tools: [financial_detail, vs_xnk_detail]
uses_tools: [financial_detail, vs_xnk_detail, financial_ratios, planned_targets, analyst_consensus, peer_compare, yf_commodities, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành vận tải, vận tải biển, cảng biển, cước vận chuyển, tàu chở container, luồng hàng hoá, công ty cảng, mảng logistics, hãng hàng không, vận tải hàng không]
version: 1.0.0
---

# Vận tải & logistics Việt Nam — framework phân tích

Vietnamese transport is a **freight-rate cycle, not a domestic demand cycle**: revenue
tracks international freight rates and the volume of cargo through ports. This skill reads the sector through
route freight rates, export demand (the leading signal for throughput), port capacity (where the most
durable margins sit), and **the share of fixed-rate contracts** — which decides who really
benefits from a freight wave and who is locked into prices and misses it.

The second factor: **segments**. Deep-water ports, intra-Asia container shipping and oil
tankers are three different cycles — record-high tanker rates can come with a squeezed
container business.

## Khi nào dùng

- Use when: the user asks about transport-group trends, how freight rates act, whether a
  port company still has room, whom tariffs affect.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Shipping inside the oil & gas group (the shipping segment) → continue in `dau-khi-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Freight rates | Rates by route (transoceanic, intra-Asia, Europe–America) decide shipping revenue. Rates do not rise evenly: short routes and transshipment hubs follow different rules | Route rates: `news_market`/`web_search`, stating the rate index + date; for the ticker, average realised rates in `financial_detail` |
| Export demand | Port throughput tracks exports and component imports. Read TEU/tonnes through ports and total trade flows; rising equipment-import value does not prove rising transport demand | Exports/imports by period: `vs_xnk_detail`; aggregate sector demand: `news_market` |
| Port capacity | New berths running below capacity push up fixed costs; with enough utilisation, tariffs hold. Container handling, berth and towage tariffs move only inside the minimum–maximum band set by the Ministry of Construction, so a band change is itself a revenue driver. This is the sector's most durable source of margin | Berth utilisation + the tariff-band decision in force (number + date): `news_market`/`web_search`; for the ticker, revenue/average tariff in `financial_detail` |
| Rate-locking share | Long-term periodic shipping contracts smooth income: a high locked share means a freight wave does not reach revenue at once | Fixed-contract share: `news_market`/`web_search`; indirect signs in revenue/volume in `financial_detail` |
| Fuel | Fuel and port costs squeeze margins of **shipping and airlines**; ports are little affected. The direction differs by segment: tanker rates follow tonne-miles and ship supply, not the oil price level (they can jump while oil falls); airlines get squeezed (fuel is one of their largest costs, not the majority) and domestic basic-economy fares sit under a state ceiling, which limits the pass-through | Fuel prices: `yf_commodities` by cycle |
| Trade policy | Tariffs redirect routes: intra-Asia routes are less affected than routes to the US | Tariffs/policy: `news_market`/`web_search` |

## Các bước

**Bước 1: Identify the segment (in parallel).**

`symbol_lookup` · `vn_company` (segments: ports / intra-Asia container / tankers / freight forwarding
and delivery / airlines) · `financial_detail` (revenue by segment). State the segment.

**Bước 2: Rates + demand (in parallel).**

`news_market` (route rates, rate indices, tanker rates if relevant) ·
`vs_xnk_detail` (total exports + imports for the same period as context; separate price/volume, never infer TEU from value).

**Bước 3: Capacity + volume + costs (in parallel).**

`news_market` (berth utilisation, port throughput, new routes) ·
`financial_detail` (revenue, cost of goods, financial costs, fuel inventory) ·
`yf_commodities` (reference fuel for sea routes).

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` · `analyst_consensus` · `peer_compare` (compare **within the same
segment** — comparing ports with container shipping is forbidden).

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định công ty vận tải đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. Which segment is the company in?
├─ Ports/berths → Q4 (ports)
├─ Container → Q2 (container)
├─ Tankers/dry bulk → ★ "Đánh giá cước tuyến, tonne-mile, sản lượng và hợp đồng; thiếu thì chưa đủ dữ liệu cho phân khúc"
├─ Forwarding/delivery → ★ "Đánh giá lưu lượng bưu kiện, giá dịch vụ và chi phí; thiếu thì chưa đủ dữ liệu cho phân khúc"
├─ Airlines → ★ "Đánh giá ngược chiều giá dầu: giá dầu tăng bóp biên (nhiên liệu là một trong các khoản chi phí lớn nhất, đọc tỷ trọng trong báo cáo); kèm nhu cầu đi lại theo mùa và giá vé (vé phổ thông cơ bản nội địa có giá trần); thiếu dữ liệu thì chưa đủ cho phân khúc"
├─ Several segments → assess each segment independently per Q1, then combine by the disclosed weights
└─ Unclear → ★ "Chưa đủ dữ liệu phân khúc"

Q2 (container). How are rates and the rate-locking share?
├─ Rates up, contracts allow capturing new prices → record favourable, continue Q3
├─ Rates down or locking delays the benefit → record pressure/lag, continue Q3
└─ Rates/contracts unclear → record missing, continue Q3

Q3 (container). How does trade policy affect actual routes?
├─ Routes and volumes held, tariffs verified by product/origin/destination/date → continue Q5
├─ Evidence of lost cargo or rerouting costs → record policy pressure, continue Q5
└─ Policy/routes unclear → record missing, continue Q5

Q4 (ports). How are berth capacity and throughput?
├─ TEU/tonnes and utilisation rising → record favourable, continue Q5
├─ New berths under capacity or falling volume → record fixed-cost pressure, continue Q5
└─ No figures → record missing, continue Q5

Q5 (common). Do underlying demand and margins confirm it?
├─ TEU/tonnes up year on year, margins held, favourable rates/capacity → ★ "Được tiếp sức bởi lưu lượng và vận hành đã xác minh"
├─ TEU/tonnes down or revenue up only on prices/rates → ★ "Có áp lực cầu hoặc phụ thuộc giá; nêu bằng chứng và độ nhạy cước"
└─ Only trade values, or data missing/conflicting → ★ "Chưa đủ dữ liệu cầu thực; không suy cầu từ nhập máy móc tăng nhanh hơn xuất khẩu"

## Chỉ báo đặc thù ngành

The transport indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value transport **by segment**: ports on a steadier P/E (revenue under
long-term contracts), container shipping on cyclical EV/EBITDA (never P/E at the
rate peak). Anchor expectations with `planned_targets` and `analyst_consensus`. With rates
at a cycle peak every multiple looks cheap — state the position in the loop before comparing.

## Rủi ro đặc thù

- **Rate-reversal risk**: freight rates swing within weeks, not
  quarters.
- **Berth-capacity risk**: new berths under capacity, fixed costs running ahead of
  revenue.
- **Trade-policy risk**: tariffs redirect routes and volumes, with uneven effects
  across companies.
- **Fuel risk**: squeezes shipping margins before rates can adjust.
- **Mixed-segment risk**: a company with both ports and ships gives a consolidated figure
  that matches neither cycle.

## Ranh giới

- Do not determine the market phase or infer "vận tải sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer route rates from one reporting period: rates are a short cycle; look up rates
  for the recent period and state the source date.
- Rank only within the same segment; comparing ports with containers is forbidden.

## Giới hạn

- Route rates are a short, volatile cycle: conclusions must state the check date, never
  last week's numbers.
- Exports/imports from `vs_xnk_detail` are a general demand signal, not the company's own
  throughput.
- Fixed-contract shares are not disclosed regularly: when missing, lower the confidence of the Q2 branch.

## Ví dụ

**Ví dụ 1:**
Hỏi: Cước vận chuyển lên thì cả nhóm vận tải hưởng không?
Đạt khi: segments separated, route rates + check date, the rate-locking share, and a verdict
following the Q1→Q5 tree for each segment.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
multiline route rates with average realised rates, bar gross margin by segment, bar
port throughput. Draw with `chart_render` using `from_call` (the `[ref …]` code) from
tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need the segmentation, reading average realised rates and margins by segment, using route rates and export demand |
