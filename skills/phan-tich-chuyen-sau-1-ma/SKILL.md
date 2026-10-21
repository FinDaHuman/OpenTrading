---
name: phan-tich-chuyen-sau-1-ma
description: "Điều phối phân tích toàn diện một mã: mã, ngành, tin, sự kiện, rồi kỹ thuật và định giá, gộp thành bảng tích cực/tiêu cực/động lực. Dùng khi hỏi \"phân tích FPT\", \"VCB thế nào\"."
activation: auto
requires_tools: [symbol_lookup, financial_detail]
uses_tools: [symbol_lookup, symbol_resolve, vn_company, vs_company_info, vs_industry_tree, financial_detail, news_symbol, company_events, event_calendar_vn, evidence_bundle]
triggers:
  keywords: [kỹ thuật định giá, phân tích cổ phiếu, phân tích mã, phân tích toàn diện, chi tiết mã, mã này sao]
version: 1.4.0
---

# Phân tích toàn diện một mã

Skill điều phối: tự làm nhận diện mã + ngành + tin + sự kiện, giao kỹ thuật và định giá cho 2 subagent chạy song song, rồi gộp kết luận.

## Khi nào dùng

- Dùng khi: user yêu cầu phân tích toàn diện 1 mã (`phân tích FPT`, `VCB thế nào`, `mã này sao`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Chỉ hỏi kỹ thuật (RSI, breakout, đa khung, higher-high/lower-low) → `ky-thuat-chuyen-sau`.
  - Chỉ hỏi BCTC/cơ bản (M-Score, cổ đông, cổ tức) → `co-ban-chuyen-sau`.
  - Chỉ hỏi định giá (fair value, PER, upside) → `dinh-gia-chuyen-sau`.
  - So sánh 2-6 mã cùng ngành → `so-sanh-cung-nganh`.
  - Đánh giá setup trước khi BCTC ra → `danh-gia-truoc-bctc`.

## Các bước

Khoảng 7 bước model: nạp skill, 5 lượt gọi tool (mỗi lượt gọi song song), trả lời. Kỹ thuật và định giá chạy trong subagent nên không tốn bước của lượt chính.

**Bước 1: Xác định mã.**

Chạy `symbol_lookup` (tên công ty) hoặc `symbol_resolve` (mã đa loại, có xếp hạng). Mã nhập nhằng (vàng/BTC/USD) thì bắt buộc `symbol_resolve` trước. `symbol_resolve` trả nhiều ứng viên → chọn hạng cao nhất và ghi rõ đã resolve từ tên nào sang mã nào; thiếu mã thì dừng và hỏi lại, không đoán mã. Cổ phiếu VN → tools `vn_*`/`vs_*`; crypto → `crypto_spot`.

**Bước 2: Ngành + kiếm tiền nhờ đâu (song song).**

Chạy `vn_company` · `vs_company_info` · `vs_industry_tree`. Lấy ngành GICS, mô hình kinh doanh, nguồn thu chính. Mã chưa phân loại ngành (`vs_industry_tree` không match) → ghi "chưa phân loại", vẫn làm các bước còn lại.

**Bước 3: Kỹ thuật + định giá bằng 2 subagent chạy song song.**

Gọi `spawn_subagent` hai lần trong cùng một lượt (loại `nghien-cuu`): một subagent nạp `ky-thuat-chuyen-sau`, một subagent nạp `dinh-gia-chuyen-sau`, cùng mã ở Bước 1. Yêu cầu mỗi subagent trả về 5–8 dòng có số, khung thời gian và tên tool nguồn. Không gọi trực tiếp `signals_technical` / `valuation_run` / `stock_forensic` ở lượt chính.

**Bước 4: Lợi nhuận quý + tin + sự kiện (song song, cùng lượt với Bước 3 nếu được).**

Chạy `financial_detail` (KQKD 4 quý + so QoQ/YoY/biên — không đào sâu M-Score/F-score, đó là việc của `co-ban-chuyen-sau`), `news_symbol` + `company_events` (tin + công bố), `event_calendar_vn` (lịch 30–90 ngày: BCTC/ĐHĐCĐ/cổ tức).

**Bước 5: Tổng hợp + kiểm chứng.**

Chạy `evidence_bundle` để khóa kết luận thành bảng Tích cực / Tiêu cực / Động lực tương lai. Một subagent lỗi thì vẫn ra kết luận với phần còn lại và ghi rõ phần thiếu, không bù số. User hỏi một chiều (`RSI FPT`) thì dùng thẳng sub-skill tương ứng, không chạy đủ các bước. Đủ dữ liệu ra bảng 3 cột thì dừng, không gọi thêm vòng tin/sự kiện thứ hai.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình; tối đa 1 biểu đồ. Vẽ bằng `chart_render` với `from_call` trỏ vào kết quả nến hoặc `financial_detail` đã có (mã `[ref …]`), không lấy thêm dữ liệu chỉ để vẽ; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: nến + khối lượng, stacked DT/LN theo quý.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + trend + provenance (tool/sub-skill nào ra số đó):

1. Nhận định 1 câu (khuyến nghị/tone chính).
2. Ngành + cách kiếm tiền (2 dòng, từ Bước 2).
3. Kỹ thuật (`provenance: ky-thuat-chuyen-sau`, từ subagent, kèm khung 1D/1W).
4. Định giá (`provenance: dinh-gia-chuyen-sau`, từ subagent, kèm UPSIDE/DOWNSIDE % nếu có).
5. Lợi nhuận quý (số DT/LN 4 quý + trend QoQ/YoY + biên, từ `financial_detail` Bước 4).
6. Tin + sự kiện sắp tới (từ `news_symbol` / `company_events` / `event_calendar_vn`).
7. Bảng Tích cực / Tiêu cực / Động lực tương lai (3 cột, khóa bằng `evidence_bundle`).
8. Kết luận 1 câu chốt lại toàn mã.

## Ví dụ

**Ví dụ 1:**
Hỏi: Phân tích FPT
Đạt khi: đủ các mục ở trên, có bảng 3 cột tích cực/tiêu cực/động lực; số kỹ thuật và định giá lấy từ 2 subagent, không bịa số tại skill này.
