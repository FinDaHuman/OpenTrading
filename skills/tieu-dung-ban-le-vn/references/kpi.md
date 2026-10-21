# Chỉ báo ngành tiêu dùng & bán lẻ — cách đọc sức mua thật

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `vs_indicator_data` gần nhất và ghi kỳ kèm theo. Luật về
> phân biệt danh nghĩa – thực chỉ nằm ở §Trụ cột driver của SKILL.md — không lặp
> lại ở đây.

## 1. Phân khúc

| Phân khúc | Chu kỳ bám | Lưu ý đọc |
|---|---|---|
| Thực phẩm – hàng thiết yếu | Thu nhập + giá thị trường | Chu kỳ êm; biên phụ thuộc giá nguyên liệu thực phẩm |
| Bán lẻ điện tử tiêu dùng | Chu kỳ thay thế thiết bị | Chu kỳ riêng — **không** dùng driver hàng thực phẩm |
| Dịch vụ tiêu dùng (ăn uống, du lịch) | Thu nhập + du lịch | Tăng theo mùa; đọc kèm du lịch trong `vs_indicator_data` |

## 2. Nhóm sức mua

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Tổng mức bán lẻ danh nghĩa | `vs_indicator_data(category_id từ vs_categories)` | Chỉ là điểm khởi đầu — chưa kết luận gì. Không có preset; phải tra category trước |
| Chỉ số giá tiêu dùng | `vs_indicator_data(indicator="CPI")` | Mẫu số để ra tăng trưởng thực — CPI có preset sẵn |
| Chỉ số giá lõi | `vs_indicator_data(category_id từ vs_categories)` | Lõi cao hơn mục tiêu = áp lực sức mua — không có preset |
| Bán lẻ thực | Tự tính (ghi rõ công thức) | Tăng trưởng thực âm = danh nghĩa đến từ giá |

## 3. Nhóm chất lượng tăng trưởng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu | `financial_detail` | Đọc cùng số điểm bán và biên, không riêng lẻ |
| Tăng trưởng cùng cửa | Tự tính nếu công bố cho phép (ghi rõ) | Vượt trội hơn tăng trưởng từ mở cửa trong đánh giá thị phần |
| Biên lãi gộp | `financial_detail` | Giảm trong 2 quý liền cùng với tăng trưởng mạnh = dấu hiệu khuyến mại mua đà |
| Tồn kho | `financial_detail` | Tồn kho tăng nhanh hơn doanh thu = bán chậm hơn dự kiến |
| Công nợ | `financial_detail` | Phải thu khách hàng tăng nhanh = bán chịu, đặc biệt kênh truyền thống |

## 4. Nhóm đối chiếu bên ngoài

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `news_market` | Chính sách thuế và hiệu lực, thu nhập/tiền lương, mở cửa/đóng cửa, thị phần | Ghi rõ văn bản + ngày |
| `vs_indicator_data` | Thu nhập, tiêu dùng, lạm phát | Sức mua thật; đọc cả danh nghĩa và thực |
| `planned_targets` | Kế hoạch doanh thu/lãi/mở cửa | Neo kỳ vọng |
| `peer_compare` | Chỉ tỷ lệ định giá (P/E, P/B, ROE) | So trong cùng phân khúc — chỉ báo vận hành đọc bằng `financial_detail` từng peer, KHÔNG hỏi `peer_compare` |

## 5. Bẫy đọc thường gặp

- Báo cáo "bán lẻ tăng trưởng hai con số" mà không hỏi lạm phát: đó là tăng trưởng
  giá, không phải sức mua.
- Mở cửa nhanh trong khi cùng cửa chững: tăng trưởng đến từ mở rộng, dễ đảo chiều
  khi mở rộng chậm.
- Một quý biên giảm sau khuyến mại lớn: đọc 2 quý liền trước khi kết luận ép biên.
