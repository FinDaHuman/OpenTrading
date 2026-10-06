---
name: du-doan-polymarket
description: Read Polymarket odds by topic (event table + prob_pct + volume + liquidity/end-date trust flags). Always use this skill when the user asks about odds/probabilities, which markets are hot, or "bao giờ X" (when will X happen) — e.g. "odds bầu cử Mỹ", "BTC bao giờ chạm 100k" — even when the user doesn't explicitly say they want "xem Polymarket" (Polymarket odds). Do not use for Fed specifically (use du-doan-fed).
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 6
triggers:
  keywords: [polymarket, odds, xác suất, prediction market, bao giờ bitcoin, cá cược sự kiện]
version: 1.2.0
---

# Reading Polymarket Odds

Return an event table with prob_pct + volume + liquidity + end-date, every row carrying both trust flags. At most 2 events drilled per run — the user picks, never open the whole top-10 yourself. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks for Polymarket odds/probabilities by topic (economy, elections, crypto...), "market nào đang nóng" (which markets are hot), or drill-down of 1–2 events.
- When NOT to use (use another skill instead):
  - Fed specifically (needs curve + FOMC + VN implications) → use `du-doan-fed`.
  - Broad political map combining odds + GDELT news → use `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: scan odds (1 call, take the top sorted by vol24h)
- [ ] Step 2: drill down into the events the user cares about (max 2)
- [ ] Step 3: table + flags + 1-sentence conclusion
```

**Step 1: Scan odds (mandatory).**

Run `world_prediction_odds` (query or tag, limit=10). Empty query → switch to tag at most once, then conclude "không có market cho chủ đề" (no market for this topic). If the user only asked "đang nóng gì" (what's hot) and Wave 1 already has ≥5 events, stop — no drill-down.

**Step 2: Drill-down (after Step 1, max 2).**

Run `polymarket_event` for the slug the user cares about (drill full outcomes); a second event only if the user asks explicitly. Never run Step 2 + 3 in parallel.

**Step 3: Validate before finalizing.**

Wrong/nonexistent slug → switch to the next top slug once, then note "không drill được event X" (could not drill event X). Slow Jina proxy → the tool falls back to direct by itself (see warnings), wait once, no rapid-fire retries. Gamma down on both paths → state clearly "không có odds" (no odds available), never fabricate probabilities.

## Template

ALWAYS use this exact verdict structure:

1. **Event table:** each row {title · prob_pct per outcome (unit %) · volume24h (USD) · liquidity (USD) · end-date (day) · event URL}.
2. **Mandatory trust flags on every row:** (1) low liquidity (<50k USD) → "odds kém tin" (low-trust odds); (2) end-date passed → LOẠI from the table.
3. **Conclusion:** 1 sentence "thị trường đặt cược X với xác suất Y" (unit %).
4. **Provenance:** every row requires the event URL.

## Examples

**Example 1 (live 02-10-2026, no fabricated numbers):**
Input: Polymarket đang nóng gì về kinh tế
Output: Fed T10/2026 no-change 74.5% (vol 2.6M) · Brazil presidential detail OK · sort vol24h active → ≥5 events + trust flags on every row.
