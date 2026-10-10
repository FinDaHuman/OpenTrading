# Chuỗi luân chuyển định lượng (bảng prior thống kê)

> `stats_version: v2` · `as_of: 2026-10-09` · Nguồn: basket equal-weight 2018→2026, lead-lag weekly/monthly, đỉnh chỉ số HOSE.
> Quy tắc dùng: sau khi mảng A vượt trội (RS dương), đọc B vượt VNI tháng sau. Luôn kèm hit-rate + n mẫu.

## 1. Chuỗi relative: A mạnh → B vượt VNI tháng sau bao nhiêu?

| Chuỗi | B vượt VNI TB/tháng | Hit | n | Đánh giá |
|---|---|---|---|---|
| **NH → Chứng khoán (RS 3M)** | **+3.16%** | **62%** | 47 | Hit cao nhất (đồng hạng) — xương sống rotation VN |
| **NH → Thép (RS 3M)** | **+3.78%** | 60% | 47 | Vượt trội trung bình cao nhất (thép là beta của NH) |
| NH → BĐS (RS 3M) | +1.53% | 62% | 47 | Vừa |
| NH → Chứng khoán (RS 1M) | +2.54% | 59% | 32 | Mạnh |
| BĐS → Chứng khoán (RS 3M) | **+3.13%** | 57% | 44 | Vòng 2 của sóng |
| Thép → Chứng khoán (RS 1M) | +3.13% | 54% | 35 | Vòng thép→CK (2021, 2023) |
| CK → CNTT (RS 3M) | +2.01% | 55% | 49 | Sóng growth đi cùng CK |
| CK → BĐS (RS 3M) | +1.56% | 59% | 49 | Vừa |
| BĐS → Dầu khí (RS 3M) | +0.86% | 50% | 44 | Yếu — dầu khí KHÔNG nối đuôi BĐS |
| NH → Dầu khí (RS 3M) | -0.56% | 45% | 47 | KHÔNG tồn tại |
| NH mạnh → Hàng tiêu dùng | **-1.70%** | 23% | 47 | Tiền RỜI defensives khi NH nóng |
| Dầu khí → Bank (RS 3M) | +0.99% | 55% | 42 | Yếu-vừa |

Chiều ngược kiểm chứng: CK → Bank +1.09% hit 61% (n=49) · Hóa chất → Bank +1.07% hit 59% (n=44).

## 2. Lead-lag tuần (corr, ai báo trước ai?)

| Cặp (A tuần t → B tuần t+1) | Corr | Đọc |
|---|---|---|
| **CK → BĐS** | **+17%** | CK là leading indicator tuần tốt nhất cho BĐS |
| **CK → VNINDEX** | **+11%** | CK báo trước thị trường chung |
| Bank → BĐS | +8% | Vừa |
| CK → Bank | +7% | Vừa |
| Bank → VNI | +6% | Yếu |
| BĐS → Bank | +5% | Yếu |

Lead-lag tháng: hầu hết ÂM nhẹ (mean-reversion tháng) — KHÔNG dùng horizon tháng để bắt lead-lag tuyến tính, chỉ dùng chuỗi relative mục 1.

## 3. Đọc RS 3M (mảng − VNI, cuộn 63 phiên)

- RS 3M > +15% sau giai đoạn bank dẫn = vùng quá nóng, thường đi trước đỉnh 1–3 tháng (mẫu: CK +30 Q4/2020, thép +40 H1/2021, BĐS +28 Q4/2021).
- RS 3M bank dương + CK dương + BĐS âm = đầu/giữa sóng (tiền chưa lan tới BĐS).
- RS 3M BĐS/utilities dương trong khi bank/CK đã âm = "last leg" cuối sóng.
- RS 3M mọi mảng âm sâu (< −20%) = bear hoặc pre-đáy; sau đó beta cao (thép/CK) hồi mạnh nhất (mẫu đáy 11/2022: thép +90%, CK +56% trong 3 tháng).

## 4. Quy tắc timing đỉnh (từ đỉnh chỉ số HOSE 2018→2026)

| Mẫu lịch sử | VNFIN đỉnh | VNI đỉnh | Chênh | VNREAL/VNUTI đỉnh |
|---|---|---|---|---|
| 2021 mega | 05/07/2021 | 25/11/2021 | **VNFIN sớm ~5 tháng** | 22–28/12/2021 (muộn ~1 tháng) |
| 2026 | 12/01/2026 | 18/05/2026 | **VNFIN sớm ~4 tháng** | VNREAL 04/09/2026 (muộn ~4 tháng) |
| 2025 | 21/08/2025 | 31/12/2025 | VNFIN sớm ~4 tháng | 24–29/12/2025 |
| 2024 | 09/10/2024 | 13/06/2024 | VNFIN muộn (ngoại lệ — đỉnh VNI sớm, tài chính rướn thêm) | — |

Quy tắc áp dụng:
1. **VNFIN đỉnh trước VNI 3–6 tháng = dấu hiệu cuối sóng** (2/3 chu kỳ lớn đúng: 2021, 2025–2026).
2. **VNREAL/VNUTI rướn sau đỉnh VNI 1–4 tháng = "last leg"** → thoát dần, không mua đuổi BĐS/utilities lúc này.
3. Đáy panic: mọi chỉ số cùng đáy một ngày (15/11/2022) trừ VNREAL đáy muộn ~1 tháng (26/12/2022) — BĐS luôn "chết cuối cùng", và cũng là mảng hồi yếu nhất sau đáy (+8% vs VNI +16% sau đáy 11/2022).
4. Ngoại lệ 2024 cho thấy quy tắc (1) sai khi VNI đỉnh sớm do nhóm trụ phi-tài-chính (VIC/VHM) kéo — luôn kiểm tra breadth (`breadth_scan`) kèm theo, sóng thiếu breadth thì timing đỉnh nhiễu.
