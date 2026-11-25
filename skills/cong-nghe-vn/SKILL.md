---
name: cong-nghe-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN technology by signed contract value, domestic vs international split, long-term orders and staff utilisation. Use for tech trends or IT services companies."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành công nghệ Việt Nam theo giá trị hợp đồng ký, phân hoá nội địa và quốc tế, đơn hàng dài hạn và tỷ lệ sử dụng nhân công. Dùng khi hỏi xu hướng nhóm công nghệ hoặc công ty dịch vụ công nghệ."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, financial_ratios, analyst_consensus, peer_compare, news_symbol, company_events, news_market, symbol_lookup, vn_company, yf_commodities]
triggers:
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation, pha tiếp theo]
  keywords: [ngành công nghệ, công nghệ thông tin, dịch vụ công nghệ, chuyển đổi số, thuê ngoài công nghệ, đội ngũ kỹ sư công nghệ, phần mềm]
version: 1.0.0
---

# Công nghệ Việt Nam — framework phân tích

Vietnamese technology is mainly an **outsourced engineering (IT services)** sector, not a consumer-product
sector; **telecom and digital infrastructure** (internet, towers, data centres) is a separate loop read by
subscribers, revenue per subscriber, capital spending and depreciation. Its drivers are therefore signed orders, contract quality
(long terms, large orders), the split between foreign and domestic markets, and staff
utilisation. This skill reads the sector through those four things, **not through stock prices
or international tech indices**.

The most common misreading: **signed revenue leads recognised revenue**.
A 2–3 year contract signed this period does not enter revenue at once — it comes in
quarter by quarter. Reading recognised revenue without signed orders makes the sector look "flat" in
exactly the period it is strong.

## Khi nào dùng

- Use when: the user asks about tech-group trends, what signed orders mean, whether a tech company
  can still grow, what staff utilisation says.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Only chart technicals → `ky-thuat-chuyen-sau`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Signed revenue | Signing long-term contracts is the condition for future revenue. A strong signing period leads 1–3 periods later, even if current recognised revenue is flat | **The company's own** disclosures: `news_symbol(symbol=…)` (ticker-tagged news) + `company_events`; `news_market` only for market/policy context since it cannot be queried by ticker |
| Foreign vs domestic split | Foreign depends on international clients' cycles (Japan/EU/US); domestic depends on e-government and businesses. Two different cycles | Domestic/foreign segments in `financial_detail` or company disclosures |
| Contract quality | Large orders (above a threshold) with 2–3 year terms give more durable revenue than small one-offs | Large-order share + terms: the company's own disclosures via `news_symbol`/`company_events` |
| Staff and productivity | Utilisation = billable hours / available hours per the company's definition; a low rate may come from hiring ahead of contracts, training or a lack of work, and does not by itself prove an outdated structure | Utilisation from company disclosures; revenue per average employee from `financial_detail` and staffing disclosures is only a productivity indicator, not a substitute for utilisation |
| Telecom, digital infrastructure | Subscribers × revenue per subscriber set revenue; network and data-centre spending comes first and depreciation stays, so cash flow says more than signed orders | Subscribers, prices: `news_symbol`/`web_search`; capital spending, depreciation: `financial_detail` (`LCTT`) |
| AI input costs | Computers and infrastructure get dearer with global AI demand, pushing up delivery costs | `yf_commodities` (the metals cycle if context is needed) + `news_market` |

## Các bước

**Bước 1: Identify the segments (in parallel).**

`symbol_lookup` · `vn_company` (segments: foreign services / domestic / own
products / telecom) · `financial_detail` (revenue by segment).

**Bước 2: Orders and leading signals (in parallel).**

`news_symbol(symbol=…)` + `company_events` for the company's own signed-order disclosures
(contract value, term, client market) — `news_market` does **not** take a ticker
parameter, use it only for market context · `financial_detail` (backlog and
unearned revenue if available).

**Bước 3: Operating quality (in parallel).**

`financial_detail`: revenue, profit, costs, headcount. Compute revenue
per average employee for the same period with `shell` (show the formula and inputs); utilisation needs billable/available hours from company disclosures. Without those figures, do not infer utilisation from revenue per employee.

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` (revenue/profit plan) · `peer_compare` (overview metrics within the group) · `analyst_consensus`.

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: wherever this skill names it for sector figures, prices or legal texts, look them up with `web_search` (source + date) and keep `news_market` for the day's headlines.

Tool check: `peer_compare` uses only the overview keys actually present in the result (such as P/E, P/B, ROE); its `metrics` parameter does not create extra metrics. Margins, volumes, costs, inventory and operating KPIs must be read from each peer's `financial_detail` for the same period; if missing, look up company disclosures via `news_symbol`/`web_search`, stating the source, formula and period. With missing data, leave it blank and do not rank.

## Cây quyết định công ty công nghệ đang được tiếp sức hay siết

Follow the matching branch; record intermediate states and stop only at ★. Every conclusion must separate known data from what is missing; never fill in numbers or turn "chưa rõ" into "xấu".

Q1. How are signed orders and the backlog?
├─ Signed orders up, long terms → record favourable, continue Q2
├─ Signed orders down, backlog falling, verified → record pressure on future revenue, continue Q2
└─ Not disclosed → record missing data, continue Q2

Q2. Which segment drives revenue/profit?
├─ Foreign → Q3 (international)
├─ Domestic → Q4 (domestic)
├─ Telecom/digital infrastructure → ★ "Đánh giá thuê bao, doanh thu mỗi thuê bao, chi đầu tư, khấu hao và dòng tiền tự do; không dùng hợp đồng ký mới cho mảng này"
├─ Mixed → consider Q3 and Q4 separately by the disclosed weights
└─ Mix unclear → record missing, continue Q5

Q3 (international). How are contract quality and concentration?
├─ Long-term, diversified clients → record favourable, continue Q5
├─ Short-term or concentrated in one client/market → record concentration risk, continue Q5
└─ No terms/mix → record missing, continue Q5

Q4 (domestic). How are the client base and budgets?
├─ Public budgets/contracts with verified progress → record acceptance conditions, continue Q5
├─ Private clients → assess the backlog, demand and private clients' payments, continue Q5
├─ Verified slow public budgets → record pressure, continue Q5
└─ Unclear → record missing, continue Q5

Q5 (common). Do productivity, staff and margins confirm it?
├─ Revenue per employee and margins held/improving over several periods, favourable signings → ★ "Được tiếp sức bởi đơn hàng và vận hành đã xác minh"
├─ Productivity/margins falling for long or weak signings → ★ "Có áp lực cần kiểm tra thời gian thuê trước doanh thu; không mặc định mở nhân sự là lỗ"
└─ Missing average headcount, margins or signings, or conflicting data → ★ "Chưa đủ dữ liệu kết luận tổng thể; doanh thu/nhân viên không thay tỷ lệ sử dụng nhân công"

## Chỉ báo đặc thù ngành

The tech indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value tech with **P/E** (its profits are steadier than commodity cycles) and **P/E
on net profit from long-term signed orders** when margins are improving. Anchor expectations with
`planned_targets` (the yearly revenue/profit plan) and `analyst_consensus`. Do not use
peak P/E when profit depends on one large temporary order — state the profit quality. Telecom and digital infrastructure: EV/EBITDA, because depreciation is large. Several loops in one company: value each and add them up, stating the assumptions.

## Rủi ro đặc thù

- **Backlog exhaustion risk**: revenue consumes the backlog while signings are weak → growth flattens
  after 2–3 periods.
- **Automation risk**: traditional outsourced tasks get replaced → revenue per
  head falls and margins shrink.
- **Market concentration risk**: one client market (Japan/EU/US) reversing
  drags down the whole foreign segment.
- **Policy-driven domestic risk**: the domestic segment relies on e-government, sensitive to
  budgets.
- **Client-currency risk**: a client market's currency weakening cuts revenue in dong without any change in orders.
- **Wage risk**: competition for engineers raises costs before prices adjust.
- **AI input-cost risk**: computer and infrastructure prices push costs up
  when the company builds its own infrastructure.

## Ranh giới

- Do not determine the market phase or infer "công nghệ sắp dẫn sóng" → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never extrapolate revenue from one large signed order: long-term orders enter revenue quarter
  by quarter; state the recognition schedule.
- Never use international tech indices in place of domestic drivers.

## Giới hạn

- Signed orders are disclosed irregularly: when missing, lower the confidence of the Q1 branch.
- Revenue per employee is derived (label it "tính từ"), before removing seasonal staff and subcontractors —
  say so.
- The foreign segment carries FX: a quarter's gross margin can jump on the exchange rate, not on
  operations.

## Ví dụ

**Ví dụ 1:**
Hỏi: Công ty công nghệ này còn tăng trưởng được nữa không?
Đạt khi: signed revenue + backlog, the foreign/domestic segments, 2 quarters of revenue per
employee, and a verdict following the Q1→Q5 tree.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
waterfall from signed orders → backlog → recognised revenue, multiline revenue by segment,
bar revenue per employee by period. Draw with `chart_render` using `from_call` (the
`[ref …]` code) from tool results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read signed orders/backlog, compute revenue per head and margin indicators by segment |
