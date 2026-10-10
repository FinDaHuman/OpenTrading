---
name: chu-ky-tai-san-the-gioi
description: "Xác định pha chu kỳ tài sản toàn cầu (ML Clock + NBER) trên 14 nhóm (cổ phiếu/bonds/credit/commodities/vàng/REITs/infra/USD/BTC) từ returns theo pha + regime tương quan + outlook banks, rồi suy ra tilt phân bổ."
when_to_use: Câu hỏi về chu kỳ tài sản thế giới, phân bổ global (US/EM/bonds/vàng/BTC), stock-bond correlation regime, outlook các nhà băng/quỹ lớn, NBER-phase returns.
activation: auto
triggers:
  keywords: [tài sản toàn cầu, global allocation, investment clock, stock bond correlation, suy thoái mỹ, recession mỹ, nber, ally weather, risk parity, outlook jpmorgan blackrock, overweight underweight]
requires_tools: [g_asset_check, g_asset_seasonality, g_asset_phase, g_asset_corr, g_asset_outlook, g_asset_refresh]
version: 1.0.0
---

# Chu kỳ tài sản toàn cầu (multi-asset)

Skill suy luận pha toàn cầu từ ML Clock quadrants + NBER dating + 14 nhóm tài sản. Số liệu sống trong PG (`g_asset_*`), tra bằng tools — file này chỉ giữ logic.

## Khi nào dùng

- Dùng khi: user hỏi phân bổ tài sản global, Mỹ suy thoái hay chưa, stock-bond correlation regime nào, outlook banks/quỹ lớn, nhóm nào dẫn theo pha NBER.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Tài sản VN → dùng `chu-ky-tai-san-vn` / `dinh-vi-chu-ky-vn`.
  - Fed policy odds thuần → dùng `du-doan-fed`.
  - Vĩ mô quốc tế chi tiết → dùng `danh-gia-vi-mo-quoc-te`.

## Các bước

**Bước 0: Kiểm tra độ tươi.**

Gọi `g_asset_check`. Stale (>90 ngày) → cảnh báo + đề xuất `g_asset_refresh` (user đồng ý mới chạy). Outlook (`g_asset_outlook`) refresh thủ công theo quý — luôn nêu quarter của calls khi trích.

**Bước 1: Định pha (song song).**

Tra `g_asset_phase`: so returns Early/Late/Mid/Recession. Kinh điển đã verify: bonds dài + vàng tốt nhất Late; commodities chỉ thắng Early; cash không bao giờ thắng tuyệt đối. **Caveat bắt buộc**: Early/Late/Recession chỉ từ 1 suy thoái (2020), n nhỏ — Mid (n~176) mới robust. Tra `g_asset_corr(regime="post22")` kiểm tra stock-bond correlation hiện tại (dương từ 2022 = bonds không còn hedge tốt).

**Bước 2: Mùa vụ + sự kiện (song song).**

Tra `g_asset_seasonality(month=<M>)`: SPY T7/T11, vàng T1/T8/T12, BTC T10, bonds T5–T8, commodities T7/T1 (T5 yếu).

**Bước 3: Đối chiếu street (song song).**

Tra `g_asset_outlook` calls mới nhất (JPM/BlackRock/GS/MS/BofA/PIMCO...): OW/UW gì, target số nào, quarter nào. Street là đối trọng với thống kê, không phải chân lý — nêu cả hai khi mâu thuẫn.

**Bước 4: Kết luận tilt phân bổ.**

Verdict pha + tilt (OW/UW theo nhóm, không picking mã/ETF cụ thể trừ khi user hỏi) + bằng chứng (provenance tool) + caveat NBER-mỏng + regime hiện tại.

## Cấu trúc câu trả lời

Độ tươi bảng + quarter outlook · verdict pha · bằng chứng (phase table + corr regime + seasonality) · tilt gợi ý · đối chiếu street (đồng/thuận + mâu thuẫn) · caveat mẫu NBER nhỏ.

## Reference files

| File | Trả lời câu hỏi |
|---|---|
| `references/ml-clock.md` | 4 pha ML Clock + mapping tài sản + hạn chế đã biết |
| `references/regime-guide.md` | Đọc corr regimes (pre22/post22), stock-bond flip, BTC-gold spike |
| `references/refresh.md` | Khi nào + cách refresh qua tools + changelog |
