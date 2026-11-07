# Mô hình dữ liệu 001: Kho memory (lược đồ bản 1)

| | |
| --- | --- |
| **Trạng thái** | Bản nháp, đi cùng [plan.md](plan.md) |
| **Spec** | [spec.md](spec.md) |

Lược đồ bản 1 của kho memory v5.1. Bám `ra-soat-v5.md` C3 và ADR 0003. Tên bảng, cột viết tiếng Anh như code.

## 1. Quy ước chung

| Quy ước | Nội dung | Vì sao |
| --- | --- | --- |
| Nhận diện kho | `PRAGMA application_id` = hằng số riêng của OpenTrading; `PRAGMA user_version` = phiên bản lược đồ (bản 1) | File SQLite của chương trình khác không bị coi là kho (YC-004). Cả hai nằm ở đầu file, đổi trong cùng transaction với lược đồ |
| ID | `INTEGER PRIMARY KEY AUTOINCREMENT` cho mọi bảng có ID người dùng thấy | AUTOINCREMENT không cấp lại ID đã dùng, kể cả ID lớn nhất đã xoá (YC-008, C10 B7) |
| Thời điểm | Chuỗi ISO 8601 UTC có hậu tố `Z`, ví dụ `2026-11-01T08:00:00.000Z`; lấy từ đồng hồ tiêm được | Thời điểm tuyệt đối (YC-030); test cố định được thời gian |
| Văn bản | Chuẩn hoá NFC trước khi kiểm và lưu; không cắt; không escape | "Hòa Phát" gõ bằng hai bộ gõ khác nhau là một chuỗi; escape thuộc spec 002 |
| Danh sách | Điều kiện, tag: cột JSON (mảng chuỗi) | Thứ tự giữ nguyên; luôn đọc, ghi cả mảng của một bản bất biến |
| Xoá | Đặt cột nội dung về `NULL`, ghi `deleted_at`; giữ dòng, ID, số bản. `secure_delete` ghi đè 0 lên byte cũ trong file kho; sau khi commit, checkpoint `TRUNCATE` cố gắng làm rỗng WAL (R58, R75) | Xoá logic (YC-020). Giảm phần sót trên đĩa, không phải xoá vật lý |
| Nguồn | `manual` (gõ tay), `card` (thẻ đã xác nhận, spec 007), `investor_import` (nhập từ `INVESTOR.md`, để sau) | C3. Bản đầu chỉ ghi `manual` |

## 2. Bảng

### `counters`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `name` | TEXT | khoá chính; bản 1 chỉ có `constraint_set` |
| `value` | INTEGER | ≥ 0, chỉ tăng |

`constraint_set` = phiên bản bộ ràng buộc (YC-013). Tăng 1 trong cùng transaction với mỗi lần thêm, sửa, xoá một ràng buộc loại `constraint`. Loại `style` không tăng.

### `constraints` và `constraint_versions`

| Cột `constraints` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | INTEGER | AUTOINCREMENT |
| `kind` | TEXT | `constraint` hoặc `style` |
| `scope` | TEXT | bản đầu chỉ `all_accounts` (H8) |
| `current_version` | INTEGER | số bản hiện hành; giữ nguyên khi xoá |
| `deleted_at` | TEXT | `NULL` khi còn hiệu lực |

| Cột `constraint_versions` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `constraint_id`, `version` | INTEGER | khoá chính ghép |
| `text` | TEXT | `NULL` sau khi xoá |
| `source` | TEXT | như §1 |
| `created_at` | TEXT | |

### `subjects`, `subject_aliases`

| Cột `subjects` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | INTEGER | AUTOINCREMENT, ID nội bộ (Q7) |
| `kind` | TEXT | `ticker`, `sector`, `market` |
| `sector_id` | INTEGER | tham chiếu `subjects(id)` có `kind = sector`; chỉ cho `ticker`; tuỳ chọn |
| `uppercase_only` | INTEGER | 0 hoặc 1 (cờ "chỉ khớp khi viết hoa", dùng ở spec 002) |
| `last_version` | INTEGER | số bản luận điểm lớn nhất đã cấp; không bao giờ giảm (YC-010) |
| `current_version` | INTEGER | bản luận điểm hiện hành; `NULL` khi chưa có hoặc đã xoá |
| `thesis_state` | TEXT | `none`, `watching`, `refuted`, `closed` |
| `thesis_state_at` | TEXT | thời điểm đổi trạng thái gần nhất |

| Cột `subject_aliases` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | INTEGER | AUTOINCREMENT |
| `subject_id` | INTEGER | tham chiếu `subjects(id)` |
| `alias` | TEXT | như người dùng gõ (NFC) |
| `alias_key` | TEXT | NFC, viết hoa theo `toLocaleUpperCase("vi")`; dùng để tra không phân biệt hoa thường |
| `added_at`, `retired_at` | TEXT | `retired_at` `NULL` khi đang dùng |

Chỉ mục duy nhất một phần: `alias_key` trong các dòng `retired_at IS NULL`. Một bí danh đang dùng chỉ trỏ một chủ đề (YC-015). Tên hiển thị của chủ đề = bí danh đang dùng được thêm gần nhất.

### `thesis_versions`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `subject_id`, `version` | INTEGER | khoá chính ghép |
| `text` | TEXT | `NULL` sau khi xoá |
| `detail` | TEXT | tuỳ chọn; `NULL` sau khi xoá |
| `conditions` | TEXT | JSON mảng chuỗi, 0–8 phần tử; `NULL` sau khi xoá |
| `review_by` | TEXT | ngày `YYYY-MM-DD`, tuỳ chọn |
| `valid_from` | TEXT | thời điểm bản này thành hiện hành |
| `valid_to` | TEXT | `NULL` khi còn hiện hành; bằng đúng `valid_from` của bản kế tiếp, hoặc thời điểm xoá |
| `source`, `deleted_at` | TEXT | |

### `lessons`, `lesson_versions`, `lesson_applies`

| Cột `lessons` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | INTEGER | AUTOINCREMENT |
| `current_version` | INTEGER | |
| `deleted_at` | TEXT | |

| Cột `lesson_versions` | Kiểu | Ràng buộc |
| --- | --- | --- |
| `lesson_id`, `version` | INTEGER | khoá chính ghép |
| `title`, `summary` | TEXT | bắt buộc; `NULL` sau khi xoá |
| `exceptions`, `detail` | TEXT | tuỳ chọn; `NULL` sau khi xoá |
| `tags` | TEXT | JSON mảng chuỗi; `NULL` sau khi xoá |
| `source`, `created_at` | TEXT | |

`lesson_applies(lesson_id, version, position, subject_id)`: "áp dụng cho" của từng bản, theo thứ tự, tham chiếu chủ đề `ticker` hoặc `sector`. Bỏ trùng (giữ lần xuất hiện đầu) và tối đa 20 chủ đề (R77). Bị xoá cùng nội dung khi xoá bài học.

### `decisions`

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `id` | INTEGER | AUTOINCREMENT |
| `subject_id` | INTEGER | bắt buộc, chủ đề phải tồn tại (R51) |
| `thesis_version` | INTEGER | tuỳ chọn (R51); có thì phải là bản của `subject_id`, tồn tại và chưa xoá **lúc ghi** |
| `constraint_set` | INTEGER | giá trị `counters.constraint_set` đọc trong cùng transaction |
| `action`, `reason` | TEXT | bắt buộc; `NULL` sau khi xoá |
| `expectation`, `change_mind` | TEXT | tuỳ chọn; `NULL` sau khi xoá |
| `confidence` | TEXT | tuỳ chọn: `low`, `medium`, `high` |
| `review_on` | TEXT | ngày `YYYY-MM-DD`, tuỳ chọn |
| `source`, `created_at`, `deleted_at` | TEXT | |

Không có câu lệnh sửa nào cho bảng này ngoài xoá logic (YC-018).

## 3. Chuyển trạng thái

**Luận điểm của một chủ đề** (`thesis_state`, `current_version`):

```
none ──lưu bản (mốc: chưa có)──▶ watching (bản last_version+1)
watching ──lưu bản (mốc: N)──▶ watching (bản N+1; bản N đóng valid_to)
watching ⇄ refuted ⇄ closed  (đổi trạng thái, mốc: N; không tạo bản)
watching | refuted | closed ──xoá (mốc: N)──▶ none (mọi bản: nội dung NULL, deleted_at; last_version giữ)
```

Lưu bản mới khi đang `refuted` hoặc `closed` đưa trạng thái về `watching`.

**Ràng buộc, cách trình bày, bài học:** `có hiệu lực (bản N)` ──sửa (mốc N)──▶ `có hiệu lực (bản N+1)`; ──xoá (mốc N)──▶ `đã xoá` (cuối). Không hồi sinh.

**Quyết định:** `có` ──xoá──▶ `đã xoá` (cuối). Không có phiên bản, nên mốc khi xoá là "chưa bị xoá".

## 4. Quy tắc phiên bản và chống ghi đè

Mỗi lần ghi chạy trong một transaction `BEGIN IMMEDIATE` (giữ quyền ghi ngay từ đầu, nên lần đọc mốc và lần ghi không bị tiến trình khác xen vào):

1. đọc bản hiện hành của mục;
2. so với mốc bên gọi đưa; lệch thì huỷ transaction, trả lỗi xung đột kèm bản hiện hành;
3. ghi bản mới hoặc xoá; tăng `constraint_set` nếu là ràng buộc;
4. commit.

| Thao tác | Mốc | Lệch thì |
| --- | --- | --- |
| Tạo ràng buộc, bài học, quyết định | không cần | — |
| Lưu luận điểm khi chủ đề chưa có luận điểm | "chưa có" (`null`) | xung đột nếu đã có bản hiện hành |
| Sửa, đổi trạng thái, xoá | số bản hiện hành | xung đột; mục đã xoá thì lỗi "đã xoá" |
| Xoá quyết định | không cần | mục đã xoá thì lỗi "đã xoá" |

## 5. Đọc mục đã xoá

| Đọc | Trả về |
| --- | --- |
| Mục đã xoá theo ID | `{ id, deleted: true, deletedAt }`, không có trường nội dung |
| Bản cũ của mục đã xoá | `{ version, deleted: true }` |
| Bản luận điểm của lần viết trước khi xoá (chủ đề đã có luận điểm mới) | `{ version, deleted: true }` |
| Căn cứ của quyết định trỏ bản đã xoá | `{ subjectId, version, deleted: true }` |
| Cổng đọc theo chính sách | không bao giờ trả mục hoặc bản đã xoá |
