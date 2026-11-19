---
name: phan-tich-vang-ty-gia
description: "Analyses SJC gold, its gap to the world price, the USDVND rate and SBV–Fed rates. Use for gold prices, the gold premium, exchange-rate pressure."
match_text: "Phân tích vàng SJC, chênh lệch với giá thế giới, tỷ giá USDVND và lãi suất SBV–Fed. Dùng khi hỏi giá vàng, premium vàng, áp lực tỷ giá."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd, dự đoán vàng]
version: 1.3.0
---

# Vàng và tỷ giá

Return: world price + 3 lines of TA · premium % + the expected direction of Vietnamese gold (following the world / against it when the premium widens) · rates at both ends + exchange-rate implications · odds scenarios. No point forecast of a price ("vàng sẽ lên X triệu") — only the premium + drivers + odds scenarios.

## Khi nào dùng

- Use when: the user asks about SJC/bar gold prices, the Vietnam–world gap (premium), world gold prices + gold TA, USDVND pressure, the expected direction of Vietnamese gold, SBV–Fed rates at both ends and exchange-rate implications.
- Do NOT use (use another skill instead): Vietnam's policy rates in general (use `danh-gia-vi-mo-viet-nam` only); crypto (use `nhip-dap-crypto` only); TA of Vietnamese stocks (use `ky-thuat-chuyen-sau` only).

## Các bước

**Bước 1: World gold price + gold TA.**

Run `yf_commodities` (GC — 1 call already includes GC+DXY; do not split ticks) + `vn_msn_fx_gold`. Read trend/momentum on daily candles (price vs SMA20/50 + RSI estimated from the series). `signals_technical` supports only Vietnamese tickers — do not force it on GC=F; read TA from the series you have.

**Bước 2: Geopolitical risk (cross-reference, no new calls).**

Refer to `danh-gia-tinh-hinh-xung-dot` / `bat-on-quoc-gia` if a previous skill just ran them (escalation = gold up); do not call them again and waste budget.

**Bước 3: Vietnam–world gap → premium.**

Run `vn_retail_gold` (SJC buy/sell). Premium = (SJC buy − converted world price) / world price — you must state the unit-conversion assumption (SJC VND/lượng vs XAUUSD USD/oz). A widening premium = Vietnamese gold is slow to fall with the world.

**Bước 4: Rates at both ends.**

Run `sbv_rates` + `fred_series` (DGS10) + `yf_yield_curve`: SBV (refinancing/discount) vs US (DGS10/curve) — the gap drives capital flows and the exchange rate.

**Bước 5: Odds scenarios + validate.**

Refer to `world_prediction_odds` (cross-ref `du-doan-fed`) + `macro_events_vn` for context. Give only the premium + drivers + odds scenarios, no point forecast.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure: world price + 3 lines of TA · premium % + expected direction of Vietnamese gold (following the world / against it when the premium widens) · rates at both ends + exchange-rate implications · odds scenarios · NO point price forecast.

## Ví dụ

**Ví dụ 1:**
Hỏi: Vàng SJC hôm nay đắt hơn thế giới bao nhiêu
Đạt khi: the premium % + assumption + 2 drivers, ≤10 calls.

## Trực quan hóa

Draw only when the user wants a picture, or when a time series / comparison is hard to read as a table; at most 1 chart per answer. Draw with `chart_render` using `from_call` (the `[ref …]` code at the top of a tool result) so you never retype numbers; load `ve-bieu-do` to choose the chart type. Fitting this skill's data: candlestick/line gold price, multiline SMA, bar diverging premium/rate gap.
