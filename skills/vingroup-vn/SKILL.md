---
name: vingroup-vn
description: "Vin group KPIs; phase/wave: use dinh-vi-chu-ky-vn. SOTP for VIC: Vinhomes handovers, VinFast cash burn, Vincom leasing; checks related-party deals, refinancing and the Vingroup index weight."
match_text: "KPI nhóm Vin; pha/sóng dùng skill chu kỳ. SOTP VIC: Vinhomes bàn giao, VinFast đốt tiền, Vincom cho thuê; kiểm tra giao dịch liên kết, tái cấp vốn và trọng số chỉ số Vingroup."
activation: auto
requires_tools: [financial_detail, company_events]
uses_tools: [financial_detail, company_events, news_symbol, news_market, financial_ratios, planned_targets, analyst_consensus, peer_compare, breadth_scan, market_snapshot, vn_equity_quote_batch, event_calendar_vn, symbol_lookup, vn_company]
triggers:
  keywords: [nhóm vin, tập đoàn vingroup, phân tích vingroup, sức khỏe tài chính vingroup, SOTP Vingroup, quỹ đất vinhomes, hiệu quả vinfast, dòng tiền vinfast, kinh doanh vincom, vinfast lỗ]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Vingroup — framework phân tích

Vingroup is a **multi-segment conglomerate**, not a sector: profit comes from segments with
different cycles (real estate, EVs, retail, hotels, services) and **each segment's weight
changes by period** — in periods when real estate hands over, real estate leads; when EVs
expand, they are the cash-flow variable. Reading VIC with any one sector's indicator set is wrong.
This skill analyses by **splitting value by segment and by real cash flow**, and
the first mandatory step is measuring each segment's contribution (`financial_detail` +
company disclosures) before concluding anything about the consolidated whole:

1. **The real-estate loop**: profit comes from project handovers, so it jumps by batch —
   read contracted sales, buyer advances and work in progress, not one quarter.
2. **The cash-burning EV segment**: EV revenue grows fast but margins are negative → accumulated
   losses and refinancing needs become a driver for the whole group.
3. **Related-party transactions**: buying/selling assets with the founding shareholder, divesting/deconsolidating,
   capital contributions — these change the reporting entity. This is a governance risk, visible only when
   read before the numbers come out.

## Khi nào dùng

- Use when: the user asks about Vingroup, VIC, VHM, VinFast, Vincom, the group's financial
  health, why Vin can drag the whole market on a given day.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`; only one ticker's statements → `co-ban-chuyen-sau`.
  - Real estate in general → `bat-dong-san-vn`.
  - Consumer retail in general → `tieu-dung-ban-le-vn`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| The real-estate loop | Profit comes from Vinhomes project handovers. Contracted pre-sales differ from buyer advances; work in progress is invested inventory, and the gap between the two is not future profit | `financial_detail` (pre-sales, accumulated work in progress, real-estate segment margin) |
| The EV loop | EV revenue grows but margins are negative; payback depends on scale and unit costs. Restructuring (spinning off, selling, merging segments) changes the reporting entity | EV segment + accumulated losses + restructuring: `financial_detail`, `company_events` |
| Leverage | Projects are financed with debt and bonds; the bond wall and the average cost of capital decide refinancing risk | `financial_detail` (debt, bonds, interest) + `news_market` (maturity wall, issuance) |
| Related-party transactions | Internal asset sales and handover eliminations change both the consolidation structure and margins | `company_events` (structure-change events) + `news_market` |
| Weight and index contribution | Share of exchange market cap, index weight and point contribution are three different quantities | Take constituent weights by the index methodology, base date and price changes for the same index/period from the index provider or a verifiable reporting source. Never use VN30 quotes or batch quotes to infer exchange market cap/weights |
| Cash flow / liquidity | An independent check: cash, charter capital, maturing debt | `financial_detail` (cash, capital, short-term debt) |

## Các bước

**Bước 1: Split segments + consolidation structure (in parallel).**

`symbol_lookup` · `vn_company` (segments, revenue/profit weights) · `financial_detail`
(revenue and margins by segment). State which parts recently changed the consolidation structure.

**Bước 2: The real-estate loop (in parallel).**

`financial_detail`: pre-sales, accumulated work in progress, real-estate gross margin.
`company_events` + `news_market`: project handover progress, approval events.

**Bước 3: The EV loop + leverage (in parallel).**

`financial_detail`: EV segment revenue and losses, debt, bonds, cash,
interest costs. `news_market`: maturing bond wall, new issuance, restructuring.

**Bước 4: Index impact + expectation anchor.**

`breadth_scan` (exchange-wide breadth) · index-provider releases or reports
with constituent weights and a clear period · `planned_targets` · `peer_compare` (only the overview keys
it really returns, such as P/B, ROE; operating KPIs from each peer's statements/disclosures) · `analyst_consensus`.

Compute contribution only when you have complete, compatible weight and price-change sources for **the same
index and the same period**. Estimate single-period contribution share ≈ sum of start-of-period weights × constituent
returns; point contribution ≈ start-of-period index level × that share, stating it is an estimate and
adjusting for methodology/divisor/rebalancing/corporate actions where needed. If a source
publishes the contribution directly, prefer that number. Compute share of exchange market cap only with the market
cap of the whole scope and its total at the same time; never call it an index weight, especially
for free-float-adjusted/capped indices. Missing the denominator, weights or period
→ do not compute; describe the price/breadth correlation and record the missing data.

## Cây quyết định sức khoẻ tập đoàn

Go through the nodes in order; record the intermediate state and move on. Stop only at ★.
Missing data must be stated and lowers confidence; never treat missing data as a negative signal.

Q1. Has the consolidation structure changed?
├─ Yes → record that adjusted, like-for-like comparisons are needed → Q2
├─ No → Q2
└─ Unverified → record limited comparability → Q2

Q2. How does the real-estate segment contribute?
├─ Pre-sales, handovers and margins improving → record a favourable real-estate contribution → Q3
├─ Real estate stalling/margins falling → record real-estate pressure; do not infer other segments compensate → Q3
└─ No segment figures → record contribution unclear → Q3

Q3. How is EV segment cash flow?
├─ Operating cash flow and investment needs improving → record lower funding needs if evidenced → Q4
├─ Margins/losses improving but no cash-flow evidence → record reduced cash burn unconfirmed → Q4
├─ Negative cash flow and rising investment needs → record funding pressure → Q4
└─ No figures → record EV cash flow unmeasured → Q4

Q4. Is refinancing secured?
├─ Committed sources with clear conditions, enough to match maturing debt → record available funding → Q5
├─ Cash short of the maturity schedule → record refinancing risk → Q5
└─ No debt schedule/commitments → record refinancing ability unverified → Q5

Q5. Do related-party transactions distort comparisons?
├─ Immaterial, consolidation eliminations checked → ★ "Đánh giá SOTP và dòng tiền theo các trạng thái đã xác minh"
├─ Unusual gains from transactions/divestments → ★ "Điều chỉnh lãi một lần và phạm vi hợp nhất trước khi định giá; giữ rủi ro dòng tiền đã ghi"
└─ Missing notes → ★ "Chưa đủ dữ liệu quản trị/hợp nhất; không kết luận lãi nội bộ đã ghi nhận ở cấp tập đoàn"

## Chỉ báo đặc thù ngành

The group indicator table + how to read it is in `references/kpi.md`.

## Định giá theo đặc thù ngành

A multi-segment group is **not valued with one consolidated multiple**: value it as **the sum
of its segments (SOTP)** with the fitting multiple for each (real estate by P/B and NAV, EVs
by revenue/margins or discounted cash flow, retail by P/E), then subtract a conglomerate
discount. Anchor expectations with `planned_targets` and `analyst_consensus`. Never compare
the consolidated P/E with a pure real-estate company.

## Rủi ro đặc thù

- **Multi-segment risk**: the profit structure changes with the leading segment, so no single cycle
  describes the group.
- **Cash-burn risk**: the EV segment's accumulated losses become a cash-flow risk for the whole
  group.
- **Refinancing risk**: debt and bonds maturing concentrated in a few periods.
- **Governance risk**: related-party transactions and consolidation changes make reported margins
  and consolidated value incomparable with prior periods.
- **Portfolio concentration risk**: the Vin group holds a large index weight, so the group's moves
  alone can skew the whole market's index.

## Ranh giới

- Do not determine the market phase or infer "nhóm Vin sắp dẫn sóng" → `dinh-vi-chu-ky-vn`
  (the only place holding the chain rules and the Vin group by cycle).
- Do not pick tickers to buy/sell → `phan-tich-chuyen-sau-1-ma`.
- Never infer restructuring plans or maturity schedules from memory: look up disclosures and cite the source.
- Never conclude on cash flow when reported margins are skewed by internal transactions: read carefully
  which segment contributes.

## Giới hạn

- Segment costs are not fully disclosed every period: when missing, lower the confidence
  of the segment branches.
- The regulatory debt ceiling for real estate is a sector rule (`bat-dong-san-vn`), applied to the group's
  real-estate segment — not repeated here.
- Internal funding between subsidiaries makes consolidated figures differ from each company's own:
  state whether you are reading consolidated or separate figures.

## Ví dụ

**Ví dụ 1:**
Hỏi: VIC có đang khoẻ không?
Đạt khi: profit split by segment, pre-sales + accumulated work in progress, debt + the maturity
wall, and a verdict following the Q1→Q5 tree stating the points needing caution.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
stacked revenue by segment, waterfall from pre-sales to recognised profit, multiline debt/cash
by period. Draw with `chart_render` using `from_call` (the `[ref …]` code) from tool results
you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read pre-sales – accumulated work in progress, profit allocation by segment and the group's cash-flow indicators |
