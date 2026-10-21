# Chỉ báo ngành tiêu dùng & bán lẻ — cách đọc sức mua thật

> File này giữ **cách đọc**, không giữ số kỳ nào. `financial_detail` nhận một
> `statement` mỗi lời gọi. Luật "không dùng số danh nghĩa thay số thực" nằm ở mục
> "Ranh giới" của SKILL.md.

## 1. Phân khúc

| Phân khúc | Bám theo | Đọc thêm |
|---|---|---|
| Bách hoá, thực phẩm thiết yếu | Thu nhập, giá thực phẩm | Doanh thu/cửa hàng, biên sau khuyến mại |
| Điện máy, điện thoại | Chu kỳ thay thiết bị, tín dụng tiêu dùng | Tồn kho, mùa ra mắt sản phẩm |
| Trang sức | Giá vàng, nhu cầu cưới hỏi, quà tặng | Biên khi giá vàng biến động mạnh |
| Nhà thuốc | Nhu cầu ổn định, mở chuỗi | Doanh thu/cửa hàng, thời gian hoà vốn cửa hàng |
| Nhà sản xuất hàng tiêu dùng | Sản lượng, giá nguyên liệu, kênh phân phối | Biên lãi gộp, chi phí bán hàng |

## 2. Sức mua

| Chỉ báo | Nguồn | Cách đọc |
|---|---|---|
| Tổng mức bán lẻ hàng hoá và dịch vụ | `vs_categories` → `vs_indicator_data(category_id, term_type_id)` | Không có preset; tra category trước |
| CPI | `vs_indicator_data(indicator="CPI")` | Có preset |
| Bán lẻ thực (tự tính) | Hai dòng trên | (1 + tăng trưởng danh nghĩa) / (1 + lạm phát) − 1, cùng kỳ so sánh; ghi rõ đã dùng chỉ số giá nào |
| Thu nhập bình quân | `vs_categories` nếu có chuỗi, không thì `web_search` | Ghi kỳ và nguồn |

## 3. Dòng BCTC

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Doanh thu theo chuỗi/mảng | TM | Xác định phân khúc chính |
| Doanh thu, giá vốn, biên lãi gộp | KQKD | Biên giảm 2 quý liền khi doanh thu tăng mạnh = mua tăng trưởng bằng giá |
| Chi phí bán hàng | KQKD | Tăng nhanh hơn doanh thu = chi phí mở mới, khuyến mại, thuê mặt bằng |
| Hàng tồn kho | CDKT | Tăng nhanh hơn doanh thu = bán chậm hơn kế hoạch |
| Phải trả người bán | CDKT | Chuỗi lớn dùng vốn nhà cung cấp; giảm đột ngột = nhà cung cấp siết điều kiện |
| Tăng trưởng cùng cửa hàng (tự tính) | Doanh thu + số cửa hàng công bố | Doanh thu / số cửa hàng hoạt động đủ kỳ; ghi rõ là ước lượng nếu công ty không công bố |

## 4. Bẫy đọc thường gặp

- "Bán lẻ tăng hai con số" mà không trừ lạm phát.
- Mở cửa hàng nhanh trong khi cùng cửa hàng chững: tăng trưởng mượn từ mở rộng.
- Một quý biên giảm sau đợt khuyến mại lớn: đọc 2 quý liền trước khi kết luận.
