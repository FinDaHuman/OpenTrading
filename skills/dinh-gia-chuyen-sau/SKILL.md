---
name: dinh-gia-chuyen-sau
description: "Computes a fair price range and % upside/downside for a ticker (P/E, P/B vs its 2–3 year history). Use when asked whether a stock is expensive or cheap, fair value, remaining upside."
match_text: "Tính vùng giá hợp lý và % upside/downside của một mã (P/E, P/B so với lịch sử 2–3 năm). Dùng khi hỏi mã đắt hay rẻ, fair value, còn upside không."
activation: auto
requires_tools: [mcp__opentrading__valuation_run]
uses_tools: [mcp__opentrading__valuation_run]
triggers:
  keywords: [định giá, fair value, dcf, per, đắt hay rẻ, upside, giá mục tiêu tự tính, valuation]
version: 1.3.0
---

# Định giá một mã

Return exactly 6 items: price vs the fair range → PER/PB vs history → why cheap/expensive → UPSIDE/DOWNSIDE % → the brokerage target anchor → a 1-sentence conclusion. With negative EPS (a loss-making company) per_pb is meaningless — say plainly there is not enough basis to value it instead of inventing a fair value.

## Khi nào dùng

- Use when: the user asks to value 1 ticker (`FPT đắt chưa`, `VCB fair value`, `định giá theo PER`, `upside còn bao nhiêu`).
- Do NOT use (use another skill instead):
  - Comparing several tickers → `so-sanh-cung-nganh`.
  - Pure fundamentals (financial statements, M-Score, ownership) → `co-ban-chuyen-sau`.
  - Pure technicals → `ky-thuat-chuyen-sau`.
  - Brokerages' target prices (summarising existing reports) → `tim-co-hoi-bao-cao-ctck` (cross-ref only to anchor expectations, never replacing your own valuation).

## Các bước

**Bước 1: Core fair value (in parallel, direct calls).**

Run `valuation_run` (symbol, `btype`: 1 ordinary company, 2 brokerage, 3 bank, 5 insurer; leave `method` at auto unless the user insists). It returns today's price, EPS of the last four quarters, BVPS and the current `per`, `pb` — no price range and no DCF; the range is computed in Bước 2. `vs_overview_trading` carries no multiples, do not call it here.

**Bước 2: Historical anchor (in parallel, direct calls).**

Run `financial_ratios` (symbol, period="quarter" — the default is yearly and gives too few points) + `vn_quote_history` (symbol, days=365, the price context of the year). Take the last 8–12 quarters of `p_e`, `p_b` ending at `latest_period` (`periods` runs oldest → newest); skip quarters that are missing or not positive. Each multiple is at its own quarter end, on the same four-quarter EPS basis as `per`. Compute the average in one `shell` command, stating the number of periods and the first/last period. Fair range = average P/E × current EPS and average P/B × current BVPS (say "tính từ"), the two ends of the range; banks and brokerages: P/B only. Quarterly figures unavailable → use the yearly ones and say so. No PER/PB periods at all → drop the historical comparison: a partial verdict + note what is missing. Per-share figures are not restated for bonus/rights issues after their period: when `eps_note` applies and an issue happened, say the comparison is distorted.

**Bước 3: Rate backdrop (only when needed).**

Run `yf_yield_curve` + `vs_trading_info` for PB-heavy tickers (banks). Once you have the fair value + the historical comparison, stop; do not open Bước 3 to fill time. One `method` per run (auto, per, pb or ensemble): it is only a label, the figures do not change with it.

**Bước 4: Validate before concluding.**

Do not build a DCF yourself, and never say one was computed: no tool returns it. Do not call `signals_technical` / `financial_detail` / `stock_forensic` here; for fundamental quality cross-ref `co-ban-chuyen-sau` without calling that skill's tools again. For banks and brokerages P/B leads (`pb_bank_broker`); say why.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure, each item with figures + trend + provenance:

1. Current price vs the fair range: which method leads, the gap in % (`provenance: valuation_run` + `financial_ratios`).
2. Current PER/PB vs the 2–3 year average (current: `per`, `pb` of `valuation_run`; average: the PER/PB periods of `financial_ratios`).
3. Why cheap/expensive: growth + quality (cross-ref `co-ban-chuyen-sau`) + rates.
4. Upside/downside % + confidence (high if 2 methods agree).
5. Expectation anchor: brokerages' target price (`provenance: tim-co-hoi-bao-cao-ctck` cross-ref, reference only).
6. 1-sentence conclusion: ĐẮT/HỢP LÝ/RẺ + upside/downside %.

Write column headings and the conclusion in Vietnamese: "tỷ lệ giá trên lợi nhuận (P/E)", never a bare "PER"; "vùng giá hợp lý", never "fair"; "dư địa tăng/giảm", never "upside/downside".

## Ví dụ

**Ví dụ 1:**
Hỏi: FPT đắt chưa
Đạt khi: UPSIDE % + 2 lines comparing with history, ≤7 calls.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: multiline current PER vs average, bar PER/PB history, bar diverging upside.
