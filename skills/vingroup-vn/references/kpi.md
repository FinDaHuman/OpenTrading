# Chỉ báo tập đoàn Vingroup — tách mảng và đọc dòng tiền

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật về tra lịch nợ và tỷ trọng chỉ số nằm ở mục "Ranh
> giới" của SKILL.md; điều kiện vốn dự án BĐS nằm ở `bat-dong-san-vn`.

## 1. Tách mảng

| Mảng | Bám theo | Chỉ báo riêng |
|---|---|---|
| Bất động sản | Bàn giao, mở bán | Người mua trả tiền trước, hàng tồn kho dự án, biên mảng |
| Xe điện | Số xe giao, giá bán, chi phí sản xuất | Doanh thu, lỗ gộp, lỗ mảng |
| Bán lẻ, cho thuê | Giá thuê, lưu lượng khách | Doanh thu cho thuê, tỷ lệ lấp đầy |
| Nghỉ dưỡng, vui chơi | Du lịch | Doanh thu, công suất phòng |
| Giáo dục, y tế, khác | Nhu cầu riêng | Doanh thu, lợi nhuận mảng |

Lợi nhuận theo mảng: `financial_detail(statement=TM)` của VIC. Thiếu chi tiết thì đọc
riêng công ty con niêm yết (VHM, VRE) và ghi rõ.

## 2. Dòng tiền và nợ

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Vay ngắn hạn + nợ dài hạn đến hạn | CDKT | Phần phải trả trong 12 tháng |
| Trái phiếu, lịch đáo hạn | TM, công bố (`web_search`) | Dựng lịch theo quý; đáo hạn tập trung = rủi ro tái cấp vốn |
| Tiền và tương đương tiền | CDKT | So với nợ đến hạn 4 quý tới |
| Chi phí lãi vay | KQKD | Tăng nhanh hơn doanh thu = chi phí tài chính ăn vào lãi |
| Lưu chuyển tiền từ hoạt động kinh doanh | LCTT | Âm kéo dài khi lợi nhuận dương = lãi chưa thành tiền |
| Giao dịch với bên liên quan | TM | Quy mô so với lợi nhuận kỳ; chuyển nhượng công ty con là một lần |

## 3. SOTP (tự tính, ghi rõ giả định)

| Phần | Cách tính |
|---|---|
| Công ty con niêm yết | Vốn hoá = số cổ phiếu lưu hành (KLCPLH) × giá, cả hai trong `stock_overview` từng mã; × tỷ lệ sở hữu của VIC (TM hoặc `vn_company(detail=true)`) |
| Mảng chưa niêm yết | Phương pháp hợp mảng; không đủ số thì ghi "chưa định giá" thay vì đoán |
| Nợ ròng công ty mẹ | Nợ vay công ty mẹ − tiền công ty mẹ (BCTC riêng nếu có) |
| Chiết khấu tập đoàn | Nêu mức giả định và lý do |

## 4. Bẫy đọc thường gặp

- So số hợp nhất với kỳ trước khi vừa tách hoặc bán một công ty con.
- Lãi tăng mạnh mà không đọc đóng góp theo mảng: có thể chỉ một đợt bàn giao hoặc một
  giao dịch nội bộ.
- Dùng P/E hợp nhất so với công ty BĐS thuần: mô hình khác nhau.
