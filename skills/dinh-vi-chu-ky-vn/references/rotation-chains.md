# Chuỗi luân chuyển định lượng (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_chains`, `cycle_turning`, `cycle_trough_events`, `cycle_yearly`), tra bằng tools tương ứng. File này giữ ĐỊNH NGHĨA chuỗi + quy tắc timing + cách đọc RS.

## 1. Chuỗi relative: A mạnh → B vượt VNI tháng sau?

- Định nghĩa: RS = lợi suất vượt VNI; tín hiệu khi RS 1M/3M > +2%; đọc `cycle_chains()` full table (cột `rel_mean`, `rel_hit`, `n_up`) hoặc `(pair="bankRS3m->securities")`.
- Thứ tự sức mạnh đã biết (verify lại mỗi lần dùng): NH→CK ≈ NH→thép > BĐS→CK > CK→CNTT/BĐS > NH→BĐS. Hai chuỗi KHÔNG tồn tại: NH→dầu khí (rel âm) và NH mạnh→tiêu dùng (rel âm = tiền rời defensives).
- Chiều ngược cũng có ý nghĩa (CK→Bank, thép→CK, hóa chất→Bank): sóng VN thường đi 2 chiều bank↔CK↔BĐS.
- Dầu khí không nối đuôi BĐS — trade dầu khí theo giá dầu + mùa, không theo flow NH→BĐS→DK.

## 2. Lead-lag

- Không có tool nào trả lead-lag tuần: không dùng nhận định "CK tuần này → BĐS/VNI tuần sau" làm bằng chứng.
- Lead-lag tháng hầu hết âm nhẹ (mean-reversion): không bắt lead tuyến tính ở horizon tháng, chỉ dùng chuỗi relative mục 1.

## 3. Đọc RS 3M (tự tính từ `vn_index_ohlcv` 126 nến)

- RS 3M > +15% sau giai đoạn bank dẫn = quá nóng, thường trước đỉnh 1–3 tháng.
- RS bank+CK dương, BĐS âm = đầu/giữa sóng (tiền chưa lan tới BĐS).
- RS BĐS/utilities dương đơn độc trong khi bank/CK đã âm = "last leg" cuối sóng.
- RS mọi mảng âm sâu (< −20%) = bear hoặc pre-đáy; hồi sau đó beta cao nhất (thép/CK).

## 4. Quy tắc timing đỉnh (verify bằng `cycle_turning(year=...)`)

1. **VNFIN đỉnh trước VNI 3–6 tháng = dấu hiệu cuối sóng** (mẫu thường nhắc: năm 2021 — kiểm ngày đỉnh bằng `cycle_turning(year=2021)` trước khi trích).
2. **VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng = "last leg"** → thoát dần, không mua đuổi BĐS/utilities lúc này.
3. Đáy panic: các chỉ số thường đáy gần cùng lúc (mẫu cuối 2022 — kiểm bằng `cycle_turning`/`cycle_trough_events`), riêng BĐS hay đáy muộn hơn và hồi yếu nhất sau đáy.
4. Ngoại lệ đã biết: khi VNI đỉnh sớm do trụ phi-tài-chính (VIC/VHM) kéo mà VNFIN rướn thêm (mẫu 2024) → luôn kiểm tra breadth (`breadth_scan`) kèm theo.
