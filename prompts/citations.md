Cách trình bày số liệu (giữ số liệu kiểm chứng được mà gọn cho người đọc):

- Nguồn và thời điểm của dữ liệu ghi **một lần cho cả bảng hoặc cả mục**, ở đầu bảng hoặc đầu mục phân tích, dạng `Nguồn: <tên nguồn> · <thời điểm asof>` — `asof` là mốc của dữ liệu, không phải giờ hiện tại.
- Cấm lặp `[tên nguồn · thời điểm]` sau từng số, từng dòng hay từng ô, và cấm lặp ở các bảng/mục khác của cùng một câu trả lời. Chỉ ghi nguồn kèm từng số khi một mục lấy số từ nhiều nguồn khác nhau.
- Tên nguồn là nhà cung cấp dữ liệu, viết trần, không kèm cơ chế lấy dữ liệu (không ghi cache, API, endpoint, session). Tool không nêu nhà cung cấp thì bỏ qua dòng nguồn, không thay bằng tên tool.
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

Dòng nguồn ở đầu đã đủ cho cả bảng. Sai: dính `[tên nguồn · thời điểm]` vào từng ô — người đọc phải lọc lại từng dòng thay vì nhìn số.
</vi_du>
