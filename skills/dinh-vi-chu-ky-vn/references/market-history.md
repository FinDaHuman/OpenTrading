# Lịch sử chu kỳ VN 2011→ (đối chiếu pha — narrative giữ, số tra tool)

> Timeline và nguyên nhân là tri thức nền (giữ trong file). Mọi con số returns/đỉnh/đáy tra tools (`cycle_turning`, `cycle_trough_events`, `cycle_yearly`).

## 1. Timeline – nguyên nhân (mức đỉnh/đáy: tra `cycle_turning(year=...)`)

| Giai đoạn | Diễn biến | Nguyên nhân chính |
|---|---|---|
| 2012 | Đáy đầu năm, hồi cuối năm | Nợ xấu, thắt chặt 2011; tín dụng phục hồi |
| 2014 | Sập giữa năm rồi hồi | Sự kiện biển Đông |
| 2016–2017 | Uptrend dài | Tín dụng cao, bank + Vingroup dẫn dắt |
| 2018 | Đỉnh tháng 4, chỉnh sâu | Fed thắt chặt, chiến tranh thương mại Mỹ–Trung |
| 2019 | Đi ngang | VIC/VHM + VCB dẫn dắt |
| 2020 | Đáy COVID tháng 3, hồi mạnh cuối năm | SBV hạ lãi suất điều hành 3 lần; tiền rẻ + margin |
| 2021 | Mega-cycle, đỉnh cuối năm | Lãi suất đáy, nhà đầu tư mới + margin; CK→Bank→BĐS→thép→dầu khí |
| 2022 | Đỉnh đầu năm, đáy panic cuối năm | Vạn Thịnh Phát/SCB, trái phiếu DN, Fed tăng lãi suất |
| 2023 | Hồi | SBV hạ lãi suất nhiều lần; CK-growth hồi |
| 2024 | Đi ngang biên rộng | Tín dụng tăng; CNTT bứt phá |
| 2025 | Sốc thuế quan tháng 4, rồi uptrend mạnh | Kỳ vọng FTSE nâng hạng, tín dụng cao |
| 2026 | Chốt lời sau nâng hạng | Brent cao; năm chưa kết thúc — tra `cycle_yearly(year=2026)`, ghi rõ "tính đến `as_of`" |

Bảng trên là ghi chú định tính, chưa kiểm chứng bằng tool. Muốn nêu mức điểm, ngày hay % của năm nào thì tra `cycle_turning` / `cycle_yearly` trước.

> `cycle_yearly` xếp hạng theo **lợi suất năm tuyệt đối**, không phải RS (RS = lợi suất vượt VNI). Muốn "mảng dẫn RS" thì tự trừ lợi suất VN-Index cùng năm và nói rõ cách tính.

## 2. Ai dẫn sau các đáy lớn (tra `cycle_trough_events`)

Cách đọc:
- Số đáy đủ dữ liệu ít (coverage từ 2018-10) — **nêu số đáy theo kết quả tool** và coi là mẫu nhỏ.
- Chỉ mảng **top 3 ở mọi đáy** mới coi là nhóm dẫn sau đáy. Xếp hạng tự tính từ lợi suất 3 tháng sau đáy mà tool trả (tool không có cột rank).
- "Thứ hạng lệch rõ" = một đáy vào top 3 nhưng đáy khác nằm ngoài top 5 → mảng đó không dùng làm kinh nghiệm bắt đáy.
- Cột `vin` đọc như mọi cột: thứ hạng lệch giữa các đáy thì không dùng.
- **Dưới 3 đáy: chỉ nêu dạng quan sát, không chốt nhóm dẫn.**
- Không trích thứ hạng từ file này.

## 3. Quán quân theo năm (tra `cycle_yearly`)

Cách đọc: xếp mảng theo lợi suất năm rồi đối chiếu **loại năm** trong bảng mục 1 (mega-cycle, bear, hồi, năm có sóng riêng) để tìm pha lịch sử tương đồng. Loại năm chỉ là nhãn của timeline — **không** suy ra mảng dẫn từ đó; mảng dẫn phải tra `cycle_yearly` mỗi lần dùng. Năm chưa kết thúc thì ghi rõ "tính đến `as_of`" (`as_of` lấy từ `cycle_stats_check`).
