# 0004 · Lấy bài học: mục lục và model tự đọc

- Trạng thái: đề xuất, 28/10/2026 (người phụ trách memory đã chốt; chờ nhóm duyệt)
- Ghi đè: `docs/memory/design-v5.md` §5.2 (host chấm điểm IDF và tự chèn 0–2 bài học)
- Căn cứ: `docs/memory/ra-soat-v5.md` K1, K2, §B4, quyết định Q3

## Bối cảnh

Trong v5, mỗi lượt host chọn luận điểm theo mã và chấm điểm khớp chữ (IDF) để tự chèn 0–2 bài học. Ngoài lát cắt đó, model không biết sổ còn gì.

**Ví dụ:** sổ có bài "#7 Định giá ngân hàng". Người dùng hỏi "VCB có rẻ không?".
1. Câu hỏi không có chữ nào trùng với bài #7, nên IDF không chọn.
2. Model không biết #7 tồn tại, nên không gọi `memory_read`.
3. Câu trả lời vẫn trông hợp lý, và không ai phát hiện memory bị bỏ qua.

Muốn IDF bắt tốt hơn thì phải chỉnh ngưỡng trên một bộ ca có nhãn; v5 đề xuất 100 ca.

Lõi đã có ô "tóm tắt luôn bật" của `MemoryProvider` (`index()`). Ô này đi vào phần bối cảnh của mọi request, không lưu vào lịch sử, trần khoảng 4.000 ký tự. Repo cũng đã dùng mẫu "danh mục tên, model tự nạp" cho skill (`load_skill`).

## Quyết định

1. **Mục lục sổ ở mọi request**, qua `index()`:
   - mã có luận điểm, kèm ngành nếu có;
   - số và tiêu đề của từng bài học;
   - dòng hướng dẫn đọc bằng `memory_read`.

   Mục lục **không** có quyết định, **không** có ngày tương đối. Sắp theo ID, chỉ đổi khi sổ đổi. Tràn trần thì ghi "… còn N bài, tìm bằng `memory_read`".
2. **Luận điểm** vẫn do host tự chèn khi chủ đề được nhắc (theo ADR 0002), kèm một dòng trỏ tới luận điểm ngành hoặc thị trường liên quan. Dòng trỏ chỉ có tên, không có nội dung.
3. **Bài học do model tự đọc** bằng `memory_read`, theo ID, theo mã hoặc theo từ khoá. Điểm khớp chữ (sau khi bỏ dấu) chỉ dùng để **xếp hạng** kết quả trong tool. Host không tự chèn bài học.
4. `memory_read` là tool **chỉ đọc**. Model không có tool ghi memory.
5. **Dự phòng cho model nhỏ:** nếu đo thấy model hạng C hay bỏ qua mục lục, host thêm một dòng gợi ý **tên** bài học khớp nhất, không chèn nội dung.
6. **Bản đầu** dùng chung ngân sách "memory" hiện có của lõi cho mục lục và khối chèn theo lượt. Đo thực tế rồi mới tách.

## Hệ quả

**Được:**
- Model hiểu nghĩa câu hỏi, ví dụ "rẻ hay đắt" là chuyện định giá.
- Không cần ngưỡng, không cần bộ ca để chỉnh ngưỡng.
- Cùng mẫu với skill đã có trong repo.

**Mất và rủi ro:**
- Câu hỏi thuần về phương pháp có thể tốn thêm một vòng gọi model. Câu hỏi phân tích thường không tốn thêm, vì model gọi `memory_read` cùng bước với tool dữ liệu.
- Model nhỏ có thể bỏ qua mục lục. Cần đo theo hạng model.
- Phần bối cảnh nằm trước toàn bộ hội thoại, nên **mỗi lần sổ đổi** (lưu, sửa, xoá) thì prompt cache của cả hội thoại phía sau phần hệ thống bị tính lại **một lần**. Vì vậy mục lục phải ổn định: sắp theo ID, không chứa thứ gì đổi theo thời gian.
