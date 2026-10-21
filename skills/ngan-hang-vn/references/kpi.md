# Chỉ báo ngành ngân hàng — dòng BCTC và cách đọc

> Tên dòng chính xác tra bằng `vs_financial_norms(btype=3)`; tên dưới đây theo mẫu BCTC
> tổ chức tín dụng và có thể khác chữ đôi chút. File này giữ **cách đọc**, không giữ số
> kỳ nào. `financial_detail` nhận một `statement` mỗi lời gọi — cột "Statement" ghi sẵn.
> Luật về trần/tỷ lệ pháp lý nằm ở mục "Ranh giới" của SKILL.md.

## 1. Thu nhập và NIM

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Thu nhập lãi và các khoản thu nhập tương tự | KQKD | Chia cho tài sản sinh lãi bình quân = lợi suất tài sản |
| Chi phí lãi và các chi phí tương tự | KQKD | Chia cho nợ chịu lãi bình quân (tiền gửi khách hàng, tiền gửi và vay TCTD khác, giấy tờ có giá) = chi phí vốn |
| Thu nhập lãi thuần | KQKD | Tử số của NIM. Tăng nhờ dư nợ tăng trong khi NIM nén = tăng bằng khối lượng, không bằng chất lượng |
| Thu nhập ngoài lãi (dịch vụ, ngoại hối, chứng khoán, khác) | KQKD | Phần từ chứng khoán và thu hồi nợ đã xử lý dao động mạnh — tách ra trước khi nói "thu ngoài lãi tăng" |
| Chi phí dự phòng rủi ro tín dụng | KQKD | So với lợi nhuận trước dự phòng: dự phòng ăn phần lớn thì tăng trưởng trước dự phòng không vào lợi nhuận |
| NIM (tự tính) | KQKD + CDKT | Thu nhập lãi thuần năm hoá / bình quân đầu–cuối kỳ của tài sản sinh lãi (tiền gửi tại NHNN, tiền gửi và cho vay TCTD khác, chứng khoán kinh doanh và đầu tư, cho vay khách hàng). Ghi rõ là tự tính và cách năm hoá |

## 2. Chất lượng tài sản

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Tỷ lệ nợ xấu | TM (phân loại nợ) | Nợ nhóm 3–5 / tổng dư nợ. Lớp **đã xảy ra** |
| Tỷ lệ nợ nhóm 2 | TM (phân loại nợ) | Nợ nhóm 2 / tổng dư nợ. Lớp **đang hình thành**; tăng 2 quý liền khi nợ xấu phẳng là tín hiệu sớm |
| Tỷ lệ bao phủ nợ xấu | CDKT + TM | Dự phòng rủi ro cho vay khách hàng / nợ xấu. Lớp **đệm**; giảm là đệm mỏng đi dù nợ xấu đẹp |
| Nợ xấu đã xử lý bằng dự phòng / bán nợ | TM (nếu có) | Nợ xấu giảm nhờ xoá nợ bằng dự phòng khác với nợ xấu giảm nhờ thu hồi |

## 3. Tăng trưởng, vốn và thanh khoản

| Chỉ báo | Statement | Cách đọc |
|---|---|---|
| Cho vay khách hàng | CDKT | Tăng trưởng từ đầu năm; chỉ kết luận "nhanh/chậm" khi đặt cạnh room hoặc tỷ lệ an toàn |
| Tiền gửi của khách hàng | CDKT | Tín dụng tăng nhanh hơn tiền gửi = phải dựa vào liên ngân hàng và giấy tờ có giá (vốn đắt hơn) |
| CASA | TM (tiền gửi theo loại) | Tiền gửi không kỳ hạn / tổng tiền gửi khách hàng. Đọc cạnh chi phí vốn |
| Cho vay / tiền gửi khách hàng (tự tính) | CDKT | Ước lượng thô của LDR; LDR theo quy định có công thức riêng |
| Vốn chủ sở hữu | CDKT | Mẫu số ROE và đệm vốn; tăng vốn (cổ phiếu, giữ lại lợi nhuận) mở thêm chỗ tăng trưởng |
| CAR | Thuyết minh / báo cáo thường niên | Không nằm trong CDKT; lấy số ngân hàng công bố, ghi kỳ |
| Cam kết ngoại bảng | TM (nếu có) | Tỷ lệ so với dư nợ trên bảng; không cộng vào nợ xấu nhưng tính vào rủi ro |

## 4. Đọc theo kỳ

| Kỳ | Đọc thêm |
|---|---|
| Quý 1 | Tín dụng thường thấp đầu năm; chỉ là bất thường nếu thấp hơn hẳn cùng kỳ |
| Quý 4 | Tín dụng tăng vọt cuối năm có thể do đuổi room — đọc kèm chất lượng tài sản |
| Năm văn bản mới có hiệu lực | Tỷ lệ tính theo mẫu số mới không so được với năm trước |

## 5. So sánh

- So với chính ngân hàng 4–8 quý trước khi so với nhóm: một quý đột biến có thể do
  một lần xử lý nợ hay bán chứng khoán.
- Chỉ so trong cùng nhóm (quốc doanh / tư nhân lớn / nhỏ); số của peer đọc bằng
  `financial_detail` từng mã, ghi rõ đang so với ai.
