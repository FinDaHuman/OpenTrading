---
name: du-doan-fed
description: "Đọc xác suất và kịch bản lãi suất Fed kỳ tới, đường cong lợi suất, lịch FOMC và hàm ý cho VN. Dùng khi hỏi Fed, FOMC, dot plot."
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
triggers:
  keywords: [fed, fomc, cắt giảm lãi suất, dot plot, xác suất fed, lãi suất mỹ]
version: 1.3.0
---

# Dự đoán quyết định của Fed

Trả về đúng 5 mục: xác suất từng kịch bản → đường cong → lịch FOMC → biến số theo dõi → hàm ý VN. Chỉ drill 1 event Fed chính (slug mới nhất, đã sort vol24h) — không bắn 5 query biến thể.

## Khi nào dùng

- Dùng khi: user hỏi Fed kỳ tới (cắt/giữ/tăng), FOMC, dot plot, xác suất odds + đường cong + hàm ý VN.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Bối cảnh vĩ mô Mỹ chung (chu kỳ, việc làm, risk regime) không cần odds → dùng `danh-gia-vi-mo-quoc-te`.
  - Odds chủ đề ngoài Fed (bầu cử, BTC...) → dùng `du-doan-polymarket`.
  - Bản đồ rủi ro chính trị rộng → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Các bước

**Bước 1: Odds Fed (bắt buộc).**

Chạy `world_prediction_odds` (query=fed). Có prob ≥2 kịch bản + lịch họp là đủ verdict; Bước 3 sau đó chỉ để xác minh.

**Bước 2: Drill-down + macro (song song, tuần tự sau Bước 1).**

Chạy `polymarket_event` (slug fed-decision-*) + `fred_series` (DGS10, thêm EFFR/DFII nếu cần). Không drill quá 1 slug Fed/run.

**Bước 3: Curve + xác minh (song song, tuần tự sau Bước 2).**

Chạy `yf_yield_curve` + `web_fetch` (chỉ statement/nguồn chính thức fed.gov trong odds).

**Bước 4: Validate trước khi chốt.**

Odds stale (end-date qua) → lọc `end > today`, bỏ event hết hạn, retry 1 lần query fed mới. Gamma chết cả proxy + direct thì ghi rõ "không có odds", không thay bằng nhận định riêng. Curve flaky → retry tối đa 1 lần sau backoff rồi bỏ, ghi chú thiếu curve. `fred_series` tối đa 3 series ngoài Fed thì dừng.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. **Xác suất từng kịch bản:** cắt/giữ/tăng, mỗi kịch bản prob_pct (đơn vị %) + volume (USD) + end-date + URL event.
2. **Đường cong ám chỉ:** US10Y/2Y (đơn vị %) + inverted hay không + URL.
3. **Lịch FOMC kế tiếp:** ngày họp (đơn vị ngày/tháng) + nguồn fed.gov URL.
4. **Biến số theo dõi:** CPI Mỹ, jobs, đơn vị %/K jobs + URL.
5. **Hàm ý cho VN:** tỷ giá/lãi suất, 1–2 dòng + URL.

## Ví dụ

**Ví dụ 1:**
Hỏi: Fed tháng tới
Đạt khi: prob ≥2 kịch bản + lịch họp + 1 dòng hàm ý VN.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: bar odds per scenario, multiline 10Y/2Y, line yield curve.
