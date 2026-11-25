---
name: chung-khoan-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN brokerages by leverage and revenue mix: margin loans vs equity, margin spread, the shift from fees to balance-sheet businesses. Use for brokerage results."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành chứng khoán VN theo đòn bẩy và cơ cấu doanh thu: dư nợ margin so vốn chủ, spread margin, sự dịch chuyển từ phí sang mảng cân đối. Dùng khi đọc kết quả công ty chứng khoán."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, stock_overview, planned_targets, analyst_consensus, peer_compare, market_overview, breadth_scan, news_symbol, news_market, symbol_lookup, vn_company, vs_market_info, valuation_run]
triggers:
  keywords: [ngành chứng khoán, mảng chứng khoán, dư nợ margin, cho vay ký quỹ, môi giới chứng khoán, lãi margin, doanh thu môi giới, ctck vn]
  exclude_keywords: [mở tài khoản, nên mua cổ phiếu nào, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, đang khuyến nghị, khuyến nghị mã, khuyến nghị những mã, báo cáo khuyến nghị, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Chứng khoán Việt Nam — framework phân tích

Vietnamese brokerages have left the "live on brokerage fees" model: revenue is shifting
to the **balance-sheet businesses** (proprietary investment + margin lending). So this skill reads
the sector through **leverage** (margin loans vs equity and vs the permitted cap), **the quality of
that leverage** (the margin spread) and **the revenue mix** (which business feeds profit),
not through brokerage revenue — zero-fee competition distorts that indicator's value.

Brokerage statements are read under their own standards (`vs_financial_norms(btype=2)`).

## Khi nào dùng

- Use when: the user asks about brokerage-sector trends, a securities company's results,
  whether margin debt is risky, what the sector gains from a market upgrade.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed Vietnamese macro figures → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Transmission channel | Measure/verify with |
|---|---|---|
| Margin debt | One of the sector's interest sources: investors borrow to buy shares. Steadily rising debt = risk appetite opening up; a sudden drop = the market just sold off or brokerages tightened margin calls | Total sector margin debt + the ticker's: `news_market`/`web_search` (large brokerages publish margin debt quarterly); for the ticker read `financial_detail` |
| Leverage level | Margin debt vs equity against the **regulatory cap in force** (look up the regulator's text: number, effective date, scope, formula and conditions; unverified → do not conclude the headroom) decides how much room for growth is left. Near the cap → growing the loan book may need new capital; proprietary trading is a separate source of risk and does not by default make up for growth | Computed from `financial_detail` (margin loans, equity) — state your formula |
| Margin spread | Margin rates vary by brokerage and margin package, while brokerages' funding costs move with deposits and valuable papers → a compressed spread is a direct profit risk | Average margin rate (per package, published by each company) + funding cost: `news_market` + `financial_detail` — take the figures for the period in question; never carry old figures across periods |
| Revenue mix | The sector is moving from fees to the balance sheet. Domestic groups rely on investment + margin; foreign groups are more balanced. The mix decides which group suffers in a falling market | `financial_detail` (brokerage standards): brokerage · margin lending · investment · advisory revenue |
| Market liquidity | Zero-fee competition strips brokerage fees of measurement value, but liquidity remains the base for margin and proprietary trading | `market_overview` · `breadth_scan` · `vs_market_info` |
| New mechanisms | Non-prefunding, a clearing system (CCP), market upgrades in stages, the IPO/ECM pipeline → underwriting/advisory fees and equity expansion | `news_market`/`web_search`; state the source and the dates |

## Các bước

About 4 tool rounds. `vs_financial_norms(btype=2)` is required BEFORE reading
brokerage statement lines.

**Bước 1: Standards + identify the ticker (in parallel).**

`vs_financial_norms(btype=2)` · `symbol_lookup` (if the user gives a company name) ·
`vn_company` (business model, shareholder group — a bank subsidiary or independent).

**Bước 2: Leverage + revenue mix (in parallel).**

`financial_detail`: margin loans · equity · revenue by the 4 businesses ·
receivables. Compute the leverage level with `shell` from those figures (show the formula and inputs) and compare with the regulatory cap.

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: sector figures, prices and legal texts come from `web_search` (source + date).

**Bước 3: Market rhythm + spread (in parallel).**

`market_overview` (bluechip prices, movers, breadth) · `breadth_scan` (is the breadth
real) · `news_market` (sector margin debt, margin rates, brokerages' funding costs).

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` (the yearly plan) · `peer_compare` (only the overview keys it really returns, such as P/B, ROE) · each peer's `financial_detail`/disclosures for the same period to compare debt/equity and revenue mix · `analyst_consensus` (an expectation anchor, never a substitute
for the conclusion).

## Cây quyết định ngành đang được tiếp sức hay bị siết

Go through the nodes in order; record the intermediate state and move on. Stop only at ★.
Missing data must be stated and lowers confidence; never treat missing data as a negative signal.

Q1. Is sector margin debt rising or falling?
├─ Rising steadily → record rising margin demand → Q2
├─ Falling/flat → record weak margin momentum; do not infer that proprietary trading makes up for it → Q2
└─ No sector series → record margin demand unclear → Q2

Q2. How far is margin debt/equity from the cap in force?
├─ Near the cap, verified → record limited headroom, new capital needed → Q3
├─ Well below the cap, verified → record headroom left → Q3
└─ Missing figures/texts → record legal headroom unconfirmed → Q3

Q3. Is the margin spread widening or compressing?
├─ Compressing → record pressure on margin profit → Q4
├─ Widening/stable → record a favourable/stable margin → Q4
└─ No rates or funding costs for the same period → record the spread unmeasurable → Q4

Q4. How good is the revenue mix?
├─ Dependent on brokerage → record fee-competition risk → Q5
├─ Margin lending rising, funding costs under control → record a margin-interest source → Q5
├─ Dependent on proprietary trading → record portfolio volatility, separate realised/unrealised gains; not positive by default → Q5
└─ Missing detail or a mixed mix → record sustainability unclear → Q5

Q5. Is there evidence the new mechanisms and the advisory pipeline are being delivered?
├─ Dates and revenue/capital effects verified → ★ "Có động lực bổ sung; đánh giá cùng rủi ro ký quỹ và tự doanh đã ghi"
├─ Not delivered/already priced in → ★ "Đánh giá tăng trưởng từ hoạt động thực tế; không nội suy lợi nhuận từ tên chính sách"
└─ Unverified → ★ "Chưa đủ dữ liệu về động lực thể chế; kết luận giới hạn theo các mảng đã xác minh"

## Chỉ báo đặc thù ngành

The table of brokerage statement lines + how to read each indicator is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value brokerages with **P/B anchored on ROE**: at the same P/B, a brokerage with 13% ROE and one with
25% ROE are worth different amounts. Group by business model (balanced domestic /
bank-linked domestic / foreign), then compare P/B within the group (`valuation_run` with `btype=2` for the
current P/B, it gives no range; `peer_compare` for ranking). Anchor expectations with `planned_targets` and
`analyst_consensus`. Profit dependent on proprietary trading → one unusually profitable quarter does not
last: state the profit quality before using P/E.

## Rủi ro đặc thù

- **Two-way leverage risk**: margin debt falls fast when the market sells off → both
  margin revenue and the proprietary portfolio's quality worsen at once.
- **Near-the-cap risk**: near the margin cap, even a market rally adds no
  growth to this business.
- **Fee-competition risk**: brokerage fees are structurally compressed, with no way
  around it.
- **Portfolio-quality risk**: proprietary books holding corporate bonds → corporate
  clients' credit risk leaks onto the brokerage's balance sheet.
- **Collateral-concentration risk**: margin loans on a few tickers can turn into bad debt when one falls limit-down for
  several sessions.
- **Session-rhythm dependence**: falling liquidity drags all 3 businesses.

## Ranh giới

- Do not determine the market phase, say "chứng khoán sắp dẫn sóng", or read
  rotation chains or weekly leading indicators → `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer sector margin debt from one brokerage: that is the ticker's own figure. Sector figures come
  from disclosures or sourced press, with the period stated.
- The rules on the margin cap live only here, not repeated in `references/kpi.md`.

## Giới hạn

- Sector margin debt is aggregated quarterly, with a lag: monthly conclusions must state
  which period's figure is used.
- The revenue mix shifts quarter to quarter with proprietary trading — read 4–8 quarters before
  grouping.
- Brokerages do not disclose funding costs uniformly: spread comparisons are estimates;
  say so.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chứng khoán còn dư địa tăng trưởng không?
Đạt khi: sector margin debt + source, the ticker's leverage vs the cap, the margin spread
widening/compressing, the 4-business revenue mix, and a verdict following the Q1→Q5 tree with its stop branch.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
stacked revenue by the 4 businesses, multiline margin debt of the group, bar leverage of
the tickers. Draw with `chart_render` using `from_call` (the `[ref …]` code) from
`financial_detail`/`peer_compare` results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need the exact brokerage statement lines in `vs_financial_norms(btype=2)`, how to compute leverage, interpretation thresholds |
