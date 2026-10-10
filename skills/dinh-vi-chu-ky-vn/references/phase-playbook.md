# Playbook 4 pha + ma trận pha→mảng (bảng prior thống kê)

> `stats_version: v2` · `as_of: 2026-10-09` · Pha suy từ RS 3M + timing đỉnh + mùa vụ + SBV. Gợi ý ở đây là MẢNG (có hit-rate), không picking mã, không quy tắc mua/bán.

## 1. Định nghĩa 4 pha

| Pha | Tên | Dấu hiệu đủ (cần ≥3/5) |
|---|---|---|
| **P1** | Đầu phục hồi / đầu năm | (a) VNI vừa tạo đáy lớn (drawdown >15% rồi hồi >20%) hoặc đang T12–T2 · (b) RS 3M bank dương, CK chuyển dương · (c) SBV hạ/giữ thấp điều hành · (d) bias tháng: bank T1 +3.1 rel hit 88%, T12 +2.0 · (e) pre-Tết bank +4.5% hit 88% |
| **P2** | Giữa sóng | (a) RS 3M CK/thép dương mạnh (+15% trở lên từng xuất hiện) · (b) VNFIN chưa đỉnh (đỉnh < 3 tháng) · (c) breadth > 50% · (d) bias tháng: CK T8 +6.2/T11 +5.5, thép T2 +8.3, dầu khí T5 +5.2 · (e) post-Tết thép/hóa chất/vận tải +3~6% |
| **P3** | Cuối sóng / phân phối | (a) VNFIN đã đỉnh > 3 tháng mà VNI vẫn lên · (b) RS 3M BĐS/utilities dương trong khi bank/CK đã âm · (c) RS 3M từng mảng > +15% (quá nóng) · (d) bias tháng: T10 tệ toàn diện · (e) SBV thắt chặt/giữ cao + hút tín phiếu |
| **P4** | Suy thoái / bear | (a) VNI drawdown > 20% từ đỉnh · (b) RS 3M mọi mảng âm sâu · (c) consumer/utilities rơi ít nhất (mẫu 2022: -8%/-10% vs VNI -33%) · (d) thép/CK/BĐS rơi sâu nhất (-58~-61% năm 2022) |

## 2. Ma trận pha → mảng gợi ý (kèm hit-rate từ rotation-chains)

| Pha hiện tại | Mảng gợi ý tiếp theo | Cơ sở thống kê |
|---|---|---|
| P1 (bank RS 3M dương) | **Chứng khoán** (+3.16%/tháng, hit 62%, n=47) · **Thép** (+3.78%/tháng, hit 60%) · BĐS (+1.53%, hit 62%) | rotation-chains mục 1 |
| P1 sau Tết | Thép (+5.5% post-Tết, hit 75%) · Hóa chất (+3.8%, 75%) · Vận tải (+3.3%, 88%) · Dầu khí (+2.9%, 75%) | seasonality-vn mục 4 |
| P2 (CK mạnh tuần này) | **BĐS tuần sau** (corr +17%) · VNI tuần sau (corr +11%) · CNTT (+2.01%/tháng, hit 55%) | rotation-chains mục 2 |
| P2 tháng 8 / tháng 11 | CK (+10.9%/+7.9% tuyệt đối; rel +6.2/+5.5) | seasonality-vn mục 2–3 |
| P3 | Giảm dần BĐS/utilities "last leg" (rướn sau đỉnh VNI 1–4 tháng); TRÁNH mua đuổi khi VNFIN đỉnh > 3 tháng | rotation-chains mục 4 |
| P4 (đang rơi) | Trú: **consumer + utilities** (rơi ít nhất 2022) · TRÁNH: thép/CK/BĐS | market-history 2022 |
| P4 (vừa tạo đáy) | Hồi kỹ thuật: **thép** (+64%/+90% 3M sau 2 đáy lớn) · **CK** (+34%/+56%) · **CNTT** (+36%/+51%) · TRÁNH BĐS (+8% sau đáy 11/2022) | market-history |

## 3. Checklist chấm pha (dùng ở Bước 5 của SKILL.md)

Chấm mỗi trụ cột +1/0/-1 (ủng hộ/trung tính/chống) rồi cộng:
- RS 3M: bank+CK dương (+1 P1/P2) · BĐS/utilities dương đơn độc (+1 P3) · tất cả âm sâu (+1 P4)
- Timing đỉnh: VNFIN đỉnh < 3 tháng (+1 P2) · VNFIN đỉnh > 3 tháng mà VNI lên (+1 P3)
- Mùa vụ: tháng hiện tại bias mảng nào (tra seasonality-vn) — khớp mảng đang top thì +1 pha tương ứng
- Tiền tệ: SBV nới lỏng (+1 P1/P2) · thắt chặt (+1 P3/P4)
- Tổng ≥ +3 cho một pha và không có trụ cột -1 mâu thuẫn → verdict pha đó, tin cậy cao; +2 → tin cậy trung bình; còn lại → "chưa rõ pha" + nêu 2 kịch bản.

## 4. Ranh giới (không vượt qua)

- Chỉ gợi ý MẢNG + hit-rate. Picking mã cụ thể → skill phân tích mã. Quy tắc mua/bán, sizing, cắt lỗ → skill chiến lược/backtest.
- Không dùng đòn bẩy suy luận: chuỗi "NH→Dầu khí" KHÔNG tồn tại (-0.56%, hit 45%) — cấm gợi ý; dầu khí chỉ theo giá dầu + mùa T1–T2/T5 (corr WTI +29%/tháng theo FRED 09/2026 — số này tool chưa recompute, xem refresh.md).
- Defensives (consumer/staples) ở VN gần như không dẫn sóng nào — chỉ gợi ý để TRÚ trong P4, không gợi ý để đón sóng.
