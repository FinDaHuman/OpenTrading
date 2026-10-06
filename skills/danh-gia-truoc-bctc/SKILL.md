---
name: danh-gia-truoc-bctc
description: Grade A/B/C for 1 ticker's setup on the eve of an earnings report from 6 legs (announcement date, trend, manipulation, expectations, positioning, valuation cushion). Always use this skill when the earnings report is not out yet and the user asks whether to buy/hold through it — e.g. "FPT sắp ra báo cáo có nên mua", "setup HPG trước BCTC ra sao" — even when the user doesn't explicitly say they want a "đánh giá setup".
activation: auto
requires_tools: [mcp__opentrading__company_events]
tool_budget: 10
triggers:
  keywords: [trước bctc, sắp ra báo cáo, pre earnings, công bố lợi nhuận, setup bctc]
version: 1.2.0
---

# Grading Pre-Earnings Setup

Grade the pre-earnings setup. No income-statement forecasting — never give forecast revenue/profit numbers. If the earnings report is already out, stop immediately and switch to `co-ban-chuyen-sau`; don't force a grade. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the earnings report is not out yet and the user asks about the pre-earnings setup (`FPT sắp ra báo cáo`, `đánh giá setup HPG trước BCTC`, `pre-earnings`).
- When NOT to use (use another skill instead):
  - Regular ticker analysis (not earnings-linked) → `phan-tich-chuyen-sau-1-ma`.
  - Report already published, need to read numbers/M-Score → `co-ban-chuyen-sau`.
  - One-off technical questions → `ky-thuat-chuyen-sau`.
  - One-off valuation questions → `dinh-gia-chuyen-sau`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: check the announcement date (usually not public — cross-check only, don't lock)
- [ ] Step 2: reuse trend + manipulation from co-ban-chuyen-sau
- [ ] Step 3: expectations + positioning (call directly)
- [ ] Step 4: reuse valuation cushion + grade A/B/C
```

**Step 1: Check the announcement date (cross-check only, do NOT lock a date).**

Earnings announcement dates in VN are usually NOT publicly exact (companies only flag month/quarter; `event_calendar_vn` has no earnings-date type). Run `company_events` + `news_symbol` only to cross-check announcement-schedule news if the user asks; if no clear date is found → treat the date as `unknown`, legs record accordingly and grade is capped at B (this is the default; no need to force a date).

**Step 2: Reuse trend + manipulation (don't call the source tools).**

LOAD `co-ban-chuyen-sau` (call `load_skill` with the skill name ONLY — there is no side file `aspect=...`; aspects are sections inside the body; loading a foreign file will fail). After loading: use the "Growth quality" (trend) + "M-Score + F-score" (manipulation) legs from that skill's body. Reason to reuse instead of calling `financial_detail`/`stock_forensic` directly: avoid stacking calls to the same source of numbers within 1 run. Mark the reuse on each leg.

**Step 3: Expectations + positioning (call directly).**

Run `planned_targets` + `analyst_consensus` + `news_symbol` + `sentiment_score` (anchor = the company plan because VN has no consensus EPS; sentiment is a heuristic and doesn't count as a green leg) and `insider_trading` + `money_flow` + `block_trades`. `planned_targets` returns REAL numbers from Vietstock CTKH (chain verified live) but is session-gated: Render/no session → `unavailable` — record honestly "missing plan anchor"; never fabricate plan numbers.

**Step 4: Reuse valuation cushion + grade.**

LOAD `dinh-gia-chuyen-sau` + run `scenario_simulate` (−5%) to get a suggested size. `scenario_simulate` is an exact LINEAR CALCULATION on the latest close price (shock × price, P/L per 1000 shares) — use it to cushion position size, it is NOT a price forecast. Don't call `valuation_run` directly here. Once 6 legs have evidence (partials included), stop — no second news/money-flow round, no 7th leg.

## Template

ALWAYS use this exact verdict structure:

1. Grade **A/B/C** (rubric: A = ≥5 green legs + clean M-Score + clear plan; B = 4–5 legs; C = <4 legs or red M-Score > −1.78).
2. 1 evidence line/leg (6 lines, each with numbers + trend + provenance).
3. Suggested size (from `scenario_simulate` −5%).
4. Explicit unknowns (list what is still unknown).
5. 1-sentence conclusion: grade + whether to hold/buy before earnings + biggest risk.

Partial data (missing positioning or expectations) → partial verdict + unknowns. Mildly negative/positive `sentiment_score` → record it as a heuristic; don't promote it to a green/red leg.

## Examples

**Example 1 (live 02-10-2026, FPT, don't fabricate new numbers):**
Input: Đánh giá trước BCTC HPG
Output: M **−2.06** clean · F 2/6 · KH DT 61,850/75,400/**58,580** · bonus shares 10:1 ex 21-09 · sentiment heuristic −0.25 · foreign net selling · pt 0% session → grade B + 6 leg evidence + unknowns, ≤10 calls (reused legs).
