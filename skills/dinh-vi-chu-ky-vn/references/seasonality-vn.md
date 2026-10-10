# Mùa vụ thị trường Việt Nam (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_month_stats`, `cycle_tet`), tra bằng `cycle_seasonality` / `cycle_tet`. File này chỉ giữ CÁCH ĐỌC + ngưỡng diễn giải. Ví dụ số bên dưới là snapshot minh họa as_of 2026-10-09 — luôn tra tool lấy số mới.

## 1. Đọc bảng mùa vụ (`cycle_seasonality`)

- Không tham số = full table (basket × tháng 1–12): `mean_ret` (% TB/tháng), `hit_rate` (% tháng dương), `rel_ret` (vượt VNI), `n` (mẫu).
- Lọc: `cycle_seasonality(basket="bank")` hoặc `(month=1)`.
- Ngưỡng diễn giải: hit ≥ 75% = bias mạnh; 60–75% = vừa; < 50% = không bias. |rel| ≥ 2%/tháng mới đáng kể.
- Hàng VNINDEX trong bảng là mẫu dài (~16 năm); các hàng mảng là mẫu ngắn hơn (~8 năm, từ 2018) — so sánh cùng hàng, không so n.
- Cột tháng chưa hoàn tất (partial) sẽ chốt sau khi hết tháng — không kết luận chắc chắn trên ô partial.

## 2. Cấu trúc mùa vụ VN đã biết (verify lại bằng tool mỗi lần dùng)

- Q1 (đặc biệt T1–T2) mạnh nhất năm; T12→T3 là cửa sổ tốt (khớp SSI "xác suất ~75%, +1.7%/tháng").
- T4 hit thấp nhất ("bán trước Sell-in-May"); Sell-in-May KHÔNG đúng ở VN (T5 thường dương).
- T8 tốt thứ hai; T10 tệ nhất gần như mọi mảng (mùa chốt NAV/quý 3 + báo cáo).
- Bank = mảng đầu năm (T1/T12 vượt trội, hit ~88%); CK mạnh T8/T11; thép mạnh T2 (sau Tết); dầu khí mạnh T1–T2/T5, yếu T3–T4.
- Hàng tiêu dùng thiết yếu gần như KHÔNG có mùa vụ vượt trội — chỉ "rơi ít hơn", dùng để trú.

## 3. Hiệu ứng Tết (`cycle_tet`)

- Định nghĩa: pre = 5 phiên trước phiên cuối cùng trước Tết; post = 5 phiên đầu sau Tết.
- Cơ chế: pre-Tết bank/bán lẻ mạnh (dòng tiền + kỳ vọng room năm mới); post-Tết xoay sang thép–hóa chất–vận tải–dầu khí (SX-XD khởi động lại); thép KHÔNG có pre-effect.
- Tra `cycle_tet()` full table hoặc `(basket="steel")`. Mẫu ~8 Tết cho baskets (từ 2019), ~15 cho VNINDEX.
- Tết mới: truyền vào `cycle_stats_finalize(extra_tet=[...])` ở lần refresh sau Tết.
