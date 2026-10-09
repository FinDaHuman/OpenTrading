---
name: danh-gia-truoc-bctc
description: "Chấm hạng A/B/C cho một mã trước khi ra BCTC (xu hướng, thao túng, kỳ vọng, đệm định giá). Dùng khi hỏi có nên mua/giữ qua kỳ báo cáo."
activation: auto
requires_tools: [mcp__opentrading__company_events]
triggers:
  keywords: [trước bctc, sắp ra báo cáo, pre earnings, công bố lợi nhuận, setup bctc]
version: 1.3.0
---

# Chấm setup trước BCTC

Chấm grade cho setup trước BCTC. Không forecast KQKD — không bao giờ đưa số DT/LN dự báo. BCTC đã ra rồi thì dừng ngay, chuyển sang `co-ban-chuyen-sau`, không cố chấm grade.

## Khi nào dùng

- Dùng khi: BCTC chưa ra và user hỏi setup trước BCTC (`FPT sắp ra báo cáo`, `đánh giá setup HPG trước BCTC`, `pre-earnings`).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Phân tích mã thường (không gắn BCTC) → `phan-tich-chuyen-sau-1-ma`.
  - BCTC đã công bố, cần đọc số/M-Score → `co-ban-chuyen-sau`.
  - Hỏi kỹ thuật lẻ → `ky-thuat-chuyen-sau`.
  - Hỏi định giá lẻ → `dinh-gia-chuyen-sau`.

## Các bước

**Bước 1: Kiểm tra ngày công bố (chỉ đối chiếu, KHÔNG chốt dated).**

Ngày công bố BCTC tại VN thường KHÔNG công khai chính xác (công ty chỉ báo trước tháng/quý; `event_calendar_vn` không có earnings-date type). Chạy `company_events` + `news_symbol` chỉ để đối chiếu tin lịch công bố nếu user hỏi; nếu không thấy ngày rõ ràng → coi như `unknown ngày`, các leg ghi accordingly và grade tối đa B (đây là mặc định, không cần cố chốt ngày).

**Bước 2: Reuse trend + thao túng (không gọi tool gốc).**

LOAD `co-ban-chuyen-sau` (gọi `load_skill` CHỈ với tên skill — không có file phụ `aspect=...`, aspect là các section trong body; load_skill file lạ sẽ fail). Sau khi load: dùng leg "Chất lượng tăng trưởng" (trend) + leg "M-Score + F-score" (thao túng) từ body skill đó. Lý do reuse thay vì gọi trực tiếp `financial_detail`/`stock_forensic`: tránh gọi chồng chéo cùng nguồn số trong 1 run. Ghi rõ reuse ở từng leg.

**Bước 3: Kỳ vọng + positioning (gọi trực tiếp).**

Chạy `planned_targets` + `analyst_consensus` + `news_symbol` + `sentiment_score` (anchor = kế hoạch DN vì VN không có consensus EPS; sentiment là heuristic, không tính là leg xanh) và `insider_trading` + `money_flow` + `block_trades`. `planned_targets` trả số THẬT từ Vietstock CTKH (chain verified live) nhưng session-gated: Render/không session → `unavailable` — ghi trung thực "thiếu neo kế hoạch", không bịa số kế hoạch.

**Bước 4: Reuse đệm định giá + chấm grade.**

LOAD `dinh-gia-chuyen-sau` + chạy `scenario_simulate` (−5%) để lấy size gợi ý. `scenario_simulate` là PHÉP TÍNH TUYẾN TÍNH chính xác trên giá close gần nhất (shock × giá, P/L/1000cp) — dùng để đệm cỡ vị thế, KHÔNG phải dự báo giá. Không gọi trực tiếp `valuation_run` ở đây. Đủ 6 leg evidence (kể cả partial) thì dừng — không gọi thêm vòng tin/dòng tiền thứ hai, không thêm leg thứ 7.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau:

1. Grade **A/B/C** (rubric: A = ≥5 leg xanh + M-Score sạch + KH rõ; B = 4–5 leg; C = <4 leg hoặc M-Score đỏ > −1.78).
2. 1 dòng evidence/leg (6 dòng, mỗi dòng số + trend + provenance).
3. Size đề xuất (từ `scenario_simulate` −5%).
4. Unknowns tường minh (liệt kê điều chưa biết).
5. Kết luận 1 câu: grade + có nên giữ/mua trước BCTC + rủi ro lớn nhất.

Partial data (thiếu positioning hoặc kỳ vọng) → verdict partial + unknowns. `sentiment_score` âm/dương nhẹ thì ghi đúng là heuristic, không nâng thành leg xanh/đỏ.

## Ví dụ

**Ví dụ 1:**
Hỏi: Đánh giá trước BCTC HPG
Trả lời: M **<số>** sạch · F <số> · KH DT <số>/<số>/**<số>** · thưởng CP <số> ex <số> · sentiment heuristic <số> · NN bán ròng · pt <số> phiên → grade B + 6 leg evidence + unknowns, ≤10 calls (reuse legs).

## Trực quan hóa

Dữ liệu skill này nhận: trend giá, consensus, sentiment score, NN flow theo phiên, scenario %. Sau khi MCP trả data, nếu có thể trực quan hóa: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (line trend, gauge sentiment, waterfall NN flow), chọn và vẽ biểu đồ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.
