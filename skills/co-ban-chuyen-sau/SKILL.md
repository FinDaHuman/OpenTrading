---
name: co-ban-chuyen-sau
description: Read financial statements and assess the fundamental quality of 1 ticker (M-Score manipulation, F-score, growth, ownership, dividends). Always use this skill when the user asks to read financial statements, earnings quality, M-Score, major shareholders, insider or dividends of a ticker — e.g. "BCTC FPT có gì lạ", "VCB có thao túng không", "cổ đông lớn HPG" — even when the user doesn't explicitly say they want "phân tích cơ bản".
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
tool_budget: 9
triggers:
  keywords: [bctc, báo cáo tài chính, cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.2.0
---

# Analyzing Single-Stock Fundamentals

PURE fundamentals analysis of 1 ticker by aspect: whichever aspect is asked, run only that leg then stop — don't scan the whole statement set "just to be safe". Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks about financial statements (BCTC), earnings quality, M-Score/manipulation, F-score, business plan, major shareholders, insider, dividends of 1 ticker.
- When NOT to use (use another skill instead):
  - Technical questions (RSI, MACD, breakout, support/resistance) → `ky-thuat-chuyen-sau`.
  - Valuation questions (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - Comparing 2-6 tickers → `so-sanh-cung-nganh`.
  - Full analysis of 1 ticker → `phan-tich-chuyen-sau-1-ma`.
  - Reading broker reports (not original financial statements) → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 0: check whether the JWT is alive
- [ ] Step 1: statement core + quality (aspect chataluong stops here)
- [ ] Step 2-3: only run the aspect the user asked (trend/ratios, ownership/plan)
- [ ] Step 4: lock the 7-item verdict + provenance
```

**Step 0: JWT check (mandatory, call directly first).**

Run `vs_auth_status`. JWT alive → `financial_detail` may be used; JWT dead → switch to the mirror branch `vs_financeinfo` — these two tools never run in parallel because they share the same source of numbers.

**Step 1: Statement core + quality.**

Run 2 calls in parallel: `financial_detail` (statement=KQKD, periods_n=4) + `stock_forensic` (symbol). If the user only asks about quality (`chataluong`), stop right here.

**Step 2: Expand by aspect (each aspect is 1 leg, run only the leg asked).**

- Trend/ratios: `financial_statements` · `financial_ratios` · `vn_fundamentals` (at most 3 calls).
- Ownership/plan (`sohuu`/`cophieu`/`kehoach`): `planned_targets` · `holders` · `insider_trading` · `dividends_splits` (+ Step 1 if a base is needed).
- Reference: `vs_financial_norms` / `vs_financial_terms` / `vs_company_info` — only when norm_id/period need explaining.
- Never call `vs_documents` here (that is `tim-co-hoi-bao-cao-ctck`'s tool). Cash-flow (LCTT) / balance-sheet (CDKT) statements are only fetched when the user explicitly asks for cash flow/balance sheet via the `statement` param.

**Step 3: Validate before locking the verdict.**

Any leg that comes back empty → partial verdict + state clearly which source is missing; never fabricate numbers to fill gaps. If M is partial for banks (SGAI null because the cash-flow statement is empty — VCB live), write "M inconclusive"; never assign M=0. If `financial_detail` periods exceed the package → empty rows + warning → degrade to `vs_financeinfo` exactly once, state the fallback clearly. `vn_company` is slow ~30s when throttled so schedule it last; if missing, record as missing.

## Template

ALWAYS use this exact verdict structure, each item with numbers + trend + provenance:

1. Growth quality: Revenue/Profit 4 quarters + QoQ/YoY trend + margins (`provenance: financial_detail`).
2. Key ratios (`provenance: financial_ratios` / `vn_fundamentals`).
3. M-Score + F-score + red flags (`provenance: stock_forensic`).
4. Vs plan: beat/miss % (`provenance: planned_targets`).
5. Ownership structure + insider changes (`provenance: holders` / `insider_trading`).
6. Dividend policy (`provenance: dividends_splits`).
7. 1-sentence conclusion: CƠ BẢN TỐT/TRUNG BÌNH/YẾU + top 3 risks.

**Explaining forensic numbers (mandatory when leg 3 exists):** don't just list numbers — explain what each variable means and why it leads to the conclusion:
- M-Score per variable: DSRI (revenue quality — >1.03 suggests revenue window-dressing), GMI (gross margin deteriorating), AQI (asset quality), SGI (growth), SGAI (selling expenses), LVGI (leverage), TATA (accruals). M < −1.78 = few manipulation signs; M > −1.78 = suspicious.
- F-score per point lost/kept (ROA, CF>ROA, dROA, leverage, margin, turnover) — why each point was lost (which period, which line).
- The "clean/red" conclusion must cite every number as basis; never conclude bare.

## Examples

**Example 1:**
Input: BCTC FPT có gì lạ
Output (Wave 1 enough, 2 calls): M-Score/F-score + 4 quarters of Revenue/Profit + 7-item verdict, don't open Waves 3–4.

**Example 2 (live 02-10-2026, don't fabricate new numbers):**
Input: cơ bản FPT
Output: FPT detail 25 norms × 138 numbers · M **−2.06**, F 2/6 · KH DT 61,850/75,400/58,580 · VCB holders SBV 74.8% · VCB dividend 450đ · insider empty is correct data.
