---
name: chu-ky-tai-san-vn
description: "Định vị pha chu kỳ đa tài sản VN (cổ phiếu, trái phiếu, tiết kiệm, vàng, USD, phái sinh) từ dòng tiền liên thị trường, mùa vụ và lãi suất SBV. Dùng khi hỏi tiền đang chảy giữa các lớp tài sản VN thế nào."
activation: auto
triggers:
  keywords: [tài sản việt nam, luân chuyển tiền, dòng tiền liên thị trường, lãi suất tiết kiệm, trái phiếu doanh nghiệp, maturity wall, basis phái sinh, tiền rẻ, stagflation việt nam]
requires_tools: [vn_asset_check]
uses_tools: [vn_asset_check, vn_asset_seasonality, vn_asset_anchors, vn_asset_chains, vn_index_ohlcv, vn_futures_ohlcv, sbv_rates, breadth_scan]
version: 1.1.0
---

# Chu kỳ tài sản Việt Nam (multi-asset)

Skill suy luận pha tiền tệ/tài sản VN từ 6 chuỗi giá (VNINDEX, vàng, USDVND, xăng RON95, BTC, Brent) + các mốc báo cáo kỳ (lãi gửi, lợi suất TPCP, đáo hạn TPDN, chênh lệch SJC, khối ngoại). Số liệu sống trong PG (`vn_asset_*`), tra bằng tools — file này chỉ giữ logic. Chi tiết mảng cổ phiếu → cross-ref skill `dinh-vi-chu-ky-vn`.

## Khi nào dùng

- Dùng khi: user hỏi tiền đang chảy đi đâu giữa CK/tiết kiệm/vàng/USD/trái phiếu, spread SJC nói gì, wall TPDN có nguy hiểm không, basis phái sinh báo gì, nên trú ẩn ở đâu.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chi tiết sóng ngành cổ phiếu → dùng `dinh-vi-chu-ky-vn`.
  - Số vĩ mô GDP/CPI/XNK → dùng `danh-gia-vi-mo-viet-nam`.
  - Backtest chiến lược → dùng `kiem-chien-luoc-backtest`.
  - Tài sản toàn cầu → dùng `chu-ky-tai-san-the-gioi`.

## Các bước

**Bước 0: Kiểm tra độ tươi.**

Gọi `vn_asset_check`.
- `as_of` rỗng hoặc bảng không có dòng nào → **chưa có dữ liệu**: dừng, báo "chưa có dữ liệu chu kỳ trên server", không kết luận pha, không dùng con số nào trong `references/` thay thế.
- Stale (>90 ngày) → cảnh báo + đề xuất refresh theo `references/refresh.md` (tool ghi, tìm bằng `tool_search`; user đồng ý mới chạy). Không kết luận chắc chắn khi bảng cũ.

**Bước 1: Đọc dòng tiền liên thị trường (song song).**

Tra `vn_asset_seasonality` tháng hiện tại cho VNINDEX/GOLD_W/USDVND/RON95/BTC/BRENT + `vn_asset_anchors` (lãi gửi, TPCP yields, TPDN wall, spread SJC, foreign). Ghép thành vòng tiền: tiền rẻ (lãi gửi thấp, SBV nới) → CK; CK nóng + USD căng + spread SJC giãn → Overheat (vàng/USD/BĐS); TPDN wall + margin stress → phân phối; suy thoái → tiết kiệm/USD/vàng.

**Bước 2: Tín hiệu dẫn dắt (tuần tự).**

Tra `vn_asset_chains`: BTC tháng mạnh và Brent tăng là 2 tín hiệu dẫn trong bảng (kiểm hit-rate và số mẫu trong kết quả tool trước khi dùng). USD/vàng chỉ đọc cùng thời điểm, không dùng để dự báo (đồng mất giá + khối ngoại bán = giảm tỷ trọng CK).

**Bước 3: Mùa vụ + sự kiện (song song).**

Tháng hiện tại tra `vn_asset_seasonality` (số lấy từ bảng, không dùng tháng nhớ sẵn). Basis VN30F1M nếu cần: `vn_futures_ohlcv` (VN30F1M) trừ `vn_index_ohlcv` (VN30) cùng phiên; discount sâu + thanh khoản lớn = vùng đáy.

**Bước 4: Kết luận pha + gợi ý lớp tài sản.**

Verdict 1 dòng + độ tin cậy + bằng chứng (mỗi số kèm provenance tool) + 1–2 lớp gợi ý. CẤM picking mã cụ thể. Anchors (TPDN wall, spread SJC, lãi gửi) luôn ghi kèm nguồn từ `vn_asset_anchors`.

## Cấu trúc câu trả lời

Độ tươi bảng · verdict pha · bằng chứng dòng tiền (anchors kèm nguồn) · lớp gợi ý · caveat (anchors là báo cáo kỳ, không daily; margin aggregate không tồn tại công khai).

## File tham khảo

| File | Trả lời câu hỏi |
|---|---|
| `references/flow-map.md` | Vòng luân chuyển tiền VN + ngưỡng trigger từng mắt xích |
| `references/anchors-guide.md` | Đọc anchors (TPDN wall, spread SJC, lãi gửi, foreign) + provenance |
| `references/refresh.md` | Khi nào + cách refresh qua tools + changelog |
