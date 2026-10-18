---
name: dinh-vi-chu-ky-vn
description: "Định vị pha thị trường VN (phục hồi, giữa sóng, cuối sóng, suy yếu) từ sức mạnh tương đối các nhóm ngành, mùa vụ và lãi suất SBV, rồi gợi ý 1–2 nhóm có thể dẫn dắt tiếp. Dùng khi hỏi thị trường đang ở giai đoạn nào, sóng ngành tiếp theo."
activation: auto
triggers:
  keywords: [chu kỳ thị trường, giai đoạn thị trường, pha thị trường, luân chuyển ngành, rotation, sóng ngành, đỉnh chu kỳ, giai đoạn phân phối, đầu phục hồi, bank dẫn, chứng dẫn, dòng tiền ngành, cuối sóng, giữa sóng, mùa vụ ngành]
requires_tools: [cycle_stats_check, vn_index_ohlcv]
uses_tools: [cycle_stats_check, cycle_seasonality, cycle_chains, cycle_turning, cycle_tet, cycle_yearly, cycle_trough_events, vn_index_ohlcv, seasonality, sbv_rates, breadth_scan, market_movers]
version: 1.6.0
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

Gọi `cycle_stats_check`.
- `as_of` rỗng hoặc `cached_symbols` = 0 → bảng **chưa có dữ liệu**: dừng, báo "chưa có dữ liệu chu kỳ trên server", không kết luận pha, không dùng con số nào trong `references/` thay thế.
- `needs_refresh` true, hoặc vừa qua Tết mà bảng Tết chưa cập nhật → cảnh báo + đề xuất refresh theo `references/refresh.md` (user đồng ý mới chạy). Không kết luận pha chắc chắn khi bảng cũ.

**Bước 1: RS mảng live (song song).**

Chạy `vn_index_ohlcv` cho VNINDEX + VN30 + VNFIN + VNREAL + VNUTI + VNMAT (count=126, interval=1D; cần đủ nến để có giá 63 phiên trước, không dùng summary), mỗi lượt tối đa 3 chỉ số để không dồn tải lên server. Tính RS 3 tháng (≈63 nến) từng chỉ số ngành vs VNINDEX = % thay đổi chỉ số ngành − % thay đổi VNINDEX; ghi rõ ngày đầu/cuối dùng để tính. Đối chiếu quy tắc đọc RS trong `references/rotation-chains.md` + tra `cycle_trough_events` so mẫu hồi sau đáy. Song song chạy `market_movers` + `breadth_scan` (sóng thật cần breadth > 50%).

**Bước 2: Timing đỉnh (tuần tự sau Bước 1).**

Tra `cycle_turning` đỉnh gần nhất VNFIN vs VNINDEX + đỉnh live từ data Bước 1. Áp quy tắc timing trong `references/rotation-chains.md`. Nghi ngờ vùng đỉnh → chạy `event_study` quanh đỉnh để đo CAR sau đỉnh.

**Bước 3: Mùa vụ tháng hiện tại (song song).**

Tra `cycle_seasonality(month=<M>)` (bias + hit-rate theo từng mảng, tính sẵn trong bảng PG) + gọi `seasonality` cho VNINDEX (tính trực tiếp từ nến, chỉ một mã) để xác nhận bias còn hiệu lực. Hai tool có thể lệch nhau vì khác giai đoạn dữ liệu: ghi rõ số nào từ tool nào. Nếu trong cửa sổ ±10 phiên quanh Tết → tra `cycle_tet` (pre-Tết bank/bán lẻ; post-Tết thép/hóa chất/vận tải/dầu khí).

**Bước 4: Trạng thái tiền tệ (song song).**

Chạy `sbv_rates`. Nới lỏng = ủng hộ Pha 1–2; thắt chặt/giữ cao + hút tín phiếu = ủng hộ Pha 3–4. Cần số GDP/tín dụng sâu → cross-ref skill `danh-gia-vi-mo-viet-nam`, không tự suy diễn macro.

**Bước 5: Kết luận pha + gợi ý mảng.**

Chấm 4 trụ cột theo checklist trong `references/phase-playbook.md`, chọn pha có nhiều điểm khớp nhất. Gợi ý 1–2 mảng tiếp theo: tra `cycle_chains` lấy hit-rate MỚI NHẤT (không dùng số trong file). CẤM picking mã cổ phiếu cụ thể, CẤM quy tắc mua/bán (đó là việc của skill khác).

## Cấu trúc câu trả lời

Trình bày đúng thứ tự: độ tươi bảng (`as_of` từ check) · verdict pha (1 dòng + độ tin cậy) · bằng chứng 4 trụ cột (mỗi số kèm provenance tool) · 1–2 mảng gợi ý kèm hit-rate live · pha lịch sử tương đồng nhất · thay đổi định nghĩa trong lần refresh này (nếu có, trích changelog) · caveat + đề xuất refresh nếu bảng cũ. Khoảng 12–16 lệnh gọi, gom song song trong từng bước.

## Ngôn ngữ trình bày

Viết tắt trong `references/` dùng để bạn làm việc, không viết ra cho người dùng:

| Ký hiệu nội bộ | Viết cho người dùng |
| --- | --- |
| RS 3M, RS 1M, RS mảng | sức mạnh tương đối 3 tháng/1 tháng của nhóm ngành so với VN-Index (lần đầu nói rõ nghĩa của "sức mạnh tương đối") |
| VNI, VNFIN, CK, BĐS, utilities, consumer | VN-Index, VN-Finindex, chứng khoán, bất động sản, tiện ích, tiêu dùng |
| drawdown, bear, bull | mức sụt giảm sâu nhất, pha suy yếu, pha phục hồi |
| bias tháng, hit-rate, breadth | xu hướng thường thấy của tháng đó, tỷ lệ đúng theo lịch sử, độ rộng thị trường |
| pre-Tết, post-Tết, turning | trước Tết, sau Tết, đảo chiều |

Tên chỉ số và mã giữ nguyên (VN-Index, VN30). Số liệu trong `references/` là dữ liệu để ra quyết định, không phải để chép lại cho người dùng: chốt pha bằng lời của bạn, kèm độ tin cậy và nguồn.

## Ví dụ

**Ví dụ 1:**
Hỏi: Thị trường đang ở giai đoạn nào, sóng ngành nào tiếp theo?
Đạt khi: có độ tươi bảng (`as_of`), kết luận pha kèm độ tin cậy, 4 trụ cột có số + tool nguồn, 1–2 mảng gợi ý kèm hit-rate lấy từ `cycle_chains`, và caveat mẫu nhỏ.

## Trực quan hóa

Chỉ vẽ khi người dùng muốn xem hình, hoặc khi có chuỗi thời gian / so sánh mà bảng khó đọc; tối đa 1 biểu đồ mỗi câu trả lời. Vẽ bằng `chart_render` với `from_call` (mã `[ref …]` ở đầu kết quả tool) để không phải gõ lại số; cần chọn loại hình thì nạp `ve-bieu-do`.

## File tham khảo

| File | Trả lời câu hỏi |
|---|---|
| `references/seasonality-vn.md` | Cách đọc bảng mùa vụ + ngưỡng diễn giải + cơ chế Tết (số tra tool) |
| `references/rotation-chains.md` | Định nghĩa chuỗi + quy tắc đọc RS + quy tắc timing đỉnh |
| `references/phase-playbook.md` | Định nghĩa 4 pha + ma trận pha→mảng + checklist chấm pha |
| `references/market-history.md` | Timeline chu kỳ VN 2011→ (narrative; số tra tool) |
| `references/refresh.md` | Khi nào + cách refresh qua MCP tools + changelog |
