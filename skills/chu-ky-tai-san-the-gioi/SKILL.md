---
name: chu-ky-tai-san-the-gioi
description: "Định vị pha chu kỳ tài sản toàn cầu (cổ phiếu, trái phiếu, hàng hoá, vàng, USD, BTC) từ lợi suất theo pha, tương quan cổ phiếu–trái phiếu và outlook các quỹ lớn. Dùng khi hỏi phân bổ tài sản toàn cầu."
activation: auto
triggers:
  keywords: [tài sản toàn cầu, global allocation, investment clock, stock bond correlation, suy thoái mỹ, recession mỹ, nber, all weather, risk parity, outlook jpmorgan blackrock, overweight underweight]
requires_tools: [g_asset_check]
uses_tools: [g_asset_check, g_asset_seasonality, g_asset_phase, g_asset_corr, g_asset_outlook]
version: 1.1.0
---

# Chu kỳ tài sản toàn cầu (multi-asset)

Skill suy luận pha toàn cầu từ ML Clock + mốc suy thoái NBER + 17 ETF đại diện các nhóm tài sản. Số liệu sống trong PG (`g_asset_*`), tra bằng tools — file này chỉ giữ logic.

## Khi nào dùng

- Dùng khi: user hỏi phân bổ tài sản global, Mỹ suy thoái hay chưa, stock-bond correlation regime nào, outlook banks/quỹ lớn, nhóm nào dẫn theo pha NBER.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Tài sản VN → dùng `chu-ky-tai-san-vn` / `dinh-vi-chu-ky-vn`.
  - Fed policy odds thuần → dùng `du-doan-fed`.
  - Vĩ mô quốc tế chi tiết → dùng `danh-gia-vi-mo-quoc-te`.

## Các bước

**Bước 0: Kiểm tra độ tươi.**

Gọi `g_asset_check`.
- `as_of` rỗng hoặc bảng không có dòng nào → **chưa có dữ liệu**: dừng, báo "chưa có dữ liệu chu kỳ trên server", không kết luận pha, không dùng con số nào trong `references/` thay thế.
- Stale (>90 ngày) → cảnh báo + đề xuất refresh theo `references/refresh.md` (tool ghi, tìm bằng `tool_search`; user đồng ý mới chạy).
- Outlook (`g_asset_outlook`) cập nhật thủ công theo quý — luôn nêu quý của nhận định khi trích; bảng trống thì bỏ Bước 3.

**Bước 1: Định pha (song song).**

Tra `g_asset_phase`: so lợi suất theo pha Early/Late/Mid/Recession, đọc số từ bảng. **Caveat bắt buộc**: Early/Late/Recession hiện chỉ có 1 suy thoái (2020) trong dữ liệu, mẫu rất nhỏ — chỉ pha Mid đủ mẫu để tin; không gọi kết quả các pha kia là "đã kiểm chứng". Tra `g_asset_corr(regime="post22")` kiểm tra stock-bond correlation hiện tại (dương từ 2022 = bonds không còn hedge tốt).

**Bước 2: Mùa vụ + sự kiện (song song).**

Tra `g_asset_seasonality(month=<M>)` cho tháng hiện tại; số lấy từ bảng, không dùng tháng mạnh/yếu nhớ sẵn.

**Bước 3: Đối chiếu street (song song).**

Tra `g_asset_outlook` nhận định mới nhất (JPM/BlackRock/GS/MS/BofA/PIMCO...): tăng/giảm tỷ trọng (OW/UW) nhóm nào, mục tiêu số nào, quý nào. Street là đối trọng với thống kê, không phải chân lý — nêu cả hai khi mâu thuẫn.

**Bước 4: Kết luận tilt phân bổ.**

Verdict pha + nghiêng phân bổ (tăng/giảm tỷ trọng theo nhóm, không picking mã/ETF cụ thể trừ khi user hỏi) + bằng chứng (provenance tool) + caveat NBER-mỏng + regime hiện tại.

## Cấu trúc câu trả lời

Độ tươi bảng + quarter outlook · verdict pha · bằng chứng (phase table + corr regime + seasonality) · tilt gợi ý · đối chiếu street (đồng/thuận + mâu thuẫn) · caveat mẫu NBER nhỏ.

## File tham khảo

| File | Trả lời câu hỏi |
|---|---|
| `references/ml-clock.md` | 4 pha ML Clock + mapping tài sản + hạn chế đã biết |
| `references/regime-guide.md` | Đọc corr regimes (pre22/post22), stock-bond flip, BTC-gold spike |
| `references/refresh.md` | Khi nào + cách refresh qua tools + changelog |
