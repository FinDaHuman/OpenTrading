---
name: phan-tich-vang-ty-gia
description: Phân tích vàng SJC/thế giới, tỷ giá USDVND — premium, trend, điều khiển, khung dự báo.
when_to_use: "Vàng SJC đắt hơn thế giới bao nhiêu, tỷ giá áp lực. Không dùng khi: lãi suất điều hành VN chung (danh-gia-vi-mo-viet-nam), crypto (nhip-dap-crypto)."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
tool_budget: 10
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd]
version: 1.0.0
---

# Phân tích vàng & tỷ giá

## Workflow

| Wave | Tools |
|---|---|
| 1 | `vn_retail_gold`(SJC+nhẫn) · `vn_msn_fx_gold`(XAUUSD+USDVND) · `sbv_rates` |
| 2 | `yf_commodities`(GC) · `fred_series`(DGS10) · `world_prediction_odds`(fed) |
| 3 | `vn_forex_ohlcv`(USDVND path) · `macro_events_vn` · `vn_retail_fx`(spreads VCB) |

## Verdict

Premium SJC vs thế giới (qui đổi, ghi giả định tính thuế/phí) · trend tỷ giá + khoảng cách
trần · điều khiển (DGS10, Fed odds, SBV) · dự báo KHUNG (không point-forecast).

## Chống tràn lan

- 1 call `yf_commodities` (đã gồm GC+DXY) thay vì tick riêng lẻ.

## Bằng chứng live (02-10-2026)

VÀNG MIẾNG SJC 999.9 (BTMC live) · XAUUSD 4,195 · USDVND 25,970 (MSN) · SBV 4.5% tái cấp vốn · Fed giữ 74.5%.

## Nghiệm thu

"Vàng SJC hôm nay đắt hơn thế giới bao nhiêu" → số premium % + giả định + 2 driver.
