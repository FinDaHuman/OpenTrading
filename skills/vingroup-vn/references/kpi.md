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
| Bán lẻ (trung tâm thương mại) | Doanh thu thuê, dịch vụ và lưu lượng | Doanh thu cho thuê, diện tích, tỷ lệ lấp đầy |
| Khách sạn / nghỉ dưỡng | Du lịch | Doanh thu phòng, tỷ lệ lấp đầy |
| Dịch vụ (giáo dục, y tế) | Nhu cầu độc lập | Doanh thu, số học sinh/bệnh nhân |

## 2. Nhóm vòng quay BĐS

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Bán trước kỳ | `financial_detail` (nếu có) | Doanh số hợp đồng ký mới; không đồng nghĩa tiền người mua trả trước hay doanh thu ghi nhận |
| Tích luỹ chi phí dở | `financial_detail` | Chi phí dự án đang nằm trong tồn kho; không lấy chênh bán trước trừ chi phí dở để suy lãi |
| Biên lãi gộp mảng BĐS | `financial_detail` / công bố công ty | Đọc 4–8 quý trước khi nội suy (một đợt bàn giao làm nhảy) |
| Quỹ đất | Công bố doanh nghiệp qua `news_symbol`/`company_events`/`web_search` | Nguồn tăng trưởng tương lai của vòng BĐS |

## 3. Nhóm dòng tiền và đòn bẩy

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Nợ và trái phiếu | `financial_detail` | Đọc cùng lịch đáo hạn trong `news_market`; tập trung vài kỳ = rủi ro tái cấu |
| Tiền mặt | `financial_detail` | So với khoản đến hạn trong 6 tháng tới |
| Chi phí lãi và chi phí vốn bình quân | `financial_detail` / `news_market` | Tăng nhanh hơn doanh thu = lãi bị chi phí tài chính nuốt |
| Lỗ lũy kế mảng xe điện | BCTC/thuyết minh hãng qua `financial_detail`/`news_symbol`/`web_search` | Lỗ kế toán không đồng nhất tiền đã đốt; đối chiếu dòng tiền hoạt động và đầu tư |

## 4. Nhóm quản trị và chỉ số

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `company_events` | Thay đổi cơ cấu hợp nhất, thoái/tách/gộp mảng, giao dịch với cổ đông sáng lập | Muốn so sánh với kỳ trước, phải đọc trước khi nhìn doanh thu |
| `news_market` | Tường trái phiếu, phát hành mới, nhận định tác động chỉ số | Ghi rõ nguồn + ngày |
| `breadth_scan` | Độ rộng toàn sàn | Phát hiện "chỉ số do nhóm một mình kéo" trước khi kết luận toàn thị trường — `market_overview` chỉ đếm rổ bluechip nên không đủ làm bằng chứng |
| Nguồn công bố chỉ số có trọng số và ngày | Trọng số, biến động thành viên cùng chỉ số/cùng kỳ và mức chỉ số đầu kỳ | Chỉ tính đóng góp khi đủ dữ liệu tương thích; quote VN30 không có mẫu số vốn hóa sàn hoặc trọng số. Tỷ trọng vốn hóa sàn khác trọng số chỉ số và đóng góp điểm |
| `peer_compare` | Key tổng quan thực trả (P/B, ROE...) | KPI biên/đòn bẩy mảng phải đọc BCTC/công bố từng peer cùng kỳ; không so hợp nhất đa ngành với BĐS thuần |

## 5. Bẫy đọc thường gặp

- So doanh thu/lãi hợp nhất với kỳ trước khi vừa tách hoặc thoái mảng: kết luận vô
  nghĩa, đọc chênh lệch pháp nhân trước.
- Nhìn lãi tăng mạnh mà không đọc tỷ trọng đóng góp: phần lớn có thể đến từ một đợt
  bàn giao hoặc một giao dịch nội bộ.
- Dùng P/E hợp nhất để so với công ty BĐS thuần: mô hình khác nhau, cần SOTP.
