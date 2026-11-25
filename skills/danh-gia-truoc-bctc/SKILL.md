---
name: danh-gia-truoc-bctc
description: "Grades a ticker A/B/C before its earnings release (trend, manipulation, expectations, valuation cushion). Use when asked whether to hold through the report."
match_text: "Chấm hạng A/B/C cho một mã trước khi ra BCTC (xu hướng, thao túng, kỳ vọng, đệm định giá). Dùng khi hỏi có nên mua/giữ qua kỳ báo cáo."
activation: auto
requires_tools: [mcp__opentrading__company_events]
triggers:
  keywords: [trước bctc, sắp ra báo cáo, pre earnings, công bố lợi nhuận, setup bctc]
version: 1.4.0
---

# Chấm setup trước BCTC

Grade the setup ahead of an earnings release. Do not forecast results — never give forecast revenue/profit figures. If the statements are already out, stop at once and switch to `co-ban-chuyen-sau`; do not force a grade.

## Khi nào dùng

- Use when: the statements are not out yet and the user asks about the pre-earnings setup (`FPT sắp ra báo cáo`, `đánh giá setup HPG trước BCTC`, `pre-earnings`).
- Do NOT use (use another skill instead):
  - Ordinary ticker analysis (not tied to earnings) → `phan-tich-chuyen-sau-1-ma`.
  - Statements already published, figures/M-Score needed → `co-ban-chuyen-sau`.
  - A technicals-only question → `ky-thuat-chuyen-sau`.
  - A valuation-only question → `dinh-gia-chuyen-sau`.

## Các bước

**Bước 1: Check the release date (cross-check only, NOT a fixed date).**

Vietnamese earnings dates are usually NOT published precisely (companies announce only the month/quarter; `event_calendar_vn` has no earnings-date type). Run `company_events` + `news_symbol` only to cross-check calendar news if the user asks; with no clear date → treat it as `unknown ngày`, record the legs accordingly and cap the grade at B (this is the default; do not strain to pin a date).

**Bước 2: Reuse trend + manipulation (no source tools).**

LOAD `co-ban-chuyen-sau` (call `load_skill` WITH THE SKILL NAME ONLY — there is no `aspect=...` extra file; aspects are sections in the body; loading an unknown file fails). After loading: use the "Chất lượng tăng trưởng" leg (trend) + the "M-Score + F-score" leg (manipulation) from that skill's body. Why reuse instead of calling `financial_detail`/`stock_forensic` directly: to avoid overlapping calls on the same data in one run. State the reuse in each leg.

**Bước 3: Expectations + positioning (direct calls).**

Run `planned_targets` + `analyst_consensus` + `news_symbol` + `sentiment_score` (the anchor is the company's plan, since Vietnam has no EPS consensus; sentiment is a heuristic and never counts as a green leg) and `insider_trading` + `money_flow` + `block_trades`. `planned_targets` returns REAL figures from Vietstock CTKH (chain verified live) but is session-gated: on Render/without a session → `unavailable` — say honestly "thiếu neo kế hoạch"; never invent plan figures.

**Bước 4: Reuse the valuation cushion + grade.**

LOAD `dinh-gia-chuyen-sau` + run `scenario_simulate` (−5%) for a suggested size. `scenario_simulate` is an exact LINEAR CALCULATION on the latest close (shock × price, P/L per 1000 shares) — for cushioning position size, NOT a price forecast. Do not call `valuation_run` directly here. Once all 6 legs have evidence (even partial), stop — no second round of news/flows, no 7th leg.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. Grade **A/B/C**, labelled provisional when data is missing (rubric: A = ≥5 green legs with evidence, a clear plan and every applicable forensic model `complete` with no review flag; B = 4–5 legs or not certain enough for A; C = <4 legs pass once all 6 legs were assessed). Interpret the M-Score only when the 8-variable yearly Beneish is for the right period/scope and `status=complete`; the research threshold −1.78 is a flag for review, not calibrated for Vietnam, and on its own never concludes fraud or decides a C grade. `partial`/`score=null`, `not_applicable`, `unsupported` count as neither green nor red legs; give the F-score's `passed/evaluated` instead of scoring the missing part as 0/9. For banks/brokerages/insurers, do not grade with the ordinary-company Beneish/Piotroski.
2. 1 line of evidence per leg (6 lines, each with figure + trend + provenance).
3. Suggested size (from `scenario_simulate` −5%).
4. Explicit unknowns (list what is not known).
5. 1-sentence conclusion: the grade + the setup's main strength + the biggest risk going into the release. Asked whether to buy or hold through it → the call, with what would make it wrong; too few legs with data → say they do not support a call.

Partial data (missing positioning, expectations or forensics) → a provisional verdict + unknowns. A mildly negative/positive `sentiment_score` is reported as the heuristic it is, never promoted to a green/red leg.

## Ví dụ

**Ví dụ 1:**
Hỏi: Đánh giá trước BCTC HPG
Đạt khi: grade B + 6 legs of evidence + unknowns, ≤10 calls (legs reused).

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: line trend, gauge sentiment, waterfall NN flow.
