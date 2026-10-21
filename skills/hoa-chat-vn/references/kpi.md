# Chỉ báo ngành phân bón & hoá chất — cách đọc theo cửa sổ giá

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật về tra chính sách và thuế nằm ở mục "Ranh giới" của
> SKILL.md.

## 1. Nhóm sản phẩm

| Nhóm | Giá bám | Chi phí chính | So với |
|---|---|---|---|
| Phân đạm (ure) | Giá ure thế giới và trong nước | Khí (giá theo hợp đồng) hoặc than | Nhà máy ure |
| Lân, NPK | Giá trong nước, mùa vụ | Quặng apatit, lưu huỳnh, ure/kali đầu vào | Nhà sản xuất lân, NPK |
| Phốt pho vàng, hoá chất phốt pho | Giá Trung Quốc và xuất khẩu | Quặng apatit, điện, than cốc | Hoá chất phốt pho |
| Hoá chất cơ bản (xút, clo, axit) | Giá trong nước, khách công nghiệp | Muối, điện | Hoá chất cơ bản |

## 2. Dòng BCTC

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu theo sản phẩm, xuất khẩu | TM | Xác định nhóm và tỷ lệ xuất khẩu |
| Doanh thu, giá vốn | KQKD | Tách giá và sản lượng nếu có sản lượng công bố |
| Biên lãi gộp (tự tính) | KQKD | Đọc **2 quý liền**: một quý mở có thể nhờ tồn kho giá rẻ |
| Giá bán bình quân (tự tính) | KQKD + sản lượng | So với giá tham chiếu để xem công ty nhận đủ cửa sổ giá không |
| Hàng tồn kho | CDKT | Tồn kho thành phẩm tăng mạnh = bán chậm hơn sản xuất |
| Số ngày tồn kho (tự tính) | CDKT + KQKD | Tồn kho bình quân / giá vốn quý × 90 |
| Tiền, tiền gửi | CDKT | Nhiều doanh nghiệp đầu ngành giữ tiền lớn: thu lãi tiền gửi đỡ lợi nhuận khi cửa sổ đóng |

## 3. Ngoài BCTC

| Chỉ báo | Nguồn | Cách dùng |
|---|---|---|
| Giá ure, DAP, phốt pho vàng | `web_search` | Ghi loại giá (khu vực, điều kiện giao) + ngày |
| Chính sách xuất khẩu Trung Quốc | `web_search` | Ghi thông báo + ngày |
| Giá dầu tham chiếu | `yf_commodities` | Hướng giá khí đầu vào nếu hợp đồng gắn giá dầu |
| Mùa vụ, giá lúa | `web_search` | Cầu trong nước |

## 4. Bẫy đọc thường gặp

- Một quý lãi nhảy mạnh: kiểm tra tồn kho giá rẻ trước khi nội suy.
- Giá thế giới tăng nhưng công ty bán chủ yếu trong nước: phần được hưởng nhỏ hơn
  công ty xuất khẩu.
- Trung Quốc nới xuất khẩu: giá cả nhóm bị kéo xuống dù công ty không xuất sang
  Trung Quốc.
