---
name: phan-tich-vang-ty-gia
description: "Phân tích vàng SJC, chênh lệch với giá thế giới, tỷ giá USDVND và lãi suất SBV–Fed. Dùng khi hỏi giá vàng, premium vàng, áp lực tỷ giá."
activation: auto
requires_tools: [mcp__opentrading__vn_retail_gold]
triggers:
  keywords: [vàng sjc, vàng miếng, giá vàng, usdvnd, tỷ giá, premium vàng, vàng thế giới, xauusd, dự đoán vàng]
version: 1.3.0
---

# Vàng và tỷ giá

Trả về: giá TG + TA 3 dòng · premium % + dự đoán khung vàng VN (theo TG / ngược TG khi premium nở) · lãi suất 2 đầu + hàm ý tỷ giá · kịch bản odds. Không point-forecast giá cụ thể ("vàng sẽ lên X triệu") — chỉ nêu premium + driver + kịch bản odds.

## Khi nào dùng

- Dùng khi: user hỏi giá vàng SJC/vàng miếng, chênh lệch (premium) VN–TG, giá vàng thế giới + TA vàng, áp lực tỷ giá USDVND, dự đoán khung vàng VN, lãi suất 2 đầu SBV–Fed và hàm ý tỷ giá.
- Khi KHÔNG dùng (dùng skill khác thay thế): lãi suất điều hành VN chung (chỉ dùng `danh-gia-vi-mo-viet-nam`); nhịp đập crypto (chỉ dùng `nhip-dap-crypto`); TA mã chứng khoán VN (chỉ dùng `ky-thuat-chuyen-sau`).

## Các bước

**Bước 1: Giá vàng quốc tế + TA vàng.**

Chạy `yf_commodities` (GC — 1 call đã gồm GC+DXY, không tách tick riêng lẻ) + `vn_msn_fx_gold`. Đọc trend/momentum trên nến daily (giá vs SMA20/50 + RSI ước từ series). `signals_technical` chỉ hỗ trợ mã VN — không ép dùng cho GC=F, đọc TA từ series có sẵn.

**Bước 2: Rủi ro địa chính trị (cross-ref, không gọi lại).**

Tham chiếu `danh-gia-tinh-hinh-xung-dot` / `bat-on-quoc-gia` nếu vừa chạy ở skill trước (leo thang = vàng lên); không gọi lại tốn budget.

**Bước 3: So lệch VN–TG → premium.**

Chạy `vn_retail_gold` (SJC mua/bán). Premium = (SJC mua vào − giá TG quy đổi) / giá TG — bắt buộc ghi giả định quy đổi đơn vị (SJC VND/lượng vs XAUUSD USD/oz). Premium nở = vàng VN khó giảm theo TG.

**Bước 4: Lãi suất 2 đầu.**

Chạy `sbv_rates` + `fred_series` (DGS10) + `yf_yield_curve`: SBV (tái cấp vốn/chiết khấu) vs US (DGS10/curve) — chênh lệch hút vốn, hàm ý tỷ giá.

**Bước 5: Kịch bản odds + validate.**

Tham chiếu `world_prediction_odds` (cross-ref `du-doan-fed`) + `macro_events_vn` cho bối cảnh. Chỉ nêu premium + driver + kịch bản odds, không point-forecast.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau: giá TG + TA 3 dòng · premium % + dự đoán khung vàng VN (theo TG / ngược TG khi premium nở) · lãi suất 2 đầu + hàm ý tỷ giá · kịch bản odds · KHÔNG point-forecast giá.

## Ví dụ

**Ví dụ 1:**
Hỏi: Vàng SJC hôm nay đắt hơn thế giới bao nhiêu
Đạt khi: số premium % + giả định + 2 driver, ≤10 calls.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: candlestick/line giá vàng, multiline SMA, bar diverging premium/rate gap.
