# Mùa vụ thị trường Việt Nam (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_month_stats`, `cycle_tet`), tra bằng `cycle_seasonality` / `cycle_tet`. File này chỉ giữ CÁCH ĐỌC + ngưỡng diễn giải; không trích con số nào từ file này như số liệu.
> Basket v2 (2026-10-18): 15 mảng, mẫu mảng ~8–9 năm (từ 2018-10); VNINDEX ~17 năm.

## 1. Đọc bảng mùa vụ (`cycle_seasonality`)

- Không tham số = full table (basket × tháng 1–12): `mean_ret` (% TB/tháng), `hit_rate` (% tháng dương), `rel_ret` (vượt VNI), `n` (mẫu).
- Lọc: `cycle_seasonality(basket="bank")` hoặc `(month=1)`; tên tiếng Việt không dấu cũng nhận ("bất động sản", "dầu khí", "vin").
- Ngưỡng diễn giải: hit ≥ 75% = bias mạnh; 60–75% = vừa; < 50% = không bias. |rel| ≥ 2%/tháng mới đáng kể.
- Hàng VNINDEX trong bảng là mẫu dài; các hàng mảng là mẫu ngắn hơn — so sánh cùng hàng, không so n.
- Cột tháng chưa hoàn tất (partial) sẽ chốt sau khi hết tháng — không kết luận chắc chắn trên ô partial.

## 2. Cấu trúc mùa vụ VN đã biết (verify lại bằng tool mỗi lần dùng)

- Q1 (đặc biệt T1–T2) thường mạnh nhất năm; T12→T3 là cửa sổ tốt.
- T4 hit thấp nhất ("bán trước Sell-in-May"); Sell-in-May KHÔNG đúng ở VN (T5 thường dương).
- T8 tốt thứ hai và rộng: nhiều mảng cùng vượt trội (vận tải, chứng khoán, bán lẻ, hóa chất; BĐS hit cao nhất bảng).
- T10 tệ nhất gần như mọi mảng (mùa chốt NAV/quý 3 + báo cáo); nhóm rơi ít nhất: tiêu dùng, bảo hiểm (và hóa chất giữ được rel dương).
- Bank = mảng đầu năm (T1/T12 hit cao nhất nhóm); CK mạnh T8/T11 (T10 yếu nhất); thép mạnh T2 — mạnh nhất toàn bảng, sau Tết; dầu khí mạnh T1–T2/T5, yếu T3–T4; hóa chất mạnh T2/T3/T8; vận tải mạnh T8/T5; Vin mạnh T3/T4/T11 (nhịp riêng, không theo nhóm BĐS).
- Hàng tiêu dùng thiết yếu gần như KHÔNG có mùa vụ vượt trội — chỉ "rơi ít hơn" (đặc biệt T10), dùng để trú.

## 3. Hiệu ứng Tết (`cycle_tet`)

- Định nghĩa: pre ≈ các phiên ngay trước Tết, post ≈ 5 phiên đầu sau Tết — số phiên chính xác theo kết quả `cycle_tet`, ghi lại khi trích.
- Cơ chế: pre-Tết bank/bán lẻ/vận tải mạnh (dòng tiền + kỳ vọng room năm mới); post-Tết xoay sang thép–hóa chất–vận tải–dầu khí (SX-XD khởi động lại); thép KHÔNG có pre-effect (hit thấp; số tra tool).
- Tra `cycle_tet()` full table hoặc `(basket="steel")`. Mẫu ~8 Tết cho baskets (từ 2019), ~15 cho VNINDEX.
- Tết mới: truyền vào `cycle_stats_finalize(extra_tet=[...])` ở lần refresh sau Tết.
