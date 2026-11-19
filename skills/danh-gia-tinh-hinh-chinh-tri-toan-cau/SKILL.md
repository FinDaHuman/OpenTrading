---
name: danh-gia-tinh-hinh-chinh-tri-toan-cau
description: "Lists 4–6 global political risks (elections, policy, tensions), each with odds and confirming news. Use for political risk across several countries."
match_text: "Lập 4–6 rủi ro chính trị toàn cầu (bầu cử, chính sách, căng thẳng), mỗi mục có odds và tin xác nhận. Dùng khi hỏi rủi ro chính trị ở nhiều nước."
activation: auto
triggers:
  keywords: [địa chính trị, bầu cử, chính trị, chính sách mỹ, căng thẳng quốc tế, rủi ro chính trị]
version: 1.3.0
---

# Bản đồ rủi ro chính trị toàn cầu

A cross-referencing skill (no home tool of its own — it combines odds + news from several sources). Every verdict item must have an event URL + a news URL; if one is missing, say so.

## Khi nào dùng

- Use when: the user asks for a global political risk map, elections, policy, international tensions (several events, combining odds + news).
- Do NOT use (use another skill instead):
  - A specific armed conflict → use `danh-gia-tinh-hinh-xung-dot`.
  - Unrest in one country → use `bat-on-quoc-gia`.
  - Only a plain Polymarket odds table → use `du-doan-polymarket`.
  - Only Fed cut/hold → use `du-doan-fed`.

## Các bước

**Bước 1: Odds + intel (in parallel, required).**

Run `world_prediction_odds` (tag=fed/politics/elections per the question) + `geo_intel` (topic). Odds are sorted by vol24h, so take only the top 5 — pulling all 20 events sprawls.

**Bước 2: Drill-down (in parallel, after Bước 1).**

Run `polymarket_event` (top 1–2 slugs) + `event_stats` (query). Drill only events truly relevant to the question, at most 2 slugs per run. Never overlap `geo_intel` + `event_stats` + `news_market` on the same query for more than 1 round.

**Bước 3: Verify the news (sequential, after Bước 2).**

Run `news_market` (sources=gdelt) + `web_fetch` 1–2 official-source URLs from the news. Stop once 4 items have probabilities + confirming news.

**Bước 4: Validate before concluding.**

GDELT rate-limited → back off 20s, retry at most once → if it still fails, state honestly "thiếu tin GDELT, verdict chỉ dựa trên odds". If Gamma is slow the tool falls back to direct itself; wait once. Stale odds (end-date passed) → filter `end > today`, drop expired events. Both paths down → write "không có odds"; never invent probabilities.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **Event:** name + a 1-line background.
2. **Probability:** prob_pct per outcome (%) + end-date.
3. **Odds reliability:** 24h volume + liquidity (USD; <50k → flag "odds kém tin").
4. **Confirming GDELT news:** 1 line + URL.
5. **Market impact if any:** transmission channel + URL.
6. **Provenance:** every item must have an event URL + a news URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Rủi ro chính trị toàn cầu
Đạt khi: every item has a probability (prob_pct), trading volume and an event link as its source.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar odds per event, line event counts.
