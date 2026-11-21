---
name: tieu-dung-ban-le-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN consumer and retail by real retail sales, household income, tax policy and modern-retail penetration. Use for consumer trends or retail chain results."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành tiêu dùng và bán lẻ Việt Nam theo bán lẻ thực, thu nhập hộ gia đình, chính sách thuế và độ thâm nhập bán lẻ hiện đại. Dùng khi hỏi xu hướng nhóm tiêu dùng hoặc kết quả chuỗi bán lẻ."
activation: auto
requires_tools: [financial_detail, vs_indicator_data]
uses_tools: [financial_detail, vs_indicator_data, vs_categories, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, company_events, news_market, symbol_lookup, vn_company]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành tiêu dùng, chuỗi bán lẻ, hàng tiêu dùng, bán lẻ hiện đại, thu nhập hộ gia đình, sức mua, thị phần bán lẻ, mảng tiêu dùng]
version: 1.0.0
---

# Tiêu dùng & bán lẻ Việt Nam — framework phân tích

This sector is not read through nominal revenue: nominal retail figures include
inflation, while real purchasing power lies in **real growth (inflation removed)** and **household
income**. This skill reads the sector through real retail sales, income (the demand barrier), policies
supporting purchasing power, and **modern-retail penetration** — the sector's long-term engine and
what separates modern chains from traditional markets.

A classification note: **consumer-electronics retail** (computers, phones, appliances) follows a
device-replacement cycle, different from the food/staples cycle. Both sit under the "retail" label
but do not share drivers.

## Khi nào dùng

- Use when: the user asks about consumer/retail trends, whether a retail chain can keep growing
  through expansion, how purchasing power is.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed Vietnamese macro figures → `danh-gia-vi-mo-viet-nam`.
  - Food/agricultural exports → `xuat-nhap-khau-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Real retail sales | The gap between nominal and real retail is inflation. Reading the nominal figure shows "good growth" while volume barely rises | `vs_indicator_data` (total retail sales + price index) — read both before concluding on real terms |
| Household income | Income is the demand barrier. Slow job creation + frozen public-sector pay slow income growth and drag purchasing power | `vs_indicator_data` (income/wages if available) + `news_market` (income policy). If missing → say so |
| Purchasing-power policy | VAT cuts on essentials support purchasing power for a set period; "formalising the market" policies (invoices, price listing) reduce the price edge of traditional channels | `news_market` (texts + effective dates), stating the source + date |
| Modern-retail penetration | Modern retail has a low share versus the region → opening stores is the long-term growth engine. Chains opening faster than the market gain share | Chain developments (store count, floor area) + market share: `news_symbol`/`company_events` or `web_search` on company sources |
| Same-store sales | New-store openings and same-store growth are two different kinds of growth. Rising same-store sales means taking share from competitors | `financial_detail` + company disclosures via `news_symbol`/`company_events`; compute it with `shell` from the disclosed figures if they allow, showing the formula |
| Segment | Food staples (a steady cycle) differ from consumer electronics (a device-replacement cycle). Do not share one driver | Segments in `financial_detail` + `vn_company` |

## Các bước

**Bước 1: Identify the segment (in parallel).**

`symbol_lookup` · `vn_company` (segments: food/electronics/services) · `financial_detail`
(revenue by segment). State which segment you are analysing.

**Bước 2: Real purchasing power (in parallel — look up the catalogue FIRST).**

`vs_indicator_data` has presets only for GDP/CPI/XK; other series (total retail
sales, core CPI, income) need a `category_id` from `vs_categories` first, then passed
with the matching `term_type_id`. Call `vs_categories` → choose category + term_type →
`vs_indicator_data(category_id=…, term_type_id=…)`; the `CPI` preset uses
`vs_indicator_data(indicator="CPI")` directly. Add `news_market` (tax policy, income,
public-sector pay).

**Bước 3: Growth quality (in parallel).**

`financial_detail` (revenue, gross margin, inventory, receivables/payables; store count if
disclosed) · `news_symbol`/`company_events` or `web_search` on company sources (openings/closures, market share); use `news_market` only for general context.

**Bước 4: Expectation anchor + position in the group (in parallel).**

`planned_targets` · `analyst_consensus` · two separate comparisons: (a) valuation
ratios (P/E, P/B, ROE) use `peer_compare`; (b) operating indicators (gross margin,
inventory, receivables/payables) are read with `financial_detail` **for each peer**, store counts/expansion speed
from company disclosures via `news_symbol`/`company_events` — `peer_compare` cannot return
those lines.

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định chuỗi bán lẻ đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. Where does growth come from?
├─ Same-store sales rising → record favourable, continue Q2
├─ Mainly new openings, same-store flat → record dependence on expansion, continue Q2
└─ Cannot separate → record missing, continue Q2

Q2. Is real retail still growing?
├─ Growing after the matching price-index adjustment, same period → record favourable, continue Q3
├─ Falling, even though nominal rises → record purchasing-power pressure, continue Q3
└─ No comparable price index/total retail → record missing, continue Q3

Q3. Does income support purchasing power?
├─ Real income improving or a policy already in effect → record favourable, continue Q4
├─ Real income falling per a verified source → record pressure, continue Q4
└─ No data → record missing, continue Q4

Q4. How does policy affect the segment and the chain?
├─ Support with verified recipients/effective dates → record the specific effect, continue Q5
├─ No specific incentive or rising competition → record a neutral/risk state, continue Q5
└─ Unclear → record missing, continue Q5

Q5. What do margins, inventory and receivables confirm?
├─ Real/same-store growth and margins held, inventory/receivables in line → ★ "Được tiếp sức bởi vận hành và sức mua đã xác minh"
├─ Margins down on promotions or adverse rises in inventory/receivables → ★ "Tăng trưởng có chi phí; nêu yếu tố gây áp lực đã xác minh"
└─ Data missing or conflicting → ★ "Chưa đủ dữ liệu kết luận tổng thể; thiếu thu nhập/chính sách không tự thành nhận định xấu"

## Chỉ báo đặc thù ngành

The consumer/retail indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value consumer/retail with **P/E** (the sector's profits are steady) and **EV/
revenue-based multiples** for expansion phases without profit. Read alongside
same-store revenue to avoid mistaking "expansion" for "real growth". Anchor expectations
with `planned_targets` and `analyst_consensus`. During promotions, one period of lower margins
may be deliberate; read 2 consecutive quarters.

## Rủi ro đặc thù

- **Nominal-misreading risk**: reporting "good retail growth" while volume
  barely rises.
- **Stagnant-income risk**: the demand barrier cannot be broken in the short term.
- **Promotion-margin risk**: growth bought with price, which changes when competitors
  follow.
- **Input-cost risk**: food raw-material prices and chain operating costs
  press on margins.
- **Segment-confusion risk**: the consumer-electronics cycle differs from the food cycle.

## Ranh giới

- Do not determine the market phase or infer "tiêu dùng là nơi trú ẩn" by cycle →
  `dinh-vi-chu-ky-vn` (which holds the roles of segments by phase).
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never use nominal figures in place of real growth in the conclusion.
- Never infer tax policy from memory: look up the current text, stating the source + date.

## Giới hạn

- The CPI and core CPI are monthly with a lag — state the period used.
- Companies do not disclose same-store revenue every period: when missing, lower the confidence
  of the Q1 branch.
- Modern-retail penetration is a sector estimate; state the source.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chuỗi bán lẻ này còn tăng trưởng được nữa không?
Đạt khi: new-store growth told apart from same-store growth, real retail sales, 2 quarters of margins,
and a verdict following the Q1→Q5 tree.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
multiline nominal vs real retail, bar gross margin by segment, scatter store
count against same-store revenue. Draw with `chart_render` using `from_call` (the
`[ref …]` code) from tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to compute real retail, read same-store growth, and margin/inventory indicators by segment |
