# Chuỗi luân chuyển định lượng (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_chains`, `cycle_turning`, `cycle_trough_events`, `cycle_yearly`), tra bằng tools tương ứng. File này giữ ĐỊNH NGHĨA chuỗi + quy tắc timing + cách đọc RS.
> Basket v2 (2026-10-18): 15 mảng — Vin tách khỏi BĐS, viễn thông gộp vào CNTT.

## 1. Chuỗi relative: A mạnh → B vượt VNI tháng sau?

- Định nghĩa: RS = lợi suất vượt VNI; tín hiệu khi RS 1M/3M > +2%; đọc `cycle_chains()` full table (cột `rel_mean`, `rel_hit`, `n_up`) hoặc `(pair="bankRS3m->securities")`.
- Thứ tự sức mạnh đã biết, kiểm lại mỗi lần dùng (basket v2): **NH→thép ≈ BĐS→CK ≈ NH→CK > thép→CK > CK→CNTT ≈ CK→BĐS > NH→BĐS**. Chiều ngược vẫn có nghĩa (CK→Bank, thép→CK, hóa chất→Bank): sóng VN thường đi 2 chiều bank↔CK↔BĐS.
- Hai chuỗi KHÔNG tồn tại: NH→dầu khí (rel âm) và NH mạnh→tiêu dùng (rel âm = tiền rời defensives). CNTT mạnh→CK yếu — không dùng làm tín hiệu.
- Dầu khí không nối đuôi BĐS — trade dầu khí theo giá dầu + mùa, không theo flow NH→BĐS→DK.
- **Vin:** 3 cặp NH→Vin, Vin→BĐS, BĐS→Vin — đọc `rel_mean`/`rel_hit`/`n_up` trong `cycle_chains`; cặp nào `rel_mean` âm thì không dùng. Lúc viết cả 3 cặp đều yếu/âm (kiểm lại): Vin thường đi nhịp riêng (vốn hóa lớn, câu chuyện tập đoàn).
- Mẫu nhỏ: mỗi cặp chỉ vài chục tháng (từ 2018-10); luôn đọc kèm `n_up` và chỉ coi là gợi ý, không phải quy luật.

## 2. Lead-lag

- Không có tool nào trả lead-lag tuần: không dùng nhận định "CK tuần này → BĐS/VNI tuần sau" làm bằng chứng.
- Lead-lag tháng hầu hết âm nhẹ (mean-reversion): không bắt lead tuyến tính ở horizon tháng, chỉ dùng chuỗi relative mục 1.

## 3. Đọc RS 3M (tự tính từ `vn_index_ohlcv` 126 nến, và `market_candles_batch` cho Vin)

- RS 3M > +15% sau giai đoạn bank dẫn = quá nóng, thường trước đỉnh 1–3 tháng.
- RS bank+CK dương, BĐS âm = đầu/giữa sóng (tiền chưa lan tới BĐS).
- RS BĐS/utilities dương đơn độc trong khi bank/CK đã âm = "last leg" cuối sóng.
- RS mọi mảng âm sâu (< −20%) = bear hoặc pre-đáy; hồi sau đó beta cao nhất (thép/CK).
- Vin không có chỉ số riêng: RS 3M tính từ trung bình % thay đổi VIC/VHM/VRE/VPL (nêu rõ cách tính); Vin có thể bùng nổ/nghỉ hoàn toàn tách khỏi nhóm còn lại của thị trường.

## 4. Quy tắc timing đỉnh (verify bằng `cycle_turning(year=...)`)

1. **VNFIN đỉnh trước VNI 3–6 tháng = dấu hiệu cuối sóng.** Trước khi dùng: tra `cycle_turning(year=...)` các đỉnh lớn gần nhất, tính độ trễ VNFIN→VNI từng năm (ghi ngày đỉnh). Độ trễ nằm trong 3–6 tháng ở các đỉnh gần thì áp quy tắc; độ trễ lệch nhau giữa các năm (kể cả năm VNFIN đỉnh sau VNI) thì hạ độ tin cậy, không suy diễn.
2. **VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng = "last leg"** → thoát dần, không mua đuổi BĐS/utilities lúc này.
3. Đáy panic: các chỉ số thường đáy gần cùng lúc (mẫu cuối 2022 — kiểm bằng `cycle_turning`/`cycle_trough_events`), riêng BĐS hay đáy muộn hơn và hồi yếu nhất sau đáy; Vin cần kiểm riêng cột `vin` của `cycle_trough_events` (kết quả trái ngược giữa các đáy thì không suy diễn).
4. Ngoại lệ đã biết: khi VNI đỉnh sớm do trụ Vin (VIC/VHM) kéo mà VNFIN rướn thêm (mẫu 2024) → luôn kiểm tra breadth (`breadth_scan`) kèm theo.
