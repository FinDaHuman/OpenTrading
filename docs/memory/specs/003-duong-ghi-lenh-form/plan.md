# Plan 003: Sổ ghi nhớ, đường ghi: lệnh và form

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (04/11/2026, qua cổng 2) |
| **Ngày** | 04/11/2026 |
| **Spec** | [spec.md](spec.md) |
| **Nhánh** | `feat/memory` |
| **Code đã kiểm ở** | commit `34183fd` (spec 002). Không gộp `main` (người dùng chốt 03/11/2026: gộp một lần khi xong kiến trúc) |

## 1. Tóm tắt

Thêm đường ghi cho sổ ghi nhớ, chạy hoàn toàn tại máy:
- **Bộ điều phối** (TUI): nhận ra bốn lệnh `/nho`, `/luandiem`, `/baihoc`, `/quyetdinh` **trước** khi ghi lịch sử ô nhập, ở cả bốn đường (gửi, Esc hai lần, Ctrl+C, chọn trong danh sách gợi ý), và chỉ lưu tên lệnh. Sổ không dùng được thì báo, giữ chữ trong ô nhập.
- **Tay cầm quản trị** của spec 002 được mở rộng thêm các thao tác ghi kho đã có (thêm, sửa, đổi trạng thái, tạo chủ đề, ghi quyết định) và các lần đọc để điền form; lỗi kho đổi thành kết quả cho form **ở một chỗ**.
- **Hai module thuần** trong phần memory: chỗ khác nhau theo từng ô và đếm ký tự; cảnh báo (luật cứng lưu thành bài học, giá và dự báo, trùng).
- **Form** (file mới trong TUI): một khung chung, bốn bộ ô, màn hình xung đột.
- **`/memory`**: thêm sửa, đổi trạng thái luận điểm, xuất Markdown.

Không đổi: hợp đồng `MemoryProvider`, lược đồ kho, bảng chính sách, vòng agent, lưu phiên, `/config`, `FileMemory`.

## 2. Bối cảnh kỹ thuật

| Mục | Giá trị |
| --- | --- |
| Runtime | Bun 1.4.2 (`C:\Users\Admin\anaconda3\Scripts\bun.exe`), TypeScript strict, ESM, import nội bộ không đuôi `.ts` |
| Lưu trữ | Kho của spec 001 (`bun:sqlite`, đồng bộ). Không bảng mới, không đổi lược đồ. File xuất Markdown ghi vào `<thư mục dữ liệu>/exports` |
| Kiểm cấu trúc | Không cần `zod` mới: form chỉ tạo đối tượng có kiểu cho tay cầm; kho tự kiểm mọi trường |
| LLM | Không gọi. `ai@7.0.137` chỉ dùng trong test lượt hội thoại thật (TC-004) qua `fetch` giả |
| Giao diện | OpenTUI + Solid; `<input>` một dòng, `<textarea>` nhiều dòng có `keyBindings` tuỳ chỉnh; hộp thoại thay chỗ ô nhập chat |
| Test | `bun:test`; `OPENTRADING_HOME` tạm; `fetch` giả đếm request; giao diện headless `testRender` (mẫu `test/memory-notebook-tui.test.tsx`); seed kho bằng `test/helpers/memory-notebook.ts` |
| Nền tảng | Windows và Ubuntu (CI chạy cả hai) |
| Ràng buộc khác | Ghi chỉ khi người dùng bấm xác nhận, trên luồng giao diện, chờ tối đa 1 giây (thời gian chờ quyền ghi của kho) |

**Đã kiểm trong code (`34183fd`):** chi tiết kèm `file:dòng` ở §4 `handoff.md`. Tóm tắt những điều plan dựa vào:
- Lịch sử ô nhập ghi **trước** khi phân loại lệnh ở đường gửi; đường xoá ô ghi cả chữ lẫn đoạn dán; đường chọn trong danh sách gợi ý đã chỉ ghi `/<tên>`.
- `run()` xoá ô nhập trước khi gọi `runCommand`; lệnh không biết thì giữ chữ và báo.
- Hộp thoại nằm thay chỗ ô nhập chat; Ctrl+C khi có hộp thoại thì đóng hộp thoại.
- `NotebookAdmin` đã nhận `writer()` từ vòng đời kho, chỉ đang dùng cho xoá; test quét mã chỉ cho `memory.tsx`, `notebook.tsx` import tay cầm.
- Kho: chỉ bí danh **đang dùng** phải duy nhất; lưu bản luận điểm mới đặt trạng thái về "đang theo dõi"; ghi quyết định nhận **mọi bản luận điểm chưa xoá** của chủ đề, đọc phiên bản bộ ràng buộc trong cùng transaction; `MemoryStoreError.current` mang bản hiện hành khi xung đột; các hàm kiểm văn bản của kho (`requiredText`, `optionalText`, `textList`, `checkCount`) và `countChars`, `MEMORY_LIMITS`, `looksLikeSecret` đều export.
- Lệnh `/export` ghi vào `<thư mục dữ liệu>/exports`; thư mục dữ liệu không bao giờ là workspace.
- Test danh sách lệnh trong `test/tui.test.tsx` so **8 dòng đầu**; chèn bốn lệnh mới sau `/memory` thì không ảnh hưởng.

## 3. Quyết định thiết kế

### 3.1. Khối chức năng và luồng

```
Ô nhập chat ──Enter / Esc Esc / Ctrl+C / chọn gợi ý──▶ Bộ điều phối (app.tsx)
   │  lệnh memory? (notebookCommandOf)
   │    ├─ có: lịch sử ô nhập ← "/nho" (không tham số, không đoạn dán)
   │    │      openNotebookForm(memory, tên, tham số)
   │    │        ├─ sổ tắt / memory cũ / kho lỗi → báo, GIỮ chữ trong ô nhập, không ghi gì
   │    │        └─ được → state.notebookForm = yêu cầu; hộp thoại "notebook-form"
   │    └─ không: như hiện nay
   ▼
Form (TUI) ── đọc qua tay cầm: lookupSubject / current… ──▶ điền sẵn, "đang sửa từ bản N"
   │  mỗi phím: fieldCounts, draftWarnings (thuần, không đọc kho)
   │  Xác nhận ─▶ (sửa) fieldChanges so bản đã đọc → hỏi lại
   │          ─▶ tay cầm.save…(nháp, mốc bản) ─▶ kho (một transaction mỗi thao tác)
   ▼
SaveResult ─ ok → "Đã lưu …", đóng form
           ─ conflict → màn xung đột (fieldChanges bản hiện có ↔ nháp), 3 lựa chọn
           ─ deleted / busy / limit / secret / invalid / alias_taken → báo, giữ nháp
```

Lượt hỏi kế tiếp: provider của spec 002 tự thấy kho đổi (`changed()`), dựng lại ràng buộc, mục lục, dòng nhắc. Spec này không đụng đường đọc.

### 3.2. Bộ điều phối và lịch sử ô nhập (T6)

- `notebookCommandOf(text)` (code memory, thuần): lấy từ đầu tiên sau `/` của chữ đã cắt khoảng trắng, hạ chữ thường; là một trong bốn tên thì trả tên, không thì `undefined`. Chạy trên chữ **có viên đoạn dán** (`[Pasted text #1]`) cũng như chữ đã mở rộng, vì tên lệnh luôn đứng đầu.
- **Bốn đường**, mỗi đường một chỗ sửa trong `app.tsx`:

  | Đường | Hiện nay lưu | Sau khi sửa |
  | --- | --- | --- |
  | Enter (`run`) | cả dòng và đoạn dán, trước khi phân loại | lệnh memory: `addHistory("/<tên>")` không đoạn dán; chữ khác: như cũ |
  | Esc hai lần (`rememberDraft`) | chữ và đoạn dán | lệnh memory: chỉ `/<tên>` |
  | Ctrl+C trên ô nhập (`rememberDraft`) | chữ và đoạn dán | như Esc hai lần (cùng hàm) |
  | Chọn trong danh sách gợi ý | `/<tên>` | giữ nguyên (đã đúng); thêm test |

- **Giữ chữ khi sổ không dùng được:** trong `run`, với lệnh memory, gọi `openNotebookForm` **trước** `setInput("")`. Trả lỗi thì `say(lỗi, "warning")` và `return` (giống nhánh "lệnh không biết"). Đường chọn trong danh sách gợi ý chỉ có tên lệnh trong ô, nên xoá ô ở đó không mất gì.
- Tham số lệnh lấy từ chữ **đã mở rộng** (`expanded.text`), nên form nhận đủ đoạn dán (Story 2 kịch bản 3).
- Lệnh chỉ chạy từ `run` (chữ người dùng gõ). Câu trả lời của model, kết quả tool, thông báo agent con không đi qua `run`, nên không bao giờ mở form (Story 2 kịch bản 6; chỉ cần test, không cần code).

### 3.3. Tay cầm quản trị mở rộng (object-capability)

- `NotebookAdmin` vẫn chỉ lấy được bằng `notebookAdmin(provider)`, cất trong `WeakMap`. Thêm các thao tác ghi và đọc ở §5. Provider đưa cho vòng agent vẫn chỉ giữ `gate`.
- Ai được import tay cầm: thư mục `src/core/memory/notebook/`, `src/tui/dialogs/memory.tsx`, `src/tui/dialogs/notebook.tsx`, và thư mục mới `src/tui/dialogs/notebook-form/`. `app.tsx` **không** import tay cầm: nó gọi `openNotebookForm` của `notebook-form/open.ts`. Test quét mã mở rộng danh sách cho phép đúng như vậy (TC-005).
- **Lỗi kho đổi thành `SaveResult` ở một chỗ** (`admin.ts`), như `remove` đã làm. Câu báo lấy từ `MemoryStoreError.message` của kho (kho đã không chép chữ người dùng) hoặc câu cố định của form; không bao giờ ghép chữ người dùng gõ vào câu báo.
- **Đọc để điền form** trả `{ ok: false, message }` khi kho lỗi, không trả rỗng (YC-027); form khi đó không mở, chỉ báo.

### 3.4. Tạo chủ đề cùng nội dung

Kho không có thao tác "tạo chủ đề và luận điểm trong một transaction", và plan **không đổi hình dạng API của spec 001**. Cách làm:
1. Kiểm trước nội dung bằng **đúng các hàm kiểm của kho** (export sẵn): trường trống, giới hạn, mẫu khoá. Hỏng thì báo, chưa tạo gì.
2. Tạo chủ đề ngành mới (nếu người dùng gõ tên ngành mới), rồi chủ đề, rồi bí danh khác, rồi nội dung. Mỗi bước một transaction của kho.
3. Bước sau lỗi (kho bận, bí danh vừa bị cửa sổ khác lấy, tổng ràng buộc…) thì `SaveResult` có `partial`: câu báo ("Đã tạo chủ đề FPT; luận điểm chưa lưu: …") **và ID của mọi chủ đề đã tạo trong lần lưu đó** (chủ đề chính, ngành mới, chủ đề "áp dụng cho" mới). Chủ đề rỗng không chứa nội dung riêng tư ngoài bí danh, nên để lại (spec §3).
4. **Form nhận `partial` thì đổi mọi ô "chủ đề mới" đã được tạo thành "chủ đề đã có" (theo ID trả về), giữ nguyên nội dung người dùng đã gõ.** Xác nhận lại chỉ lưu phần còn thiếu: luận điểm, quyết định của mã mới, bài học có chủ đề "áp dụng cho" mới, chủ đề ngành mới chưa tạo được. Không bao giờ tạo chủ đề thứ hai cùng bí danh: bí danh đã có chủ thì kho từ chối (`alias_taken`), và form đã không còn gửi yêu cầu tạo chủ đề đó.

   Ví dụ: `/luandiem FPT`, ngành mới "Công nghệ". Lần 1: tạo được ngành "Công nghệ" (#12) và chủ đề FPT (#13), luận điểm gặp kho bận → `partial = { message: "Đã tạo chủ đề FPT; luận điểm chưa lưu: kho memory đang bận…", created: [{ role: "sector", id: 12, display: "Công nghệ" }, { role: "subject", id: 13, display: "FPT" }] }`. Form đổi ô thành "FPT (#13, đã có), ngành Công nghệ (#12)", nội dung luận điểm còn nguyên. Lần 2: Xác nhận → chỉ `saveThesis(13, null, …)` → "Đã lưu luận điểm FPT bản 1."; kho có đúng một chủ đề FPT.

### 3.5. Quyết định: gắn bản đã xem

- Form giữ `shownVersion` (bản luận điểm đã hiện lúc mở, hoặc lúc người dùng chọn "xem bản mới").
- Lúc Xác nhận, form đọc lại bản hiện hành qua tay cầm:
  - vẫn là `shownVersion` → ghi với `thesisVersion = shownVersion`;
  - khác → hỏi "[Bản N, bản bạn đã xem] [Xem bản M trước] [Huỷ]";
  - bản đã xem đã bị xoá → không ghi, cho chọn "không gắn luận điểm".
- **Quyết định thiết kế:** lần so này chạy ở form, **ngoài transaction** của kho. Kho nhận mọi bản luận điểm chưa xoá làm căn cứ, nên giữa lần so và lần ghi có một khe: cửa sổ khác lưu bản mới đúng lúc đó. Khe này **vô hại**, vì quyết định luôn gắn đúng bản người dùng đã thấy (không bao giờ gắn bản chưa thấy). Nếu đúng trong khe đó bản đã xem bị xoá, kho từ chối (`deleted`) và form xử lý như ca "bị xoá".
- Phiên bản bộ ràng buộc do kho đọc trong cùng transaction ghi quyết định.

### 3.6. Xung đột phiên bản

- Mọi lần sửa gửi `expected` = bản form đã đọc lúc mở. Kho từ chối thì `SaveResult.conflict` mang **bản hiện hành** dưới dạng nháp (cùng kiểu với nháp của form), để `fieldChanges(hiện có, nháp)` liệt kê từng ô khác nhau.
- Ba lựa chọn: **Lưu bản của tôi thành bản M+1** (form đổi `expected` thành M, hiện lại chỗ khác nhau so với bản M, cần Xác nhận lần nữa), **Bỏ bản của tôi, xem bản M** (nạp lại form từ bản M), **Sửa tiếp**.
- Mục bị xoá ở nơi khác (`deleted`, hoặc luận điểm `conflict` không có bản hiện hành) → "[Lưu thành mục mới] [Huỷ]".

### 3.7. Cảnh báo (thuần, không chặn)

Một bảng mẫu cố định cho mỗi loại cảnh báo, mỗi dòng có lý do; thêm mẫu là thêm một dòng cộng một ca test.

| Cảnh báo | Áp cho | So trên | Mẫu bản đầu |
| --- | --- | --- | --- |
| Luật cứng lưu thành bài học (K7) | tiêu đề, tóm tắt bài học | chữ thường NFC **giữ dấu**; thêm bản bỏ dấu chỉ cho cụm nhiều từ | "không bao giờ", "tuyệt đối không", "cấm", "không được", "tối đa <số> % danh mục" (có hoặc không chữ "danh mục"; "%" có hoặc không cách) |
| Giá, dự báo | mọi trường văn bản của mọi form | chữ thường NFC giữ dấu | số kèm đơn vị tiền ("đồng", "đ", "vnđ", "vnd", "nghìn", "ngàn", "k", "triệu", "tỷ"), "giá mục tiêu", "giá hiện tại", "dự báo", "sẽ lên", "sẽ xuống", "sẽ đạt" |
| Trùng | văn bản ràng buộc / cách trình bày; tiêu đề bài học | chữ đã chuẩn hoá bằng `foldName` (bỏ dấu, hoa thường, khoảng trắng) | trùng nguyên văn với mục đang có hiệu lực (cả giữa ràng buộc và bài học) |

- "cấm" so **có dấu**, vì bỏ dấu thì "cấm" trùng "cảm", "cám" ("cảm nhận thị trường" không được cảnh báo). Cụm nhiều từ như "khong bao gio" mới so cả bản bỏ dấu.
- Cảnh báo số liệu **không** bật chỉ vì có số hay phần trăm: "Tối đa 20% danh mục", "biên gộp dưới 10%" không cảnh báo (TC-016).
- Hiện ở form trước khi xác nhận; người dùng bấm "Vẫn lưu" là đủ. Không lưu cảnh báo vào kho.

### 3.8. Form

- Một khung chung (`frame.tsx` của form): tiêu đề, dòng "đang sửa từ bản N" hoặc "mới", các ô, dòng đếm ký tự, khu cảnh báo, hàng nút. Bốn bộ ô: ràng buộc và cách trình bày (một form, chọn ngăn), luận điểm (cả ô chủ đề mới), bài học, quyết định.
- **Phím:** Tab, Shift+Tab chuyển ô; ô một dòng (`<input>`): Enter chuyển sang ô kế; ô nhiều dòng (`<textarea>`, cho chi tiết, lý do, kỳ vọng, điều gì làm đổi ý): Enter xuống dòng, không lưu; **chỉ Enter trên nút Xác nhận mới lưu**. Esc và Ctrl+C: form chưa có thay đổi thì đóng ngay; có thay đổi thì hỏi "Bỏ nội dung đang sửa?" (người dùng chốt 04/11/2026). Bỏ thì nội dung không lưu ở đâu cả.
- **Ctrl+C cần sửa lõi:** hiện nay Ctrl+C khi có hộp thoại do `app.tsx` xử lý và đóng hộp thoại ngay, trước khi hộp thoại kịp xử lý. Form đặt cờ `state.notebookFormDirty` khi nội dung khác lúc mở; `app.tsx` thấy hộp thoại `notebook-form` có cờ đó thì đặt `state.notebookFormAskLeave = true` thay vì đóng, form thấy cờ thì hiện câu hỏi như Esc. Hộp thoại khác giữ nguyên hành vi. Bấm Ctrl+C lần hai trong 800 ms vẫn thoát app như mọi chỗ (cơ chế "bấm lần nữa để thoát" có sẵn không đổi); nội dung form khi đó bỏ đi, không lưu.
- **Ô điều kiện "Sai nếu":** danh sách có thứ tự, thêm, xoá, tối đa 8; mỗi dòng hiện "n/160".
- **Ngăn của `/nho`:** không chọn sẵn; nút Xác nhận mờ cho tới khi chọn.
- **Đoạn dán vào ô của form:** chuẩn hoá xuống dòng như ô nhập chat; không đi qua lịch sử ô nhập.
- **Trạng thái form chỉ ở RAM**; đóng form là mất.
- Lệnh memory gõ khi form đang mở: không xảy ra, vì hộp thoại thay chỗ ô nhập chat.

### 3.9. `/memory`: sửa, đổi trạng thái, xuất

- Màn chi tiết thêm phím: `s` sửa (mọi nhóm trừ quyết định), `t` đổi trạng thái (chỉ luận điểm; chọn trong ba trạng thái, hỏi lại, gửi kèm bản đang xem). Màn danh sách thêm Ctrl+X xuất (không dùng `x`: ô lọc của danh sách nhận mọi chữ gõ, `x` sẽ thành chữ lọc; người dùng chấp nhận 04/11/2026).
- Sửa mở hộp thoại form với yêu cầu "sửa mục X từ bản N", giống hệt khi gõ lệnh.
- Câu "Sổ ghi nhớ còn trống. Lệnh ghi … sẽ có ở bản sau." đổi thành hướng dẫn bốn lệnh.
- **Xuất:** màn xuất có một ô chọn "Kèm nhật ký quyết định" (mặc định tắt, không nhớ), câu "File xuất là bản sao; xoá trong sổ không xoá file này.", và khi bật ô chọn thì câu cảnh báo của spec. File `<thư mục dữ liệu>/exports/so-ghi-nho-DD-MM-YYYY.md`; có rồi thì thêm `-HHmmss`; vẫn trùng thì báo lỗi, không ghi đè. Ghi có hạn chờ 5 giây; lỗi thì báo lỗi, không báo đã xuất.
- **Xuất đọc bằng quyền đọc của người dùng** (như màn `/memory`, spec 002), không qua cổng đọc theo chính sách: cổng đó dành cho vai model. Test duyệt bảng (TC-013) thêm một ca cho đường xuất: mặc định không có quyết định, bật thì có; và mọi vai model vẫn không có "làm cho có hiệu lực".
- **Test của đường xuất kiểm đầu ra** (file xuất mặc định không chứa chuỗi đánh dấu đặt trong lý do quyết định, bật thì có), **không kiểm một dòng trong bảng chính sách**, vì bảng chỉ có luật cho vai model và quyền "làm cho có hiệu lực" của người dùng; không có và không thêm luật cho việc người dùng tự đọc hay tự xuất sổ.

### 3.10. Sổ không dùng được

`openNotebookForm` trả lỗi, không mở form, không mở kho, không đổi cấu hình:

| Tình huống | Nhận biết | Câu báo |
| --- | --- | --- |
| "Tắt" | `notebookAdmin(memory)` không có, `memory.id === "none"` | "Sổ ghi nhớ đang tắt; /nho chưa lưu gì. Bật trong /config (mục Memory → Sổ ghi nhớ) rồi gõ lại." |
| "Memory cũ" | không có tay cầm, `memory.id === "file"` | câu trên + "Lệnh này ghi vào sổ ghi nhớ, không ghi vào memory cũ." |
| Kho mở lỗi | `admin.problem()` có | "Sổ ghi nhớ chưa mở được: <lý do, đường dẫn của kho>" |
| Kho đã đóng khi form còn mở | lần lưu nhận `failed` từ tay cầm (`side.closed()`) | "Sổ ghi nhớ đã tắt; chưa lưu." |

## 4. Cấu trúc file

```
src/core/memory/notebook/commands.ts      tên bốn lệnh memory; notebookCommandOf (thuần)
src/core/memory/notebook/admin.ts         (sửa) tay cầm quản trị: thêm đọc để điền form, các thao tác ghi,
                                          xuất; đổi lỗi kho thành SaveResult ở một chỗ
src/core/memory/notebook/drafts.ts        kiểu nháp của bốn form; chuyển bản trong kho thành nháp
src/core/memory/notebook/form-model.ts    fieldChanges (chỗ khác nhau theo ô), fieldCounts (đếm ký tự, tổng)
src/core/memory/notebook/warnings.ts      bảng mẫu và draftWarnings: luật cứng, giá và dự báo, trùng
src/core/memory/notebook/export.ts        dựng Markdown của sổ (thuần) và ghi file có hạn chờ, không ghi đè

src/tui/commands.ts                [LÕI]  thêm bốn lệnh sau /memory; mô tả /memory
src/tui/state.ts                   [LÕI]  DialogName thêm "notebook-form"; trường notebookForm
src/tui/app.tsx                    [LÕI]  bốn đường lịch sử ô nhập; mở form, giữ chữ khi sổ không dùng được;
                                          Match hộp thoại form
src/tui/dialogs/notebook.tsx       [LÕI]  /memory: sửa, đổi trạng thái, xuất; câu sổ trống
src/tui/dialogs/notebook-form/open.ts      [LÕI, file mới]  openNotebookForm: kiểm sổ dùng được, đặt state
src/tui/dialogs/notebook-form/frame.tsx    [LÕI, file mới]  khung form: ô, đếm, cảnh báo, nút, phím, hỏi lại khi Esc
src/tui/dialogs/notebook-form/fields.tsx   [LÕI, file mới]  ô một dòng, ô nhiều dòng, danh sách điều kiện, chọn
src/tui/dialogs/notebook-form/forms.tsx    [LÕI, file mới]  bốn bộ ô (ghi nhớ, luận điểm, bài học, quyết định), gọi tay cầm
src/tui/dialogs/notebook-form/conflict.tsx [LÕI, file mới]  màn chỗ khác nhau: trước khi lưu sửa, và khi xung đột
src/tui/dialogs/notebook-form/export.tsx   [LÕI, file mới]  màn xuất Markdown

test/memory-notebook-commands.test.ts      notebookCommandOf
test/memory-notebook-admin-write.test.ts   các thao tác ghi của tay cầm, tạo chủ đề, bí danh đã thôi dùng,
                                           quyết định gắn bản, lỗi kho, xuất
test/memory-notebook-form-model.test.ts    fieldChanges, fieldCounts, draftWarnings
test/memory-notebook-forms-tui.test.tsx    App headless: lịch sử ô nhập, 0 request, form, xung đột, /memory, sổ tắt
test/memory-notebook-lifecycle.test.ts     (sửa) test quét mã: thêm thư mục notebook-form/ vào danh sách cho phép
test/memory-notebook-tui.test.tsx          (sửa) câu "Sổ ghi nhớ còn trống" đổi
test/memory-policy.test.ts                 (sửa) ca đường xuất ở vai người dùng
```

`src/core` không import `src/tui`. Không `utils.ts`, `manager.ts`. `src/core/memory/types.ts`, `file-memory.ts`, `store/*`, `policy.ts` không sửa. File form mới nằm trong `src/tui/`, phần của chủ repo, nên vẫn ghi `[LÕI]` để người dùng xác nhận và chủ repo duyệt.

## 5. Giao diện

```ts
// src/core/memory/notebook/commands.ts
export const NOTEBOOK_COMMANDS = ["nho", "luandiem", "baihoc", "quyetdinh"] as const
export type NotebookCommand = (typeof NOTEBOOK_COMMANDS)[number]
/** "/NHO  Không dùng margin" → "nho"; "/memory", "Phân tích HPG" → undefined. */
export function notebookCommandOf(text: string): NotebookCommand | undefined

// src/core/memory/notebook/drafts.ts
export interface ConstraintDraft { kind?: "constraint" | "style"; text: string }
export interface NewSubjectDraft {
  kind: SubjectKind                       // mặc định "ticker"
  alias: string                           // loại mã: viết hoa khi lưu
  sector?: { id: number } | { newName: string }
  otherAliases: string[]
  uppercaseOnly: boolean
}
export interface ThesisDraft { text: string; detail?: string; conditions: string[]; reviewBy?: string }
export type SubjectRef = { id: number } | { newName: string; kind: "ticker" | "sector" }
export interface LessonDraft {
  title: string; summary: string; appliesTo: SubjectRef[]
  exceptions?: string; detail?: string; tags: string[]
}
export interface DecisionDraft {
  action: string; reason: string; expectation?: string; confidence?: Confidence
  reviewOn?: string; changeMind?: string
  basis: { version: number } | "none"     // bản form đã hiện
}
export type AnyDraft = ConstraintDraft | ThesisDraft | LessonDraft | DecisionDraft

// src/core/memory/notebook/form-model.ts
export type FormGroup = "constraint" | "thesis" | "lesson" | "decision"
export interface FieldChange { field: string; label: string; before: string; after: string }
export function fieldChanges(group: FormGroup, before: AnyDraft, after: AnyDraft): FieldChange[]
export interface FieldCount { field: string; label: string; count: number; max: number; over: boolean }
/** Per-field counts, plus the running total for constraints and styles (active ones, minus the one edited). */
export function fieldCounts(group: FormGroup, draft: AnyDraft, totals?: { activeChars: number }): FieldCount[]

// src/core/memory/notebook/warnings.ts
export type WarningKind = "hard_rule" | "figure" | "duplicate"
export interface DraftWarning { kind: WarningKind; field: string; message: string; duplicateOf?: { group: NotebookGroup; id: number } }
export function draftWarnings(group: FormGroup, draft: AnyDraft, existing: readonly NotebookEntry[]): DraftWarning[]

// src/core/memory/notebook/admin.ts (thêm vào NotebookAdmin)
export type Read<T> = { ok: true; value: T } | { ok: false; message: string }
export type SubjectLookup =
  | { found: Subject; thesis?: ThesisVersion; deletedUpTo?: number }     // deletedUpTo: luận điểm đã xoá, số bản cuối
  | { found?: undefined; retired?: { subjectId: number; display: string; retiredAt: string } }
export type SaveResult =
  | { ok: true; message: string; saved: { id: number; version?: number } }
  | { ok: false; reason: "conflict"; message: string; current: AnyDraft & { version: number } }
  | { ok: false; reason: "deleted" | "busy" | "invalid" | "limit" | "secret" | "alias_taken" | "failed"
      message: string; field?: string
      /** Some subjects were created before the failing step: the form now treats them as existing ones. */
      partial?: { message: string; created: CreatedSubject[] } }
export interface CreatedSubject {
  /** Which field of the form asked for it: the main subject, its new sector, or one "áp dụng cho" entry. */
  role: "subject" | "sector" | "applies_to"
  /** For "applies_to": the index of the entry in LessonDraft.appliesTo. */
  index?: number
  id: number
  display: string
}
export interface NotebookAdmin {
  // có sẵn: path, problem(), entries(), remove()
  lookupSubject(alias: string): Read<SubjectLookup>
  sectors(): Read<{ id: number; display: string }[]>
  constraintDraft(id: number): Read<ConstraintDraft & { id: number; version: number }>
  lessonDraft(id: number): Read<LessonDraft & { id: number; version: number }>
  activeConstraintChars(kind: "constraint" | "style"): Read<number>
  saveConstraint(draft: ConstraintDraft, edit?: { id: number; expected: number }): SaveResult
  saveThesis(subject: { id: number } | NewSubjectDraft, expected: number | null, draft: ThesisDraft): SaveResult
  saveLesson(draft: LessonDraft, edit?: { id: number; expected: number }): SaveResult
  saveDecision(subject: { id: number } | NewSubjectDraft, draft: DecisionDraft): SaveResult
  setThesisState(subjectId: number, expected: number, state: "watching" | "refuted" | "closed"): SaveResult
  exportMarkdown(opts: { decisions: boolean }): Promise<{ ok: true; file: string } | { ok: false; message: string }>
}

// src/core/memory/notebook/export.ts
export function renderNotebookMarkdown(entries: readonly NotebookEntry[], opts: { decisions: boolean; at: Date }): string
export function exportFileName(at: Date, taken: (name: string) => boolean): string | undefined

// src/tui/state.ts
export type NotebookFormRequest =
  | { group: "constraint"; text?: string; edit?: { id: number }; kind?: "constraint" | "style" }
  | { group: "thesis"; alias?: string }
  | { group: "lesson"; edit?: { id: number }; title?: string }
  | { group: "decision"; alias?: string }
  | { group: "export" }
// state: notebookForm: undefined as NotebookFormRequest | undefined
//        notebookFormDirty: false     (form đặt khi nội dung khác lúc mở)
//        notebookFormAskLeave: false  (app.tsx đặt khi Ctrl+C trên form có thay đổi; form hỏi lại rồi đặt về false)

// src/tui/dialogs/notebook-form/open.ts
/** undefined: the form is open. A string: why it cannot open (nothing written, nothing opened). */
export function openNotebookForm(memory: MemoryProvider, name: NotebookCommand, args: string): string | undefined
```

Chữ ký có thể đổi nhỏ khi code. Đổi cách chia quyền (provider chỉ giữ `gate`; ghi chỉ qua tay cầm; `app.tsx` không import tay cầm) thì báo lại.

## 6. Điểm đụng lõi

Người dùng xác nhận **từng dòng** trước khi code. Mọi dòng `blocked-by-core` tới khi chủ repo duyệt trong PR.

| # | File [LÕI] | Sửa gì | Vì sao | Cỡ | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/tui/commands.ts` | Thêm bốn dòng lệnh `/nho [văn bản]`, `/luandiem [mã]`, `/baihoc`, `/quyetdinh [mã]` ngay sau `/memory`; mô tả `/memory` thành "Xem, sửa, xoá, xuất sổ ghi nhớ" | Lệnh phải có trong danh sách để `run` nhận ra (lệnh lạ bị báo "Không có lệnh") và hiện trong gợi ý, `/help` (YC-001, YC-023) | Nhỏ (5 dòng) | `blocked-by-core` |
| 2 | `src/tui/state.ts` | `DialogName` thêm `"notebook-form"`; trường `notebookForm` (yêu cầu form đang mở); hai cờ `notebookFormDirty`, `notebookFormAskLeave` | Hộp thoại mở qua `state.dialog`; form cần biết mở cho mục nào (YC-008 tới YC-011, YC-023); Ctrl+C hỏi lại khi form có thay đổi (spec §3) | Nhỏ (5 dòng) | `blocked-by-core` |
| 3 | `src/tui/app.tsx` | (a) `run`: lệnh memory lưu lịch sử chỉ `/<tên>`, gọi `openNotebookForm` trước khi xoá ô, lỗi thì báo và giữ chữ; (b) `rememberDraft` (Esc hai lần, Ctrl+C): lệnh memory chỉ lưu `/<tên>`; (c) `runCommand`: bốn `case` cho đường chọn trong gợi ý; (d) thêm `Match` cho hộp thoại `notebook-form`; (e) `onQuitKey`: Ctrl+C khi hộp thoại `notebook-form` có thay đổi thì đặt `notebookFormAskLeave` thay vì đóng; hộp thoại khác như cũ | T6: lịch sử ô nhập ghi trước khi phân loại lệnh và ghi cả đoạn dán ở đường xoá ô; đây là C-3 (phần lệnh) của §C11 (YC-003, YC-026). (e): Ctrl+C hiện đóng mọi hộp thoại ngay, làm mất nội dung form đang gõ (spec §3, người dùng chốt 04/11/2026) | Vừa (khoảng 30 dòng) | `blocked-by-core` |
| 4 | `src/tui/dialogs/notebook.tsx` | Màn chi tiết thêm `s` sửa, `t` đổi trạng thái luận điểm; màn danh sách thêm Ctrl+X xuất; câu sổ trống đổi thành hướng dẫn bốn lệnh | YC-023 tới YC-025 (file do spec 002 thêm, nằm trong TUI) | Vừa (khoảng 60 dòng) | `blocked-by-core` |
| 5 | `src/tui/dialogs/notebook-form/` (6 file mới: `open.ts`, `frame.tsx`, `fields.tsx`, `forms.tsx`, `conflict.tsx`, `export.tsx`) | Bốn form, màn chỗ khác nhau, màn xuất; gọi tay cầm quản trị | YC-007 tới YC-022, YC-025; file mới nhưng nằm trong TUI | Lớn (khoảng 600 dòng, file mới) | `blocked-by-core` |

Không sửa: `src/core/memory/types.ts`, `src/core/agent.ts`, `src/core/runtime.ts`, `src/core/config.ts`, `src/tui/dialogs/config.tsx`, `src/tui/dialogs/memory.tsx`, `src/tui/prompt/history.ts`, `src/core/memory/file-memory.ts`, lược đồ kho.

## 7. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | |
| Module mới dưới `src/core/memory/`, lõi không import TUI | Đạt | Đạt | Logic thuần (lệnh, nháp, chỗ khác nhau, cảnh báo, xuất) ở `notebook/`; TUI import vào, không chiều ngược lại |
| Mỗi module một trách nhiệm; không `utils.ts`, `manager.ts` | Đạt | Đạt | |
| I/O có timeout; lỗi đọc không bị nuốt | Đạt | Đạt | Ghi kho chờ tối đa 1 giây (kho); ghi file xuất hạn 5 giây; đọc để điền form trả lỗi rõ, không trả rỗng (YC-027) |
| Lỗi upstream đổi một lần ở biên | Đạt | Đạt | `MemoryStoreError` → `SaveResult` chỉ ở `admin.ts` |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | `OPENTRADING_HOME` tạm, `fetch` giả đếm request |
| Chạy được trên Windows và Ubuntu | Đạt | Đạt | Đóng kho trước khi xoá thư mục tạm; tên file xuất không có `:`; xuống dòng LF trong file xuất |
| Model không có tool ghi; chỉ người dùng làm memory có hiệu lực | Đạt | Đạt | Không thêm tool; ghi chỉ qua tay cầm, chỉ form và `/memory` giữ (test quét mã); lệnh chỉ chạy từ `run` |
| Bí mật | Đạt | Đạt | Lịch sử ô nhập chỉ có tên lệnh; câu báo không chép chữ người dùng; kho chặn mẫu khoá |
| Quyết định không tự vào context | Đạt | Đạt | Không đổi đường đọc; xuất mặc định không có quyết định |
| Không ghi trên đường dựng request, đường vẽ màn hình | Đạt | Đạt | Ghi chỉ trong xử lý phím Xác nhận |

## 8. Cách kiểm

```
C:\Users\Admin\anaconda3\Scripts\bun.exe --version                    (1.4.2)
C:\Users\Admin\anaconda3\Scripts\bun.exe install --frozen-lockfile   (chỉ khi node_modules lệch lockfile)
C:\Users\Admin\anaconda3\Scripts\bun.exe run typecheck
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-notebook-commands.test.ts test/memory-notebook-form-model.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-notebook-admin-write.test.ts test/memory-notebook-lifecycle.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-notebook-forms-tui.test.tsx test/memory-notebook-tui.test.tsx
C:\Users\Admin\anaconda3\Scripts\bun.exe test                         (toàn bộ, cuối mỗi gói)
```

| TC | Test | Cách kiểm chính |
| --- | --- | --- |
| TC-001 | forms-tui, admin-write | Gõ `/nho Không bán khống`, chọn ngăn, xác nhận; đọc kho (#5 bản 1, bộ ràng buộc 6); lượt sau so phần hệ thống trong `bodies` |
| TC-002 | forms-tui | `fetch` giả đếm; bốn lệnh đi trọn tới lưu, không cấu hình provider: 0 request |
| TC-003 | forms-tui | Sau mỗi đường (Enter, Esc hai lần, Ctrl+C, chọn gợi ý, đoạn dán, chữ hoa) đợi `historyFlushed()` rồi đọc `prompt-history.jsonl`: chỉ tên lệnh; câu chat thường lưu nguyên |
| TC-004 | forms-tui | **Chạy một lượt hội thoại thật trước** (model giả), để file phiên tồn tại; rồi `/nho` với chuỗi đánh dấu, xác nhận; đọc file phiên: không có chuỗi. Model trả "/nho Được dùng margin": không form, kho không đổi |
| TC-005 | lifecycle | Quét mã: ngoài `notebook/` chỉ `memory.tsx`, `notebook.tsx`, `notebook-form/` import tay cầm; `app.tsx` không. Tool memory của agent chính chỉ `memory_read` |
| TC-006 | admin-write, forms-tui | Điền sẵn bản 3; lưu bản 4; chủ đề mới FPT bản 1; xoá rồi viết lại bản 4; 8 điều kiện; cảnh báo trạng thái; `/luandiem ABC` → chủ đề mới khác #9, #9 không đổi; bí danh "HPG" bị từ chối |
| TC-007 | admin-write, forms-tui | Hai kết nối: kết nối B lưu HPG bản 4 khi form A hiện bản 3 → câu hỏi; chọn bản 3 → D1 gắn 3; B xoá → không lưu; VCB không luận điểm; MWG tạo chủ đề; chuỗi đánh dấu trong lý do không có trong `bodies` lượt sau |
| TC-008 | form-model, forms-tui | Bảng ca: mỗi câu mẫu luật cứng có cảnh báo; "Dùng P/B và ROE, không dùng P/E", "cảm nhận thị trường" không; nút chuyển sang `/nho` |
| TC-009 | admin-write, forms-tui | Xung đột: không ghi, `fieldChanges` đúng ô, giữ nháp; lưu thành bản 5 cần xác nhận lại; xoá ở nơi khác; tiến trình phụ giữ quyền ghi (mẫu `test/fixtures/scripts/memory-store-contender.ts`): báo bận dưới 2 giây, kho không đổi |
| TC-010 | admin-write, forms-tui | Sửa từ `/memory` mở đúng form; đổi trạng thái không tạo bản; quyết định không có `s`; xuất: file ở `exports/`, không mục đã xoá, không ghi đè, mặc định không chứa chuỗi đánh dấu của quyết định, bật thì có, lần sau lại tắt |
| TC-011 | forms-tui | Bốn ca sổ không dùng được: câu báo đúng; chữ còn trong ô nhập; kho không tạo; memory cũ không đổi; lịch sử ô nhập chỉ tên lệnh |
| TC-012 | admin-write | Mỗi lỗi kho → `SaveResult` đúng `reason`, câu báo không chứa chuỗi đánh dấu người dùng gõ |
| TC-013 | memory-policy | Ca đường xuất ở vai người dùng; mọi vai model không có "làm cho có hiệu lực" |
| TC-014 | toàn bộ | Typecheck sạch; `bun test` xanh; CI Windows, Ubuntu khi push |
| TC-015 | tay | Người dùng kiểm trên TUI thật (danh sách ở `handoff.md` §7) |
| TC-016 | form-model | Bảng ca giá và dự báo: có cảnh báo; "Sai nếu biên gộp dưới 10% hai quý liền", "Tối đa 20% danh mục cho một mã" không |

## 9. Theo dõi độ phức tạp

Không có mục trượt cổng kiểm. Hai điểm đáng nhớ:

| Điểm | Vì sao chấp nhận | Phương án bị loại |
| --- | --- | --- |
| Tạo chủ đề và nội dung là nhiều transaction (§3.4) | Không đổi API của spec 001; kiểm trước bằng đúng hàm kiểm của kho nên chỉ còn lỗi ngoài ý muốn (kho bận); chủ đề rỗng vô hại và câu báo nói rõ | Thêm thao tác gộp vào kho: đổi hình dạng `MemoryWriter`, phải duyệt lại spec 001 |
| File form mới (khoảng 600 dòng) nằm trong TUI của chủ repo | Form là giao diện, phải ở `src/tui`; logic thuần đã đưa sang `src/core/memory/notebook/` để test không cần giao diện | Đặt form trong `src/core`: lõi không được import TUI |
