---
name: danh-gia-vi-mo-viet-nam
description: Read Vietnam macro (GDP, CPI, trade, USDVND rate, SBV rates, market-driving narrative + event calendar). Always use this skill when the user asks for VN macro numbers, context or release calendar — e.g. "GDP quý này bao nhiêu", "lãi suất SBV bao nhiêu" — even when the user doesn't explicitly say they want a "đánh giá vĩ mô".
activation: auto
requires_tools: [mcp__opentrading__vs_indicator_data]
tool_budget: 12
triggers:
  keywords: [vĩ mô, GDP, CPI, lạm phát, xuất khẩu, nhập khẩu, lãi suất điều hành, sbv, xnk, cán cân, câu chuyện thị trường, dẫn dắt]
version: 1.3.0
---

# Reading Vietnam Macro

Always open with the mandatory 2-call pre-flight (source_status + vs_auth_status) because VN macro depends on JWT and HAR-sessions that die easily. The category/termType pairs must be exactly right (wrong = empty rows): GDP 73/tt3, CPI 15/tt7/sub2, XK 38/tt2. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks for VN numbers (GDP/CPI/XK/NK), SBV rates, USDVND rate in macro context, the NSO release calendar, broker macro reports, the VN market-driving narrative.
- When NOT to use (use another skill instead):
  - US/global macro, Fed context, risk regime → use `danh-gia-vi-mo-quoc-te`.
  - Pure Fed cut/hold odds → use `du-doan-fed`.
  - Detailed gold-FX play → use `phan-tich-vang-ty-gia`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 0: source pre-flight (parallel)
- [ ] Step 1: mandatory VN data (categories first, indicators parallel)
- [ ] Step 2: macro news (parallel)
- [ ] Step 3: broker reports (1 shared-feed call)
- [ ] Step 4: supplementary data + event calendar
- [ ] Step 5: 6-item verdict + narrative
```

**Step 0: Pre-flight (parallel, mandatory).**

Run `source_status` + `vs_auth_status` before every wave.

**Step 1: Mandatory VN data.**

Run `vs_categories` first (look up ids if unsure), then in parallel `vs_indicator_data` GDP + CPI + XK and `vs_xnk_detail` (only 1 direction, xk or nk, per the question). Empty rows → recheck the id pair, retry at most 1 time → if still empty, record "no data for this period".

**Step 2: Macro news (parallel).**

Run `news_market` (filter macro/rates/FX) + `macro_events_vn` + `economic_calendar`.

**Step 3: Broker reports (1 call only).**

Run `analyst_consensus` (report_type=macro, limit=30) as one shared feed; take section pointers + dated reports. Don't fire per keyword.

**Step 4: Supplementary data + calendar (parallel, at most 1 call each).**

Run `snapshot_history` (macro_curated) + `yf_yield_curve` + `sbv_rates` + `vn_retail_fx` + `macro_events_vn` (NSO) + the Fed/US meeting (cross-ref `du-doan-fed`). Missing HAR session → macro returns a permission message: record honestly "macro needs session", fall back to `snapshot_history`; never interpret the permission message as data. Curve/DXY flaky → retry 1 time after backoff then drop.

## Template

ALWAYS use this exact verdict structure:

1. **Growth:** GDP, ≥8 latest points, unit % yoy + URL/provenance.
2. **Inflation:** CPI, ≥8 latest points, unit % yoy + URL.
3. **Trade:** XK/NK/XNK-detail, unit million USD + URL.
4. **Exchange rate:** USDVND (unit VND), SBV rates (refinancing/re-discount, unit %) + URL.
5. **Rates:** SBV policy rate + foreign-capital-flow context (curve/DXY) + URL.
6. **Points Tích cực / Tiêu cực + future outlook.**
7. **Market-driving narrative + event calendar** (per narrative: which event, what date, what impact).

## Examples

**Example 1 (live 02-10-2026, don't fabricate new numbers):**
Input: Vĩ mô VN
Output: GDP 504 rows up to Q2/2026 · CPI 1,839 · XK 2,941 · XNK-country 3,675 · SBV refinancing 4.5% / re-discount 3% · USDVND 25,970 · NSO CPI calendar for August → verdict covers all 6 items + market-driving narrative with event calendar, ≤12 calls.
