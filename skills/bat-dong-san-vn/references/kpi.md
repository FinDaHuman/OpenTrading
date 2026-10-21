# Chỉ báo ngành bất động sản — dòng báo cáo và cách đọc

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `news_market` gần nhất và ghi kỳ kèm theo. Luật về trần nợ
> theo quy mô dự án và cách tính đòn bẩy chỉ nằm ở §Trụ cột driver của SKILL.md —
> không lặp lại ở đây.

## 1. Nhóm dòng vốn

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Nợ vay | `financial_detail` | Xu hướng 4–8 quý. Tăng nhanh hơn vốn chủ = đòn bẩy đang giãn |
| Trái phiếu phát hành | `financial_detail` | Đọc cùng lãi suất phát hành (bên ngoài): nợ **đắt** tăng nhanh là tín hiệu trước, không phải sau |
| Vốn chủ | `financial_detail` | Mẫu số cho đòn bẩy theo trần quy định |
| Chi phí lãi thuần | `financial_detail` | Tăng nhanh hơn tổng nợ = lãi bình quân đang lên |
| Tiền thu từ khách hàng | `financial_detail` | Vốn ứng dài hạn rẻ: tăng đều là tiếp sức; giảm là dấu hiệu bán chậm trước khi doanh thu nhận bị ảnh hưởng |

## 2. Nhóm chất lượng bán hàng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Bán trước (ký trong kỳ) | Công bố doanh nghiệp; `planned_targets` chỉ là kế hoạch | Đọc cùng biên lãi gộp: bán trước tăng + biên giảm = tăng trưởng bằng giảm giá |
| Backlog hợp đồng chưa ghi nhận | Công bố doanh nghiệp/thuyết minh | Không đồng nhất với tiền người mua trả trước hoặc doanh thu chưa thực hiện kế toán; theo dõi bàn giao và hủy hợp đồng |
| Tích luỹ chi phí dở | `financial_detail` | Cơ sở nhận lãi khi bàn giao. So với doanh thu chưa ghi nhận để xem giai đoạn còn dài hay ngắn |
| Biên lãi gộp mảng BĐS | `financial_detail` | Chỉ tiêu chất lượng của ngành. Biên giảm dù doanh thu tăng = cung cạnh tranh hoặc chiết khấu |

## 3. Nhóm phân khúc

| Phân khúc | Đọc gì | So với ai |
|---|---|---|
| Nhà ở thương mại | Bán trước, biên, tích luỹ chi phí dở, lãi vay chịu | Nhóm cùng phân khúc nhà ở |
| Công nghiệp | Diện tích cho thuê mới, diện tích đã cho thuê, giá thuê bình quân, tỷ lệ lấp đầy | Nhóm KCN cùng khu vực (bắc / nam) |
| Bán lẻ – dịch vụ | Doanh thu dịch vụ, tỷ lệ lấp đầy, chi phí vận hành | Nhóm bán lẻ; đọc thêm `tieu-dung-ban-le-vn` |

## 4. Nhóm đối chiếu bên ngoài

| Nguồn | Đọc gì | Khi nào |
|---|---|---|
| `news_market` | Tăng trưởng tín dụng ngành, phát hành + lãi trái phiếu, tường đáo hạn, cung mới theo kỳ | Mỗi lần cần số ngành; ghi rõ nguồn và kỳ |
| `company_events` | Phê duyệt dự án, tăng vốn, chào bán trái phiếu | Trước khi kết luận tiến độ hoặc kế hoạch vốn |
| `event_calendar_vn` | Họp cổ đông, ngày chốt, lịch công bố | Neo mốc thời gian cho kỳ vọng |
| `planned_targets` | Kế hoạch doanh thu/lãi/bán trước | Neo kỳ vọng và đối chiếu kết quả đã công bố |

## 5. Bẫy đọc thường gặp

- So đòn bẩy giữa hai phân khúc: nhà ở và công nghiệp có trần nợ và vòng quay vốn
  khác nhau.
- Doanh thu BĐS nhảy giữa các quý do bàn giao mất đều — đọc 4 quý và backlog, đừng
  đọc một quý.
- Tín dụng ngành siết nhưng doanh nghiệp vẫn tăng trưởng: nguồn có thể là vốn ứng
  từ khách hàng hoặc trái phiếu — phân biệt trước khi kết luận chất lượng.
