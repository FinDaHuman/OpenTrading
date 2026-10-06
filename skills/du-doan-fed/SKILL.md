---
name: du-doan-fed
description: Read next-meeting Fed rate probabilities and scenarios (cut/hold/hike) with the yield curve, FOMC calendar and implications for VN. Always use this skill when the user asks about Fed, FOMC, dot plot or US rate odds — e.g. "Fed tháng tới cắt hay giữ", "dot plot mới nhất" — even when the user doesn't explicitly say they want a "dự đoán Fed" (Fed forecast).
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 8
triggers:
  keywords: [fed, fomc, cắt giảm lãi suất, dot plot, xác suất fed, lãi suất mỹ]
version: 1.2.0
---

# Reading the Next Fed Decision

Return exactly 5 items: probability per scenario → curve → FOMC calendar → variables to watch → VN implications. Drill only the 1 main Fed event (latest slug, already sorted by vol24h) — never fire 5 query variants. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks about the next Fed decision (cut/hold/hike), FOMC, dot plot, or odds probabilities + curve + VN implications.
- When NOT to use (use another skill instead):
  - General US macro context (cycle, jobs, risk regime) without odds → use `danh-gia-vi-mo-quoc-te`.
  - Odds on non-Fed topics (elections, BTC...) → use `du-doan-polymarket`.
  - Broad political-risk map → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: Fed odds (1 call, take the top event)
- [ ] Step 2: drill-down + macro (parallel)
- [ ] Step 3: curve + verify official source
- [ ] Step 4: verdict, 5 items
```

**Step 1: Fed odds (mandatory).**

Run `world_prediction_odds` (query=fed). Probabilities for ≥2 scenarios + meeting dates are enough for a verdict; Step 3 afterwards is only for verification.

**Step 2: Drill-down + macro (parallel, after Step 1).**

Run `polymarket_event` (slug fed-decision-*) + `fred_series` (DGS10, add EFFR/DFII if needed). Never drill more than 1 Fed slug per run.

**Step 3: Curve + verification (parallel, after Step 2).**

Run `yf_yield_curve` + `web_fetch` (only the statement/official fed.gov source cited in the odds).

**Step 4: Validate before finalizing.**

Stale odds (end-date passed) → filter `end > today`, drop expired events, retry once with a fresh fed query. If Gamma is down on both proxy + direct, state clearly "không có odds" (no odds available) — never substitute your own opinion. Flaky curve → retry at most once after backoff, then drop with a note that the curve is missing. `fred_series`: at most 3 series beyond the Fed ones, then stop.

## Template

ALWAYS use this exact verdict structure:

1. **Probability per scenario:** cut/hold/hike, each with prob_pct (unit %) + volume (USD) + end-date + event URL.
2. **Implied curve:** US10Y/2Y (unit %) + whether inverted or not + URL.
3. **Next FOMC date:** meeting day (unit day/month) + fed.gov source URL.
4. **Variables to watch:** US CPI, jobs, unit %/K jobs + URL.
5. **Implications for VN:** FX/rates, 1–2 lines + URL.

## Examples

**Example 1 (live 02-10-2026, no fabricated numbers):**
Input: Fed tháng tới
Output: "Fed Decision in October 2026": Yes(no change) 74.5% / No 25.5%, volume24h 2.6M · curve US10Y 5.24% not inverted → probabilities for ≥2 scenarios + meeting dates + 1 line of VN implications.
