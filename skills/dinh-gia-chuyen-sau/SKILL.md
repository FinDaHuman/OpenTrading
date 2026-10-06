---
name: dinh-gia-chuyen-sau
description: "Compute the fair-value range and UPSIDE/DOWNSIDE % for one stock (PER/PB, vs 2-3 year history). Always use this skill when the user asks whether a stock is expensive or cheap, what the fair value is, how much upside is left — e.g. 'FPT đắt chưa', 'VCB fair value' — even when the user doesn't explicitly say they want 'định giá' (valuation)."
activation: auto
requires_tools: [mcp__opentrading__valuation_run]
tool_budget: 7
triggers:
  keywords: [định giá, fair value, dcf, per, đắt hay rẻ, upside, giá mục tiêu tự tính, valuation]
version: 1.2.0
---

# Valuing Single-Stock Fair Value

Return exactly 6 items: price vs fair range → PER/PB vs history → why cheap/expensive → UPSIDE/DOWNSIDE % → broker-target anchor → 1-sentence verdict. Negative EPS (loss-making company) makes per_pb meaningless — say outright that there is no basis for valuation instead of fabricating a fair value. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks for valuation of one stock (`FPT đắt chưa`, `VCB fair value`, `định giá theo PER`, `upside còn bao nhiêu`).
- When NOT to use (use another skill instead):
  - Comparing multiple stocks → `so-sanh-cung-nganh`.
  - Pure fundamentals (financial statements, M-Score, ownership) → `co-ban-chuyen-sau`.
  - Pure technicals → `ky-thuat-chuyen-sau`.
  - Broker target prices (aggregating existing reports) → `tim-co-hoi-bao-cao-ctck` (cross-ref only to anchor expectations; does not replace self-computed valuation).

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 1: core fair value (parallel)
- [ ] Step 2: history anchor (parallel)
- [ ] Step 3: rate context (bank/PB-heavy only)
- [ ] Step 4: verdict, 6 items
```

**Step 1: Core fair value (parallel, call directly).**

Run `valuation_run` (symbol, method defaults to auto — only change method if the user insists) + `vs_overview_trading` (symbol).

**Step 2: History anchor (parallel, call directly).**

Run `financial_ratios` (symbol) + `vn_quote_history` (symbol, days=365), compute the 2–3 year average PER/PB yourself. If price history is missing, drop the history comparison, verdict partial + note the gap.

**Step 3: Rate context (only when needed).**

Run `yf_yield_curve` + `vs_trading_info` for PB-heavy stocks (banks). If you already have fair value + history comparison, stop — do not open Step 3 to pad the answer. One `method` per run; a `method` outside the enum → warning → fall back to auto, no retry with exotic methods.

**Step 4: Validate before finalizing.**

Never rebuild the DCF yourself (already computed in `valuation_run`). Never call `signals_technical` / `financial_detail` / `stock_forensic` here; for fundamentals quality, cross-ref `co-ban-chuyen-sau` without re-calling that skill's tools. For banks prefer per_pb and state the reason.

## Template

ALWAYS use this exact verdict structure, each item with numbers + trend + provenance:

1. Current price vs fair range: which method leads, gap in % (`provenance: valuation_run` + `vs_overview_trading`).
2. Current PER/PB vs self-computed 2–3 year average (`provenance: financial_ratios` + `vn_quote_history`).
3. Why cheap/expensive: growth + quality (cross-ref `co-ban-chuyen-sau`) + rates.
4. UPSIDE/DOWNSIDE % + confidence (high if the 2 methods agree).
5. Expectation anchor line: upside per broker targets (`provenance: tim-co-hoi-bao-cao-ctck` cross-ref, reference only).
6. 1-sentence verdict: ĐẮT/HỢP LÝ/RẺ + UPSIDE/DOWNSIDE %.

## Examples

**Example 1 (live 02-10-2026, no fabricated numbers):**
Input: FPT đắt chưa
Output: VCB per_pb @57,400 (2 methods agree) · FPT per_pb @62,700 · US10Y 5.24% context · overview_trading VCB PE/PB/ROEA complete → UPSIDE % + history comparison, 2 lines, ≤7 calls.
