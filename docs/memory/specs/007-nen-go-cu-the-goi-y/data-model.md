# Data model 007

## 1. Khối thẻ (model viết, không bao giờ vào lịch sử)

```
<the_goi_y loai="rang_buoc">
noi_dung: Không gợi ý cổ phiếu penny
cau_goc: từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi
</the_goi_y>
```

| `loai` | Trường bắt buộc | Kiểm |
| --- | --- | --- |
| `rang_buoc` | `noi_dung`, `cau_goc` | Bảng chính sách `main_agent/propose/constraint`; `noi_dung` qua giới hạn và kiểm khoá của form ràng buộc; `cau_goc` khớp chữ gõ (research R-10) |
| `cach_trinh_bay` | `noi_dung`, `cau_goc` | `main_agent/propose/style`; như trên |
| `bai_hoc` | `tieu_de`, `tom_tat` | `main_agent/propose/lesson`; giới hạn và kiểm khoá của form bài học |
| khác (`luan_diem`, `quyet_dinh`, …) | — | Không có thẻ |

- Mỗi trường một dòng `ten: giá trị`, giá trị trên một dòng; trường lạ thì khối hỏng. Thứ tự trường tự do.
- Hợp lệ khi: là khối duy nhất trong câu trả lời cuối; sau thẻ đóng chỉ còn khoảng trắng; không nằm trong code fence hay dòng trích dẫn; tổng độ dài khối ≤ 2.000 ký tự.
- Mọi khối (hợp lệ hay không) bị tách khỏi chữ trước khi vào lịch sử, ở **mọi** lượt, kể cả khi thẻ tắt hay model hạng C. Khối không có thẻ đóng: bỏ dòng mở, giữ chữ phía sau.

## 2. Dòng thẻ trong file phiên (model không thấy)

```json
{"type":"card","ts":"2026-11-07T09:12:00.000Z","id":"the-12-a3f9","turn":12,"kind":"constraint",
 "text":"Không gợi ý cổ phiếu penny","quote":"từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi","state":"pending"}
{"type":"card","ts":"2026-11-07T09:13:05.000Z","id":"the-12-a3f9","state":"saved","saved":{"group":"constraint","id":2}}
```

| Trường | Có khi | Ghi chú |
| --- | --- | --- |
| `id` | luôn | `the-<turn>-<4 hex đầu SHA-1 nội dung>`, giao diện gán khi lượt vào hàng ghi; lượt bị bỏ rồi gửi lại có nội dung khác thì khác id |
| `turn` | dòng tạo | mã lượt của spec 006 |
| `kind` | dòng tạo | `constraint` (từ `rang_buoc`), `style` (từ `cach_trinh_bay`), `lesson` (từ `bai_hoc`) |
| `text` / `title`, `summary` / `quote` | dòng tạo | theo loại |
| `state` | luôn | `pending`, `saved`, `dismissed` |
| `saved` | `state: "saved"` | nhóm và số mục người dùng đã lưu (nhóm có thể khác `kind`: người dùng đổi ràng buộc thành cách trình bày trong form) |

- Dòng tạo đi qua bộ đệm theo lượt (như `chart`, `harness`), ghi trước `turn_end`. Dòng đổi trạng thái là một phần riêng trong hàng ghi (như `redact`). Dòng sau cùng của một `id` thắng.
- `loadSession` trả `cards`: theo `id`, trạng thái cuối, cùng vị trí trong `display` (số tin nhắn đã đọc khi gặp dòng tạo) để giao diện đặt thẻ dưới đúng câu trả lời.
- Bản app cũ bỏ qua dòng `card` (đã bỏ qua loại dòng lạ).

## 3. Dòng nhắc mới của sổ (vào lịch sử như mọi dòng nhắc)

| Khoá | Chữ (mẫu, chốt ở code; test so đúng chữ) |
| --- | --- |
| `compacted:<mã>` | `[Memory · nhắc] Hội thoại phía trên đã được nén (mã nén <mã>); bản tóm tắt chỉ giữ nhãn memory, cần nội dung thì đọc bằng memory_read.` |
| `cardPending:<id>` | `[Memory · nhắc] Gợi ý lưu <id> (<loại>) đang chờ người dùng xem; không đề xuất lại.` |
| `cardSaved:<id>` | `[Memory · nhắc] Người dùng đã lưu gợi ý <id> thành <nhóm> #<số>.` |
| `cardDismissed:<id>` | `[Memory · nhắc] Người dùng đã bỏ qua gợi ý <id>; không đề xuất lại trong phiên này.` |

`<mã>` là 6 ký tự hex đầu của SHA-1 chữ bản tóm tắt. `<loại>`, `<nhóm>`: "ràng buộc", "cách trình bày", "bài học". Mẫu nhận lại các dòng này thêm vào `history-blocks.ts` (sinh từ chính hàm viết ra chúng, như spec 006).

## 4. Dòng lược trong request tóm tắt (chỉ trong request, không lưu)

```
[Memory · bài học · #7 · bản 1 · ghi 20/10/2026 · người dùng tự ghi]
(nội dung đã lược khỏi bản tóm tắt; đọc bằng memory_read)
```
Dòng nhãn giữ nguyên byte như khối gốc.

## 5. Cấu hình

```json
{ "memory": { "provider": "notebook", "cards": true } }
```
- `provider`: `"none" | "notebook"`. Giá trị cũ `"file"` được hiểu là `"notebook"`; chỉ giao diện ghi lại.
- `cards`: mặc định `true` khi vắng. Chỉ có tác dụng khi `provider` là `"notebook"`.

## 6. Hợp đồng và kiểu dữ liệu đổi

| Chỗ | Đổi |
| --- | --- |
| `MemoryContext` | thêm `cards?: readonly CardOutcome[]` (`{ id, kind, state, saved? }`) |
| `MemoryProvider` | bỏ `approve`, `reject` và mọi phần chỉ memory cũ dùng (xác định khi code bằng tìm chỗ gọi; ghi danh sách vào mô tả PR) |
| `MemoryItem` | bỏ `status` (`"pending" \| "active"`) và `MemoryStatus` |
| `RunOptions` | thêm `cards?: boolean` |
| `AgentEvent` | thêm `{ type: "card"; card: CardDraft }` (phát trước `done`; nội dung đã kiểm, chưa có id) |
| `SessionEntry` | thêm `card` (§2) |
| `NotebookFormRequest` | thêm điền sẵn (ràng buộc: `text`; bài học: `title`, `summary`), `card: { id, quote? }`; lưu từ thẻ thì nguồn `card` |
