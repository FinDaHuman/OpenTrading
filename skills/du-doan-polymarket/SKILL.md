---
name: du-doan-polymarket
description: "A table of Polymarket probabilities by topic (probability, volume, confidence). Use when asked the odds of an event or \"when will X\". Fed questions use du-doan-fed."
match_text: "Bảng xác suất Polymarket theo chủ đề (xác suất, khối lượng, độ tin cậy). Dùng khi hỏi odds một sự kiện hoặc \"bao giờ X\". Câu hỏi về Fed dùng du-doan-fed."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
triggers:
  keywords: [polymarket, odds, xác suất sự kiện, prediction market, bao giờ bitcoin, cá cược sự kiện]
version: 1.3.0
---

# Đọc xác suất Polymarket

Return a table of events with prob_pct + volume + liquidity + end-date, each row with both reliability flags. Drill down into at most 2 events per run — the user chooses; never open the whole top 10 yourself.

## Khi nào dùng

- Use when: the user asks for Polymarket odds/probabilities by topic (economy, elections, crypto...), "market nào đang nóng", or a drill-down into 1–2 events.
- Do NOT use (use another skill instead):
  - The Fed specifically (needs the curve + FOMC + implications for Vietnam) → use `du-doan-fed`.
  - A broad political map combining odds + GDELT news → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Các bước

**Bước 1: Scan the odds (required).**

Run `world_prediction_odds` (query or tag, limit=10). If the query is empty, change the tag at most once, then conclude "không có market cho chủ đề". If the user only asks "đang nóng gì" and wave 1 gives ≥5 events, stop; no drill-down.

**Bước 2: Drill down (sequential after Bước 1, at most 2).**

Run `polymarket_event` for the slug the user cares about (full outcomes); a second event only if the user asks explicitly. Never run Bước 2 + 3 in parallel.

**Bước 3: Validate before concluding.**

A wrong/missing slug → try the next top slug once, then write "không drill được event X". If the Jina proxy is slow, the tool falls back to direct itself (see warnings); wait once, no burst of retries. Gamma down on both paths → state "không có odds"; never invent probabilities.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

1. **Event table:** each row {title · prob_pct per outcome (%) · volume24h (USD) · liquidity (USD) · end-date (date) · event URL}.
2. **Reliability flags required on every row:** (1) low liquidity (<50k USD) → "odds kém tin"; (2) end-date passed → REMOVE from the table.
3. **Conclusion:** 1 sentence "thị trường đặt cược X với xác suất Y" (in %).
4. **Provenance:** every row must have the event URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Polymarket đang nóng gì về kinh tế
Đạt khi: ≥5 events + reliability flags on every row.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar odds % per outcome.
