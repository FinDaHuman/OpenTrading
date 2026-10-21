# Chỉ báo ngành dầu khí — đọc theo mảng

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật "không xếp dầu khí vào chuỗi luân chuyển" nằm ở mục
> "Ranh giới" của SKILL.md.

## 1. Nhận diện mảng

| Mảng | Nhận diện | Bám theo | Chỉ báo riêng |
|---|---|---|---|
| Khai thác | Doanh thu bán dầu thô, khí | Giá dầu, sản lượng, trữ lượng | Sản lượng, chi phí khai thác/thùng (nếu công bố) |
| Dịch vụ kỹ thuật | Doanh thu khoan, xây lắp, cho thuê giàn | Chi tiêu đầu tư của chủ mỏ | Giá trị hợp đồng mới, hiệu suất sử dụng giàn, giá thuê ngày |
| Vận chuyển | Doanh thu cước tàu | Cước, độ dài tuyến | Tỷ lệ hợp đồng dài hạn, đội tàu |
| Lọc hoá dầu | Doanh thu sản phẩm lọc | Chênh lệch lọc dầu | Biên lãi gộp, lãi/lỗ tồn kho |
| Phân phối khí, xăng dầu | Doanh thu bán khí, LPG, xăng dầu | Sản lượng, giá điều hành | Sản lượng tiêu thụ, biên phân phối |

Doanh thu theo mảng: `financial_detail(statement=TM)`. Không tách được thì nói rõ
đang đọc số hợp nhất.

## 2. Dòng BCTC

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu, giá vốn, biên lãi gộp | KQKD | Đọc theo mảng; biên hợp nhất che dịch chuyển giữa các mảng |
| Hàng tồn kho | CDKT | Lọc dầu, phân phối: tồn kho lớn khi giá biến động mạnh = lãi/lỗ tồn kho một lần |
| Phải thu khách hàng | CDKT | Dịch vụ: phải thu chủ mỏ tăng nhanh hơn doanh thu = thanh toán chậm |
| Chi phí thăm dò, tài sản dầu khí | TM | Khai thác: đầu tư thăm dò giảm kéo dài = sản lượng tương lai giảm |
| Khấu hao | LCTT | Dùng tính EBITDA |

## 3. Đầu vào thị trường

| Chỉ báo | Nguồn | Cách dùng |
|---|---|---|
| Brent, WTI | `yf_commodities` | Mốc tham chiếu; không thay giá bán thực |
| Khí tự nhiên tham chiếu (Henry Hub) | `yf_commodities` | Chỉ là bối cảnh; giá khí trong nước theo hợp đồng riêng |
| Chênh lệch lọc dầu, cước tàu, giá thuê giàn | `web_search` | Ghi nguồn, ngày và loại chỉ số |

## 4. Bẫy đọc thường gặp

- "Giá dầu tăng thì cả ngành hưởng": dịch vụ đi sau 2–4 quý, phân phối có thể chỉ có
  lãi tồn kho một lần.
- Lãi tăng vọt một quý ở lọc dầu, phân phối: kiểm tra lãi tồn kho trước khi nội suy.
- Sản lượng hiện tại đẹp: kiểm tra trữ lượng và mỏ mới trước khi nói bền vững.
