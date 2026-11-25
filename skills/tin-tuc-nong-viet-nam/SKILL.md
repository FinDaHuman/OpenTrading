---
name: tin-tuc-nong-viet-nam
description: "Summarises 5–7 VN stock-market/corporate news items of the day, classified with their impact. Use for today's hot news in general."
match_text: "Tóm tắt 5–7 tin chứng khoán/doanh nghiệp VN trong ngày, phân loại và đánh giá tác động. Dùng khi hỏi chung tin nóng hôm nay."
activation: auto
requires_tools: [mcp__opentrading__news_market]
triggers:
  keywords: [tin nóng, tin chứng khoán, tin hôm nay, tin vn, tin doanh nghiệp, headline]
version: 1.3.0
---

# Tin nóng Việt Nam

A quick digest of today's Vietnamese news — headline + classification + sentiment, with clear provenance. Never turn heuristic sentiment on its own into a buy/sell recommendation.

## Khi nào dùng

- Use when: asked for today's hot Vietnamese news, VN30, Vietnamese market/corporate news, when 5–7 quick headlines are needed.
- Do NOT use (use another skill instead): a specific ticker/keyword or rumour → `tim-kiem-tin-tuc`; US/China/global news → `tin-tuc-nong-quoc-te`; digging into one ticker's crowd/FOMO → `phan-tich-sentiment`; brokerage ratings/targets → `tim-co-hoi-bao-cao-ctck`.

## Các bước

**Bước 1: General news + disclosure calendar (in parallel).**

Run `news_market` (limit=15) + `corporate_calendar` (limit=20).

**Bước 2: Dig into the prominent tickers (sequential, after Bước 1).**

Run `news_symbol` × the 2–3 tickers that appear most in the news — chosen by frequency, not by feel, at most 3 tickers.

**Bước 3: Sentiment + cross-check (in parallel).**

Run `sentiment_score` (the hottest ticker) + `company_events` (that ticker, only to cross-check, not to dig through its whole history). Without Groq → use the heuristic + warning, and the verdict must carry the label `heuristic`.

**Bước 4: Validate before concluding.**

Fireant down → the tool falls back to GDELT itself; do not retry Fireant endlessly. Both down → read `snapshot_history` (kind=news_feed), a 1-day cache, and state clearly that it is cached + the cache date. An empty feed at the weekend/holidays is a valid empty; write "phiên nghỉ, ít tin mới". Stop once you have 5 headlines with provenance; stop once Bước 3 gives a verdict for the hottest ticker. Never call `sentiment_score` again with a larger limit.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, each headline with: **title + related ticker + classification** (catalyst / đồn đoán / tin vĩ mô) + **sentiment** when there is enough data + **provenance** (Fireant/GDELT) + **age**. Rumours must carry the label `CHƯA XÁC NHẬN`.

## Ví dụ

**Ví dụ 1:**
Hỏi: Tin nóng hôm nay
Đạt khi: ≥5 headlines with provenance, ≤9 calls. Missing provenance or classification → not met; sentiment without a source label → not met.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type.
