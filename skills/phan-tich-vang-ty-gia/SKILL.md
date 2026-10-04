---
name: phan-tich-vang-ty-gia
description: Phân tích vàng SJC/thế giới, tỷ giá USDVND — giá TG + TA vàng + địa chính trị, so lệch VN–TG, lãi suất 2 đầu, polymarket, macro.
when_to_use: "Vàng SJC đắt hơn thế giới bao nhiêu, tỷ giá áp lực, dự đoán vàng VN. Không dùng khi: lãi suất điều hành VN chung (danh-gia-vi-mo-viet-nam), crypto (nhip-dap-crypto)."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
tool_budget: 10
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd, dự đoán vàng]
version: 1.1.0
---

# Phân tích vàng & tỷ giá

## Workflow

| # | Điểm | Tools |
|---|---|---|
| 1. Giá vàng quốc tế + TA vàng | Giá XAUUSD + đọc trend/momentum trên nến daily (giá vs SMA20/50 + RSI ước từ series `yf_commodities`) | `yf_commodities`(GC) · `vn_msn_fx_gold` |
| 2. Rủi ro địa chính trị + xung đột | Yếu tố đẩy giá vàng (leo thang = vàng lên) | cross-ref danh-gia-tinh-hinh-xung-dot / bat-on-quoc-gia (không gọi lại nếu vừa chạy) |
| 3. So lệch VN–TG → dự đoán vàng VN | Premium = (SJC mua vào − giá TG quy đổi) / giá TG; premium nở = vàng VN khó giảm theo TG | `vn_retail_gold` (SJC mua/bán) + giá TG wave 1 |
| 4. Lãi suất 2 đầu | SBV (tái cấp vốn/chiết khấu) vs US (DGS10/curve) — chênh lệch hút vốn | `sbv_rates` · `fred_series`(DGS10) · `yf_yield_curve` |
| 5. Dự đoán + macro | Odds Fed/căng thẳng + bối cảnh vĩ mô | `world_prediction_odds` (cross-ref du-doan-fed) · `macro_events_vn` |

## Verdict

Giá TG + TA 3 dòng · premium % + dự đoán vàng VN (theo TG / ngược TG khi premium nở) ·
lãi suất 2 đầu + hàm ý tỷ giá · kịch bản odds · KHÔNG point-forecast giá.

## Chống tràn lan

- 1 call `yf_commodities` (đã gồm GC+DXY) thay vì tick riêng lẻ.
- TA vàng đọc từ series có sẵn; `signals_technical` chỉ hỗ trợ mã VN — không ép dùng cho GC=F.

## Bằng chứng live (02-10-2026)

VÀNG MIẾNG SJC 999.9 (BTMC live) · XAUUSD 4,195 · USDVND 25,970 (MSN) · SBV 4.5% tái cấp vốn · Fed giữ 74.5%.

## Nghiệm thu

"Vàng SJC hôm nay đắt hơn thế giới bao nhiêu" → số premium % + giả định + 2 driver.
