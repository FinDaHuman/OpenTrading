# Chỉ báo ngành bảo hiểm — tách nghiệp vụ và tài chính

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `news_market` gần nhất và ghi kỳ kèm theo. Luật về hai nguồn
> lãi chỉ nằm ở §Trụ cột driver của SKILL.md — không lặp lại ở đây.

## 1. Tách hai nguồn lãi

| Nguồn | Nhạy | Cách đọc |
|---|---|---|
| Nghiệp vụ bảo hiểm (phí thuần trừ bồi thường, chi phí hoạt động) | Chất lượng bán hàng, chất lượng sổ | Cải thiện của nguồn này mới là hồi phục thật |
| Thu nhập tài chính (đầu tư quỹ phí) | Lãi suất, biến động thị trường | Tăng trong giai đoạn lãi cao ≠ năng lực; nhạy lãi suất đảo chiều |

Công thức tự tính (ghi rõ): tỷ trọng thu nhập nghiệp vụ = nghiệp vụ / tổng thu nhập
trước thu nhập tài chính. Tỷ trọng thấp = lãi đang dựa lãi suất.

## 2. Nhóm phí mới và chất lượng sổ

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu phí bảo hiểm | `financial_detail` | Đọc theo mảng nhân thọ/phi nhân thọ; tổng số che sự teo tập trung một mảng |
| Phí bảo hiểm mới | Công bố công ty/hiệp hội (`news_market`) | Chỉ báo tăng trưởng tương lai; đọc theo năm để biết vùng đáy |
| Tỷ lệ duy trì hợp đồng | Công bố công ty | Thấp = sổ đang teo dù phí mới đẹp |
| Dự phòng nghiệp vụ | `financial_detail` | Tăng bền vững = sổ đang tích lũy; tăng đột ngột bất thường cần lý do |
| Chi phí bồi thường và chi phí quản lý | `financial_detail` | Biên nghiệp vụ; tăng nhanh hơn phí = biên xấu đi |

## 3. Nhóm kênh phân phối

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Tỷ trọng kênh | `news_market` | Kênh qua ngân hàng bị siết sau khủng hoảng niềm tin; đại lý hồi phục chậm nhưng bền |
| Chi phí hoa hồng/thuê | `financial_detail` | Co giãn theo kênh bán đang mở rộng |
| Chính sách kênh | `news_market` | Quy định bán hàng ảnh hưởng hiệu quả kênh |

## 4. Nhóm đối chiếu

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `news_market` | Phí mới ngành, chính sách kênh, room nước ngoài | Số ngành; ghi rõ nguồn + ngày |
| `planned_targets` | Kế hoạch doanh thu/lãi/phí mới | Neo kỳ vọng |
| `peer_compare` | Phí mới, tỷ trọng nghiệp vụ, biên | So trong cùng phân khúc nhân thọ/phi nhân thọ |
| `vs_financial_norms(btype=5)` | Dòng BCTT loại bảo hiểm | Đọc đúng dòng, không đoán dòng CTCP chung |

## 5. Bẫy đọc thường gặp

- Lãi tăng mạnh trong năm lãi suất cao: kiểm tra tỷ trọng thu nhập tài chính trước
  khi kết luận hồi phục.
- Phí mới tạm thời nhờ một hợp đồng tập thể/ngân hàng lớn: đánh dấu một lần.
- Tổng phí hợp nhất tăng nhưng phí mới teo: quỹ cũ đang thu, nguồn mới đang yếu —
  hồi phục chưa thật.
