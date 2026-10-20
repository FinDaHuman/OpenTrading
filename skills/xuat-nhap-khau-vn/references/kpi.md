# Chỉ báo xuất nhập khẩu — phân nhóm hàng và chỉ báo dẫn

> File này giữ **cách đọc**, không giữ con số kỳ nào. Mọi giá trị lấy từ
> `vs_xnk_detail` / `vs_indicator_data` gần nhất và ghi kỳ kèm theo. Luật về thuế
> hai lớp chỉ nằm ở §Trụ cột driver của SKILL.md — không lặp lại ở đây.

## 1. Phân nhóm hàng

| Nhóm | Chu kỳ bám | Lưu ý đọc thuế |
|---|---|---|
| Điện tử – linh kiện – thiết bị | Chu kỳ thay thế và tăng công suất toàn cầu | Thường nằm trong danh sách miễn của chính sách kỹ thuật |
| Máy móc – công cụ | Đầu tư công suất | Nhập khẩu nhóm này là chỉ báo dẫn cho nhóm khác |
| Dệt may – giày da – hàng thủ công | Mùa đặt hàng và chính sách thương mại | Thường không được miễn — chịu chênh với đối thủ mức thấp |
| Thủy sản – nông sản – lâm sản | Nguồn cung trong nước + nhu cầu nhập khẩu | Nhạy hạn ngạch, kiểm dịch và điều tra thương mại |
| Hoá chất – nhựa – cao su | Chu kỳ nguyên liệu toàn cầu | Đối chiếu `hoa-chat-vn` cho phần sản xuất |

## 2. Chỉ báo dẫn: cặp nhập – xuất

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Nhập khẩu thiết bị theo kỳ | `vs_xnk_detail` | Tăng vài quý trước xuất hàng công nghệ = công suất mới đang triển khai |
| Xuất khẩu hàng công nghệ | `vs_xnk_detail` | Đi sau nhập khẩu; đọc cặp để tránh kết luận "chững" |
| Nhập khẩu linh kiện/nội đị | `vs_xnk_detail` | Tăng nhanh hơn xuất = sản xuất đang mở rộng, chưa cho ra sản phẩm |
| Xuất khẩu hàng thủ công | `vs_xnk_detail` | Chu kỳ rời ngành công nghệ; đừng nội suy từ tổng số |

## 3. Nhóm chính sách và tỷ giá

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Thuế thuận/miễn nước | `news_market` | Ghi rõ văn bản + ngày; mức áp và danh sách miễn là biến số quyết định |
| Khai trương doanh nghiệp FDI | `vs_indicator_data` / `news_market` | Tín hiệu dẫn chu kỳ xuất khẩu 1–2 năm |
| Tỷ giá USD | `vn_forex_ohlcv` | Nội tệ yếu hỗ trợ trị giá xuất khẩu tính ngoại tệ nhưng làm chi phí nhập tăng |
| Chỉ số USD | `yf_commodities` | Bối cảnh giá trị xuất khẩu tính ngoại tệ |

## 4. Nhóm riêng công ty

| Chỉ báo | Đọc từ | Cách đọc |
|---|---|---|
| Doanh thu xuất khẩu | `financial_detail` (nếu công bố tách) | Không tách được → chỉ nói được tỷ trọng ước lượng, ghi rõ |
| Nợ phải trả nước ngoài | `financial_detail` | Vay ngoại nhạy tỷ giá — đọc cùng tỷ giá |
| Giá trị tồn kho và phải thu | `financial_detail` | Tăng nhanh hơn doanh thu = đơn hàng đang ùn hoặc thanh toán chậm |

## 5. Bẫy đọc thường gặp

- Tổng xuất khẩu tăng hai con số mà đọc "cả nền kinh tế khỏe": nên kiểm tra phân
  bổ theo nhóm hàng trước.
- Nhập khẩu tăng bị đọc là "yếu": với hàng công nghệ, nhập thiết bị/linh kiện tăng
  trước xuất khẩu là tín hiệu tích cực.
- Dùng chỉ số USD thay tỷ giá: một là vĩ mô, một là doanh nghiệp — đọc cả hai và ghi
  rõ lung tung.
