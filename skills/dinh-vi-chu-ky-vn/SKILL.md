---
name: dinh-vi-chu-ky-vn
description: "Xác định pha thị trường VN (đầu phục hồi, giữa sóng, cuối sóng, suy thoái) từ RS mảng 3M + timing đỉnh VNFIN/VNREAL + mùa vụ tháng + SBV, rồi suy ra 1-2 mảng dẫn dắt tiếp theo theo thống kê rotation trong PG."
when_to_use: Câu hỏi về giai đoạn/pha hiện tại của thị trường VN, sóng ngành tiếp theo, đỉnh/đáy chu kỳ, luân chuyển dòng tiền giữa Bank–Chứng–BĐS–Thép–Dầu khí.
activation: auto
triggers:
  keywords: [chu kỳ, giai đoạn thị trường, pha thị trường, luân chuyển, rotation, sóng ngành, đỉnh chu kỳ, tạo đỉnh, phân phối, đầu phục hồi, suy thoái, bank dẫn, chứng dẫn, dòng tiền ngành, cuối sóng, giữa sóng, mùa vụ ngành]
requires_tools: [vn_index_ohlcv, seasonality, event_study, market_movers, breadth_scan, sbv_rates, cycle_stats_check, cycle_seasonality, cycle_chains, cycle_turning, cycle_tet, cycle_yearly, cycle_trough_events, cycle_stats_refresh, cycle_stats_finalize]
version: 1.4.0
---

# Định vị pha chu kỳ thị trường Việt Nam

Skill suy luận pha hiện tại từ 4 trụ cột live (RS mảng, timing đỉnh, mùa vụ tháng, tiền tệ) + bảng thống kê dài hạn trong PG (`cycle_*`, version trong `cycle_meta`). Kết luận luôn kèm hit-rate và provenance, không nói chắc chắn.

## Khi nào dùng

- Dùng khi: user hỏi thị trường đang ở giai đoạn/pha nào, sóng ngành nào dẫn dắt tiếp theo, có phải cuối sóng/phân phối không, nên ưu tiên mảng nào theo chu kỳ.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Số liệu vĩ mô VN chi tiết (GDP/CPI/XNK/lãi suất điều hành) → dùng `danh-gia-vi-mo-viet-nam`.
  - Kiểm chứng chiến lược giao dịch cụ thể bằng backtest → dùng `kiem-chien-luoc-backtest`.
  - Phân tích kỹ thuật 1 mã/1 chart → dùng `ky-thuat-chuyen-sau`.
  - Chu kỳ đa tài sản VN (vàng/USD/trái phiếu/xăng) → dùng `chu-ky-tai-san-vn`.
  - Chỉ muốn XEM biểu đồ RS/heatmap → dùng `ve-bieu-do`.

## Các bước

**Bước 0: Kiểm tra độ tươi (bắt buộc, đầu tiên).**

Gọi `cycle_stats_check`. Nếu `needs_refresh` true HOẶC vừa qua Tết mà bảng Tết chưa cập nhật → cảnh báo + đề xuất refresh theo `references/refresh.md` (user đồng ý mới chạy). Không kết luận pha chắc chắn khi bảng cũ.

**Bước 1: RS mảng live (song song).**

Chạy `vn_index_ohlcv` cho VNINDEX + VN30 + VNFIN + VNREAL + VNUTI + VNMAT (count=126, interval=1D). Tự tính RS 3 tháng (≈63 nến) từng chỉ số ngành vs VNINDEX. Đối chiếu quy tắc đọc RS trong `references/rotation-chains.md` + tra `cycle_trough_events` so mẫu hồi sau đáy. Song song chạy `market_movers` + `breadth_scan` (sóng thật cần breadth > 50%).

**Bước 2: Timing đỉnh (tuần tự sau Bước 1).**

Tra `cycle_turning` đỉnh gần nhất VNFIN vs VNINDEX + đỉnh live từ data Bước 1. Áp quy tắc timing trong `references/rotation-chains.md`. Nghi ngờ vùng đỉnh → chạy `event_study` quanh đỉnh để đo CAR sau đỉnh.

**Bước 3: Mùa vụ tháng hiện tại (song song).**

Tra `cycle_seasonality(month=<M>)` (bias + hit-rate) + gọi `seasonality` cho VNINDEX để xác nhận bias còn hiệu lực. Nếu trong cửa sổ ±10 phiên quanh Tết → tra `cycle_tet` (pre-Tết bank/bán lẻ; post-Tết thép/hóa chất/vận tải/dầu khí).

**Bước 4: Trạng thái tiền tệ (song song).**

Chạy `sbv_rates`. Nới lỏng = ủng hộ Pha 1–2; thắt chặt/giữ cao + hút tín phiếu = ủng hộ Pha 3–4. Cần số GDP/tín dụng sâu → cross-ref skill `danh-gia-vi-mo-viet-nam`, không tự suy diễn macro.

**Bước 5: Kết luận pha + gợi ý mảng.**

Chấm 4 trụ cột theo checklist trong `references/phase-playbook.md`, chọn pha có nhiều điểm khớp nhất. Gợi ý 1–2 mảng tiếp theo: tra `cycle_chains` lấy hit-rate MỚI NHẤT (không dùng số trong file). CẤM picking mã cổ phiếu cụ thể, CẤM quy tắc mua/bán (đó là việc của skill khác).

## Cấu trúc câu trả lời

Trình bày đúng thứ tự: độ tươi bảng (`as_of` từ check) · verdict pha (1 dòng + độ tin cậy) · bằng chứng 4 trụ cột (mỗi số kèm provenance tool) · 1–2 mảng gợi ý kèm hit-rate live · pha lịch sử tương đồng nhất · thay đổi định nghĩa trong lần refresh này (nếu có, trích changelog) · caveat + đề xuất refresh nếu bảng cũ. ≤15 calls.

## Ví dụ

**Ví dụ 1:**
Hỏi: Thị trường đang ở giai đoạn nào, sóng ngành nào tiếp theo?
Trả lời: bảng as_of <ngày> (tươi) · verdict **giữa sóng** (tin cậy trung bình) · RS 3M: CK +<số>%, bank +<số>% (vn_index_ohlcv) · VNFIN đỉnh <ngày>, VNI đỉnh <ngày> (cycle_turning) · tháng <M> bias CK +<số>% hit <số>% (cycle_seasonality) · SBV <trạng thái> · gợi ý: chứng khoán (tra cycle_chains: bank RS 3M dương → CK +<số>%/tháng hit <số>%) · caveat mẫu nhỏ.

## Trực quan hóa

Dữ liệu skill này nhận: RS 3M các mảng, mốc đỉnh VNFIN vs VNI, bias tháng. Sau khi có data, nếu user muốn XEM: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó, chọn và vẽ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.

## Reference files

| File | Trả lời câu hỏi |
|---|---|
| `references/seasonality-vn.md` | Cách đọc bảng mùa vụ + ngưỡng diễn giải + cơ chế Tết (số tra tool) |
| `references/rotation-chains.md` | Định nghĩa chuỗi + quy tắc đọc RS + quy tắc timing đỉnh |
| `references/phase-playbook.md` | Định nghĩa 4 pha + ma trận pha→mảng + checklist chấm pha |
| `references/market-history.md` | Timeline chu kỳ VN 2011→ (narrative; số tra tool) |
| `references/refresh.md` | Khi nào + cách refresh qua MCP tools + tự rà soát định nghĩa + changelog |
