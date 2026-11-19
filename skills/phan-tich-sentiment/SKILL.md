---
name: phan-tich-sentiment
description: "Measures opinion about a ticker on Fireant: sentiment score, quotes, FOMO warnings. Use when asked what investors are saying about a ticker."
match_text: "Đo dư luận về một mã trên Fireant: điểm sentiment, trích dẫn, cảnh báo FOMO. Dùng khi hỏi nhà đầu tư đang nói gì về một mã."
activation: auto
requires_tools: [mcp__opentrading__sentiment_score]
triggers:
  keywords: [sentiment, dư luận, phố nói gì, crowd, fomo, tâm lý nhà đầu tư]
version: 1.3.0
---

# Đo tâm lý đám đông về một mã

Measure the *crowd*, not the *company* — the crowd can be wrong, and sentiment is never the only leg of a decision. Only 1 symbol per run; limit 20 covers 90% of samples, do not raise the limit.

## Khi nào dùng

- Use when: asked about opinion/crowd/FOMO/comments on 1 specific ticker on Fireant.
- Do NOT use (use another skill instead): official news/rumours → `tim-kiem-tin-tuc`; general fear/greed → `danh-gia-vi-mo-quoc-te` / `nhip-dap-crypto`; brokerage ratings → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 1: Top 20 posts + score + comments (in parallel).**

Run `sentiment_score` (symbol, limit=20) — score + posts from Fireant. Run `news_symbol`/Fireant posts (limit=20) to read the top 20 titles/summaries. Pick the hottest post (highest interactions/comments) → run `fireant_thread` (post_id) for the actual comments (replies) — read the comments' mood, not just the score. Stop once you have the score + ≥3 quotes + ≥3 comments + a source label.

**Bước 2: Cross-check disclosures (only on a contradiction, sequential).**

Run `company_events` (symbol) when comments contradict disclosures. Never use sentiment to "settle" a thesis — only to confirm/deny.

**Bước 3: Validate before concluding.**

No Groq → `score_heuristic` + the warning "groq unavailable" → the verdict must carry the label `heuristic` (the heuristic uses a different scale; never normalise across the Groq/heuristic modes). Empty posts = a little-discussed ticker (a valid empty); never invent quotes; write "ít bàn luận". Fireant down → the only fallback: GDELT titles via `tim-kiem-tin-tuc` (1 call); state the substitute source. Never interpret the heuristic as "nên mua/bán".

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

- **Sentiment score** (Groq or heuristic — the source label is required).
- **3–5 representative comment quotes** (positive / negative / recurring theories) + Fireant provenance.
- **FOMO/panic detection** (symbol tag frequency + likes); heuristic thresholds: <−0.3 panic · >+0.3 FOMO · in between = neutral.
- **Required feedback-loop warning:** the crowd can be wrong — sentiment must never be the only leg of a decision.

## Ví dụ

**Ví dụ 1:**
Hỏi: Phố nói gì về FPT
Đạt khi: score + ≥3 quotes + source label, ≤4 calls. Missing the source label or the feedback-loop warning → not met.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: gauge score.
