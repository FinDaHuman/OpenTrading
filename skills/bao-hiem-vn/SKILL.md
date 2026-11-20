---
name: bao-hiem-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses life and non-life insurance: new premiums, policy retention, claims, combined ratio, reinsurance and investment income; splits by business line and distribution channel."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích bảo hiểm nhân thọ/phi nhân thọ: phí mới, duy trì hợp đồng, bồi thường, combined ratio, tái bảo hiểm và thu nhập đầu tư; tách nghiệp vụ và kênh phân phối."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, planned_targets, analyst_consensus, peer_compare, news_symbol, news_market, symbol_lookup, vn_company]
triggers:
  keywords: [ngành bảo hiểm, hãng bảo hiểm, bảo hiểm phi nhân thọ, bảo hiểm nhân thọ, phí bảo hiểm, bancassurance, công ty bảo hiểm]
  exclude_keywords: [nên mua bảo hiểm, mua bảo hiểm nhân thọ, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Bảo hiểm Việt Nam — framework phân tích

Distinguish **life, non-life and mixed groups** before choosing indicators.
Life reads new premiums, policy retention and acquisition costs; non-life reads earned
premiums, the loss ratio, the combined ratio and reinsurance. A mixed group must be split
by segment with intra-group transactions eliminated; never judge the whole group by the new-premium set.
Both need underwriting results separated from investment, reserves and one-offs.

## Khi nào dùng

- Asked about sector trends, an insurer's health, underwriting quality or why profit rose/premiums fell.
- Market phase, sector rotation → `dinh-vi-chu-ky-vn`; a full ticker analysis → `phan-tich-chuyen-sau-1-ma`; valuation alone → `dinh-gia-chuyen-sau`; general statements → `co-ban-chuyen-sau`.
- Questions on a bank's bancassurance: combine with `ngan-hang-vn`; never treat bank fees as the insurer's premiums.

## Trụ cột driver

| Segment/driver | Indicators and mechanism | Source |
|---|---|---|
| Life | New premiums/APE per the published definition, renewal premiums, retention for the same cohort/term, acquisition costs and policy liabilities | Company/association disclosures with period and definition; never infer retention from total premium revenue |
| Non-life | Gross premiums, retained premiums, earned premiums, incurred claims and the combined ratio; rising premiums with high claims/costs can still mean an underwriting loss | Statements and notes per `vs_financial_norms(btype=5)`; compute per `references/kpi.md` |
| Reinsurance | Cession ratio, claim recoveries, reserves and counterparty risk; check gross/net movements | `financial_detail(statement=TM)` or company notes |
| Investment | Recurring investment income, realised/unrealised gains/losses, yield and asset duration vs liabilities | `KQKD`, `CDKT`, `TM` and disclosures for the same period |
| Reserves and solvency | Rising reserves can reflect liabilities or changed assumptions and do not by themselves mean a healthy book; accounting capital does not prove the solvency margin is met | Statements and capital-adequacy disclosures under the applicable rules |
| Sales channels and policy | Agents, banks and direct channels differ in cost/sales quality | `news_symbol`, company disclosures, `news_market` for sector figures; look up legal texts + effective dates |

## Các bước

**Bước 1 — Identify the segment and the standards.** `symbol_lookup` · `vn_company` ·
`vs_financial_norms(btype=5)` before choosing lines. Classify life/non-life/
mixed by revenue, profit and disclosed liabilities; if unclear, do not force a classification.

**Bước 2 — Underwriting by segment.** Call `financial_detail(statement=KQKD)`,
`financial_detail(statement=CDKT)` and `financial_detail(statement=TM)` separately; do not pass
`btype` to this tool. Missing specific KPIs → take company/association reports from a
verifiable source, stating the period. Life uses new premiums/retention; non-life uses the
loss ratio/combined ratio/reinsurance. Never substitute market news for a company's own figures.

**Bước 3 — Earnings quality.** Reconcile underwriting, reserves, investment, duration
and liquidity; never take rising financial income as evidence of an underwriting recovery.
Never subtract investment revenue from consolidated profit to create a "net insurance profit" when
costs, tax or allocations on the same basis are missing.

**Bước 4 — Comparison and expectations.** `planned_targets` · `analyst_consensus` ·
`peer_compare` only for the overview keys it really returns (e.g. P/B, ROE); it does not create new premiums or
combined ratios through `metrics`. Sector KPIs come from `financial_detail`/each peer's disclosures
in the same segment, period and gross/net basis.

## Cây quyết định công ty bảo hiểm đang được tiếp sức hay siết

Record the intermediate state and move on; stop only at ★. Missing figures are not a negative signal.

Q1. Which segment is the company in?
├─ Life → record the new-premium, retention, acquisition-cost set → Q2
├─ Non-life → record the earned-premium, claims, combined-ratio set → Q2
├─ Mixed → split both segments, keep their weights and consolidation eliminations → Q2
└─ Cannot classify → ★ "Chưa đủ dữ liệu chọn bộ KPI bảo hiểm"

Q2. Is each segment's underwriting improving?
├─ Life new premiums/retention improving or non-life combined ratio falling on the same basis → record favourable underwriting → Q3
├─ Underwriting indicators worsening → record underwriting pressure → Q3
└─ Missing, conflicting or on different bases → record underwriting unclear → Q3

Q3. Do reserves and reinsurance create risk?
├─ Enough information, recoveries and reserves fit the liabilities → record risk under control → Q4
├─ Reserves up on losses/slow reinsurance recoveries or weak counterparties → record pressure → Q4
└─ Missing notes → record liability quality unclear → Q4

Q4. Where does the profit improvement come from?
├─ Underwriting and recurring investment both improving → record favourable profit quality → Q5
├─ Mainly investment or one-offs → record dependence on markets/rates → Q5
├─ Both weakening → record profit pressure → Q5
└─ Cannot separate → record profit source unclear → Q5

Q5. How do sales channels and current policy act?
├─ Favourable evidence with clear effective dates and compliance costs → ★ "Có động lực hỗ trợ; kết luận từng mảng phải giữ các rủi ro nghiệp vụ/đầu tư đã ghi"
├─ Evidence of channel tightening/compliance costs → ★ "Có áp lực kênh/chính sách; đánh giá cùng sức khỏe nghiệp vụ đã ghi"
└─ Unverified or no material change → ★ "Chưa có căn cứ chốt động lực chính sách; kết luận giới hạn ở KPI đã xác minh"

## Chỉ báo đặc thù ngành

Read `references/kpi.md` to choose the formula and basis (gross/net, written/earned
premiums), on the same period and standards. If a denominator is missing or zero, do not compute the ratio.

## Định giá theo đặc thù ngành

Use P/B together with ROE, reserve quality and capital; P/E on normalised profit after
costs and tax on the same scope. For life, embedded value may be referenced if the company
publishes its method and assumptions; never build a value from total premiums. Mixed groups use
SOTP when data allows; never compare consolidated profit with a single segment's underwriting profit.

## Rủi ro đặc thù

Mis-selling and lapses, natural disasters/large claims, reserve development,
reinsurance counterparties, asset/liability duration mismatch and investment markets all need weighing.
A good combined ratio achieved by ceding more risk may trade away costs and retained profit.

## Ranh giới và giới hạn

Do not determine phases/waves or pick tickers to buy or sell. Never infer laws, ownership room or
capital-safety thresholds from memory: look up the texts and their effective periods. Never infer retention
or loss ratios from total premiums; with missing KPIs, say there is not enough data. Never call
rising reserves positive before understanding the liabilities. Disclosures on different bases must be explained,
or the comparison stops.

## Ví dụ

Hỏi: Bảo hiểm phi nhân thọ có phục hồi thật không?
Đạt khi: earned premiums, claims, the combined ratio, reinsurance and investment yield
for the same period; underwriting quality separated from investment; the tree followed by segment.

## Trực quan hóa

Draw only when the user wants; at most one chart, from verified data via
`chart_render(from_call=...)`. Life: new premiums/retention; non-life: combined
ratio; mixed: results by segment. Load `ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | Life/non-life KPI formulas, reinsurance and investment |
