---
name: danh-gia-vi-mo-quoc-te
description: Read the US economic cycle and the global risk regime (soft/hard landing, yield curve, RISK-ON/OFF, VN-vs-global comparison). Always use this skill when the user asks about the US/global macro backdrop, employment, countries' GDP, risk regime — e.g. "kinh tế Mỹ soft landing không", "yield curve đảo chưa" — even when the user doesn't explicitly say they want a "đánh giá vĩ mô".
activation: auto
requires_tools: [mcp__opentrading__fred_series]
tool_budget: 10
triggers:
  keywords: [kinh tế mỹ, recession, suy thoái, đường cong lợi suất, yield curve, risk-on, risk-off, fed bối cảnh, kinh tế toàn cầu]
version: 1.2.0
---

# Reading US and Global Macro Regime

Go through 3 waves sequentially (each wave parallel inside): US cycle → risk regime → global confirmation. Call FRED by canonical names; if the key is missing, switch to the non-FRED branch instead of dropping the whole verdict. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks about the US cycle (soft/hard landing), the yield curve, countries' employment/GDP, the global risk regime, VN-vs-global comparison.
- When NOT to use (use another skill instead):
  - Vietnam macro in detail (GDP/CPI/XNK/SBV) → use `danh-gia-vi-mo-viet-nam`.
  - Pure Fed cut/hold/hike odds + FOMC calendar → use `du-doan-fed`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: US cycle (FRED + curve, parallel)
- [ ] Step 2: risk regime (parallel)
- [ ] Step 3: global confirmation (parallel)
- [ ] Step 4: 5-item verdict
```

**Step 1: US cycle (parallel).**

Run `fred_series` (DGS10) + `fred_series` (CPIAUCSL) + `yf_yield_curve`. NEVER use web_search/web_fetch before calling the specialized tools — web only supplements after FRED numbers exist. FRED missing key → returns unavailable → switch to the non-FRED branch (use `yf_yield_curve` + `yf_global_indices`) + note honestly which series are missing. If the curve is flaky, retry at most 1 time after backoff then drop it.

**Step 2: Risk regime (parallel, sequential after Step 1).**

Run `yf_regime_assets` + `assets_rotation` + `world_macro_country` (VN/CHINA per the question). The `yf_*` group is capped at 3 calls/wave; don't stack `yf_yield_curve` + `fred_series` for more than 1 round. If `world_macro_country` comes back empty, swap the country code once then accept "thin coverage".

**Step 3: Global confirmation (parallel, sequential after Step 2).**

Run `yf_global_indices` + `yf_commodities` + `world_fear_greed`. Only proceed past Step 1 if DGS10 + CPI + curve are in; calling ≥3 FRED series at once is a sprawl signal → stop.

## Template

ALWAYS use this exact verdict structure:

1. **US cycle:** soft/hard landing, based on DGS10 + CPI + curve, unit % yield + % CPI + URL.
2. **Curve:** inverted or not, 10Y-2Y spread (unit bps/%) + URL.
3. **Global regime:** RISK-ON/OFF from rotation/regime assets + URL.
4. **VN-vs-global:** mandatory 1-line comparison of VN GDP (unit % WorldBank) vs global + URL.
5. **Variables to watch:** list US CPI, jobs, yields to watch next.

## Examples

**Example 1 (live 02-10-2026, don't fabricate new numbers):**
Input: Kinh tế Mỹ hiện tại
Output: US10Y 5.24% / 2Y 4.61%, not inverted · WorldBank GDP VN 8.02% · fear/greed crypto 70-74 (greedy) → verdict covers all 5 items, curve + ≥2 FRED series have numbers.
