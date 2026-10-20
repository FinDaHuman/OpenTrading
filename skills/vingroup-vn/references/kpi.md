# Chỉ báo tập đoàn Vingroup — tách mảng và đọc dòng tiền

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `company_events` / `news_market` gần nhất và ghi kỳ kèm theo.
> Luật về trần nợ của mảng bất động sản nằm ở `bat-dong-san-vn`; luật về chuỗi và
> mảng Vin theo chu kỳ nằm ở `dinh-vi-chu-ky-vn` — không lặp lại ở đây.

## 1. Tách mảng

| Mảng | Chu kỳ bám | Chỉ báo riêng |
|---|---|---|
| Bất động sản nhà ở | Bàn giao dự án + bán trước | Bán trước, tích luỹ chi phí dở, biên lãi gộp mảng |
| Xe điện | Quy mô sản lượng + chi phí/biến | Doanh thu, lỗ lũy kế, tỷ lệ biên âm |
| Bán lẻ (trung tâm thương mại) | Toàn bộ thuế dịch vụ + lưu lượng | Doanh thu cho thuê, diện tích, tỷ lệ lấp đầy |
| Khách sạn / nghỉ dưỡng | Du lịch | Doanh thu phòng, tỷ lệ lấp đầy |
| Dịch vụ (giáo dục, y tế) | Nhu cầu độc lập | Doanh thu, số học sinh/bệnh nhân |

## 2. Nhóm vòng quay BĐS

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Bán trước kỳ | `financial_detail` (nếu có) | Khoản thu trước — chưa phải lãi; đọc cùng tích luỹ chi phí dở |
| Tích luỹ chi phí dở | `financial_detail` | Chi phí đã cam kết chưa nhận; chênh giữa hai bên là lãi tương lai chưa chắc ăn khi bị siết |
| Biên lãi gộp mảng BĐS | `financial_detail` / công bố công ty | Đọc 4–8 quý trước khi nội suy (một đợt bàn giao làm nhảy) |
| Quỹ đất | `news_market` | Nguồn tăng trưởng tương lai của vòng BĐS |

## 3. Nhóm dòng tiền và đòn bẩn

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Nợ và trái phiếu | `financial_detail` | Đọc cùng lịch đáo hạn trong `news_market`; tập trung vài kỳ = rủi ro tái cấu |
| Tiền mặt | `financial_detail` | So với khoản đến hạn trong 6 tháng tới |
| Chi phí lãi và chi phí vốn bình quân | `financial_detail` / `news_market` | Tăng nhanh hơn doanh thu = lãi bị chi phí tài chính nuốt |
| Lỗ lũy kế mảng xe điện | `news_market` | Nguồn đốt tiền mặt chính của tập đoàn |

## 4. Nhóm quản trị và chỉ số

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `company_events` | Thay đổi cơ cấu hợp nhất, thoái/tách/gộp mảng, giao dịch với cổ đông sáng lập | Muốn so sánh với kỳ trước, phải đọc trước khi nhìn doanh thu |
| `news_market` | Tường trái phiếu, phát hành mới, nhận định tác động chỉ số | Ghi rõ nguồn + ngày |
| `market_overview` | Độ rộng chỉ số, tỷ trọng nhóm lớn | Phát hiện "chỉ số do nhóm một mình kéo" trước khi kết luận toàn thị trường |
| `peer_compare` | Biên và đòn bẩy so với nhóm BĐS lớn | So mảng BĐS với mảng BĐS, không so hợp nhất với BĐS thuần |

## 5. Bẫy đọc thường gặp

- So doanh thu/lãi hợp nhất với kỳ trước khi vừa tách hoặc thoái mảng: kết luận vô
  nghĩa, đọc chênh lệch pháp nhân trước.
- Nhìn lãi tăng mạnh mà không đọc tỷ trọng đóng góp: phần lớn có thể đến từ một đợt
  bàn giao hoặc một giao dịch nội bộ.
- Dùng P/E hợp nhất để so với công ty BĐS thuần: mô hình khác nhau, cần SOTP.
