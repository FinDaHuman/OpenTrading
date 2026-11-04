# Lộ trình implement memory v5.1

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt lộ trình (28/10/2026). Chưa spec nào được implement |
| **Kiến trúc** | [ra-soat-v5.md](../ra-soat-v5.md) phần C, các quyết định Q1–Q7 trong bảng "Đã chốt" (§B10) |
| **Quyết định** | ADR [0002](../../decisions/0002-memory-ban-ghi-co-nhan.md) · [0003](../../decisions/0003-memory-kho-sqlite-va-dinh-danh.md) · [0004](../../decisions/0004-memory-muc-luc-va-model-tu-doc.md) · [0005](../../decisions/0005-memory-rang-buoc-co-cau-truc.md) · [0006](../../decisions/0006-memory-ranh-gioi-theo-loai.md) |
| **Nhánh** | `feat/memory`, một PR vào `main` |

## Cách làm

- Mỗi spec nằm trong một thư mục `NNN-ten-ngan/`, gồm:
  - `spec.md`: làm gì, vì sao, nghiệm thu thế nào;
  - `plan.md`: làm thế nào; kèm `research.md`, `data-model.md` khi cần;
  - `tasks.md`: danh sách việc, gói theo phiên làm việc.
- **Một nhánh, một PR.** Mọi spec, kể cả spec sửa lõi, làm trên `feat/memory`. PR nháp `feat/memory` → `main` được mở sau spec 004 (spec 0 và spec 004 cùng được push lần đầu), để CI chạy typecheck và test trên Windows và Ubuntu sau mỗi lần push.
- **Mỗi spec một commit, push một lần**, sau khi spec đã được duyệt code.
- **Giữ phần lõi dễ duyệt trong một PR lớn:**
  - tiêu đề commit `feat(memory): spec NNN …` (spec 0 dùng `docs(memory): …`);
  - thân commit liệt kê từng file lõi đã sửa, kèm lý do một dòng;
  - mô tả PR có bảng "Thay đổi lõi cần chủ repo duyệt": file, sửa gì, vì sao, thuộc spec nào, mã commit.
- **Một spec được coi là xong khi:**
  - typecheck và `bun test` qua ở máy;
  - CI trên PR xanh;
  - trạng thái được cập nhật ở `docs/STATUS.md`, `CHANGELOG.md` và bảng dưới đây.
- Bản tham khảo `FileMemory` giữ nguyên. Provider v5.1 là một lựa chọn mới trong `/config`.

## Các spec

Ký hiệu:
- **[M]**: chỉ đụng phần memory (`src/core/memory/`, `test/`);
- **[LÕI]**: sửa file của khung harness, cần chủ repo duyệt.

| Thứ tự | # | Spec | Nội dung chính | Đụng lõi | Phụ thuộc | Giải quyết | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | Tài liệu và ADR | Rà soát v5, ADR 0002–0006, lộ trình này | Không | — | Q1–Q7 | Đang làm |
| 2 | [004](004-ghi-phien-khoa-agent-con/spec.md) | Sửa lỗi lõi: ghi phiên, khoá, agent con | Ghi phiên độc lập, có biên nhận, ghi lại dòng thông tin phiên khi lần đầu lỗi, chống dòng cụt (T1, T2); khoá file kiểm chủ trước khi nhả hay chiếm (T3); agent con không có tool lịch sử phiên (Q5, K9) | **[LÕI]** | — | T1, T2, T3, K9 | `implemented` (test chạy trên máy; chờ duyệt code, CI) |
| 3 | [001](001-kho-memory-db/spec.md) | Kho `memory.db` và bảng chính sách | Lược đồ bản 1 cùng migration; từ chối lược đồ mới hơn bản app; repository cho ràng buộc, cách trình bày, chủ đề và bí danh, bản luận điểm, bài học, quyết định ghi nối; chống ghi đè theo phiên bản; ID không dùng lại; xoá logic; WAL và đóng kết nối đúng lúc; bảng chính sách theo loại và test duyệt bảng | [M] | 0 | Q2, Q4, Q6, Q7; T4, T5 | `implemented` (test chạy trên máy; chưa nối vào app, việc đó thuộc 002; chờ duyệt code, CI) |
| 4 | [002](002-provider-duong-doc/spec.md) | Provider v5.1: đường đọc | Ràng buộc và cách trình bày ở phần hệ thống; mục lục ở phần bối cảnh; chủ đề từ chữ người dùng gõ; khối có nhãn chỉ chèn khi phiên chưa có, dòng "thay cho bản N"; `memory_read` chỉ đọc; xem và xoá trong `/memory`. Lõi: thêm lựa chọn provider vào `/config`, đóng kho khi thoát, báo lỗi mở kho lúc khởi động, màn `/memory` của sổ ghi nhớ | [M] + [LÕI] nhỏ | 001 | Q1 (bản tối thiểu), Q3, K1, K2, K8 | `implemented` (test chạy trên máy; chưa duyệt code, chưa CI; chưa thử tay trên TUI, chưa thử với model thật) |
| 5 | [003](003-duong-ghi-lenh-form/spec.md) | Đường ghi: lệnh và form | `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh`; `/memory` xem, sửa, xoá, xuất Markdown; cảnh báo lệch ngăn; xung đột phiên bản hiện diff; lịch sử ô nhập chỉ lưu tên lệnh | [M] + [LÕI] vừa | 001, 002 | C4, T6, K7 | `implemented` (test chạy trên máy; chưa duyệt code, chưa CI; chưa thử tay trên TUI) |
| 6 | 005 | Ràng buộc tới agent con và hồ sơ | Host gửi ràng buộc có cấu trúc cho agent con; ràng buộc độc lập với công tắc memory; đọc lỗi thì hoãn lượt (T7); file mẫu `INVESTOR.md` đưa ví dụ vào chú thích (T8) | **[LÕI]** | 001 | Q4, T7, T8 | `specified` |
| 7 | 006 | Phương án Y đầy đủ trong lõi | Lõi đưa danh sách nhãn đang có trong lịch sử cho memory; che khối khi xoá; dòng che trong file phiên; mã lượt; bản tóm tắt khi nén chỉ giữ nhãn | **[LÕI]** | 002, 004 | K3, K5 | `specified` |
| 8 | 007 | Thẻ gợi ý (tuỳ chọn) | Tách thẻ khỏi câu trả lời; dòng thẻ trong file phiên; thẻ mở form của 003 | **[LÕI]** | 003, 006 | Thẻ gợi ý | `deferred` cho tới khi người dùng chọn làm |

**Mốc dùng được:** sau 001, 002 và 003, memory v5.1 chạy trọn vòng ghi và đọc. Bản này có ba giới hạn:

| Giới hạn | Được gỡ ở |
| --- | --- |
| Sau nén hoặc mở lại phiên, khối memory có thể bị chèn lại hoặc thiếu | 006 |
| Xoá chỉ báo "đã ngừng dùng", chưa che nội dung cũ trong lịch sử đang mở | 006 |
| Agent con chưa nhận ràng buộc | 005 |

## Ngoài lộ trình này

Theo bảng "Để sau" (§C13) và giai đoạn 4 (§C12) của `ra-soat-v5.md`:
- tool lịch sử đọc file agent con và nhật ký ultradesk;
- chia sẻ quyết định;
- mã gõ sai;
- chủ đề xuất hiện giữa lượt;
- ISIN;
- phần mở rộng kiểu Cedar;
- nhập ràng buộc cũ từ `INVESTOR.md`;
- bộ đo với model thật.

**Đã bỏ (29/10/2026):** `/memory quet`. Đề xuất memory từ hội thoại chỉ còn thẻ gợi ý (spec 007).
