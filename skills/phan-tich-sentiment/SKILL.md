---
name: phan-tich-sentiment
description: Measure the crowd on 1 stock via Fireant (sentiment score + quotes + FOMO warning). Always use this skill when the user asks what the street/crowd says about a stock, sentiment or FOMO — e.g. "Phố nói gì về FPT", "crowd có FOMO HPG không" — even when the user doesn't say explicitly they want "đo sentiment".
activation: auto
requires_tools: [mcp__opentrading__sentiment_score]
tool_budget: 6
triggers:
  keywords: [sentiment, dư luận, phố nói gì, crowd, fomo, tâm lý nhà đầu tư, comment]
version: 1.2.0
---

# Measuring Single-Stock Crowd Sentiment

Measure the *crowd*, not the *business* — the crowd can be wrong, sentiment is never the only leg of a decision. One symbol/run; limit 20 covers 90% of cases, never widen the limit. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: asked about the crowd/sentiment/FOMO/comments on 1 specific stock on Fireant.
- When NOT to use (use a different skill instead): official news/rumors → `tim-kiem-tin-tuc`; general fear/greed → `danh-gia-vi-mo-quoc-te` / `nhip-dap-crypto`; broker ratings → `tim-co-hoi-bao-cao-ctck`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: top 20 posts + score + comments of the hottest post (parallel)
- [ ] Step 2: cross-check disclosures (only on contradiction)
- [ ] Step 3: verdict (score + quotes + comments + FOMO + warning)
```

**Step 1: Top 20 posts + score + comments (parallel).**

Run `sentiment_score` (symbol, limit=20) — score + posts from Fireant. Run `news_symbol`/Fireant posts (limit=20) to read titles/summaries of the top 20. Pick the hottest post (highest interactions/comments) → run `fireant_thread` (post_id) to get the actual comments (replies) — read the comments' mood, not just the score. Stop when you have the score + ≥3 quotes + ≥3 comments + source label.

**Step 2: Cross-check disclosures (only on contradiction, sequential).**

Run `company_events` (symbol) when comments contradict disclosures. Never use sentiment to "settle the case" — only confirm/deny.

**Step 3: Validate before finalizing.**

No Groq → `score_heuristic` + warning "groq unavailable" → mandatory `heuristic` label in the verdict (different scale, never cross-normalize the two Groq/heuristic modes). Empty posts = low-discussion stock (empty is valid), never fabricate quotes, state clearly "ít bàn luận". Fireant down → single fallback: GDELT titles via `tim-kiem-tin-tuc` (1 call), state the replacement source clearly. Never interpret the heuristic as "should buy/sell" advice.

## Template

ALWAYS use this exact verdict structure:

- **Sentiment score** (Groq or heuristic — mandatory source label).
- **3–5 representative comment quotes** (positive / negative / repeat-poster) + Fireant provenance.
- **FOMO/panic detection** (symbol tag frequency + likes); heuristic thresholds: <−0.3 panic · >+0.3 FOMO · in between = neutral.
- **Mandatory loop warning:** the crowd can be wrong — sentiment must never be the only leg of a decision.

## Examples

**Example 1 (live 02-10-2026, no new fabricated numbers):**
Input: Phố nói gì về FPT
Output: FPT — 20 posts, heuristic **−0.25**, while M −2.06 is clean (classic crowd≠fundamentals) · VCB posts on rates 0.1-6% → score + ≥3 quotes + source label, ≤4 calls. Missing the source label or the loop warning = not done.
