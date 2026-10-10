---
name: danh-gia-vi-mo-quoc-te
description: "Đọc chu kỳ kinh tế Mỹ và trạng thái rủi ro toàn cầu (soft/hard landing, đường cong lợi suất, risk-on/off). Dùng khi hỏi bối cảnh vĩ mô Mỹ/thế giới."
activation: auto
requires_tools: [mcp__opentrading__fred_series]
triggers:
  keywords: [kinh tế mỹ, recession, suy thoái kinh tế mỹ, đường cong lợi suất, yield curve, risk-on, risk-off, fed bối cảnh, kinh tế toàn cầu]
version: 1.3.0
---

# Vĩ mô Mỹ và toàn cầu

Đi 3 wave tuần tự (mỗi wave song song bên trong): chu kỳ Mỹ → chế độ rủi ro → xác nhận toàn cầu. FRED gọi theo tên chuẩn; thiếu key thì chuyển nhánh không-FRED thay vì bỏ cả verdict.

## Khi nào dùng

- Dùng khi: user hỏi chu kỳ Mỹ (soft/hard landing), đường cong lợi suất, việc làm/GDP các nước, chế độ rủi ro toàn cầu, so sánh VN-vs-global.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Vĩ mô VN chi tiết (GDP/CPI/XNK/SBV) → dùng `danh-gia-vi-mo-viet-nam`.
  - Xác suất Fed cắt/giữ/tăng thuần odds + lịch FOMC → dùng `du-doan-fed`.

## Các bước

**Bước 1: Chu kỳ Mỹ (song song).**

Chạy `fred_series` (DGS10) + `fred_series` (CPIAUCSL) + `yf_yield_curve`. CẤM đi web_search/web_fetch trước khi gọi tool chuyên — web chỉ bổ sung sau khi đã có số FRED. FRED thiếu key → trả unavailable → chuyển nhánh không-FRED (dùng `yf_yield_curve` + `yf_global_indices`) + ghi chú trung thực thiếu series nào. Curve flaky thì retry tối đa 1 lần sau backoff rồi bỏ.

**Bước 2: Chế độ rủi ro (song song, tuần tự sau Bước 1).**

Chạy `yf_regime_assets` + `assets_rotation` + `world_macro_country` (VN/CHINA theo câu hỏi). Nhóm `yf_*` tối đa 3 calls/wave; không gọi chồng chéo `yf_yield_curve` + `fred_series` quá 1 vòng. `world_macro_country` rỗng thì đổi mã nước 1 lần rồi chấp nhận "ít coverage".

**Bước 3: Xác nhận toàn cầu (song song, tuần tự sau Bước 2).**

Chạy `yf_global_indices` + `yf_commodities` + `world_fear_greed`. Đủ DGS10 + CPI + curve ở Bước 1 mới sang Bước 2; gọi ≥3 FRED series cùng lúc là dấu hiệu tràn lan → dừng.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Chu kỳ Mỹ:** soft/hard landing, dựa DGS10 + CPI + curve, đơn vị % lợi suất + % CPI + URL.
2. **Đường cong:** inverted hay không, chênh 10Y-2Y (đơn vị bps/%) + URL.
3. **Chế độ toàn cầu:** RISK-ON/OFF từ rotation/regime assets + URL.
4. **So VN-vs-global:** bắt buộc 1 dòng so sánh GDP VN (đơn vị % WorldBank) vs global + URL.
5. **Biến số theo dõi:** liệt kê CPI Mỹ, jobs, lợi suất cần watch tiếp theo.

## Ví dụ

**Ví dụ 1:**
Hỏi: Kinh tế Mỹ hiện tại
Trả lời: US10Y <số> / 2Y <số>, không đảo chiều · WorldBank GDP VN <số> · fear/greed crypto <số> (tham lam) → verdict đủ 5 mục, curve + ≥2 series FRED có số.

## Trực quan hóa

Dữ liệu skill này nhận: 10Y/2Y, CPI, fear/greed, curve. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (multiline 10Y/2Y, line CPI/curve, gauge fear/greed), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
