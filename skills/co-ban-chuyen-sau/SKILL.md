---
name: co-ban-chuyen-sau
description: "Reads one ticker's financial statements: earnings quality, M-Score, F-score, major shareholders, insiders, dividends. Use when asked whether the statements look odd or manipulated, or about dividends."
match_text: "Đọc BCTC một mã: chất lượng lợi nhuận, M-Score, F-score, cổ đông lớn, insider, cổ tức. Dùng khi hỏi BCTC có gì lạ, có thao túng không, cổ tức."
activation: auto
requires_tools: [mcp__opentrading__financial_detail]
triggers:
  keywords: [bctc, báo cáo tài chính, phân tích cơ bản, lợi nhuận gộp, nợ phải trả, vốn chủ, m-score, thao túng, cổ đông lớn, cổ tức, kế hoạch kinh doanh]
version: 1.6.0
---

# Phân tích cơ bản một mã

PURE fundamental analysis of 1 ticker, by aspect: run only the leg for the aspect asked, then stop — do not sweep all the statements "to be safe".

## Khi nào dùng

- Use when: the user asks about one ticker's financial statements, earnings quality, M-Score/manipulation, F-score, business plan, major shareholders, insiders, dividends.
- Do NOT use (use another skill instead):
  - Technicals (RSI, MACD, breakout, support/resistance) → `ky-thuat-chuyen-sau`.
  - Valuation (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - Comparing 2–6 tickers → `so-sanh-cung-nganh`.
  - A full analysis of 1 ticker → `phan-tich-chuyen-sau-1-ma`.
  - Reading brokerage reports (not the original statements) → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 0: Check the JWT (required, the first direct call).**

Run `vs_auth_status`. With a live JWT you may use `financial_detail`; with a dead JWT switch to the mirror branch `vs_financeinfo` — these two tools never run in parallel since they share one data source.

**Bước 1: Core statements + quality.**

After `vs_auth_status`, run 2 data calls in parallel: `financial_detail` (statement=KQKD, periods_n=4) + `stock_forensic` (symbol). That is 3 calls in total with a live JWT. With a dead JWT, use `vs_financeinfo` instead of `financial_detail` as in Bước 0. If the user asks only about quality (`chataluong`), stop right here.

**Bước 2: Expand by aspect (each aspect is 1 leg; run only the leg asked).**

- Trend/ratios: `financial_statements` · `financial_ratios` · `vn_fundamentals` (at most 3 calls).
- Ownership/plan (`sohuu`/`cophieu`/`kehoach`): `planned_targets` · `holders` · `insider_trading` · `dividends_splits` (+ Bước 1 if a base is needed).
- Reference: `vs_financial_norms` / `vs_financial_terms` / `vs_company_info` — only to explain a norm_id/period.
- Never call `vs_documents` here (that is `tim-co-hoi-bao-cao-ctck`'s tool). Call LCTT/CDKT (cash flow/balance sheet) only when the user explicitly asks about cash flow/the balance sheet, via the `statement` param.

**Bước 3: Validate before the verdict.**

An empty leg → a partial verdict + state the missing source; never invent numbers to fill gaps. In `stock_forensic`, check the top-level `schema_version`; check separately `beneish.version`, `beneish.status`, `beneish.missing_inputs`, `piotroski.version`, `piotroski.status`, `piotroski.missing_inputs`, the fiscal-year period and the statement scope. Quarterly reports in the growth leg cannot replace forensics' yearly inputs. Read a model's score only when `status=complete` and `score` has a value; for `partial`, `not_applicable`, `unsupported` or `score=null`, present the coverage and missing data, never 0. For banks/brokerages/insurers, Beneish is `not_applicable` and Piotroski `unsupported`; never apply the ordinary-company formulas. A ticker like FPT can also move from complete to partial when the source of one statement line is not proven to mean the right thing. `financial_detail` periods beyond the plan → empty rows + a warning → degrade to `vs_financeinfo` exactly once and state the fallback. `vn_company` is slow (~30s) when throttled, so put it last; if missing, say so.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, each item with figures + trend + provenance:

1. Growth quality: revenue/profit for 4 quarters + QoQ/YoY trend + margins (`provenance: financial_detail`).
2. Key ratios (`provenance: financial_ratios` / `vn_fundamentals`).
3. Yearly M-Score + F-score when complete; if incomplete, give the `status`, coverage and missing sources (`provenance: stock_forensic`).
4. Against the plan: beat/miss in % (`provenance: planned_targets`).
5. Ownership structure + insider changes (`provenance: holders` / `insider_trading`).
6. Dividend policy (`provenance: dividends_splits`).
7. A 1-sentence conclusion: the fundamental assessment from the legs with evidence + the 3 biggest risks; mark it provisional when forensics are missing.

**Explaining forensic numbers (required when leg 3 is present):** do not just list numbers. The standard Beneish here is the **versioned 8-variable yearly** model: DSRI (receivables/revenue), GMI (gross margin), AQI (assets other than current assets and net PPE), SGI (revenue growth), DEPI (depreciation rate), SGAI (selling and admin expenses/revenue), LVGI (long-term debt plus current liabilities/total assets), TATA (accounting profit minus CFO, over year-end total assets). Compare with the research threshold −1.78 only when all 8 variables are present, for the right period/scope/source, with `status=complete`; this threshold is not calibrated for Vietnam, and a score on either side proves neither fraud nor its absence. Never infer DEPI from unverified lines; never fill gaps with 0 or neutral variables. Component flags from the tool are signals for review, not evidence of manipulation; never set your own DSRI/SGI cutoffs.

The standard Piotroski has **9 signals**: positive ROA, positive CFO, rising ROA, CFO above profit on the same asset base, falling leverage, a rising current ratio, no new share issuance, a rising gross margin, rising asset turnover. Report an `x/9` score only when all 9 signals are valid; otherwise give `score=null`, `passed/evaluated`, `missing_inputs`, the period and source lines; in particular never guess current_portion_long_term_debt or equity_issued. Never turn a missing signal into a failed one. The conclusion must cite figures, period, scope and model status, and never call statements "sạch" just because the score is low or data is missing.

## Ví dụ

**Ví dụ 1:**
Hỏi: BCTC FPT có gì lạ
Trả lời (Wave 1 is enough: 1 `vs_auth_status` call, then 2 data calls): yearly M-Score and F-score status/coverage + 4 quarters of revenue/profit + a 7-item verdict; give scores only when the tool returns a complete model; do not open Waves 3–4.

**Ví dụ 2:**
Hỏi: cơ bản FPT
Đạt khi: the M-Score/F-score status was checked (scores may be null), 4 quarters of revenue/profit, major shareholders and dividends from tools; any item the tool returned empty (e.g. insiders) is stated as empty data.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: stacked P&L components, waterfall P&L, pie ownership, bar KH/dividends.
