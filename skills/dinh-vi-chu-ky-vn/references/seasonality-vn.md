# Mùa vụ thị trường Việt Nam (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_month_stats`, `cycle_tet`), tra bằng `cycle_seasonality` / `cycle_tet`. File này chỉ giữ CÁCH ĐỌC + ngưỡng diễn giải; không trích con số nào từ file này như số liệu.
> Số mẫu: đọc ở cột `n` của từng ô. Hàng mảng mẫu ngắn hơn hàng VNINDEX — so sánh cùng hàng, không so n.

## 1. Đọc bảng mùa vụ (`cycle_seasonality`)

- Không tham số = full table (basket × tháng 1–12): `mean_ret` (% TB/tháng), `hit_rate` (% tháng dương), `rel_ret` (vượt VNI), `n` (mẫu).
- Lọc: `cycle_seasonality(basket="bank")` hoặc `(month=1)`; tên tiếng Việt không dấu cũng nhận ("bất động sản", "dầu khí", "vin").
- Ngưỡng diễn giải: hit ≥ 75% = bias mạnh; 60–75% = vừa; < 50% = không bias. |rel| ≥ 2%/tháng mới đáng kể.
- Cột tháng chưa hoàn tất (partial) sẽ chốt sau khi hết tháng — không kết luận chắc chắn trên ô partial.

## 2. Cấu trúc mùa vụ VN đã biết (verify lại bằng tool mỗi lần dùng)

Các dòng dưới là **giả thuyết (prior) để định hướng tra tool**, không phải tín hiệu. Tín hiệu = ô đạt ngưỡng §1 (hit ≥ 60–75% và |rel_ret| ≥ 2%/tháng) **và** `n` đủ lớn để tin; không đạt thì không kết luận.

- Q1 (đặc biệt T1–T2) thường mạnh nhất năm; T12→T3 là cửa sổ tốt.
- T4 hit thấp nhất ("bán trước Sell-in-May"); Sell-in-May KHÔNG đúng ở VN (T5 thường dương).
- T8 tốt thứ hai và thường rộng — mảng nào vượt trội tra `cycle_seasonality(month=8)`, không lấy danh sách từ file này.
- T10 tệ nhất gần như mọi mảng (mùa chốt NAV/quý 3 + báo cáo) — mảng rơi ít nhất hoặc giữ `rel_ret` dương tra `cycle_seasonality(month=10)`.
- Bank = mảng đầu năm (T1/T12 vượt trội); CK mạnh T8/T11, yếu T10; thép mạnh T2 (sau Tết); dầu khí mạnh T1–T2/T5, yếu T3–T4.
- Vin: mùa vụ đọc ở hàng `vin` của `cycle_seasonality(month=<M>)` — không ghi tháng cố định trong file này; điều kiện dùng Vin ở `rotation-chains.md` §1.
- Hàng tiêu dùng thiết yếu gần như KHÔNG có mùa vụ vượt trội — chỉ "rơi ít hơn" (đặc biệt T10), dùng để trú.

## 3. Hiệu ứng Tết (`cycle_tet`)

- Định nghĩa: pre ≈ các phiên ngay trước Tết, post ≈ 5 phiên đầu sau Tết — số phiên chính xác theo kết quả `cycle_tet`, ghi lại khi trích.
- Cơ chế: pre-Tết bank/bán lẻ/vận tải mạnh (dòng tiền + kỳ vọng room năm mới); post-Tết xoay sang thép–hóa chất–vận tải–dầu khí (SX-XD khởi động lại); thép KHÔNG có pre-effect (hit thấp; số tra tool).
- Tra `cycle_tet()` full table hoặc `(basket="steel")`. `cycle_tet` không trả cột `n` — số lần Tết trong mẫu phải đếm khi trích; mẫu Tết ngắn hơn mẫu tháng, luôn nêu mẫu kèm kết luận.
- Tết mới: truyền vào `cycle_stats_finalize(extra_tet=[...])` ở lần refresh sau Tết.
