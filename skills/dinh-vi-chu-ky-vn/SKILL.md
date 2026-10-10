---
name: dinh-vi-chu-ky-vn
description: "Xác định pha thị trường VN (đầu phục hồi, giữa sóng, cuối sóng, suy thoái) từ RS mảng 3M + timing đỉnh VNFIN/VNREAL + mùa vụ tháng + SBV, rồi suy ra 1-2 mảng dẫn dắt tiếp theo theo thống kê rotation."
when_to_use: Câu hỏi về giai đoạn/pha hiện tại của thị trường VN, sóng ngành tiếp theo, đỉnh/đáy chu kỳ, luân chuyển dòng tiền giữa Bank–Chứng–BĐS–Thép–Dầu khí.
activation: auto
triggers:
  keywords: [chu kỳ, giai đoạn thị trường, pha thị trường, luân chuyển, rotation, sóng ngành, đỉnh chu kỳ, tạo đỉnh, phân phối, đầu phục hồi, suy thoái, bank dẫn, chứng dẫn, dòng tiền ngành, cuối sóng, giữa sóng, mùa vụ ngành]
requires_tools: [vn_index_ohlcv, seasonality, event_study, correlation_matrix, market_movers, breadth_scan, market_overview, sbv_rates, cycle_stats_check, cycle_stats_refresh, cycle_stats_finalize]
version: 1.3.0
---

# Định vị pha chu kỳ thị trường Việt Nam

Skill suy luận pha hiện tại từ 4 trụ cột live (RS mảng, timing đỉnh, mùa vụ tháng, tiền tệ) + bảng thống kê dài hạn trong `references/` (prior, có `as_of`). Kết luận luôn kèm hit-rate và provenance, không nói chắc chắn.

## Khi nào dùng

- Dùng khi: user hỏi thị trường đang ở giai đoạn/pha nào, sóng ngành nào dẫn dắt tiếp theo, có phải cuối sóng/phân phối không, nên ưu tiên mảng nào theo chu kỳ.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Số liệu vĩ mô VN chi tiết (GDP/CPI/XNK/lãi suất điều hành) → dùng `danh-gia-vi-mo-viet-nam`.
  - Kiểm chứng chiến lược giao dịch cụ thể bằng backtest → dùng `kiem-chien-luoc-backtest`.
  - Phân tích kỹ thuật 1 mã/1 chart → dùng `ky-thuat-chuyen-sau`.
  - Chỉ muốn XEM biểu đồ RS/heatmap → dùng `ve-bieu-do`.

## Các bước

**Bước 0: Kiểm tra độ tươi của bảng (bắt buộc, đầu tiên).**

Gọi `cycle_stats_check` với `as_of` trong header `references/seasonality-vn.md`. Tool trả `days_stale` + `needs_refresh` + coverage cache. Nếu stale (quá 90 ngày) HOẶC vừa qua Tết âm lịch mà bảng Tết chưa cập nhật → ghi cảnh báo "bảng prior đã cũ (as_of …)" và đề xuất chạy refresh theo `references/refresh.md` (user đồng ý mới chạy: các batch `cycle_stats_refresh` ~12 mã/call đến hết ~80 mã, rồi `cycle_stats_finalize`, chép JSON vào 4 file references + bump `as_of`/`stats_version` + **tự rà soát & cập nhật định nghĩa theo refresh.md mục 6** + ghi changelog mục 7). Không kết luận pha chắc chắn khi bảng cũ.

**Bước 1: RS mảng live (song song).**

Chạy `vn_index_ohlcv` cho VNINDEX + VN30 + VNFIN + VNREAL + VNUTI + VNMAT (count=126, interval=1D). Tự tính RS 3 tháng (≈63 nến) từng chỉ số ngành vs VNINDEX. Đối chiếu `references/rotation-chains.md` mục "đọc RS": mảng nào đang top? Có trùng mẫu các sóng lịch sử trong `references/market-history.md` không? Song song chạy `market_movers` + `breadth_scan` để xác nhận độ rộng (sóng thật cần breadth > 50%).

**Bước 2: Timing đỉnh (tuần tự sau Bước 1).**

Lấy đỉnh gần nhất của VNFIN và VNINDEX từ data Bước 1 (tối đa 365 nến qua `vn_quote_history` nếu cần xa hơn). Áp quy tắc trong `references/rotation-chains.md` mục "timing đỉnh": VNFIN đỉnh trước VNI 3–6 tháng = dấu hiệu cuối sóng (mẫu 2021: 5 tháng; 2026: 4 tháng); VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng = "last leg", thoát dần. Nghi ngờ vùng đỉnh → chạy `event_study` quanh đỉnh để đo CAR sau đỉnh.

**Bước 3: Mùa vụ tháng hiện tại (song song).**

Tra tháng hiện tại trong `references/seasonality-vn.md` (bias tuyệt đối + vượt trội vs VNI + hit-rate) + gọi `seasonality` cho VNINDEX để xác nhận bias còn hiệu lực. Nếu đang trong cửa sổ ±10 phiên quanh Tết → tra riêng bảng Tết (pre-Tết bank/bán lẻ; post-Tết thép/hóa chất/vận tải/dầu khí).

**Bước 4: Trạng thái tiền tệ (song song).**

Chạy `sbv_rates`. Nới lỏng (hạ điều hành) = ủng hộ Pha 1–2; thắt chặt/giữ cao + hút tín phiếu = ủng hộ Pha 3–4. Cần số GDP/tín dụng sâu → cross-ref skill `danh-gia-vi-mo-viet-nam`, không tự suy diễn macro.

**Bước 5: Kết luận pha + gợi ý mảng.**

Chấm 4 trụ cột theo checklist trong `references/phase-playbook.md`, chọn pha có nhiều điểm khớp nhất. Gợi ý 1–2 mảng tiếp theo từ ma trận pha→mảng, MỖI gợi ý kèm hit-rate trích từ `references/rotation-chains.md`. CẤM picking mã cổ phiếu cụ thể, CẤM quy tắc mua/bán (đó là việc của skill khác).

## Cấu trúc câu trả lời

Trình bày đúng thứ tự: cảnh báo độ tươi bảng (nếu có) · verdict pha (1 dòng + độ tin cậy cao/trung bình/thấp) · bằng chứng 4 trụ cột (RS 3M từng mảng + ngày đỉnh VNFIN vs VNI + bias tháng + SBV, mỗi số kèm provenance) · 1–2 mảng gợi ý kèm hit-rate · pha lịch sử tương đồng nhất (tra `market-history.md`) · thay đổi định nghĩa trong lần refresh này (nếu có, trích changelog) · caveat mẫu nhỏ + đề xuất refresh nếu bảng cũ. ≤15 calls.

## Ví dụ

**Ví dụ 1:**
Hỏi: Thị trường đang ở giai đoạn nào, sóng ngành nào tiếp theo?
Trả lời: bảng prior as_of <ngày> (tươi/cũ + đề xuất refresh nếu cũ) · verdict **giữa sóng** (tin cậy trung bình) · RS 3M: CK +<số>%, bank +<số>%, BĐS <số>% (vn_index_ohlcv 126 nến) · VNFIN đỉnh <ngày>, VNI đỉnh <ngày> (chênh <n> tháng) · tháng <M> bias CK +<số>% hit <số>% (seasonality + bảng) · SBV <trạng thái> · gợi ý: chứng khoán (bank RS 3M dương → CK +3.35%/tháng hit 63%) · giống sóng <năm> · caveat mẫu nhỏ.

## Trực quan hóa

Dữ liệu skill này nhận: RS 3M các mảng, mốc đỉnh VNFIN vs VNI, bias tháng. Sau khi có data, nếu user muốn XEM: nạp skill `ve-bieu-do`, đối chiếu shape data với bảng chọn hình trong đó (multiline RS mảng, bar diverging bias tháng, line đỉnh song song), chọn và vẽ phù hợp — không vẽ khi thiếu điểm tối thiểu, không bịa số minh họa.

## Reference files

| File | Trả lời câu hỏi |
|---|---|
| `references/seasonality-vn.md` | Tháng nào mảng nào mạnh (VNI 15y + basket 2018→ + Tết), kèm as_of |
| `references/rotation-chains.md` | Chuỗi luân chuyển định lượng + lead-lag + quy tắc timing đỉnh |
| `references/phase-playbook.md` | Định nghĩa 4 pha + ma trận pha→mảng + checklist chấm pha |
| `references/market-history.md` | Chu kỳ VN 2011→ (đáy/đỉnh/nguyên nhân/sóng dẫn) để đối chiếu |
| `references/refresh.md` | Khi nào + cách tự cập nhật bảng thống kê (staleness > 90 ngày) |
