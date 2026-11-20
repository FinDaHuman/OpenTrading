---
name: phan-tich-chuyen-sau-1-ma
description: "Coordinates a full analysis of one ticker: company, sector, news, events, technicals, valuation, merged into a positives/negatives/drivers table. Use for \"phân tích FPT\", \"VCB thế nào\"."
match_text: "Điều phối phân tích toàn diện một mã: mã, ngành, tin, sự kiện, rồi kỹ thuật và định giá, gộp thành bảng tích cực/tiêu cực/động lực. Dùng khi hỏi \"phân tích FPT\", \"VCB thế nào\"."
activation: auto
requires_tools: [symbol_lookup, financial_detail]
uses_tools: [symbol_lookup, symbol_resolve, vn_company, vs_company_info, vs_industry_tree, financial_detail, news_symbol, company_events, event_calendar_vn, evidence_bundle]
triggers:
  keywords: [kỹ thuật định giá, phân tích cổ phiếu, phân tích mã, phân tích toàn diện, chi tiết mã, mã này sao]
  exclude_keywords: [phân tích cơ bản]
version: 1.5.1
---

# Phân tích toàn diện một mã

A coordinating skill: identify the ticker + sector + news + events yourself, hand technicals and valuation to 2 subagents running in parallel, then merge the conclusions.

## Khi nào dùng

- Use when: the user asks for a full analysis of 1 ticker (`phân tích FPT`, `VCB thế nào`, `mã này sao`).
- Do NOT use (use another skill instead):
  - Technicals only (RSI, breakout, multi-timeframe, higher-high/lower-low) → `ky-thuat-chuyen-sau`.
  - Statements/fundamentals only (M-Score, shareholders, dividends) → `co-ban-chuyen-sau`.
  - Valuation only (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - Comparing 2–6 tickers in one sector → `so-sanh-cung-nganh`.
  - The setup before earnings come out → `danh-gia-truoc-bctc`.

## Các bước

About 7 model steps: load the skill, 5 tool rounds (each round in parallel), answer. Technicals and valuation run in subagents, so they cost no steps of the main turn.

**Bước 1: Identify the ticker.**

Run `symbol_lookup` (company name) or `symbol_resolve` (multi-type codes, ranked). For ambiguous codes (gold/BTC/USD) you must `symbol_resolve` first. If `symbol_resolve` returns several candidates → take the highest ranked and state which name you resolved to which ticker; without a ticker, stop and ask; never guess. Vietnamese stocks → `vn_*`/`vs_*` tools; crypto → `crypto_spot`.

**Bước 2: Sector + how the company makes money (in parallel).**

Run `vn_company` · `vs_company_info` · `vs_industry_tree`. Get the GICS sector, business model, main revenue sources. An unclassified ticker (`vs_industry_tree` does not match) → write "chưa phân loại" and still do the remaining steps.

**Bước 3: Technicals + valuation with 2 subagents in parallel.**

When the `desk_run` tool is available (the user turned ultradesk on) → call `desk_run` with the key `tranh_bien` for the Bước 1 ticker instead of Bước 3–5; the result arrives later; say briefly that the run is going.

Call `spawn_subagent` twice in the same round (type `nghien-cuu`): one subagent loads `ky-thuat-chuyen-sau`, the other loads `dinh-gia-chuyen-sau`, both for the Bước 1 ticker. Each brief: `task` names the ticker and the skill to load, `questions` are that skill's specific questions, `output` "5–8 dòng có số, khung thời gian và tên tool nguồn". Do not call `signals_technical` / `valuation_run` / `stock_forensic` directly in the main turn.

**Bước 4: Quarterly profit + news + events (in parallel, in the same round as Bước 3 if possible).**

Run `financial_detail` (4 quarters of results + QoQ/YoY/margins — do not dig into M-Score/F-score; that is `co-ban-chuyen-sau`'s job), `news_symbol` + `company_events` (news + disclosures), `event_calendar_vn` (30–90 day calendar: earnings/AGMs/dividends).

**Bước 5: Synthesis + verification.**

Run `evidence_bundle` to lock the conclusion into a Tích cực / Tiêu cực / Động lực tương lai table. If one subagent fails, still conclude with the rest and state what is missing; never fill in numbers. If the user asks about one dimension (`RSI FPT`), use the matching sub-skill directly instead of running all steps. Once the data fills the 3-column table, stop; no second round of news/events.

## Trực quan hóa

Draw only when the user wants a picture; at most 1 chart. Draw with `chart_render` using `from_call` pointing at candle or `financial_detail` results you have (the `[ref …]` code); never fetch extra data just to draw; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: candles + volume, stacked revenue/profit by quarter.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, each item with figures + trend + provenance (which tool/sub-skill gave the figure):

1. A 1-sentence view (the main stance/tone of the analysis — not a personal buy/sell recommendation).
2. Sector + how it makes money (2 lines, from Bước 2).
3. Technicals (`provenance: ky-thuat-chuyen-sau`, from the subagent, with the 1D/1W timeframes).
4. Valuation (`provenance: dinh-gia-chuyen-sau`, from the subagent, with UPSIDE/DOWNSIDE % if available).
5. Quarterly profit (4 quarters of revenue/profit + QoQ/YoY trend + margins, from `financial_detail` in Bước 4).
6. News + upcoming events (from `news_symbol` / `company_events` / `event_calendar_vn`).
7. The Tích cực / Tiêu cực / Động lực tương lai table (3 columns, locked with `evidence_bundle`).
8. A 1-sentence conclusion for the whole ticker.

## Ví dụ

**Ví dụ 1:**
Hỏi: Phân tích FPT
Đạt khi: all items above, with the 3-column positives/negatives/drivers table; technical and valuation figures from the 2 subagents, no invented numbers in this skill.
