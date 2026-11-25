---
name: bat-dong-san-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN real estate by capital flows and legal status: sector credit, bonds and maturity wall, borrowing limits, housing vs industrial parks. Use for real-estate trends or developers."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành bất động sản VN theo dòng vốn và pháp lý: tín dụng ngành, kênh trái phiếu và tường đáo hạn, giới hạn vay áp dụng, cơ cấu nhà ở so khu công nghiệp. Dùng khi hỏi xu hướng nhóm BĐS hay đọc BCTC chủ đầu tư."
activation: auto
requires_tools: [financial_detail, planned_targets]
uses_tools: [financial_detail, planned_targets, analyst_consensus, peer_compare, financial_ratios, stock_overview, news_symbol, news_market, company_events, event_calendar_vn, dividends_splits, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bất động sản, nhóm bất động sản, nhóm bđs, chủ đầu tư, bán trước bất động sản, khu công nghiệp, nhà ở thương mại, bất động sản công nghiệp, dòng tiền bất động sản, doanh nghiệp bất động sản]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Bất động sản Việt Nam — framework phân tích

Vietnamese real estate is a **capital-flow + legal** sector, not a simple "housing supply–demand"
sector. This skill reads it through the four flows of capital into projects (sector credit,
corporate bonds, equity, customer advances), the legal barriers blocking each
flow, and **two separate cycles** within the sector: commercial housing (driven by borrowing
rates and absorption) versus industrial real estate (driven by foreign capital
and rents). Reading it as one sector misreads both.

## Khi nào dùng

- Use when: the user asks about real-estate group trends, whether a developer is capital-squeezed,
  how segments differ, how the bond maturity wall affects things.
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements without the sector angle → `co-ban-chuyen-sau`.
  - Detailed Vietnamese macro figures (rates, system-wide credit) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Transmission channel | Read/verify with |
|---|---|---|
| Sector credit | Loans to real estate decide the cash flowing into projects. Banks face per-sector growth limits each period → tightening/easing is **administrative**, not demand | Real-estate loans + growth limits: `news_market`/`web_search` (system figures by period); for the ticker read borrowings in `financial_detail` |
| The bond channel + maturity wall | Fast bond issuance trades for medium-term restructuring risk: a maturity wall concentrated in a few quarters is a bottleneck. Rising issuance coupons = the market pricing the sector's risk higher | Issuance + coupons + maturity wall: `news_market`/`web_search`; for the ticker read issued bonds in `financial_detail` |
| Legal barriers | Rules capping (bank loans + bonds)/equity by project size set a leverage ceiling for the whole sector; the Land Law periodically publishes land price tables (+ other replacing rules), changing input costs | Text content + effective dates: `news_market`/`web_search`. **Never infer new thresholds** — look up the current text and cite it |
| Segment | Commercial housing: borrowing rates + absorption + new supply. Industrial: foreign capital + rents + land absorption. The two cycles can move in opposite directions | Pre-sales/handovers and rents/absorption: `news_market`/`web_search`; for the ticker in `financial_detail` and `planned_targets` |
| Market liquidity | New supply arriving at once reduces pricing power → the real-estate gross margin is compressed even as revenue rises | Real-estate gross margin: `financial_detail` |
| Expectations + approvals | Projects must pass a chain of approvals; stalled expectations slow progress and push up financial costs | Progress + approval events: `company_events` · `event_calendar_vn` |

## Các bước

**Bước 1: Identify the ticker + segment (in parallel).**

`symbol_lookup` · `vn_company` (the business-segment table: housing / industrial / retail
/ services). Without a clear segment → write "chưa rõ phân khúc" and read both branches of the tree.

**Bước 2: Capital flows + the debt ceiling (in parallel).**

`financial_detail`: borrowings, issued bonds, equity, net interest cost.
`news_market`: sector credit, sector bond issuance, the maturity wall.

`financial_detail` returns one `statement` per call (default `KQKD`): `CDKT` for inventory, receivables, borrowings and advances, `LCTT` for depreciation and cash flow, `TM` for notes; a row without a name cannot be used, take that item from company disclosures. `news_market` is the latest-news feed and cannot be searched by topic or ticker: wherever this skill names it for sector figures, prices or legal texts, look them up with `web_search` (source + date) and keep `news_market` for the day's headlines.

**Bước 3: Sales quality + progress (in parallel).**

`financial_detail`: buyer advances, work in progress; contracted sales/backlog from company disclosures if no separate line exists;
the real-estate gross margin. `planned_targets`: the yearly plan as the expectation anchor.

**Bước 4: Segment specifics + position in the group.**

Industrial: `news_market` (land absorption, rents, foreign capital).
Housing: `news_market` (new supply, borrowing rates, housing policy). `peer_compare`:
only the overview keys it really returns, such as P/B, ROE; compare margins, leverage and work in progress with each peer's `financial_detail`/disclosures in the same segment and period.

## Cây quyết định doanh nghiệp đang được tiếp sức hay siết

Go through the nodes in order; record the intermediate state and move on. Stop only at ★.
Missing data must be stated and lowers confidence; never treat missing data as a negative signal.

Q1. Which segment is the company in?
├─ Housing → Q2
├─ Industrial → Q4
├─ Retail leasing/services → record that rental revenue, occupancy and operating costs are needed → Q5
├─ Multi-segment → assess Q2 and Q4 separately, combine by the disclosed weights → Q5
└─ Unclear → ★ "Chưa đủ dữ liệu phân khúc để chọn bộ KPI"

Q2. How is capital flowing into housing?
├─ Credit/bonds easing → record favourable capital → Q3
├─ Credit tightening/high funding rates → record capital pressure → Q3
└─ Missing or conflicting → record capital flow unclear → Q3

Q3. Do the maturity schedule and applicable borrowing limits create pressure?
├─ Concentrated maturities/near the limit, verified → record refinancing risk → Q5
├─ Enough repayment sources, headroom left → record capital pressure under control → Q5
└─ Missing debt schedule or legal basis → record capital risk unconfirmed → Q5

Q4. Are FDI, land absorption and industrial rents favourable?
├─ Absorption/rents rising, supported by projects and disbursed FDI → record favourable demand → Q5
├─ Weak absorption/rents → record demand pressure → Q5
└─ Missing/conflicting → record demand unclear → Q5

Q5. Are sales/leasing KPIs and cash flow improving?
├─ Pre-sales/leasing, margins and collections improving together → ★ "Hoạt động được tiếp sức, nhưng kết luận vốn phải giữ các rủi ro đã ghi"
├─ Sales up but margins or collections worse → ★ "Tăng trưởng chưa chuyển thành chất lượng lợi nhuận/dòng tiền"
├─ Slow sales, falling occupancy or rising interest → ★ "Áp lực hoạt động và vốn; phân biệt theo phân khúc"
└─ Missing or mixed results → ★ "Chưa đủ dữ liệu kết luận toàn diện; nêu riêng điểm đã xác minh"

## Chỉ báo đặc thù ngành

The real-estate indicator table + how to read each one is in `references/kpi.md`.

## Định giá theo đặc thù ngành

Value real estate with **P/B centred on the discount to book value** and
**P/E on profit projected from the backlog with a clear method**, not only P/E on recognised profit — real-estate
revenue is recognised by handover batch, so P/E jumps with progress. Developers with a disclosed land bank can also be read by **revalued net asset value (RNAV)** per project: state the selling-price, progress and discount assumptions and their source; without them, do not compute it. Never divide the price by backlog revenue and call it P/E; projected profit needs margins, progress and tax on a sound basis. A P/E must state **how much unrecognised revenue** comes with it. Anchor expectations with `planned_targets` (the
pre-sales/handover plan) and `analyst_consensus`. Compare **within the same
segment**: comparing housing P/B with industrial is meaningless.

## Rủi ro đặc thù

- **Restructuring risk**: the bond maturity wall + rising issuance coupons are the sector's first
  risk, appearing before revenue falls.
- **Statutory leverage risk**: exceeding the debt ceiling for a project's size forces raising
  equity or slowing progress, both of which cut growth.
- **Supply–demand risk**: new supply arriving in the same period reduces pricing power → gross margin
  falls even as revenue rises.
- **Approval-progress risk**: depends on periodically published land price tables and the approval
  chain; one delayed step pushes up financial costs.
- **Foreign-capital risk (industrial)**: demand for land follows FDI and the trade policy of investors' home and target markets.
- **Segment-divergence risk**: one "real-estate sector" number fails when housing and
  industrial move in opposite directions.

## Ranh giới

- Do not determine the market phase or say "BĐS sắp dẫn sóng" or "cuối sóng" →
  `dinh-vi-chu-ky-vn`.
- Do not pick tickers to buy/sell or set weights → `phan-tich-chuyen-sau-1-ma`.
- Never infer legal thresholds from memory: debt ceilings, land price tables and housing rules must be
  looked up in the current texts, citing the source + text date (this rule lives only here).
- Never read real-estate revenue like steady consumer goods: it is recognised by handover batch; read
  it with accumulated work in progress.

## Giới hạn

- Credit outstanding and the bond maturity wall are sector figures with period lags; state
  which period's figure is used.
- Segments are unclear at many listed companies (real estate mixed with services,
  retail): state which segment you are reading.
- Housing gross margin can jump on one project's handover — read 4 quarters before
  concluding a trend.

## Ví dụ

**Ví dụ 1:**
Hỏi: Chủ đầu tư BĐS có bị siết vốn không?
Đạt khi: sector credit + source, the ticker's borrowings/bonds/equity, the maturity
wall, the real-estate gross margin, and a verdict following the Q1→Q5 tree stating which segment.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
waterfall from pre-sales → unrecognised revenue → recognised revenue, multiline
net interest cost/total debt of the group, bar leverage and accumulated costs. Draw with
`chart_render` using `from_call` (the `[ref …]` code) from `financial_detail`/
`peer_compare` results you have; load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need to read pre-sales, unrecognised revenue, accumulated costs, gross margin and compute leverage against the regulatory ceiling |
