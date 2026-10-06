---
name: phan-tich-vang-ty-gia
description: "Phân tích vàng SJC, premium SJC-thế giới, tỷ giá USDVND và lãi suất 2 đầu SBV-Fed (tối đa 10 calls). Luôn dùng skill này khi user hỏi vàng SJC đắt hơn thế giới bao nhiêu, tỷ giá có áp lực không, hay dự đoán khung vàng VN — ngay cả khi user không nói rõ muốn 'phân tích vàng'."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
tool_budget: 10
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd, dự đoán vàng]
version: 1.2.0
---

# Analyzing Gold Premium and USDVND Pressure

Trả về: giá TG + TA 3 dòng · premium % + dự đoán khung vàng VN (theo TG / ngược TG khi premium nở) · lãi suất 2 đầu + hàm ý tỷ giá · kịch bản odds. Không point-forecast giá cụ thể ("vàng sẽ lên X triệu") — chỉ nêu premium + driver + kịch bản odds.

## When to Use

- Dùng khi: user hỏi giá vàng SJC/vàng miếng, chênh lệch (premium) VN–TG, giá vàng thế giới + TA vàng, áp lực tỷ giá USDVND, dự đoán khung vàng VN, lãi suất 2 đầu SBV–Fed và hàm ý tỷ giá.
- Khi KHÔNG dùng (dùng skill khác thay thế): lãi suất điều hành VN chung (chỉ dùng `danh-gia-vi-mo-viet-nam`); nhịp đập crypto (chỉ dùng `nhip-dap-crypto`); TA mã chứng khoán VN (chỉ dùng `ky-thuat-chuyen-sau`).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: giá vàng quốc tế + TA vàng
- [ ] Step 2: rủi ro địa chính trị (cross-ref, không gọi lại)
- [ ] Step 3: so lệch VN–TG → premium
- [ ] Step 4: lãi suất 2 đầu
- [ ] Step 5: kịch bản odds + verdict
```

**Step 1: Giá vàng quốc tế + TA vàng.**

Chạy `yf_commodities` (GC — 1 call đã gồm GC+DXY, không tách tick riêng lẻ) + `vn_msn_fx_gold`. Đọc trend/momentum trên nến daily (giá vs SMA20/50 + RSI ước từ series). `signals_technical` chỉ hỗ trợ mã VN — không ép dùng cho GC=F, đọc TA từ series có sẵn.

**Step 2: Rủi ro địa chính trị (cross-ref, không gọi lại).**

Tham chiếu `danh-gia-tinh-hinh-xung-dot` / `bat-on-quoc-gia` nếu vừa chạy ở skill trước (leo thang = vàng lên); không gọi lại tốn budget.

**Step 3: So lệch VN–TG → premium.**

Chạy `vn_retail_gold` (SJC mua/bán). Premium = (SJC mua vào − giá TG quy đổi) / giá TG — bắt buộc ghi giả định quy đổi đơn vị (SJC VND/lượng vs XAUUSD USD/oz). Premium nở = vàng VN khó giảm theo TG.

**Step 4: Lãi suất 2 đầu.**

Chạy `sbv_rates` + `fred_series` (DGS10) + `yf_yield_curve`: SBV (tái cấp vốn/chiết khấu) vs US (DGS10/curve) — chênh lệch hút vốn, hàm ý tỷ giá.

**Step 5: Kịch bản odds + validate.**

Tham chiếu `world_prediction_odds` (cross-ref `du-doan-fed`) + `macro_events_vn` cho bối cảnh. Chỉ nêu premium + driver + kịch bản odds, không point-forecast.

## Template

ALWAYS use this exact verdict structure: giá TG + TA 3 dòng · premium % + dự đoán khung vàng VN (theo TG / ngược TG khi premium nở) · lãi suất 2 đầu + hàm ý tỷ giá · kịch bản odds · KHÔNG point-forecast giá.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Vàng SJC hôm nay đắt hơn thế giới bao nhiêu
Output: VÀNG MIẾNG SJC 999.9 (BTMC live) · XAUUSD 4,195 · USDVND 25,970 (MSN) · SBV 4.5% tái cấp vốn · Fed giữ 74.5% → số premium % + giả định + 2 driver, ≤10 calls.
