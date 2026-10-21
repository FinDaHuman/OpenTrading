# Chỉ báo ngành vận tải & logistics — phân khúc và cách đọc

> File này giữ **cách phân khúc** và cách đọc từng chỉ báo, không giữ con số kỳ
> nào. Mọi giá trị lấy từ `financial_detail` / `news_market` gần nhất và ghi kỳ
> kèm theo. Luật về tỷ lệ khóa giá và cách đọc cước chỉ nằm ở §Trụ cột driver của
> SKILL.md — không lặp lại ở đây.

## 1. Phân khúc

| Phân khúc | Chu kỳ bám | So với ai |
|---|---|---|
| Cảng / bến | Cước dịch vụ + công suất + lưu lượng qua cảng | Cùng nhóm cảng |
| Vận tải container nội Á | Cước tuyến nội Á + tuyến + khóa giá | Cùng nhóm container |
| Vận tải dầu / hàng rời | Cước tàu dầu theo tuyến + cú sốc cung | Cùng nhóm tàu dầu |
| Hàng không (chở khách/hàng) | Chi phí nhiên liệu **ngược chiều** giá dầu + nhu cầu đi lại theo mùa + giá vé | Cùng nhóm hàng không — ghi chú riêng trong SKILL.md vì chiều ảnh hưởng giá dầu **ngược** với tàu dầu |
| Giao nhận / chuyển phát | Lưu lượng bưu kiện + chi phí nhiên liệu | Cùng nhóm chuyển phát |

## 2. Nhóm giá và khối lượng

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu | `financial_detail` | Tăng do giá hay do khối lượng: so với lưu lượng công bố |
| Giá thu bình quân/ khối lượng | Tự tính (ghi rõ) | So QoQ/YoY. Giá tăng + khối lượng giảm là tăng trưởng không bền |
| Cước tuyến (bên ngoài) | `news_market` | Ghi rõ tuyến và ngày tra; cước là chu kỳ ngắn |
| Tỷ lệ sử dụng bến | `news_market` | Bến mới chưa lấp đầy = chi phí cố định chạy trước doanh thu |

## 3. Nhóm chi phí

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Chi phí nhiên liệu | `financial_detail` (nếu có) / `yf_commodities` | Siết biên vận tải ngay khi cước chưa điều chỉnh |
| Chi phí tài chính | `financial_detail` | Mua tàu/bến mới theo vốn vay: chi phí lãi chạy trước công suất |
| Biên lãi gộp | `financial_detail` | Đọc theo phân khúc; hợp nhất che sự chênh lệch cảng-tàu |

## 4. Nhóm tín hiệu cầu

| Nguồn | Đọc gì | Cách dùng |
|---|---|---|
| `vs_xnk_detail` | Xuất/nhập khẩu theo kỳ | Bối cảnh tổng xuất + nhập cùng kỳ; tách biến động giá và lượng. Xác nhận cầu bằng TEU/tấn công bố, không suy cầu từ nhập máy móc tăng nhanh hơn xuất khẩu |
| `news_market` | Cước tuyến, lưu lượng qua cảng, tuyến mới, thuế quan | Số ngành; ghi rõ ngày nguồn |
| `planned_targets` | Kế hoạch doanh thu/lãi/lưu lượng | Neo kỳ vọng |
| `peer_compare` | Key tổng quan thực sự trả về, như P/E, P/B, ROE | So cùng phân khúc; KPI vận hành lấy từ `financial_detail` từng peer cùng kỳ và công bố doanh nghiệp, không tạo key bằng `metrics` |

## 5. Bẫy đọc thường gặp

- Doanh thu tăng trong khi lưu lượng chững: tăng trưởng đến từ giá/cước, hạ độ tin
  cậy khi cước đảo chiều.
- Cước tàu dầu đắt kỷ lục không đồng nghĩa container hưởng: hai chu kỳ khác nhau
  trong cùng một nhãn ngành.
- Biên phục hồi một quý nhờ giãn tồn kho nhiên liệu: đánh dấu một lần, không nội
  suy.
