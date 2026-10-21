# Chỉ báo ngành ngân hàng — dòng BCTC và cách đọc

> Tra `vs_financial_norms(btype=3)` để lấy đúng tên dòng BCTC loại ngân hàng; file
> này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ `financial_detail`
> gần nhất và ghi kỳ báo cáo kèm theo. Luật ngưỡng chuẩn mực chỉ nằm ở mục
> "Ranh giới" của SKILL.md — không lặp lại ở đây.

## 1. Nhóm thu nhập

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Thu nhập lãi thuần | `financial_detail` (chuẩn ngân hàng) | Xu hướng theo quý, không chỉ tuyệt đối. Lãi thuần tăng nhưng biên NIM nén = tăng trưởng bằng tài sản, chưa phải bằng chất lượng |
| Lãi thuần ngoài lãi | `financial_detail` | Tỷ trọng càng cao càng phụ thuộc thị trường + chính sách; tăng trưởng lệch giữa 2 mảng phải có lý do rõ |
| Chi phí thu nhập lãi thuần | `financial_detail` | So QoQ. Tăng nhanh hơn tỷ suất sinh lợi trên tài sản = spread nén |
| Biên lãi thuần | Tính từ các dòng trên | Đọc cùng chi phí vốn, không đọc riêng lẻ: cùng một mức biên có thể đến từ 2 nguyên nhân ngược nhau |

## 2. Nhóm chất lượng tài sản

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Tỷ lệ nợ xấu | `financial_detail` | Lớp **đã xảy ra**. Phẳng nhưng nợ nhóm 2 tăng → rủi ro đang hình thành, đọc tiếp 2 dòng dưới |
| Tỷ lệ nợ nhóm 2 (cần chú ý) | `financial_detail` | Lớp **đang hình thành**. Tăng liên tục 2 quý trong khi nợ xấu phẳng là tín hiệu trước |
| Tỷ lệ bao phủ nợ vay | `financial_detail` | Lớp **đệm**. Giảm = đệm mỏng, dù nợ xấu đẹp. Hạ độ tin cậy khi đệm giảm và nợ xấu phẳng |
| Chi phí rủi ro tín dụng | `financial_detail` | So với lợi nhuận trước dự phòng: chi phí rủi ro nuốt phần lớn tăng trưởng thì tăng trưởng là hình thức |
| Nợ nhóm 2 → nợ xấu (tỷ lệ di cư) | Tính từ 2 dòng trên, ghi rõ là tự tính | Tỷ lệ càng cao thì càng ít nợ "hồi phục", chất lượng xấu hơn vẻ ngoài |

## 3. Nhóm tăng trưởng & vốn

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Tăng trưởng tín dụng YTD | `financial_detail` + phân phối hạn mức trong `news_market` | **Không kết luận "tăng trưởng tốt/xấu" khi chưa có hạn mức**: so với hạn mức được công bố mới có nghĩa. Thiếu hạn mức ghi rõ |
| Tăng trưởng tiền gửi YTD | `financial_detail` | Khoảng cách (tín dụng − tiền gửi) là áp lực huy động: âm lớn thì phụ thuộc liên ngân hàng và giấy tờ có giá |
| CASA | `financial_detail` | Chỉ đọc khi đặt cạnh spread: đây là **đệm** chi phí vốn, không phải mục tiêu tự thân |
| Trích lãi | `financial_detail` | So với ngưỡng chuẩn mực hiện hành (tra văn bản), không so với trí nhớ |
| Mức vốn chủ sở hữu | `financial_detail` | So với chuẩn mực hiện hành; chưa đạt phải đọc kèm hạn mức phát hành thêm trong `news_market` |
| Ngoại bảng (tín dụng tương đương) | `financial_detail` nếu kỳ có, nếu không thì `news_market` | Tỷ trọng so với tín dụng trên bảng. Không đưa vào kết luận nợ xấu, nhưng phải nằm trong đánh giá rủi ro |

## 4. Nhóm theo báo cáo

| Kỳ | Đọc gì thêm |
|---|---|
| Đầu năm (Q1) | Tăng trưởng tín dụng có bị chặn theo quý không (hạn mức phân bổ theo quý) — đây là hiệu ứng mùa vụ do chính sách, không phải nhu cầu giảm |
| Giữa năm (Q2/Q3) | Xu hướng chi phí vốn + nợ nhóm 2: hai chỉ báo trước của nửa cuối năm |
| Cuối năm (Q4) | Đuổi hạn mức tín dụng → tăng trưởng vọt lên có thể là hành vi hành chính; đọc kèm chất lượng tài sản |
| Năm chuyển tiếp | Văn bản chuẩn mực mới có hiệu lực: so sánh cùng kỳ năm trước vô nghĩa nếu mẫu số đổi |

## 5. Nhóm so sánh

- Chỉ so chỉ báo **cùng phân khúc** (ngân hàng tư nhân lớn / ngân hàng nhà nước /
  ngân hàng nhỏ): `peer_compare` theo từng chỉ báo, ghi rõ đang so với nhóm nào.
- So với lịch sử của chính mã (QoQ/YoY 4–8 quý) trước khi so với nhóm — một quý
  đột biến có thể do một lần điều chỉnh kế toán.
