---
name: phan-tich-vang-ty-gia
description: "Analyze SJC gold, the SJC-vs-world premium, the USDVND rate and rates at both ends SBV-Fed (max 10 calls). Always use this skill when the user asks how much more expensive SJC gold is than the world, whether the FX rate is under pressure, or a VN gold frame forecast — even when the user doesn't say explicitly they want 'phân tích vàng'."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
tool_budget: 10
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd, dự đoán vàng]
version: 1.3.0
---

# Analyzing Gold Premium and USDVND Pressure

Returns: world price + 3-line TA · premium % + VN gold frame forecast (with the world / against the world when the premium widens) · rates at both ends + FX implications · odds scenarios. No point forecast of a specific price ("vàng sẽ lên X triệu") — only premium + drivers + odds scenarios. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks SJC gold/gold bar prices, the VN–world gap (premium), world gold price + gold TA, USDVND FX pressure, a VN gold frame forecast, SBV–Fed rates at both ends and FX implications.
- When NOT to use (use a different skill instead): general VN policy rates (only `danh-gia-vi-mo-viet-nam`); crypto pulse (only `nhip-dap-crypto`); VN stock TA (only `ky-thuat-chuyen-sau`).

## Workflow

Copy the checklist and tick as you go:

```
Task Progress:
- [ ] Step 1: international gold price + gold TA
- [ ] Step 2: geopolitical risk (cross-ref, no re-calls)
- [ ] Step 3: VN–world gap → premium
- [ ] Step 4: rates at both ends
- [ ] Step 5: odds scenarios + verdict
```

**Step 1: International gold price + gold TA.**

Run `yf_commodities` (GC — 1 call already includes GC+DXY, don't split into separate ticks) + `vn_msn_fx_gold`. Read trend/momentum on daily candles (price vs SMA20/50 + RSI estimated from the series). `signals_technical` only supports VN stocks — never force it for GC=F, read TA from the series you already have.

**Step 2: Geopolitical risk (cross-ref, no re-calls).**

Reference `danh-gia-tinh-hinh-xung-dot` / `bat-on-quoc-gia` if just run in a previous skill (escalation = gold up); don't re-call and waste budget.

**Step 3: VN–world gap → premium.**

Run `vn_retail_gold` (SJC mua/bán). Premium = (SJC mua vào − converted world price) / world price — mandatory to state the unit-conversion assumption (SJC VND/lượng vs XAUUSD USD/oz). Widening premium = VN gold resists following the world price down.

**Step 4: Rates at both ends.**

Run `sbv_rates` + `fred_series` (DGS10) + `yf_yield_curve`: SBV (refinancing/discount) vs US (DGS10/curve) — the spread pulls capital, implies FX pressure.

**Step 5: Odds scenarios + validate.**

Reference `world_prediction_odds` (cross-ref `du-doan-fed`) + `macro_events_vn` for context. Only state premium + drivers + odds scenarios, no point forecasts.

## Template

ALWAYS use this exact verdict structure: world price + 3-line TA · premium % + VN gold frame forecast (with the world / against the world when the premium widens) · rates at both ends + FX implications · odds scenarios · NO point price forecast.

## Examples

**Example 1 (live 02-10-2026, no new fabricated numbers):**
Input: Vàng SJC hôm nay đắt hơn thế giới bao nhiêu
Output: VÀNG MIẾNG SJC 999.9 (BTMC live) · XAUUSD 4,195 · USDVND 25,970 (MSN) · SBV 4.5% tái cấp vốn · Fed giữ 74.5% → premium % number + assumption + 2 drivers, ≤10 calls.
