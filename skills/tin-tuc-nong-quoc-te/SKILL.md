---
name: tin-tuc-nong-quoc-te
description: Digest world news that moves markets (5 headlines + market reaction verified with numbers). Always use this skill when the user asks about international/US/China news today — even when the user doesn't explicitly say they want a 'digest tin nóng'.
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 8
triggers:
  keywords: [tin quốc tế, tin thế giới, thị trường mỹ, fed tin, wall street, nasdaq]
version: 1.2.0
---

# Digesting Global Hot News With Market Reaction

World news + market reaction verified with NUMBERS — no bare headlines. News without a reaction yet must state "thị trường chưa phản ánh"; never fabricate a reaction. International rumors must carry the `CHƯA XÁC NHẬN` label.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: international/US/China news, Fed, Wall Street, need headlines + market figures confirming the reaction.
- When NOT to use (use another skill instead): VN news → `tin-tuc-nong-viet-nam`; specific keywords/rumors → `tim-kiem-tin-tuc` mode C; deep macro (curve, flows, separate fear/greed) → `danh-gia-vi-mo-quoc-te`; crypto → `nhip-dap-crypto`.

## Workflow

Copy the checklist and tick as you progress:

```
Task Progress:
- [ ] Step 1: global news (parallel)
- [ ] Step 2: reaction with numbers (parallel, after Step 1)
- [ ] Step 3: verify the 1 standout item
- [ ] Step 4: 5-headline verdict + reaction
```

**Step 1: Global news (parallel).**

Run `news_market` (sources=gdelt) + `geo_intel` (no topic = global coverage). Do not add a narrow topic yourself when the user asks broadly. GDELT empty → try English keywords once, then conclude "ít coverage".

**Step 2: Reaction with numbers (parallel, sequential after Step 1 to pick the right items).**

Run `yf_mega_flows` + `world_fear_greed`.

**Step 3: Verify the 1 standout item (sequential).**

Run `event_stats` for exactly the 1 standout keyword, not every headline. Both news sources dead → read `snapshot_history` (kind=news_feed), must state "cache <ngày>" clearly. Empty feed on a weekend → empty is valid, state the market holiday.

## Template

ALWAYS use this exact verdict structure: 5 headlines, each item with **tiêu đề + tuổi tin + provenance** (GDELT/`geo_intel`) + **market reaction with NUMBERS** (mega-cap flows, fear/greed, curve if rates involved).

## Examples

**Example 1 (live 02-10-2026, do not fabricate new numbers):**
Input: Tin thế giới
Output: mega_flows AAPL/MSFT/NVDA OK · fear/greed 70-74 Greed 7 days → ≥5 headlines + ≥2 quantified reaction items, ≤8 calls. Missing reaction numbers without stating "thị trường chưa phản ánh" → not done.
