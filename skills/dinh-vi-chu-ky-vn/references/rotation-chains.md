# Chuỗi luân chuyển định lượng (đọc qua tool, không hardcode số)

> Số liệu sống trong PG (`cycle_chains`, `cycle_turning`, `cycle_trough_events`, `cycle_yearly`), tra bằng tools tương ứng. File này giữ ĐỊNH NGHĨA chuỗi + quy tắc timing + cách đọc RS.

## 1. Chuỗi relative: A mạnh → B vượt VNI tháng sau?

- Định nghĩa: RS = lợi suất vượt VNI; tín hiệu khi RS 1M/3M > +2%; đọc `cycle_chains()` full table (cột `rel_mean`, `rel_hit`, `n_up`) hoặc `(pair="bankRS3m->securities")`.
- **Thứ tự ưu tiên giữa các cặp: lấy từ `rel_mean` lúc tra `cycle_chains`**, không dùng thứ tự nhớ sẵn. Mỗi cặp đọc kèm `rel_hit` và `n_up`.
- Chiều ngược cũng có ý nghĩa (CK→Bank, thép→CK, hóa chất→Bank): sóng VN thường đi 2 chiều bank↔CK↔BĐS.
- Cặp có `rel_mean` âm ở lần tra gần nhất (VD NH→dầu khí, NH mạnh→tiêu dùng, CNTT mạnh→CK) → không dùng làm tín hiệu; kiểm lại bằng `cycle_chains` mỗi lần dùng. Dầu khí chỉ theo giá dầu + mùa, không theo flow NH→BĐS→DK.
- **Vin trong chuỗi.** 3 cặp có Vin trong `cycle_chains` (NH→Vin, Vin→BĐS, BĐS→Vin — tìm trong full table). Cặp có Vin chỉ dùng khi **cả 4 điều kiện**: `rel_mean` > 0 · `rel_hit` ≥ 60% (bậc "vừa" ở `seasonality-vn.md` §1) · `n_up` đủ lớn để tin (nêu `n_up`; nhỏ → hạ độ tin cậy) · điều kiện đầu chuỗi đang đúng (VD bank RS 3M dương). Tối đa 1 trong 2 mảng gợi ý. Vin đi nhịp riêng (vốn hóa lớn, câu chuyện tập đoàn) → luôn kiểm tra sự kiện tập đoàn trước khi nêu.
- Mẫu nhỏ: mỗi cặp chỉ vài chục tháng (từ 2018-10); luôn đọc kèm `n_up` và chỉ coi là gợi ý, không phải quy luật.

## 2. Lead-lag

- Không có tool nào trả lead-lag tuần: không dùng nhận định "CK tuần này → BĐS/VNI tuần sau" làm bằng chứng.
- Lead-lag tháng hầu hết âm nhẹ (mean-reversion): không bắt lead tuyến tính ở horizon tháng, chỉ dùng chuỗi relative mục 1.

## 3. Đọc RS 3M (tự tính từ `vn_index_ohlcv` 126 nến, và `market_candles_batch` cho Vin)

- RS 3M > +15% sau giai đoạn bank dẫn = quá nóng, thường trước đỉnh 1–3 tháng.
- RS bank+CK dương, BĐS âm = đầu/giữa sóng (tiền chưa lan tới BĐS).
- RS BĐS/utilities dương đơn độc trong khi bank/CK đã âm = "last leg" cuối sóng.
- RS mọi mảng âm sâu (< −20%) = bear hoặc pre-đáy; hồi sau đó ưu tiên mảng nằm top 3 ở mọi đáy — tra `cycle_trough_events` (quy tắc đọc ở `market-history.md` §2).
- Vin không có chỉ số riêng: RS 3M tính từ trung bình % thay đổi VIC/VHM/VRE/VPL (nêu rõ cách tính); Vin có thể bùng nổ/nghỉ hoàn toàn tách khỏi nhóm còn lại của thị trường.

## 4. Quy tắc timing đỉnh (verify bằng `cycle_turning(year=...)`)

1. **VNFIN đỉnh trước VNI 3–6 tháng = dấu hiệu cuối sóng.** Trước khi dùng: tra `cycle_turning` cho 2–3 năm **đã kết thúc** gần nhất — **bỏ qua năm đang chạy** (hàm trả đỉnh YTD cho năm hiện tại, chưa phải đỉnh đã xác nhận); chọn năm có VNI tăng mạnh (đối chiếu `cycle_yearly`), tính độ trễ VNFIN→VNI từng năm (ghi ngày đỉnh). Độ trễ nằm trong 3–6 tháng ở các đỉnh gần thì áp quy tắc; độ trễ lệch nhau giữa các năm (kể cả năm VNFIN đỉnh sau VNI) thì hạ độ tin cậy, không suy diễn.
2. **VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng = "last leg"** → thoát dần, không mua đuổi BĐS/utilities lúc này.
3. Đáy panic: các chỉ số thường đáy gần cùng lúc (mẫu cuối 2022 — kiểm bằng `cycle_turning`/`cycle_trough_events`), riêng BĐS hay đáy muộn hơn và hồi yếu nhất sau đáy; Vin kiểm riêng cột `vin` của `cycle_trough_events` (thứ hạng lệch rõ giữa các đáy thì không suy diễn — xem `market-history.md` §2).
4. Ngoại lệ đã biết: khi VNI đỉnh sớm do trụ Vin (VIC/VHM) kéo mà VNFIN rướn thêm (mẫu 2024) → luôn kiểm tra breadth (`breadth_scan`) kèm theo.
