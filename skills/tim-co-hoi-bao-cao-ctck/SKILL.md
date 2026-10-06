---
name: tim-co-hoi-bao-cao-ctck
description: "Hunt opportunities from broker analyst reports (CTCK): rating + target price + upside % verified against the current price. Always use this skill when the user asks what brokers (CTCK) recommend buying, which tickers got new targets, or what a broker report says — e.g. 'CTCK gần đây khuyên mua gì', 'có target mới cho MSN không' — even when the user doesn't explicitly say they want to 'tìm báo cáo CTCK'."
activation: auto
requires_tools: [mcp__opentrading__analyst_consensus]
tool_budget: 8
triggers:
  keywords: [ctck, khuyên mua, giá mục tiêu, target, báo cáo phân tích, khuyến nghị, rating]
version: 1.3.0
---

# Hunting Broker-Report Opportunities

Broker recommendations are INPUT, not gospel — always verify upside against the current price and include the disclaimer. Never turn a recommendation into "nên mua"; never fabricate target prices when the feed has none.

Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: asking about broker rating/target/reports from the shared feed or a specific ticker, or an upside % table is needed.
- When NOT to use (use another skill instead): rumor/crowd → `phan-tich-sentiment` / `tim-kiem-tin-tuc`; own valuation → `dinh-gia-chuyen-sau`; backtest → `kiem-chien-luoc-backtest`.

## Workflow

Copy the checklist and tick as you progress:

```
Task Progress:
- [ ] Step 1: shared feed (1 call only)
- [ ] Step 2: specific ticker + source docs + read PDF
- [ ] Step 3: verify upside top 1-2 tickers
- [ ] Step 4: table + disclaimer
```

**Step 1: Shared feed (1 call only).**

Run `analyst_consensus` (limit=30) — shared feed without symbol, parse rating + target price from titles. For macro reports add `analyst_consensus` (report_type=macro): filter CTCK macro reports (entry section/report); if there are no dated reports, use the source figures. If the feed is genuinely empty (weekend) → empty is valid, widen `days` once only, then conclude.

**Step 2: Specific ticker + source docs (sequential, after Step 1).**

Run `analyst_consensus` (symbol, limit=15) + `vs_documents` (symbol, only the single most worthwhile ticker) + `web_fetch` (format=pdf, report URL — read the PDF stdlib-only, scan it honestly, cap 10 pages/20k chars). If the user names a ticker and `analyst_consensus` (symbol) is empty → read the shared feed and filter titles containing the ticker (title-scrape filtering may miss some); do not retry with a different limit.

**Step 3: Verify upside (sequential, 1–2 standout tickers).**

Run `stock_overview` (1–2 calls) to compare current price vs target → upside %. Verify only the top picks, not everything.

## Template

ALWAYS use this exact verdict structure:

- Table {mã · CTCK · rating · giá mục tiêu · ngày · upside % so giá hiện tại}, filtered within `days` (default 7).
- Top 3 opportunities (large upside + MUA rating + still valid).
- The **"đã kiểm chứng"** column is mandatory = Step 3 ran for the 1–2 standout tickers (with `stock_overview`); unverified tickers must be marked "chưa kiểm chứng giá hiện tại".
- Mandatory disclaimer: broker recommendations are INPUT, not gospel — do not turn them into "nên mua".
- Provenance: dates come from URL/title; if `source/date null` (typical when parsing titles) → infer the date from URL/title + state the date source as "không chắc chắn". Once the table has ≥5 rows + 2 top tickers verified, stop; do not dig into tickers outside the top.

## Examples

**Example 1 (live 02-10-2026, do not fabricate new numbers):**
Input: CTCK khuyên mua gì tuần này
Output: Shared feed **7 reports** — MBB MUA 28,200 · **MSN MUA 89,200 (30/09)** · VPB KHẢ QUAN 30,500 · MSB GIẢM TỶ TRỌNG 13,200 · FRT THEO DÕI 157,000 · filter symbol=VCB/FPT each empty as expected → table ≥5 rows with upside %, verify 2 top tickers, ≤8 calls. Missing the "đã kiểm chứng" column or the disclaimer → not done; fabricating a target when the feed is empty → not done.
