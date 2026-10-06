---
name: bat-on-quoc-gia
description: Assess the political stability or instability of ONE country (protests, coups, unrest) on a 4-level scale with evidence. Always use this skill when the user asks about a specific country's stability situation — e.g. "Thái Lan đang bất ổn gì", "Trung Quốc có ổn định không", "Bangladesh sau đảo chính ra sao" — even when the user doesn't explicitly say they want an "đánh giá".
activation: auto
requires_tools: [mcp__opentrading__geo_intel]
tool_budget: 6
triggers:
  keywords: [bất ổn, bất ổn quốc gia, biểu tình, đảo chính, ổn định]
version: 1.3.0
---

# Assessing Single-Country Stability

Assess 1 country on the ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG scale, each level backed by evidence with URL. If several countries are asked, loop this skill once per country instead of merging. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user names ONE country + asks about unrest/stability/protests/coup.
- When NOT to use (use another skill instead):
  - Multi-country comparison/map, global elections/policy → `danh-gia-tinh-hinh-chinh-tri-toan-cau`.
  - Armed conflict/combat + market impact → `danh-gia-tinh-hinh-xung-dot`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: measure intensity (GDELT counts + severity)
- [ ] Step 2: verify with news (only if Step 1 is thin)
- [ ] Step 3: 4-level verdict + provenance
```

**Step 1: Measure intensity (mandatory).**

Run 2 calls in parallel against the same upstream GDELT: `geo_intel` (topic = country name in English) + `event_stats` (query = country name in English). `geo_intel` pre-filters political news (drops sports/noise) and returns aggregates (count/by_day/top_sources); `event_stats` returns the base-rate aggregate — use geo_intel for articles, event_stats for count vs baseline. NEVER use web_search/web_fetch before GDELT counts exist — web is only used in Step 2 when Step 1 is thin. Query in English once + at most 1 variant; empty Vietnamese queries are a data characteristic, not an error. On GDELT rate-limit, retry at most 1 time after backoff (server caches 600s); if it still fails, record honestly and base the verdict on older data.

**Step 2: Verify with news (only if Step 1 is thin).**

Run `news_market` (sources=gdelt, filtered by country name) sequentially after Step 1. If Step 1 already has counts + titles, stop — do not run Step 2. Thin coverage is a RESULT ("low-coverage ≠ stable"); never infer ỔN ĐỊNH from it.

**Step 3: Lock the verdict.**

Only add `yf_commodities` or `assets_rotation` (1 call) when the user explicitly asks about "ảnh hưởng thị trường". At most 6 calls/run because every extra call burns quota and dilutes the verdict — stop as soon as evidence is sufficient.

## Template

ALWAYS use this exact verdict structure:

1. **4-level verdict (pick exactly 1):** ỔN ĐỊNH / CẢNH BÁO / BẤT ỔN / NGHIÊM TRỌNG.
2. **Basis (1 line per item + URL):** GDELT event frequency (this run is the baseline) · severity (protest/conflict/coup keywords in titles) · neighbor-country coverage · transmission to prices if a sub-step ran (oil/gold, unit USD/oz or % move).
3. **Provenance:** each item requires 1 line of evidence + source URL.

## Examples

**Example 1:**
Input: Bất ổn Thái Lan
Output:
```
Verdict: CẢNH BÁO
- GDELT event frequency up vs baseline ... + URL
- Severity: protest keyword appears ... + URL
- Neighbor coverage: ...
Provenance: (1 line of evidence + URL per item above)
```

**Example 2 (thin coverage):**
Input: Bất ổn Lào
Output: Verdict with the honest note "low-coverage ≠ stable"; never infer ỔN ĐỊNH.
