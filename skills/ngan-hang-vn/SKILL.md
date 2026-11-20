---
name: ngan-hang-vn
description: "Phase/wave: use dinh-vi-chu-ky-vn. Analyses VN banks: credit quotas, NIM and rate spread, 3-layer asset quality, off-balance-sheet items, liquidity ratios. Use for bank trends or a bank's financial statements."
match_text: "Pha/sóng: dùng skill chu kỳ. Phân tích ngành ngân hàng VN theo bộ chỉ báo riêng: hạn mức tín dụng, NIM và spread lãi, chất lượng tài sản 3 lớp, ngoại bảng và chuẩn mực thanh khoản. Dùng khi hỏi xu hướng nhóm ngân hàng hoặc đọc BCTC ngân hàng."
activation: auto
requires_tools: [financial_detail, vs_financial_norms]
uses_tools: [financial_detail, vs_financial_norms, financial_ratios, financial_statements, stock_overview, planned_targets, sbv_rates, analyst_consensus, peer_compare, compare_equities, news_symbol, news_market, dividends_splits, symbol_lookup, vn_company, valuation_run]
triggers:
  keywords: [ngành ngân hàng, nhóm ngân hàng, nợ nhóm 2 ngân hàng, NIM ngân hàng, CASA ngân hàng, NPL ngân hàng, biên lãi thuần ngân hàng, room tín dụng, hạn mức tín dụng, trần ldr, thanh khoản ngân hàng]
  exclude_keywords: [đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, giai đoạn nào, pha tiếp theo, dẫn sóng, pha nào, chu kỳ ngành, sóng ngành, luân chuyển ngành, pha thị trường, chu kỳ thị trường, giai đoạn thị trường, sóng tiếp theo, cuối sóng, giữa sóng, đầu sóng, bank dẫn, chứng dẫn, rotation]
version: 1.0.0
---

# Ngân hàng Việt Nam — framework phân tích

This skill reads banks through **the banking sector's own indicators**: the growth
flow (credit quotas), that flow's quality (the spread), its risk
(3-layer asset quality + off-balance-sheet) and the tightening/easing frame (liquidity, prudential
ratios). Bank statements are read under the type's own standards (`vs_financial_norms`
with bank-type reports), not with the generic joint-stock company line set.

## Khi nào dùng

- Use when: the user asks about bank-group trends, which metrics to watch for a bank,
  asset quality, or whether the sector is supported or squeezed (`ngân hàng đang
  thế nào`, `NPL của VCB`, `tăng trưởng tín dụng ảnh hưởng gì`).
- Do NOT use (use another skill instead):
  - Market phase / sector rotation / the next sector wave → `dinh-vi-chu-ky-vn`.
  - A full ticker analysis (technicals + valuation + news) → `phan-tich-chuyen-sau-1-ma`.
  - Valuing one ticker only (fair value, P/B range) → `dinh-gia-chuyen-sau`.
  - Only one ticker's statements/shareholders without the sector angle → `co-ban-chuyen-sau`; the corporate Beneish score does not apply to banks, Piotroski is not supported yet.
  - Detailed Vietnamese macro figures (GDP, policy rates) → `danh-gia-vi-mo-viet-nam`.

## Trụ cột driver

| Driver | Transmission channel | Measure/verify with |
|---|---|---|
| Credit quotas | If a quota mechanism applies in the period analysed, compare each bank's quota with actual growth; allocation by period or restructuring mandates may be used only with a confirming source. Never assume quarterly quotas or seasonal growth | Verify whether a quota mechanism applies in the period analysed; the ticker's YTD credit growth vs its published quota: `financial_detail` (bank statement lines) + quota allocation in `news_market`/`web_search`. State where the quota comes from |
| Net interest spread | Net interest income = interest income − interest expense; NIM differs from the asset yield minus funding cost spread because the two metrics have different denominators. When funding costs (valuable papers, term deposits) rise faster than lending yields → the spread compresses; banks keeping price-insensitive customers and cheap funding compress less | `financial_detail`: interest income, interest expense and net interest income by quarter + funding mix; `sbv_rates` for the policy deposit-rate cap |
| CASA | The non-term funding share cushions funding costs: the larger the retail customer base, the better the spread holds | Funding mix in `financial_detail` (bank standards); compare with same-segment peers via each bank's `financial_detail`/notes, same period |
| 3-layer asset quality | NPLs are only the top layer. Group 2 (special mention) loans rising while NPLs stay flat = risk forming but not yet reported; a falling coverage ratio = a thinning provision buffer. Only reading **all 3 layers together** gives a conclusion | `financial_detail`: NPL ratio, group 2 ratio, NPL coverage, credit cost — each quarter, with the QoQ trend |
| Off-balance-sheet | Off-balance-sheet credit equivalents (guarantees, commitments) are outside published NPLs and provisions → the real risk exceeds the balance sheet | `financial_detail` off-balance-sheet lines if the period has them; sector aggregates from `news_market`/`web_search`, stating the source and period |
| Liquidity + prudential ratios | Credit growing faster than deposits can pressure funding. LDR, CAR, LCR/NSFR have different definitions and scopes; never assume Basel III replaces or exempts LDR without a text applying to that bank and period | Confirm with texts: look up `news_market`/`web_search` for **the text number + effective date + cap/roadmap in force**, then cite the source in the answer. **Never infer new thresholds from memory** — if no text is found, say "chưa xác nhận"; do not guess |

## Các bước

About 4 tool rounds. `vs_financial_norms(btype=3)` is required BEFORE reading bank
statement lines — use the sector-standard lines instead of guessing generic company line names.

**Bước 1: Standards + one anchor ticker (in parallel).**

`vs_financial_norms(btype=3)` (bank statement lines) · `symbol_lookup` (if the user
gives a company name) · `vn_company` (profile, model). No published credit quota
→ write "không lấy được hạn mức"; do not guess.

**Bước 2: Read the 3 asset-quality layers + the spread (in parallel — 3 `financial_detail` calls, each with ONE `statement`).**

`financial_detail` accepts only **one** `statement` per call (default `KQKD`), so
call them separately, batched in parallel in one round:

- `financial_detail(symbol, statement=KQKD)`: interest income, interest expense and net interest income · credit
  cost · net non-interest income → for reading the spread.
- `financial_detail(symbol, statement=CDKT)`: customer loans · deposits · earning assets ·
  equity → for reading growth, the credit − deposit gap and leverage.
- `financial_detail(symbol, statement=TM)`: NPLs · group 2 loans · NPL coverage ·
  off-balance-sheet → for **the 3 asset-quality layers** (these metrics sit in the notes,
  not in KQKD).

Compare each metric QoQ/YoY, recording the number + period + which `statement` it came from.

**Bước 3: Funding context + prudential ratios (in parallel).**

`sbv_rates` (the policy rate regime) · `news_market` (credit quota allocation,
new prudential texts, room adjustments). State which number comes from which tool.

**Bước 4: Expectation anchor + position in the group.**

`planned_targets` (the ticker's yearly plan) · `peer_compare` (only the overview metrics it really returns, such as P/B, ROE; no NIM/CASA/NPL) · each peer's `financial_detail` and disclosures to compare NIM/CASA/NPL for the same period · `analyst_consensus` (brokerages' views — as expectations,
never replacing the conclusion).

## Cây quyết định ngành đang tiếp sức hay siết

Go through the nodes in order; record the intermediate state and move on. Stop only at ★.
Missing data must be stated and lowers confidence; never treat missing data as a negative signal.

Q1. Does a credit quota apply, is it published, and is there headroom?
├─ Headroom left → record room for credit growth → Q2
├─ Used up/nearly used up → record limited growth; consider the spread/fees → Q2
├─ The mechanism does not apply in the period analysed (source confirms) → record the quota is not a barrier → Q2
└─ Unpublished/mechanism unconfirmed → record headroom unknown, lower confidence → Q2

Q2. Are NIM and the interest spread widening or compressing, with compatible periods and denominators?
├─ Compressing → record margin pressure → Q3
├─ Widening/flat → record the margin state → Q4
└─ Missing income or average earning assets → record NIM not computable → Q4

Q3. What causes the compression?
├─ Rising funding costs/falling CASA → record funding-cost risk → Q4
├─ Falling asset yields/changing asset mix → record yield pressure; do not infer bad debt → Q4
└─ Cannot separate → record the cause unclear → Q4

Q4. Do NPLs, group 2 loans and NPL coverage move the same way?
├─ All three worse → record provisioning pressure → Q5
├─ NPLs not rising but group 2 rising or coverage falling → record early risk → Q5
├─ All three stable/improving → record stable asset quality → Q5
└─ Missing/conflicting indicators → record quality not clear enough → Q5

Q5. Is off-balance-sheet risk material?
├─ Yes, rising fast → ★ "Rủi ro ngoại bảng đáng kể; tổng hợp với áp lực vốn, biên và chất lượng tài sản đã ghi"
├─ Immaterial, complete data → ★ "Kết luận tiếp sức/siết từ các trạng thái đã ghi; không kết luận tín dụng thuận nếu hạn mức bị chặn"
└─ No notes yet → ★ "Chưa đủ dữ liệu để kết luận toàn diện; nêu các trạng thái xác minh được và phần ngoại bảng còn thiếu"

## Chỉ báo đặc thù ngành

The bank statement line table + how to read each ratio is in `references/kpi.md`. Read that file
when you need the exact line names in `vs_financial_norms(btype=3)` or interpretation thresholds.

## Định giá theo đặc thù ngành

Value banks with **P/B anchored on ROE**, not P/E: at the same P/B, a bank with
20% ROE and one with 13% ROE are worth entirely different amounts. Group by ROE, then compare P/B
within the group (`valuation_run` for the range; `peer_compare` to rank within the same-segment
group). Anchor expectations with `planned_targets` (the year's profit plan) and
`analyst_consensus`. A bank with a one-off loss/gain → P/E is meaningless; say so
instead of inventing a fair value.

## Rủi ro đặc thù

- **Late-formation risk**: NPLs are an outcome that already happened; group 2 loans + coverage are
  leading indicators. Watching only NPLs reads the whole cycle late.
- **Prudential risk**: LCR/NSFR roadmaps force small banks to hold excess liquid
  assets → credit easing slows or gets more expensive.
- **Quota risk**: using up the quota before Q4 makes the last quarter's growth drop.
- **Concentration risk**: when one customer group or one lending sector has a large share,
  that sector's cycle becomes the bank's cycle.
- **Weak-member risk**: expectations of takeovers/restructuring spread to the capital and cash
  flow of the whole group — read separately in the `news_market` step.

## Ranh giới

- Do not determine the market phase, say "ngân hàng sắp dẫn sóng", or read
  rotation chains → that is `dinh-vi-chu-ky-vn`'s job.
- Do not pick tickers to buy/sell or set weights → `phan-tich-chuyen-sau-1-ma`.
- Never infer prudential thresholds from memory: every legal cap/ratio must be looked up in the current
  texts, citing the source + text date (this rule lives only here, not repeated
  in `references/kpi.md`).
- Read statement lines only under the sector standards (`vs_financial_norms(btype=3)`); guessing generic
  company line names picks the wrong metrics.

## Giới hạn

- Credit quotas are an administrative allocation, not published evenly for every ticker: when missing,
  lower confidence; never infer.
- Group 2 loans and off-balance-sheet items are not fully disclosed every period — state
  the missing periods instead of interpolating.
- Liquidity standards are in a transition roadmap: a conclusion for one
  year may not hold after a new text takes effect.

## Ví dụ

**Ví dụ 1:**
Hỏi: Ngân hàng đang bị siết bởi cái gì?
Đạt khi: the credit quota + source, the spread compressing/widening with 2 QoQ/YoY numbers, the 3
asset-quality layers read together, and a verdict following the Q1→Q5 tree with its stop branch.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Fitting this skill's data:
stacked net interest/non-interest income by quarter, multiline NIM+CASA of same-segment
peers, bar NPL/group 2/coverage. Draw with `chart_render` using `from_call`
(the `[ref …]` code) from `financial_detail`/`peer_compare` results you have; load
`ve-bieu-do` to choose the chart type.

## File tham chiếu

| File | Use when |
|---|---|
| `references/kpi.md` | You need the exact bank statement lines in `vs_financial_norms(btype=3)`, interpretation thresholds for each ratio, and the KPI table by report |
