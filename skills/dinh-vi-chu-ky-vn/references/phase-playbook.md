# Playbook 4 pha + ma trận pha→mảng (số tra tool, file giữ logic)

> Gợi ý ở đây là MẢNG (kèm hit-rate tra từ `cycle_chains`), không picking mã, không quy tắc mua/bán.

## 1. Định nghĩa 4 pha

| Pha | Tên | Dấu hiệu đủ (cần ≥3/5) |
|---|---|---|
| **P1** | Đầu phục hồi / đầu năm | (a) VNI vừa tạo đáy lớn (drawdown >15% rồi hồi >20%) hoặc đang T12–T2 · (b) RS 3M bank dương, CK chuyển dương · (c) SBV hạ/giữ thấp điều hành · (d) bias tháng bank T1/T12 vượt trội (tra `cycle_seasonality`) · (e) pre-Tết bank/bán lẻ mạnh (tra `cycle_tet`) |
| **P2** | Giữa sóng | (a) RS 3M CK/thép dương mạnh · (b) VNFIN chưa đỉnh (đỉnh < 3 tháng, tra `cycle_turning`) · (c) breadth > 50% · (d) bias tháng CK T8/T11, thép T2, dầu khí T5 · (e) post-Tết thép/hóa chất/vận tải mạnh |
| **P3** | Cuối sóng / phân phối | (a) VNFIN đã đỉnh > 3 tháng mà VNI vẫn lên · (b) RS 3M BĐS/utilities dương trong khi bank/CK đã âm · (c) RS 3M từng mảng > +15% (quá nóng) · (d) bias tháng T10 tệ toàn diện · (e) SBV thắt chặt/giữ cao + hút tín phiếu |
| **P4** | Suy thoái / bear | (a) VNI drawdown > 20% từ đỉnh · (b) RS 3M mọi mảng âm sâu · (c) consumer/utilities rơi ít nhất · (d) thép/CK/BĐS rơi sâu nhất |

## 2. Ma trận pha → mảng gợi ý (hit-rate tra `cycle_chains` mỗi lần dùng)

| Pha hiện tại | Mảng gợi ý tiếp theo | Cơ sở |
|---|---|---|
| P1 (bank RS 3M dương) | **Chứng khoán** · **Thép** · BĐS | Chuỗi bankRS3m→CK/thép/BĐS (top chuỗi) |
| P1 sau Tết | Thép · Hóa chất · Vận tải · Dầu khí | `cycle_tet` post (hit-rate tra tool) |
| P2 (CK mạnh) | CNTT · BĐS | Chuỗi CK→CNTT/BĐS trong `cycle_chains` |
| P2 tháng 8 / tháng 11 | CK | Bias T8/T11 vượt trội |
| P3 | Giảm dần BĐS/utilities "last leg"; TRÁNH mua đuổi khi VNFIN đỉnh > 3 tháng | Quy tắc timing rotation-chains mục 4 |
| P4 (đang rơi) | Trú: **consumer + utilities** · TRÁNH: thép/CK/BĐS | Tra `cycle_yearly` năm bear gần nhất |
| P4 (vừa tạo đáy) | Hồi kỹ thuật: **thép** · **CK** · **CNTT** · TRÁNH BĐS | Tra `cycle_trough_events` (thép+CK+CNTT luôn top 3) |

## 3. Checklist chấm pha (dùng ở Bước 5 của SKILL.md)

Chấm mỗi trụ cột +1/0/-1 (ủng hộ/trung tính/chống) rồi cộng:
- RS 3M: bank+CK dương (+1 P1/P2) · BĐS/utilities dương đơn độc (+1 P3) · tất cả âm sâu (+1 P4)
- Timing đỉnh: VNFIN đỉnh < 3 tháng (+1 P2) · VNFIN đỉnh > 3 tháng mà VNI lên (+1 P3)
- Mùa vụ: tháng hiện tại bias mảng nào (tra `cycle_seasonality`) — khớp mảng đang top thì +1 pha tương ứng
- Tiền tệ: SBV nới lỏng (+1 P1/P2) · thắt chặt (+1 P3/P4)
- Tổng ≥ +3 cho một pha và không có trụ cột -1 mâu thuẫn → verdict pha đó, tin cậy cao; +2 → tin cậy trung bình; còn lại → "chưa rõ pha" + nêu 2 kịch bản.

## 4. Ranh giới (không vượt qua)

- Chỉ gợi ý MẢNG + hit-rate tra từ tool. Picking mã cụ thể → skill phân tích mã. Quy tắc mua/bán, sizing, cắt lỗ → skill chiến lược/backtest.
- Chuỗi "NH→Dầu khí" KHÔNG tồn tại (rel âm trong `cycle_chains`) — cấm gợi ý; dầu khí chỉ theo giá dầu + mùa.
- Defensives (consumer/staples) ở VN gần như không dẫn sóng nào — chỉ gợi ý để TRÚ trong P4, không gợi ý để đón sóng.
- CẤM bịa ngưỡng mới: mọi ngưỡng trong checklist (RS +15%, drawdown 20%, breadth 50%...) chỉ đổi khi có bằng chứng định lượng từ ≥2 chu kỳ trong dữ liệu mới.
