# 0003 · Kho memory: SQLite `memory.db` và định danh

- Trạng thái: đề xuất, 28/10/2026 (người phụ trách memory đã chốt; chờ nhóm duyệt)
- Ghi đè: `docs/memory/design-v5.md` §2 và §12 (kho `notebook.json`, chỉ chuyển SQLite khi chạm giới hạn); dùng mã giao dịch làm khoá chủ đề
- Căn cứ: `docs/memory/ra-soat-v5.md` T3, T4, T5, H7, §B5, §B6, §C3, quyết định Q2 và Q7

## Bối cảnh

Thiết kế v5 chọn một file `notebook.json`. Mỗi lần ghi, app khoá file, đọc cả file, sửa rồi ghi lại cả file. v5 tự ghi điều kiện để chuyển sang SQLite: khi cần nhiều cửa sổ cùng ghi, transaction, hoặc lịch sử lớn.

Các nhu cầu đó **đã có ngay ở bản đầu**:

| Nhu cầu | Ví dụ |
| --- | --- |
| ID không dùng lại | Xoá bài học #7 rồi tạo bài mới; nếu bài mới thành #7, file phiên cũ nhắc "#7" sẽ trỏ nhầm |
| Chống ghi đè theo từng mục | Hai cửa sổ cùng sửa luận điểm HPG; cửa sổ lưu sau phải nhận cảnh báo xung đột |
| Ghi nhiều mục nhất quán | Quyết định "Mua HPG" phải gắn đúng bản luận điểm đang xem và phiên bản bộ ràng buộc lúc ghi |
| Hai tiến trình cùng ghi | Hai cửa sổ OpenTrading cùng mở |

Thí nghiệm trên code hiện có cho thấy hai cơ chế tự viết đang lỗi:
- khoá file có thể bị chiếm khi chủ khoá còn sống, và nhả khoá có thể xoá khoá của người khác (T3);
- Zod mặc định bỏ trường lạ, nên đọc rồi ghi lại là mất dữ liệu (T4).

Chưa có dữ liệu người dùng nào, nên đổi kho bây giờ không tốn công chuyển đổi.

## Quyết định

**Kho:** một file SQLite `memory.db` trong thư mục dữ liệu, dùng `bun:sqlite` có sẵn trong Bun. Không thêm dependency.

| Bảng | Nội dung chính |
| --- | --- |
| Ràng buộc và bản ràng buộc | Loại (ràng buộc hoặc cách trình bày), phạm vi, bản hiện hành, trạng thái; mỗi bản có văn bản, nguồn, ngày |
| Chủ đề | ID nội bộ, mã hiển thị, bí danh có lịch sử, loại (mã, ngành, thị trường), ngành, cờ "chỉ khớp khi viết hoa", số bản cuối, trạng thái luận điểm |
| Bản luận điểm | Văn bản, chi tiết, điều kiện "Sai nếu" có thứ tự, hạn xem lại, hiện hành từ … đến …, nguồn |
| Bài học và bản bài học | Tiêu đề, tóm tắt, áp dụng cho, ngoại lệ, chi tiết, tag, nguồn |
| Quyết định | Chủ đề, việc, lý do, bản luận điểm đang xem lúc ghi, phiên bản bộ ràng buộc lúc ghi; ghi nối, không sửa |
| Thông tin kho | Phiên bản lược đồ |

**Thiết lập:**
- chế độ WAL;
- thời gian chờ khoá ngắn hơn mọi thời gian chờ của giao diện;
- mỗi lần ghi là một transaction ghi ngay;
- chống ghi đè: chỉ cập nhật khi bản hiện hành vẫn là bản mà form đã đọc;
- làm mới bộ đệm theo `data_version`;
- gặp lược đồ mới hơn bản app hiểu thì từ chối mở, giữ nguyên file và báo rõ;
- đóng kết nối khi tắt app hoặc tắt memory; mở lỗi thì đóng ngay (trên Windows, kết nối còn mở giữ khoá file).

Hàm tạo kho nhận đường dẫn hoặc kết nối **tường minh**, không tự trỏ tới thư mục dữ liệu. Nhờ đó test luôn dùng thư mục tạm.

**Định danh:**
- ID tự tăng, **không bao giờ dùng lại**.
- Số bản **không bao giờ đánh lại**. Chủ đề giữ "số bản cuối" kể cả khi bị xoá, nên tạo lại thì đánh số tiếp.
- Chủ đề có **ID nội bộ**. Mã giao dịch chỉ là tên hiển thị và bí danh, có lịch sử. Đổi mã thì thêm bí danh mới, không tạo chủ đề mới. ISIN để sau.
- Bản đã ghi là bất biến. Sửa là thêm bản mới.

**Xoá** là xoá logic: xoá nội dung mọi bản của mục, giữ ID và số bản. Cách che trong lịch sử phiên theo ADR 0002.

## Hệ quả

**Được:**
- Có sẵn transaction, khoá giữa tiến trình, ID không dùng lại.
- Memory không cần khoá file tự viết, cũng không gặp lỗi mất trường lạ.
- Quyết định gắn đúng căn cứ lúc ghi.
- Tra được "tháng 9 tôi đang tin gì về HPG" theo thời gian hiệu lực của bản.

**Mất và rủi ro:**
- Không mở file ra đọc bằng mắt được. Người dùng xem và xuất Markdown qua `/memory`.
- Phải viết lược đồ và migration.
- Trên Windows phải đóng kết nối đúng lúc; test phải đóng kết nối trước khi xoá thư mục tạm.
- Khoá file vẫn cần sửa (T3) vì watchlist còn dùng. Việc này thuộc spec 004.
