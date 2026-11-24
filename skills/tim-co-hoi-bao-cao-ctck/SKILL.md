---
name: tim-co-hoi-bao-cao-ctck
description: "Collects brokerages' recommendations: rating, target price, upside checked against the matched price. Use when asked what brokerages recommend or a ticker's new targets."
match_text: "Tổng hợp khuyến nghị của CTCK: rating, giá mục tiêu, upside đã đối chiếu giá khớp lệnh. Dùng khi hỏi CTCK khuyên mua gì hoặc target mới của một mã."
activation: auto
requires_tools: [mcp__opentrading__analyst_consensus]
triggers:
  keywords: [ctck, khuyên mua, giá mục tiêu, target, báo cáo phân tích, khuyến nghị, rating]
version: 1.5.0
---

# Cơ hội từ báo cáo CTCK

Brokerage recommendations are INPUT, not truth — you must check the upside against the current price and add a disclaimer. A brokerage's rating is not your recommendation: give your own only from your own check; never invent a brokerage target price when the feed has none.

## Khi nào dùng

- Use when: asked for brokerage ratings/targets/reports from the general feed or for a specific ticker, when an upside % table is needed.
- Do NOT use (use another skill instead): rumours/crowd → `phan-tich-sentiment` / `tim-kiem-tin-tuc`; your own valuation → `dinh-gia-chuyen-sau`; backtests → `kiem-chien-luoc-backtest`.

## Các bước

**Bước 1: General feed (a single call).**

Run `analyst_consensus` (limit=30, days=7) — the general feed without a symbol; parse the rating + target price from titles. `days` keeps the last N days; lines whose date cannot be read stay, tagged `date_uncertain:true`. For macro reports add `analyst_consensus` (report_type=macro): it filters brokerages' macro reports (section/report entries); without dated reports, use the source figures. A truly empty feed (weekend) is a valid empty; widen `days` exactly once, then conclude.

**Bước 2: A specific ticker + source documents (sequential, after Bước 1).**

Run `analyst_consensus` (symbol, limit=15) + `vs_documents` (symbol, only the 1 most valuable ticker).

Feed titles are enough for "CTCK khuyên gì". Use `web_fetch` on a report page only when the question needs content beyond the title (thesis, reasons for the target), at most 3 reports, preferring MUA and the newest; pass `prompt` to take only the recommendation, target price and main thesis. If a PDF's text cannot be read, give the link and say its content was not read. Asked about a specific ticker and `analyst_consensus` (symbol) is empty → read the general feed and filter titles containing the ticker (the title-scrape filter may miss some); do not retry with a different limit.

**Bước 3: Verify the upside (sequential, the 1–2 most prominent tickers).**

Run `stock_overview` (1–2 calls) to compare the current price with the target → upside %. Verify only the top ones, not all.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

- Table {ticker · brokerage · rating · target price · date · upside % vs the current price}, filtered within `days` (default 7).
- Top 3 by brokerage upside (large upside + MUA rating + still valid) — these are the brokerages' views, never your own recommendation.
- A **"đã kiểm chứng"** column is required = Bước 3 ran for the 1–2 most prominent tickers (with `stock_overview`); unverified tickers say "chưa kiểm chứng giá hiện tại".
- Required disclaimer: brokerage recommendations are INPUT, not truth — not your own recommendation.
- Provenance: the date source from the URL/title; if `source/date null` (a feature of title parsing) → infer the date from the URL/title + state the date source as "không chắc chắn". Stop once the table has ≥5 rows + 2 top tickers are verified; do not dig into tickers beyond the top.

## Ví dụ

**Ví dụ 1:**
Hỏi: CTCK khuyên mua gì tuần này
Đạt khi: a table of ≥5 rows with upside %, 2 top tickers verified, ≤8 calls. Missing the "đã kiểm chứng" column or the disclaimer → not met; inventing a target when the feed is empty → not met.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar diverging upside.
