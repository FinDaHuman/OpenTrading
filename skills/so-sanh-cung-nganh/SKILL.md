---
name: so-sanh-cung-nganh
description: "Ranks 2–6 tickers in one sector by quality and momentum and picks the leader. Use when asked to compare tickers in a sector or which is strongest."
match_text: "Xếp hạng 2–6 mã cùng ngành theo chất lượng và đà tăng, chọn mã dẫn đầu. Dùng khi hỏi so sánh các mã cùng ngành, mã nào mạnh nhất."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
triggers:
  keywords: [so sánh, so sánh với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.5.0
---

# So sánh mã cùng ngành

The second coordinating skill (same family as `phan-tich-chuyen-sau-1-ma`): identify peers in the sector, call 1 sub-skill per ticker, merge into a ranking. Each ticker gets only 1 sub-skill according to the question (momentum → technicals; quality → fundamentals; cheap/expensive → valuation) — never all 3 dimensions per ticker, never a second round of sub-skills.

## Khi nào dùng

- Use when: the user asks to compare/rank 2–6 tickers in one sector (`VCB vs BID vs CTG`, `steel mạnh nhất là ai`, `ngân hàng nào đáng mua nhất`).
- Do NOT use (use another skill instead):
  - Only 1 ticker → `phan-tich-chuyen-sau-1-ma`.
  - One dimension of one ticker (RSI → `ky-thuat-chuyen-sau`; financial statements → `co-ban-chuyen-sau`; fair value → `dinh-gia-chuyen-sau`).

## Các bước

**Bước 0: Identify the peers (direct calls).**

Run `vn_reference` (industry) or `vs_industry_tree` (GICS lookup) → choose at most 6 tickers; given only a sector name, use `stock_screener` (sector filter, narrow pool), pick at most the 6 most liquid tickers yourself and state that assumption at the start of the answer. If the user lists more than 6 tickers, ask them to narrow it; never drop tickers yourself. If the `vn_reference` industry does not match → try `vs_industry_tree` once; if still nothing, ask for the sector again; never guess tickers.

**Bước 1: Quick table (direct calls).**

Run `compare_equities` (≤4 tickers per call; for 5–6 tickers split 4+2 with `peer_compare`) + `vn_equity_quote_batch` (≤6 tickers, 1 call): overview + momentum + price board in one shot.

**Bước 2: Call a sub-skill per ticker (dispatch, at most 4 in parallel).**

Dispatch `ky-thuat-chuyen-sau` OR `co-ban-chuyen-sau` OR `dinh-gia-chuyen-sau` for each ticker per the question. Do not call `signals_technical` / `financial_detail` / `valuation_run` directly here.

**Bước 3: Sector backdrop + validate.**

Run `vs_gics_index` (group) as the sector index backdrop (1 call). Enrichment throttled at peak hours → empty ratios → a technicals-only verdict + a note on what is missing; never invent P/E/ROE. Missing data for one criterion → a partial ranking + "n/6 mã có đủ"; never drop a ticker silently.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, each item with numbers + provenance:

1. Ranking table {ticker · PE · ROE · momentum · RS · price} (`provenance: compare_equities` / `peer_compare` / `vn_equity_quote_batch` + the Bước 2 sub-skills).
2. 1 line of reasoning: leader = quality × momentum; good value = low P/E within the high-ROE group.
3. A group-correlation warning when splitting money across the group (cross-ref `correlation_matrix`, reference only).
4. 1-sentence conclusion: which ticker leads the ranking + why. Never a personal buy recommendation.

## Ví dụ

**Ví dụ 1:**
Hỏi: So sánh bank
Đạt khi: a peer list ≤6 + bounded sub-skill calls + a ranking table, ≤8 own calls.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: bar for 1 metric, multiline PE series in the same unit, heatmap correlation.
