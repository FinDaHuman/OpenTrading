---
name: phan-tich-chuyen-sau-1-ma
description: "Coordinator for full single-stock analysis in 8 steps: self-identify the stock/sector/news/events, call the specialist skills (technicals, valuation), then merge the verdict into a Tích cực/Tiêu cực/Động lực table. Always use this skill when the user asks for full analysis of one stock — e.g. 'phân tích FPT', 'VCB thế nào', 'mã này sao' — even when the user doesn't say explicitly they want 'phân tích toàn diện'."
activation: auto
requires_tools: [mcp__opentrading__stock_overview]
tool_budget: 8
triggers:
  keywords: [phân tích, phân tích cổ phiếu, phân tích mã, toàn diện, chi tiết mã, mã này sao]
version: 1.3.0
---

# Coordinating Full Single-Stock Analysis

8-step coordinator skill: do the stock + sector + news + event identification yourself, dispatch technicals/valuation to sub-skills, then merge the verdict. Budget 8 only counts this skill's own tools; sub-skill tools live in the sub-skill's budget — they don't stack. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks for full analysis of one stock (`phân tích FPT`, `VCB thế nào`, `mã này sao`).
- When NOT to use (use a different skill instead):
  - Only technicals (RSI, breakout, multi-timeframe, higher-high/lower-low) → `ky-thuat-chuyen-sau`.
  - Only financial statements/fundamentals (M-Score, shareholders, dividends) → `co-ban-chuyen-sau`.
  - Only valuation (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - Comparing 2-6 same-sector stocks → `so-sanh-cung-nganh`.
  - Assessing the setup before earnings → `danh-gia-truoc-bctc`.

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: resolve the stock (disambiguate the given name)
- [ ] Step 2: sector + where the money comes from (direct calls)
- [ ] Step 2b: price chart (reuse existing candles → chart_render local, attach to verdict)
- [ ] Step 3-4: dispatch technicals + valuation to sub-skills
- [ ] Step 5-7: quarterly earnings + news + events (direct calls)
- [ ] Step 8: synthesis + lock the verdict
```

**Step 1: Resolve the stock (direct calls).**

Run `symbol_lookup` (company name) · `symbol_resolve` (multi-type symbols, ranked fallback). Ambiguous names (gold/BTC/USD) require `symbol_resolve` first. `symbol_resolve` returns multiple candidates → pick the highest rank + state clearly which name resolved to which symbol; no symbol → stop and ask, never guess. After you have the symbol: VN equities → candles/tools `vn_*`/`vs_*`; crypto → `crypto_spot` (USD, never use `vn_crypto_ohlcv` unless the VND price is asked).

**Step 2: Sector + where the money comes from (direct calls).**

Run `vn_company` · `vs_company_info` · `vs_industry_tree`. Get the GICS sector, business model, main revenue source. New stock not yet sector-classified (`vs_industry_tree` no match) → note "chưa phân loại", still run the remaining steps.

**Step 2b: Price chart (local tool, no remote budget).**

Reuse candles already in context (from Step 1 `vn_quote_history` or the technicals sub-skill) → call `chart_render` (local, kind=`candlestick` ≥5 candles) and attach the image to the final verdict. Never re-fetch candles just to draw; no candles → skip the chart, don't add data calls. Kind/color details: see `ve-bieu-do-ky-thuat`.

**Step 3-4: Dispatch technicals + valuation (never call the underlying tools).**

Dispatch `ky-thuat-chuyen-sau` (technical state) and `dinh-gia-chuyen-sau` (valuation). NEVER call `signals_technical` / `valuation_run` / `stock_forensic` directly here as a substitute — anything needing technicals/valuation goes through the sub-skill.

**Step 5-7: Quarterly earnings + news + events (direct calls).**

Run `financial_detail` (only quick earnings numbers for 4 quarters + QoQ/YoY/margin comparison — no deep financial-statement/M-Score/F-score digging, that's `co-ban-chuyen-sau`'s job), `news_symbol` + `company_events` (news + disclosures), `event_calendar_vn` (30–90 day calendar: earnings reports/AGMs/dividends).

**Step 8: Synthesis + validate.**

Run `evidence_bundle` to lock the verdict into a Tích cực / Tiêu cực / Động lực tương lai table. If a sub-skill loses a leg, still produce a verdict with the surviving leg + state the missing leg clearly, never backfill numbers. If the user asks a single dimension (`RSI FPT`) you must answer via the corresponding sub-skill, don't run all 8 steps. After 8 steps or once data is enough for the 3-column table, stop — never run a second news/events round.

## Template

ALWAYS use this exact verdict structure, every item with numbers + trend + provenance (which tool/sub-skill produced that number):

1. One-sentence assessment (recommendation/main tone).
2. Sector + how it makes money (2 lines, from Step 2).
3. Technicals (`provenance: ky-thuat-chuyen-sau`, include 1D/1W timeframes).
4. Valuation (`provenance: dinh-gia-chuyen-sau`, include UPSIDE/DOWNSIDE % if any).
5. Quarterly earnings (DT/LN numbers for 4 quarters + QoQ/YoY trend + margins, from `financial_detail` Step 5).
6. News + upcoming events (from `news_symbol` / `company_events` / `event_calendar_vn`).
7. Tích cực / Tiêu cực / Động lực tương lai table (3 columns, locked via `evidence_bundle`).
8. Candlestick chart attached (from Step 2b, if any).
9. One-sentence conclusion for the whole stock.

## Examples

**Example 1:**
Input: Phân tích FPT
Output: all 8 steps done, 3-column tích cực/tiêu cực/động lực table, ≤8 own calls (sub-skill calls not counted). Live numbers live in the sub-skills `ky-thuat-chuyen-sau` and `dinh-gia-chuyen-sau` — never fabricate numbers in this skill.
