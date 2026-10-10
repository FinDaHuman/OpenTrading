---
name: dinh-gia-chuyen-sau
description: "Tính vùng giá hợp lý và % upside/downside của một mã (P/E, P/B so với lịch sử 2–3 năm). Dùng khi hỏi mã đắt hay rẻ, fair value, còn upside không."
activation: auto
requires_tools: [mcp__opentrading__valuation_run]
triggers:
  keywords: [định giá, fair value, dcf, per, đắt hay rẻ, upside, giá mục tiêu tự tính, valuation]
version: 1.3.0
---

# Định giá một mã

Trả về đúng 6 mục: giá vs vùng fair → PER/PB vs lịch sử → vì sao rẻ/đắt → UPSIDE/DOWNSIDE % → neo target CTCK → kết luận 1 câu. EPS âm (công ty lỗ) thì per_pb vô nghĩa — nói thẳng không đủ cơ sở định giá thay vì bịa fair value.

## Khi nào dùng

- Dùng khi: user hỏi định giá 1 mã (`FPT đắt chưa`, `VCB fair value`, `định giá theo PER`, `upside còn bao nhiêu`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - So sánh nhiều mã → `so-sanh-cung-nganh`.
  - Cơ bản thuần (BCTC, M-Score, sở hữu) → `co-ban-chuyen-sau`.
  - Kỹ thuật thuần → `ky-thuat-chuyen-sau`.
  - Giá mục tiêu của CTCK (tổng hợp báo cáo sẵn có) → `tim-co-hoi-bao-cao-ctck` (chỉ cross-ref để neo kỳ vọng, không thay thế định giá tự tính).

## Các bước

**Bước 1: Fair value lõi (song song, gọi trực tiếp).**

Chạy `valuation_run` (symbol, method mặc định auto — chỉ đổi method khi user khăng khăng) + `vs_overview_trading` (symbol).

**Bước 2: Neo lịch sử (song song, gọi trực tiếp).**

Chạy `financial_ratios` (symbol) + `vn_quote_history` (symbol, days=365), tự tính PER/PB trung bình 2–3 năm. Thiếu lịch sử giá thì bỏ so lịch sử, verdict partial + ghi thiếu.

**Bước 3: Bối cảnh lãi suất (chỉ khi cần).**

Chạy `yf_yield_curve` + `vs_trading_info` khi mã PB-heavy (bank). Có fair value + so lịch sử thì dừng, không mở Bước 3 để câu giờ. Một `method` mỗi run; `method` sai enum → warning → về auto, không retry method lạ.

**Bước 4: Validate trước khi chốt.**

Không tự dựng lại DCF (đã tính sẵn trong `valuation_run`). Không gọi `signals_technical` / `financial_detail` / `stock_forensic` ở đây; cần chất lượng cơ bản thì cross-ref `co-ban-chuyen-sau`, không gọi lại tool của skill đó. Bank ưu tiên per_pb, ghi rõ lý do.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau, mỗi mục ghi số + trend + provenance:

1. Giá hiện tại vs vùng fair: method nào dẫn, chênh bao nhiêu % (`provenance: valuation_run` + `vs_overview_trading`).
2. PER/PB hiện tại vs trung bình 2–3 năm tự tính (`provenance: financial_ratios` + `vn_quote_history`).
3. Rẻ/đắt vì sao: tăng trưởng + chất lượng (cross-ref `co-ban-chuyen-sau`) + lãi suất.
4. UPSIDE/DOWNSIDE % + độ tin (cao nếu 2 method đồng thuận).
5. Dòng neo kỳ vọng: upside theo target CTCK (`provenance: tim-co-hoi-bao-cao-ctck` cross-ref, chỉ tham chiếu).
6. Kết luận 1 câu: ĐẮT/HỢP LÝ/RẺ + UPSIDE/DOWNSIDE %.

## Ví dụ

**Ví dụ 1:**
Hỏi: FPT đắt chưa
Đạt khi: UPSIDE % + so lịch sử 2 dòng, ≤7 calls.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`. Hình hợp với dữ liệu skill này: multiline PER hiện vs TB, bar PER/PB history, bar diverging upside.
