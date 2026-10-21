# Chỉ báo bảo hiểm — phân khúc, công thức và cơ sở

Lấy BCTC/thuyết minh hãng cùng kỳ, sau khi tra `vs_financial_norms(btype=5)`.
Gọi `financial_detail` riêng từng `statement=KQKD`, `CDKT`, `TM`; chỉ tiêu không
có trong kết quả phải lấy công bố hãng/hiệp hội có nguồn, không giả định tool trả sẵn.
Ghi rõ chuẩn mực kế toán, đơn vị, kỳ, gộp hay ròng tái bảo hiểm và công thức.

## Nhân thọ

| KPI | Cách đọc |
|---|---|
| Phí mới, APE, phí tái tục | Chỉ so cùng định nghĩa APE và cùng kỳ; tổng doanh thu phí không thay phí mới |
| Tỷ lệ duy trì hợp đồng | Số/giá trị hợp đồng còn hiệu lực / cohort ban đầu theo đúng tháng 13/25/... và công bố hãng; không suy từ doanh thu phí |
| Chi phí khai thác | Hoa hồng, chi phí phân phối theo bộ phí tương ứng; không so tùy tiện với phí tổng |
| Dự phòng/nghĩa vụ và biên khả năng thanh toán | Đọc giả định lãi suất, tỷ lệ hủy và phạm vi pháp lý; dự phòng tăng không tự là chất lượng tốt |

## Phi nhân thọ

| KPI | Công thức và điều kiện |
|---|---|
| Phí được hưởng | Phí ghi nhận trong kỳ − phần tăng dự phòng phí chưa được hưởng, theo định nghĩa báo cáo; tách phí gốc, nhận tái và nhượng tái |
| Tỷ lệ bồi thường | Bồi thường phát sinh (chi trả + biến động dự phòng bồi thường) / phí được hưởng cùng cơ sở gộp hoặc ròng; không dùng chi trả tiền mặt thay phát sinh |
| Tỷ lệ chi phí | Chi phí khai thác và quản lý nghiệp vụ phân bổ / phí được hưởng cùng cơ sở; nếu hãng dùng phí ghi nhận thì ghi rõ và không cộng trực tiếp với tỷ lệ khác cơ sở |
| Combined ratio | Tỷ lệ bồi thường + tỷ lệ chi phí khi cùng mẫu số và phạm vi. Dưới 100% thường cho thấy lãi nghiệp vụ trước đầu tư, không đồng nghĩa lãi ròng hợp nhất |
| Phát triển dự phòng | Đối chiếu ước tính tổn thất các năm cũ với cập nhật kỳ này; giải phóng dự phòng có thể tạo lãi một lần |

## Tái bảo hiểm và đầu tư (cả hai mảng)

| KPI | Công thức và cách dùng |
|---|---|
| Tỷ lệ nhượng tái | Phí nhượng / phí gốc cộng phí nhận tái cùng phạm vi (hoặc cơ sở hãng công bố); ghi mẫu số |
| Tỷ lệ giữ lại | Phí sau nhượng / phí trước nhượng cùng kỳ; không trộn phí được hưởng với phí ghi nhận |
| Thu hồi bồi thường | Khoản phải thu/thu hồi từ nhà tái bảo hiểm, tuổi nợ và chất lượng đối tác; tách gộp và ròng |
| Lợi suất đầu tư | Thu nhập đầu tư thường xuyên của kỳ quy đổi năm / tài sản đầu tư bình quân đầu/cuối đúng kỳ; quý độc lập ×4, YTD n tháng ×12/n, TTM không nhân. Tách lãi/lỗ bán tài sản, đánh giá lại và ghi rõ có/không đưa vào tử số |
| Lệch kỳ hạn | Kỳ hạn, thanh khoản và tiền tệ tài sản so với nghĩa vụ bảo hiểm; không suy từ lợi suất đơn lẻ |

Tách doanh thu, chi phí và lợi nhuận từng mảng trên cùng cơ sở; không tự tạo tỷ trọng
lãi khi tổng lãi gần không hoặc âm. Không lấy thu nhập đầu tư trừ lãi hợp nhất để suy
lãi nghiệp vụ. Hỗn hợp cần tỷ trọng mảng và loại trừ hợp nhất trước so sánh.

`peer_compare` chỉ dùng key tổng quan thực trả như P/B/ROE; `metrics` không tạo
phí mới, duy trì hay combined ratio. So KPI đặc thù bằng dữ liệu từng peer cùng kỳ.
