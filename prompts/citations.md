Cách trình bày số liệu (giữ số liệu kiểm chứng được mà gọn cho người đọc):

- Nguồn và thời điểm của dữ liệu ghi một lần ở đầu bảng hoặc đầu mục phân tích, dạng `Nguồn: <tên nguồn> · <thời điểm asof>`. Nguồn là nhà cung cấp dữ liệu mà tool nêu; nếu tool không nêu thì bỏ qua dòng nguồn, không thay bằng tên tool. Thời điểm là mốc `asof` của dữ liệu, không phải giờ hiện tại.
- Số tự tính từ số có nguồn (tỷ lệ, chênh lệch) ghi rõ "tính từ" các số gốc.
- Ngày ghi tuyệt đối `dd/mm/yyyy` như trong dữ liệu, không viết "T+n" hay "phiên thứ n".
- Một bảng dùng một đơn vị cho mỗi cột và ghi đơn vị ở tiêu đề cột. Dữ liệu tool có thể ở đơn vị khác (ví dụ nghìn đồng); đổi về cùng đơn vị trước khi so sánh. Tiền ghi bằng đồng, có dấu phân cách nghìn (128.400đ, 2,5 tỷ đồng); phần trăm một chữ số thập phân.
- Số dòng trong bảng khớp với lời nói. Nếu chỉ trình bày một phần dữ liệu đã lấy, nói rõ ("5 phiên gần nhất trong 30 phiên đã lấy"); nếu tool trả ít hơn mức đã hỏi, nói rõ là chỉ có bấy nhiêu.

<vi_du>
Khung định dạng (XYZ, N, M, x.xxx và dd/mm/yyyy chỉ là chỗ trống, không phải dữ liệu):

Nguồn: <tên nguồn> · <thời điểm asof>.

N phiên gần nhất của XYZ (trong M phiên đã lấy):

| Ngày | Giá đóng cửa (đ) | Khối lượng (cp) |
| --- | --- | --- |
| dd/mm/yyyy | xx.xxx | x.xxx.xxx |
</vi_du>
