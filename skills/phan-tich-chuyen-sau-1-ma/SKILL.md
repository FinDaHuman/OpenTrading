---
name: phan-tich-chuyen-sau-1-ma
description: "Điều phối phân tích toàn diện một mã: mã, ngành, tin, sự kiện, rồi kỹ thuật và định giá, gộp thành bảng tích cực/tiêu cực/động lực. Dùng khi hỏi \"phân tích FPT\", \"VCB thế nào\"."
activation: auto
requires_tools: [mcp__opentrading__stock_overview]
triggers:
  keywords: [phân tích, phân tích cổ phiếu, phân tích mã, toàn diện, chi tiết mã, mã này sao]
version: 1.3.0
---

# Phân tích toàn diện một mã

Skill điều phối 8 bước: tự làm nhận diện mã + ngành + tin + sự kiện, dispatch kỹ thuật/định giá sang sub-skill, rồi gộp verdict. Budget 8 chỉ đếm tool nhà của skill này; tool của sub-skill nằm trong budget của sub-skill, không cộng dồn.

## Khi nào dùng

- Dùng khi: user yêu cầu phân tích toàn diện 1 mã (`phân tích FPT`, `VCB thế nào`, `mã này sao`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chỉ hỏi kỹ thuật (RSI, breakout, đa khung, higher-high/lower-low) → `ky-thuat-chuyen-sau`.
  - Chỉ hỏi BCTC/cơ bản (M-Score, cổ đông, cổ tức) → `co-ban-chuyen-sau`.
  - Chỉ hỏi định giá (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - So sánh 2-6 mã cùng ngành → `so-sanh-cung-nganh`.
  - Đánh giá setup trước khi BCTC ra → `danh-gia-truoc-bctc`.

## Các bước

**Bước 1: Xác định mã (gọi trực tiếp).**

Chạy `symbol_lookup` (tên công ty) · `symbol_resolve` (mã đa loại, có fallback xếp hạng). Mã nhập nhằng (vàng/BTC/USD) thì bắt buộc `symbol_resolve` trước. `symbol_resolve` trả nhiều ứng viên → chọn hạng cao nhất + ghi rõ đã resolve từ tên nào sang mã nào; thiếu mã thì dừng và hỏi lại, không đoán mã. Sau khi có mã: cổ phiếu VN → nến/tools `vn_*`/`vs_*`; crypto → `crypto_spot` (USD, không dùng `vn_crypto_ohlcv` trừ khi hỏi giá VND).

**Bước 2: Ngành + kiếm tiền nhờ đâu (gọi trực tiếp).**

Chạy `vn_company` · `vs_company_info` · `vs_industry_tree`. Lấy ngành GICS, mô hình kinh doanh, nguồn thu chính. Mã mới chưa phân loại ngành (`vs_industry_tree` không match) → ghi "chưa phân loại", vẫn chạy các bước còn lại.

**Bước 2b: Chart giá (tool local, không tốn budget remote).**

Dùng lại nến đã có trong context (từ Bước 1 `vn_quote_history` hoặc sub-skill kỹ thuật) → nạp skill `ve-bieu-do`, đối chiếu shape và vẽ (chart màu tự hiện trong TUI, chỉ verdict không chép hình). Không fetch lại nến chỉ để vẽ; chưa có nến thì bỏ qua chart, không thêm call data.

## Trực quan hóa

Dữ liệu skill này nhận: chuỗi OHLC/giá (nến 30–90 phiên), P&L 4 quý (DT/LN theo quý). Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (nến+volume, stacked P&L), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.

**Bước 3-4: Dispatch kỹ thuật + định giá (không gọi tool gốc).**

Dispatch `ky-thuat-chuyen-sau` (trạng thái kỹ thuật) và `dinh-gia-chuyen-sau` (định giá). Không bao giờ gọi trực tiếp `signals_technical` / `valuation_run` / `stock_forensic` ở đây để thay thế — ai cần kỹ thuật/định giá thì đi qua sub-skill.

**Bước 5-7: Lợi nhuận quý + tin + sự kiện (gọi trực tiếp).**

Chạy `financial_detail` (chỉ lấy số nhanh KQKD 4 quý + so QoQ/YoY/biên — không đào sâu BCTC/M-Score/F-score, đó là việc của `co-ban-chuyen-sau`), `news_symbol` + `company_events` (tin + công bố), `event_calendar_vn` (lịch 30–90 ngày: BCTC/ĐHĐCĐ/cổ tức).

**Bước 8: Tổng hợp + validate.**

Chạy `evidence_bundle` để khóa verdict thành bảng Tích cực / Tiêu cực / Động lực tương lai. Sub-skill chết 1 chân thì vẫn ra verdict với leg còn sống + ghi rõ leg thiếu, không bù số. User hỏi 1 chiều (`RSI FPT`) thì bắt buộc trả lời bằng sub-skill tương ứng, không chạy đủ 8 bước. Đủ 8 bước hoặc đủ dữ liệu ra bảng 3 cột thì dừng, không gọi thêm vòng tin/sự kiện thứ hai.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + trend + provenance (tool/sub-skill nào ra số đó):

1. Nhận định 1 câu (khuyến nghị/tone chính).
2. Ngành + cách kiếm tiền (2 dòng, từ Bước 2).
3. Kỹ thuật (`provenance: ky-thuat-chuyen-sau`, kèm khung 1D/1W).
4. Định giá (`provenance: dinh-gia-chuyen-sau`, kèm UPSIDE/DOWNSIDE % nếu có).
5. Lợi nhuận quý (số DT/LN 4 quý + trend QoQ/YoY + biên, từ `financial_detail` Bước 5).
6. Tin + sự kiện sắp tới (từ `news_symbol` / `company_events` / `event_calendar_vn`).
7. Bảng Tích cực / Tiêu cực / Động lực tương lai (3 cột, khóa bằng `evidence_bundle`).
8. Chart nến đính kèm (từ Bước 2b, nếu có).
9. Kết luận 1 câu chốt lại toàn mã.

## Ví dụ

**Ví dụ 1:**
Hỏi: Phân tích FPT
Trả lời: đủ 8 bước, có bảng 3 cột tích cực/tiêu cực/động lực, ≤8 calls nhà (chưa tính calls trong sub-skill). Số liệu live nằm ở sub-skill `ky-thuat-chuyen-sau` và `dinh-gia-chuyen-sau` — không bịa số tại skill này.
