---
name: so-sanh-cung-nganh
description: "Rank 2-6 same-sector stocks and pick the leader (quality × momentum). Always use this skill when the user asks to compare same-sector stocks, which is strongest/most worth buying — e.g. 'VCB vs BID vs CTG', 'steel mạnh nhất là ai' — even when the user doesn't say explicitly they want 'so sánh cùng ngành'."
activation: auto
requires_tools: [mcp__opentrading__compare_equities]
tool_budget: 8
triggers:
  keywords: [so sánh, vs, so với, cùng ngành, mạnh nhất, leader, hơn kém, xếp hạng mã]
version: 1.3.0
---

# Ranking Same-Sector Stocks

Second coordinator skill (same family as `phan-tich-chuyen-sau-1-ma`): resolve same-sector stocks, call 1 sub-skill per stock, merge into a ranking. Each stock gets only 1 sub-skill based on the question (momentum → technicals; quality → fundamentals; cheap/expensive → valuation) — never run all 3 dimensions per stock, never run a second sub-skill round. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks to compare/rank 2–6 same-sector stocks (`VCB vs BID vs CTG`, `steel mạnh nhất là ai`, `ngân hàng nào đáng mua nhất`).
- When NOT to use (use a different skill instead):
  - Only 1 stock → `phan-tich-chuyen-sau-1-ma`.
  - Single dimension for 1 stock (RSI → `ky-thuat-chuyen-sau`; financial statements → `co-ban-chuyen-sau`; fair value → `dinh-gia-chuyen-sau`).

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 0: resolve same-sector stocks (max 6)
- [ ] Step 1: quick table (overview + momentum + prices in 1 shot)
- [ ] Step 2: 1 sub-skill/stock, max 4 parallel
- [ ] Step 3: sector backdrop + ranking verdict
```

**Step 0: Resolve same-sector stocks (direct calls).**

Run `vn_reference` (industry) or `vs_industry_tree` (GICS lookup) → pick max 6 stocks; given only a sector name use `stock_screener` (sector filter, narrow pool). More than 6 → ask the user to narrow, never expand on your own. `vn_reference` industry no match → try `vs_industry_tree` once, still nothing → ask for the sector again, never guess symbols.

**Step 1: Quick table (direct calls).**

Run `compare_equities` (≤4 stocks/call; 5–6 stocks → split 4+2 with `peer_compare`) + `vn_equity_quote_batch` (≤6 stocks, 1 call): overview + momentum + price table in 1 shot.

**Step 2: Call a sub-skill per stock (dispatch, max 4 parallel).**

Dispatch `ky-thuat-chuyen-sau` OR `co-ban-chuyen-sau` OR `dinh-gia-chuyen-sau` for each stock based on the question. NEVER call `signals_technical` / `financial_detail` / `valuation_run` directly here.

**Step 3: Sector backdrop + validate.**

Run `vs_gics_index` (group) as the sector index backdrop (1 call). Peak-hour enrich throttle → empty ratios → technical-only verdict + note the gap, never fabricate PE/ROE. Missing data on 1 criterion → partial ranking + note "n/6 mã có đủ", never silently drop stocks.

## Template

ALWAYS use this exact verdict structure, every item with numbers + provenance:

1. Ranking table {symbol · PE · ROE · momentum · RS · price} (`provenance: compare_equities` / `peer_compare` / `vn_equity_quote_batch` + Step 2 sub-skill).
2. One-line rationale: leader = quality × momentum; good valuation = low PE within a high-ROE group.
3. Group-correlation warning when allocating across the whole group (cross-ref `correlation_matrix`, reference only).
4. One-sentence conclusion: which stock + why.

## Examples

**Example 1 (live 02-10-2026, no new fabricated numbers):**
Input: So sánh bank
Output: compare_equities VCB-vs-HPG 2.8s · peer_compare cap 6 · vs_gics_index 3 groups live · quote_batch 1 request VN30 · HOSE universe 757 stocks → peer list ≤6 + capped sub-skill calls + ranking table, ≤8 own calls.
