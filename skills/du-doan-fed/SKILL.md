---
name: du-doan-fed
description: "Reads the probabilities and scenarios for the next Fed rate decision, the yield curve, the FOMC calendar and what it means for Vietnam. Use for Fed, FOMC, dot plot questions."
match_text: "Đọc xác suất và kịch bản lãi suất Fed kỳ tới, đường cong lợi suất, lịch FOMC và hàm ý cho VN. Dùng khi hỏi Fed, FOMC, dot plot."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
triggers:
  keywords: [fed, fomc, cắt giảm lãi suất, dot plot, xác suất fed, lãi suất mỹ]
version: 1.3.0
---

# Dự đoán quyết định của Fed

Return exactly 5 items: probability of each scenario → the curve → the FOMC calendar → variables to watch → implications for Vietnam. Drill into only 1 main Fed event (the newest slug, already sorted by vol24h) — never fire 5 query variants.

## Khi nào dùng

- Use when: the user asks about the next Fed decision (cut/hold/hike), FOMC, the dot plot, odds + the curve + implications for Vietnam.
- Do NOT use (use another skill instead):
  - The general US macro backdrop (cycle, jobs, risk regime) without odds → use `danh-gia-vi-mo-quoc-te`.
  - Odds on topics other than the Fed (elections, BTC...) → use `du-doan-polymarket`.
  - A broad political risk map → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Các bước

**Bước 1: Fed odds (required).**

Run `world_prediction_odds` (query=fed). Probabilities for ≥2 scenarios + the meeting date are enough for a verdict; Bước 3 afterwards only verifies.

**Bước 2: Drill-down + macro (in parallel, after Bước 1).**

Run `polymarket_event` (slug fed-decision-*) + `fred_series` (DGS10, add EFFR/DFII if needed). Never drill more than 1 Fed slug per run.

**Bước 3: Curve + verification (in parallel, after Bước 2).**

Run `yf_yield_curve` + `web_fetch` (only the statement/official fed.gov source linked in the odds).

**Bước 4: Validate before concluding.**

Stale odds (end-date passed) → filter `end > today`, drop expired events, retry once with a new fed query. Gamma down on both proxy + direct → state "không có odds"; never replace it with your own view. Flaky curve → retry at most once after a backoff, then drop it and note the missing curve. Stop at 3 `fred_series` beyond the Fed.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **Probability of each scenario:** cut/hold/hike, each with prob_pct (%) + volume (USD) + end-date + event URL.
2. **What the curve implies:** US10Y/2Y (%) + inverted or not + URL.
3. **Next FOMC meeting:** meeting date (day/month) + fed.gov source URL.
4. **Variables to watch:** US CPI, jobs, in %/K jobs + URL.
5. **Implications for Vietnam:** exchange rate/interest rates, 1–2 lines + URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Fed tháng tới
Đạt khi: probabilities for ≥2 scenarios + the meeting date + 1 line on implications for Vietnam.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar odds per scenario, multiline 10Y/2Y, line yield curve.
