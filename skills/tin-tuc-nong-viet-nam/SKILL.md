---
name: tin-tuc-nong-viet-nam
description: Digest today's hot VN news (5-7 headlines + classification + sentiment + provenance). Always use this skill when the user asks broadly about VN stock/market/business news today — e.g. "tin nóng hôm nay", "có tin gì về VN30" — even when the user doesn't explicitly say they want a "digest tin nóng".
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 9
triggers:
  keywords: [tin nóng, tin chứng khoán, tin hôm nay, tin vn, tin doanh nghiệp, headline]
version: 1.2.0
---

# Digesting Daily Vietnam News

Fast digest of today's VN news — headlines + classification + sentiment, with clear provenance. Never turn heuristic sentiment into buy/sell recommendations.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: today's hot VN news, VN30, VN market/business, a quick 5–7 headline digest is needed.
- When NOT to use (use another skill instead): specific ticker/keyword or rumor → `tim-kiem-tin-tuc`; US/China/global news → `tin-tuc-nong-quoc-te`; deep crowd/FOMO dive on 1 ticker → `phan-tich-sentiment`; broker rating/target → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy the checklist and tick as you progress:

```
Task Progress:
- [ ] Step 1: general news + announcement calendar (parallel)
- [ ] Step 2: dig into the 2-3 most frequent tickers
- [ ] Step 3: sentiment + cross-check the hottest ticker
- [ ] Step 4: 5-7 headline verdict
```

**Step 1: General news + announcement calendar (parallel).**

Run `news_market` (limit=15) + `corporate_calendar` (limit=20).

**Step 2: Dig into standout tickers (sequential, after Step 1).**

Run `news_symbol` × 2–3 tickers appearing most in the news — pick by appearance frequency, not gut feeling, max 3 tickers.

**Step 3: Sentiment + cross-check (parallel).**

Run `sentiment_score` (hottest ticker) + `company_events` (that ticker, cross-check only, do not dig the full history). Missing Groq → use heuristic + warning, the verdict must carry the `heuristic` label.

**Step 4: Validate before finalizing.**

Fireant dead → the tool falls back to GDELT itself, no infinite Fireant retries. Both dead → read `snapshot_history` (kind=news_feed) 1-day cache, must state clearly that it is a cache + the cache date. Empty feed on weekends/holidays → empty is valid, state "phiên nghỉ, ít tin mới". Stop once 5 headlines have provenance; stop once the Step 3 verdict exists for the hottest ticker. Do not re-call `sentiment_score` with a larger limit.

## Template

ALWAYS use this exact verdict structure, each headline with: **tiêu đề + mã liên quan + phân loại** (catalyst / đồn đoán / tin vĩ mô) + **sentiment** if there is enough data + **provenance** (Fireant/GDELT) + **tuổi tin**. Rumors must carry the `CHƯA XÁC NHẬN` label.

## Examples

**Example 1 (live 02-10-2026, do not fabricate new numbers):**
Input: Tin nóng hôm nay
Output: Fireant posts 02-10 (fuel stabilization fund back to KBNN; HN land market shifts sentiment; tax-id cleanup campaign) · `news_symbol("VCB")` → interest-rate 0.1-6% posts → ≥5 headlines with provenance, ≤9 calls. Missing provenance or classification → not done; sentiment without a source label → not done.
