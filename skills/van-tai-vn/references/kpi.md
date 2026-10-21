# Chỉ báo ngành vận tải & logistics — phân khúc và cách đọc

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật về tra cước và khung giá nằm ở mục "Ranh giới" của
> SKILL.md.

## 1. Phân khúc

| Phân khúc | Bám theo | Chỉ báo riêng | So với |
|---|---|---|---|
| Cảng, bến | Sản lượng qua cảng, khung giá xếp dỡ, công suất | Sản lượng thông qua, hiệu suất bến | Cảng cùng khu vực |
| Tàu container | Cước container, giá thuê tàu | Tỷ lệ hợp đồng cố định, đội tàu | Tàu container |
| Tàu hàng rời, tàu dầu | Cước hàng rời/tàu dầu, độ dài tuyến | Giá thuê định hạn, tuổi tàu | Cùng loại tàu |
| Logistics, kho bãi | Sản lượng xuất nhập khẩu | Diện tích kho, sản lượng giao nhận | Logistics |
| Hàng không | Lượng khách, nhiên liệu bay, tỷ giá | Số khách, hệ số sử dụng ghế, đội tàu bay khai thác | Hàng không |

## 2. Dòng BCTC

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu, giá vốn, biên lãi gộp | KQKD | Đọc theo phân khúc; hợp nhất che chênh lệch cảng – tàu |
| Doanh thu theo mảng | TM | Xác định phân khúc chính |
| Doanh thu trên đơn vị sản lượng (tự tính) | KQKD + sản lượng công bố | Doanh thu / TEU hay tấn; tăng khi sản lượng giảm = tăng nhờ giá, khó bền |
| Tài sản cố định, xây dựng dở dang | CDKT | Tàu, bến mới sắp đưa vào: khấu hao và lãi vay sẽ tăng trước sản lượng |
| Vay, chi phí lãi vay | CDKT, KQKD | Đầu tư tàu/bến bằng vay: lãi vay chạy trước doanh thu |
| Khấu hao | LCTT | Dùng tính EBITDA |

## 3. Ngoài BCTC

| Chỉ báo | Nguồn | Cách dùng |
|---|---|---|
| Chỉ số cước container, hàng rời, giá thuê tàu | `web_search` | Ghi tên chỉ số + ngày; cước là chu kỳ ngắn |
| Sản lượng qua cảng khu vực | `web_search`, `news_symbol` | Ghi kỳ và khu vực |
| Kim ngạch xuất khẩu | `vs_indicator_data(indicator="XK")` | Bối cảnh tổng khối lượng; nhập khẩu cần `web_search` hoặc catalogue chỉ tiêu |
| Thị trường xuất khẩu theo nước | `vs_xnk_detail(direction="xk")` | Cơ cấu thị trường đích — gợi ý tuyến chịu thuế quan |
| Dầu, dầu đốt tham chiếu | `yf_commodities` | Bối cảnh chi phí nhiên liệu |

## 4. Bẫy đọc thường gặp

- Doanh thu tăng trong khi sản lượng chững: tăng nhờ giá/cước, hạ độ tin cậy khi cước
  đảo chiều.
- Cước tàu dầu cao không có nghĩa tàu container hưởng: hai chu kỳ khác nhau.
- Biên hồi một quý nhờ nhiên liệu giảm: đọc 2 quý liền trước khi nội suy.
