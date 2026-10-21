# Chỉ báo ngành công nghệ — đơn ký, backlog và chất lượng nhân công

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `financial_detail` / `news_market` gần nhất và ghi kỳ kèm theo. Luật về đơn ký
> dẫn doanh thu chỉ nằm ở §Trụ cột driver của SKILL.md — không lặp lại ở đây.

## 1. Nhóm đơn hàng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu ký | Công bố công ty (`news_symbol`/`company_events`) | Tín hiệu **dẫn**; kỳ ký mạnh chưa vào doanh thu ngay. Ghi kỳ ký |
| Thời hạn hợp đồng | Công bố công ty | Hợp đồng 2–3 năm cho doanh thu bền hơn đơn ngắn hạn |
| Tỷ trọng đơn lớn | Công bố công ty | Đơn lớn tạo lãi bất thường: đánh dấu một lần, không nội suy |
| Backlog / doanh thu chưa nhận | `financial_detail` (nếu có) | Tồn kho doanh thu tương lai; giảm = đang tiêu backlog |

## 2. Nhóm mảng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu nước ngoài | `financial_detail` / công bố công ty | Chu kỳ khách hàng quốc tế; nhạy tỷ giá |
| Doanh thu nội địa | `financial_detail` / công bố công ty | Phụ thuộc chính phủ điện tử và ngân sách công |
| Doanh thu sản phẩm riêng | `financial_detail` | Mảng biên cao hơn dịch vụ; đọc kỳ vọng doanh thu sản phẩm |

## 3. Nhóm chất lượng vận hành

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu trên mỗi nhân viên | Tự tính (ghi rõ) | Tăng trong khi doanh thu tăng = hiệu quả cải thiện |
| Số nhân viên | `financial_detail` / công bố công ty | Tăng nhanh hơn doanh thu = mở rộng bằng đầu người |
| Biên lãi gộp | `financial_detail` | Giảm trong 2 quý liền với tăng trưởng mở rộng = chi phí nhân công đang ép biên |
| Biên lợi nhuận trước thuế | `financial_detail` | Đọc cùng phân hoá mảng: nội địa và nước ngoài khác biên |

## 4. Nhóm đối chiếu

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `news_symbol` / `company_events` | Công bố đơn hàng ký và thị trường khách hàng; `news_market` chỉ cho chính sách/bối cảnh | Tín hiệu dẫn; ghi rõ nguồn + ngày |
| `planned_targets` | Kế hoạch doanh thu/lãi | Neo kỳ vọng |
| `peer_compare` | Key tổng quan thực sự trả về, như P/E, P/B, ROE | So cùng phân khúc; KPI vận hành lấy từ `financial_detail` từng peer cùng kỳ và công bố doanh nghiệp, không tạo key bằng `metrics` |
| `yf_commodities` | Chu kỳ kim loại (bối cảnh chi phí) | Chỉ dùng khi xét cơ sở hạ tầng/cấu phần |

## 5. Bẫy đọc thường gặp

- Doanh thu nhận chững nhưng đơn ký mạnh: đọc backlog, đừng kết luận chững.
- Biên một quý nhờ một đơn lớn: đánh dấu một lần.
- Thu nhập trên người giảm do thuê trước doanh thu: đây là đầu tư, không phải lỗ —
  nhưng đọc 2 quý liền để xem có chuyển thành doanh thu không.
