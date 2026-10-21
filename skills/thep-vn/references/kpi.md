# Chỉ báo ngành thép — dòng BCTC và cách đọc

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi — cột "Statement" ghi sẵn. Giá nguyên liệu và giá thép thị
> trường không có trong BCTC: tra bằng `web_search`, ghi nguồn, ngày và loại giá.

## 1. Doanh thu, giá vốn, biên

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu thuần | KQKD | Tách phần do giá và do sản lượng khi có sản lượng công bố |
| Giá vốn hàng bán | KQKD | Chứa nguyên liệu; tăng nhanh hơn doanh thu = biên đang nén |
| Biên lãi gộp (tự tính) | KQKD | Đọc 4 quý liền; một quý cải thiện có thể do tồn kho giá rẻ |
| Giá bán bình quân (tự tính) | KQKD + sản lượng công bố | Doanh thu / sản lượng bán; so với giá thị trường cùng kỳ |
| Doanh thu theo sản phẩm, thị trường | TM | Tỷ trọng xuất khẩu và nhóm sản phẩm |

## 2. Tồn kho và vốn

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Hàng tồn kho | CDKT (chi tiết ở TM) | Nguyên liệu nhiều = độ trễ chi phí dài |
| Số ngày tồn kho (tự tính) | CDKT + KQKD | Tồn kho bình quân / giá vốn quý × 90. Cao và mua lúc giá đỉnh = biên còn nén |
| Vay ngắn hạn, chi phí lãi vay | CDKT, KQKD | Tồn kho lớn vay ngắn hạn tài trợ: lãi suất tăng làm chi phí mang hàng nặng thêm |
| EBITDA, EV (tự tính) | KQKD + LCTT + CDKT | EBITDA = lợi nhuận trước thuế + chi phí lãi vay + khấu hao (LCTT); EV = vốn hoá + nợ vay − tiền. Ghi công thức |

## 3. Đầu vào thị trường (tra ngoài BCTC)

| Chỉ báo | Nguồn | Cách đọc |
|---|---|---|
| Quặng sắt, than cốc | `web_search` | Đầu vào lò cao; ghi loại giá (ví dụ giao Trung Quốc) và ngày |
| Thép phế | `web_search` | Đầu vào lò điện |
| Thép cuộn nóng khu vực | `web_search` | Giá tham chiếu cho thép cuộn và nhà máy tôn mạ mua cuộn đầu vào |
| Giá thép xây dựng trong nước | `web_search`, công bố nhà sản xuất | Giá áp dụng thực tế cho thép xây dựng |

## 4. Bẫy đọc thường gặp

- Doanh thu tăng nhưng lãi giảm: xem spread và tồn kho trước khi nói "quản trị kém".
- Giá thép quốc tế tăng trong khi giá trong nước giảm: hàng nhập đang ép giá, không
  phải cơ hội.
- Biên một quý hồi mạnh: kiểm tra có phải nhờ tồn kho giá rẻ trước khi nội suy.
