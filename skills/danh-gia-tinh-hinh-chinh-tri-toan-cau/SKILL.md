---
name: danh-gia-tinh-hinh-chinh-tri-toan-cau
description: Map global political risk (elections, policy, international tensions) in 4-6 items, each with odds probability + confirming GDELT news + URL. Always use this skill when the user asks about political/election/policy risk at multi-country scale — even when the user doesn't explicitly say they want a "bản đồ rủi ro".
activation: auto
tool_budget: 8
triggers:
  keywords: [địa chính trị, bầu cử, chính trị, chính sách mỹ, căng thẳng quốc tế, rủi ro chính trị]
version: 1.2.0
---

# Mapping Global Political Risk

This skill organizes cross-referencing (no single home tool — it combines odds + news from multiple sources). Every verdict item must have an event URL + news URL; if either is missing, say so clearly. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks for a global political risk map, elections, policy, international tensions (multiple events, need odds + news combined).
- When NOT to use (use another skill instead):
  - A specific armed conflict → use `danh-gia-tinh-hinh-xung-dot`.
  - Single-country unrest → use `bat-on-quoc-gia`.
  - Just want pure Polymarket odds/board → use `du-doan-polymarket`.
  - Pure Fed cut/hold → use `du-doan-fed`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: odds + intel in parallel
- [ ] Step 2: drill down into relevant events (at most 2 slugs)
- [ ] Step 3: verify with news (1-2 official sources)
- [ ] Step 4: 4-6 item verdict + provenance
```

**Step 1: Odds + intel (parallel, mandatory).**

Run `world_prediction_odds` (tag=fed/politics/elections per the question) + `geo_intel` (topic). Odds come sorted by vol24h so take only the top 5 — pulling all 20 events is sprawl.

**Step 2: Drill-down (parallel, sequential after Step 1).**

Run `polymarket_event` (top 1-2 slugs) + `event_stats` (query). Only drill events actually relevant to the question, at most 2 slugs/run. Do not stack `geo_intel` + `event_stats` + `news_market` with the same query for more than 1 round.

**Step 3: Verify with news (sequential after Step 2).**

Run `news_market` (sources=gdelt) + `web_fetch` 1-2 official source URLs from the news. Stop once 4 items have prob + confirming news.

**Step 4: Validate before locking.**

GDELT rate-limit → backoff 20s, retry at most 1 time → if it still fails, record honestly "missing GDELT news, verdict based on odds only". If Gamma is slow the tool falls back to direct automatically; wait once. Stale odds (end-date passed) → filter `end > today`, drop expired events. If both paths are dead, record "no odds available"; never fabricate probabilities.

## Template

ALWAYS use this exact verdict structure:

1. **Event:** name + 1-line context.
2. **Probability:** prob_pct per outcome (unit %) + end-date.
3. **Odds reliability:** 24h volume + liquidity (unit USD; <50k flags "odds unreliable").
4. **Confirming GDELT news:** 1 line + URL.
5. **Market-impact if any:** transmission channel + URL.
6. **Provenance:** each item requires event URL + news URL.

## Examples

**Example 1 (live 02-10-2026, don't fabricate new numbers):**
Input: Rủi ro chính trị toàn cầu
Output: Fed October 2026 "no change" 74.5% (24h volume ~2.6M USD) · Brazil presidential event OK · every item has prob_pct + provenance event URL.
