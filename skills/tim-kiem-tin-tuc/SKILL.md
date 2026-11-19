---
name: tim-kiem-tin-tuc
description: "Finds news by ticker or keyword, rumours included, checks them against official disclosures and labels the unconfirmed. Use for news on a ticker or whether a rumour is true."
match_text: "Tìm tin theo mã hoặc từ khoá, kể cả tin đồn, đối chiếu công bố chính thức và gắn nhãn chưa xác nhận. Dùng khi hỏi tin về một mã hoặc hỏi tin đồn có thật không."
activation: auto
requires_tools: [mcp__opentrading__news_symbol]
triggers:
  keywords: [tin về, tìm tin, tin tức về, news về, tin trên, dư luận về, nghe đồn, tin đồn, có thật không]
version: 1.3.0
---

# Tìm tin và kiểm chứng tin đồn

Rumours come before official news — hunt both, but you must clearly classify official vs CHƯA XÁC NHẬN. Never treat a rumour as fact; never drop the reliability label.

## Khi nào dùng

- Use when: the user names a specific ticker/keyword/scope, wants to hunt news + rumours + opinion, wants a rumour verified, or wants one story analysed in detail.
- Do NOT use (use another skill instead): a default digest without keywords → `tin-tuc-nong-viet-nam` / `tin-tuc-nong-quoc-te`; only crowd/FOMO → `phan-tich-sentiment`; only brokerage ratings/targets → `tim-co-hoi-bao-cao-ctck`; only strategy backtests → `kiem-chien-luoc-backtest`.

## Các bước

Choose EXACTLY 1 mode below.

**Mode A — By ticker (+ rumours).**

1. Run `news_symbol` (symbol, limit=20) first. NEVER go to web_search before you have `news_symbol` results — the web is only for cross-checking afterwards.
2. Hunt the web + comments in parallel: `web_search` ("ticker name" + "đồn"/"tin đồn"/rumor, at most 2 queries) → `web_fetch` the 1–2 most suspicious URLs + `fireant_thread` (post_id from step 1 — rumours live in the replies; Fireant posts now have real ids, never invent a post_id).
3. Cross-check sequentially: `corporate_calendar` (symbol) + `company_events` (symbol) — does the story match disclosures?
4. Opinion: `sentiment_score` (symbol). Stop once you have ≥5 qualifying stories.

**Mode B — Vietnam.**

1. Run `news_market` (limit=15) + `corporate_calendar` (limit=20) in parallel.
2. Sequentially: `news_symbol` × the 2–3 prominent tickers + `web_search` on the hottest story to cross-check. Do not dig into tickers beyond those 2–3.

**Mode C — Global.**

1. Run `news_market` (sources=gdelt, limit=10).
2. In parallel: `geo_intel` (topic) / `event_stats` (query) + `web_search` (English keywords). GDELT empty → try English once, then conclude "ít coverage ngôn ngữ đó".

**Common validation.**

`web_search` reports no results (blocked, no key) → use only Fireant+GDELT + state "chưa quét web". Both news sources down → read `snapshot_history` (kind=news_feed) and state "cache <ngày>" explicitly.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure:

| Tiêu đề | Tuổi tin | Độ tin cậy + provenance | Triển vọng |
- **Title** in full, with the related ticker. **Age** (hours/days ago — news older than 3 days on a bluechip counts as priced in). **Reliability** (chính thống / CTCK / Fireant-crowd / ẩn danh-nguồn mở) + provenance (`news_symbol`/`news_market`/Fireant/GDELT/web). **Outlook** (impact on the company: revenue/profit/price — or just noise). Rumours must carry the label `CHƯA XÁC NHẬN` + the confirming condition (which disclosure, which date).
- A detailed analysis of the most important story: who said it → what they said → supporting evidence → whether the impact is quantifiable (e.g. dividend per share, deal size in tỷ) → scenarios if true/false.

## Ví dụ

**Ví dụ 1:**
Hỏi: Nghe đồn HPG ... thật không
Đạt khi: a conclusion with all 4 columns + a detailed analysis + confirmation labels, ≤10 calls. Missing 1 of the 4 columns → not met; a rumour without `CHƯA XÁC NHẬN` → not met.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type.
