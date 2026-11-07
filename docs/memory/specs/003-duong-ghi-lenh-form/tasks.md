# Việc cần làm 003: Sổ ghi nhớ, đường ghi: lệnh và form

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

**Ký hiệu:**
- `[P]`: làm song song được;
- `[S1]`: thuộc story 1;
- `[LÕI]`: sửa file của chủ repo, chỉ làm sau khi người dùng xác nhận (plan §6).

Đánh dấu `[x]` chỉ khi việc đã xong **và** đã chạy kiểm thật. Mỗi việc test phải **đỏ trước** khi viết phần chạy; ghi kết quả đỏ và xanh vào `handoff.md` §5.

## Giai đoạn 1: Chuẩn bị

- [x] T001 Kiểm nhánh `feat/memory`, HEAD `34183fd` hoặc mới hơn, `bun.exe --version` = 1.4.2; `bun install --frozen-lockfile`; `bun run typecheck` và `bun test` toàn bộ làm mốc (ghi số đạt vào `handoff.md` §1)

## Giai đoạn 2: Nền tảng (chặn mọi story; chỉ code memory, không đụng lõi)

- [x] T002 [P] Test `notebookCommandOf`: bốn tên, chữ hoa, khoảng trắng thừa, tham số nhiều dòng, viên đoạn dán, `/memory`, `/nhox`, câu chat, `/` trống, `test/memory-notebook-commands.test.ts`
- [x] T003 [P] `NOTEBOOK_COMMANDS`, `notebookCommandOf`, `src/core/memory/notebook/commands.ts` (T002 xanh)
- [x] T004 [P] Kiểu nháp và chuyển bản trong kho thành nháp (ràng buộc, luận điểm, bài học), `src/core/memory/notebook/drafts.ts`
- [x] T005 [P] Test `fieldChanges` (chỉ ô khác nhau; điều kiện so theo vị trí; thêm, bớt điều kiện), `fieldCounts` (đúng bằng giới hạn, vượt 1, tổng ràng buộc trừ mục đang sửa, đếm theo ký tự người đọc thấy), `test/memory-notebook-form-model.test.ts`
- [x] T006 [P] `fieldChanges`, `fieldCounts`, `src/core/memory/notebook/form-model.ts` (T005 xanh)
- [x] T007 [P] Test `draftWarnings`: bảng ca luật cứng (có: "Không bao giờ bắt đáy", "Tuyệt đối không margin", "Cấm bán khống", "Không được mua đuổi", "Tối đa 15% danh mục", "tối đa 15 % danh mục", "khong bao gio bat day"; không: "Dùng P/B và ROE, không dùng P/E", "Cảm nhận thị trường yếu"); bảng ca giá và dự báo (có: "Sai nếu giá về dưới 20.000 đồng", "giá mục tiêu 32k", "dự báo lợi nhuận 2027 sẽ đạt 15.000 tỷ"; không: "Sai nếu biên gộp dưới 10% hai quý liền", "Tối đa 20% danh mục cho một mã"); trùng sau chuẩn hoá, cả giữa ràng buộc và tiêu đề bài học, `test/memory-notebook-form-model.test.ts`
- [x] T008 [P] Bảng mẫu và `draftWarnings`, `src/core/memory/notebook/warnings.ts` (T007 xanh)
- [x] T009 Test các thao tác ghi của tay cầm (kho tạm, seed ví dụ): `saveConstraint` thêm và sửa, phiên bản bộ ràng buộc; `saveThesis` sửa, chủ đề mới cùng ngành mới và bí danh khác, viết lại sau xoá là bản 4; `lookupSubject` cho bí danh đang dùng, bí danh đã thôi dùng (#9 "ABC"), chưa có; `saveLesson` với chủ đề "áp dụng cho" mới; `setThesisState`; mỗi lỗi kho (xung đột kèm `current`, đã xoá, bận, vượt giới hạn, khoá giả, trường trống, bí danh đã có chủ) thành `SaveResult` đúng `reason`, câu báo không chứa chuỗi đánh dấu; lỗi giữa chừng khi tạo chủ đề có `partial` mang ID mọi chủ đề đã tạo (chủ đề chính, ngành mới, "áp dụng cho" mới); **lỗi giữa chừng rồi xác nhận lại** (gửi chủ đề theo ID trong `partial.created`) thì lưu được phần còn thiếu, kho có đúng một chủ đề mỗi bí danh, không tạo chủ đề thứ hai (ca luận điểm FPT có ngành mới, ca quyết định mã mới, ca bài học "áp dụng cho" mới); đọc lỗi trả `ok: false`; kho đã đóng trả `failed`, `test/memory-notebook-admin-write.test.ts`
- [x] T010 Thao tác đọc và ghi của tay cầm, đổi lỗi ở một chỗ, kiểm trước nội dung bằng hàm kiểm của kho trước khi tạo chủ đề, `src/core/memory/notebook/admin.ts` (T009 xanh)
- [x] T011 Test `saveDecision`: gắn bản đã hiện; không gắn luận điểm; chủ đề chưa có được tạo; bản đã xoá bị từ chối (`deleted`); phiên bản bộ ràng buộc lúc ghi, `test/memory-notebook-admin-write.test.ts`
- [x] T012 `saveDecision`, `src/core/memory/notebook/admin.ts` (T011 xanh)
- [x] T013 Test quét mã: thêm `src/tui/dialogs/notebook-form/` vào danh sách cho phép, khẳng định `src/tui/app.tsx` không import tay cầm, `test/memory-notebook-lifecycle.test.ts`

**Checkpoint:** nền tảng xong; typecheck sạch; bốn file test của giai đoạn này xanh; toàn bộ `bun test` xanh.

## Giai đoạn 3: Story 2 và Story 8, bộ điều phối và sổ không dùng được (P1)

**Mục tiêu:** lệnh memory nhận ra trước lịch sử ô nhập ở bốn đường; sổ không dùng được thì báo và giữ chữ.
**Kiểm độc lập:** App headless, đọc `prompt-history.jsonl` trong thư mục tạm.

- [x] T014 [S2] [S8] Test App headless: Enter `/nho Không dùng margin` → lịch sử chỉ "/nho"; Esc hai lần và Ctrl+C trên `/luandiem HPG Hưởng lợi…` → chỉ "/luandiem"; chọn `/baihoc` trong danh sách gợi ý → "/baihoc"; `/nho [Pasted text #1]` 2.000 ký tự → lịch sử không có đoạn dán; `/NHO …` như `/nho`; câu chat thường lưu nguyên; sổ "Tắt", "Memory cũ", kho lỗi → câu báo đúng, chữ còn trong ô nhập, không tạo `memory.db`, memory cũ không đổi, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T015 [LÕI] Bốn dòng lệnh sau `/memory`, mô tả `/memory`, `src/tui/commands.ts`
- [x] T016 [LÕI] `DialogName` thêm `"notebook-form"`, trường `notebookForm`, cờ `notebookFormDirty`, `notebookFormAskLeave`, `src/tui/state.ts`
- [x] T017 `openNotebookForm`: bốn ca sổ không dùng được (plan §3.10), đặt `state.notebookForm` và `state.dialog`, `src/tui/dialogs/notebook-form/open.ts` [LÕI, file mới]
- [x] T018 [LÕI] `run`: lệnh memory lưu `/<tên>`, gọi `openNotebookForm` trước khi xoá ô, lỗi thì báo và giữ chữ; `rememberDraft`: lệnh memory chỉ `/<tên>`; `runCommand`: bốn `case`; `Match` hộp thoại form (tạm hiện khung rỗng), `src/tui/app.tsx` (T014 xanh)

**Checkpoint:** T014 xanh; `test/tui.test.tsx` xanh (danh sách lệnh 8 dòng đầu không đổi); typecheck sạch.

## Giai đoạn 4: Story 1 `/nho` và khung form (P1)

**Mục tiêu:** khung form dùng chung; form ghi nhớ lưu được ràng buộc, cách trình bày.
**Kiểm độc lập:** App headless với sổ ghi nhớ bật, kho ví dụ.

- [x] T019 [S1] Test: form mở với chữ điền sẵn, chưa chọn ngăn, nút mờ; danh sách ràng buộc và "77/1.500"; chọn Ràng buộc → kho #5 bản 1, bộ ràng buộc 6, câu "Đã lưu ràng buộc #5 (bản 1)…"; Cách trình bày → bộ ràng buộc giữ 5; vượt tổng không cho xác nhận; khoá giả → câu báo kho, form giữ nguyên; câu báo, `prompt-history.jsonl`, file phiên và `memory.db` (đọc byte của file kho và file `-wal` sau khi đóng kho) không chứa chuỗi khoá (ô của form đang hiện chính chữ người dùng gõ, nên không kiểm khung hình); trùng #1 → cảnh báo, vẫn lưu được; dòng "agent con chưa nhận"; dòng hướng dẫn số liệu; Enter trên ô văn bản không lưu; Esc khi đã gõ hỏi lại; Ctrl+C khi đã gõ hỏi lại như Esc, kho không đổi, chọn bỏ thì form đóng; Ctrl+C khi chưa gõ gì thì đóng ngay; Ctrl+C trên hộp thoại khác (`/memory`) vẫn đóng ngay; lượt hỏi kế tiếp có "[#5 · bản 1] Không bán khống" trong `bodies`, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T020 [S1] Ô một dòng, ô nhiều dòng (Enter xuống dòng), lựa chọn, danh sách; chuẩn hoá đoạn dán, `src/tui/dialogs/notebook-form/fields.tsx` [LÕI, file mới]
- [x] T021 [S1] Khung form: tiêu đề, "đang sửa từ bản N", đếm ký tự, khu cảnh báo, nút Xác nhận, Tab, Esc hỏi lại; đặt `notebookFormDirty`, hỏi lại khi `notebookFormAskLeave`; nhận `partial` thì đổi ô chủ đề mới thành chủ đề đã có, giữ nội dung (plan §3.4), `src/tui/dialogs/notebook-form/frame.tsx` [LÕI, file mới]
- [x] T021b [LÕI] [S1] `onQuitKey`: Ctrl+C trên hộp thoại `notebook-form` có thay đổi thì đặt `notebookFormAskLeave` thay vì đóng (plan §6 dòng 3 mục e), `src/tui/app.tsx`
- [x] T022 [S1] Form ghi nhớ (ràng buộc, cách trình bày), `src/tui/dialogs/notebook-form/forms.tsx` [LÕI, file mới]; nối vào `Match` của T018 (T019 xanh)
- [x] T023 [S2] Test TC-004: một lượt hội thoại thật (model giả) trước, rồi `/nho` với chuỗi đánh dấu và xác nhận; file phiên không có chuỗi; model trả "/nho Được dùng margin" → không form, kho không đổi; `fetch` giả đếm 0 request cho phần lệnh, `test/memory-notebook-forms-tui.test.tsx`

**Checkpoint:** Story 1 và Story 2 xanh; typecheck sạch.

## Giai đoạn 5: Story 3 `/luandiem` và Story 6 xung đột (P1)

**Mục tiêu:** sửa luận điểm theo bản, chủ đề mới, màn chỗ khác nhau và xung đột dùng chung cho mọi form.
**Kiểm độc lập:** App headless; kết nối thứ hai vào cùng kho làm "cửa sổ khác".

- [x] T024 [S3] Test: `/luandiem hpg` điền bản 3; sửa điều kiện (2) → màn chỗ khác nhau → bản 4; `/luandiem FPT` → ô chủ đề mới, lưu bản 1; HPG xoá rồi viết lại → "Luận điểm mới (bản trước đã xoá)", bản 4; 8 điều kiện; trạng thái "đã bị bác bỏ" → câu báo trước; ô mã trống không xác nhận được; cảnh báo giá "Sai nếu giá về dưới 20.000 đồng" vẫn lưu được; `/luandiem ABC` → câu "«ABC» từng là bí danh của chủ đề #9 (nay là XYZ)…", lưu → chủ đề mới khác #9, #9 không đổi; bí danh khác "HPG" → "Bí danh «HPG» đang thuộc chủ đề HPG.", kho không đổi, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T025 [S3] Form luận điểm và ô chủ đề mới (loại, ngành có sẵn hoặc mới, bí danh khác, cờ viết hoa), `src/tui/dialogs/notebook-form/forms.tsx` (T024 xanh)
- [x] T026 [S6] Test: A sửa HPG từ bản 3, B lưu bản 4 → không ghi, khung hình có hai ô khác nhau đúng mẫu spec, nháp còn; "Lưu bản của tôi thành bản 5" → màn chỗ khác nhau so bản 4, xác nhận → bản 5; ràng buộc #1 bị B xoá → "[Lưu thành ràng buộc mới] [Huỷ]"; tiến trình phụ giữ quyền ghi → báo bận dưới 2 giây, kho không đổi; bài học không ai đổi → lưu bản 2, không có màn xung đột, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T027 [S6] Màn chỗ khác nhau (trước khi lưu sửa, và khi xung đột) với ba lựa chọn, `src/tui/dialogs/notebook-form/conflict.tsx` [LÕI, file mới]; nối vào khung form (T026 xanh)

**Checkpoint:** Story 3 và Story 6 xanh; typecheck sạch; toàn bộ `bun test` xanh.

## Giai đoạn 6: Story 4 `/quyetdinh` và Story 5 `/baihoc` (P1)

- [x] T028 [S4] Test: form hiện bản 3 và câu "chỉ nằm trên máy này… không phải lệnh giao dịch"; lưu D1 căn cứ bản 3, bộ ràng buộc 5, câu báo; B lưu bản 4 trước khi xác nhận → câu hỏi ba lựa chọn, chọn bản 3 → D1 gắn 3; chọn xem bản 4 → hiện bản 4, xác nhận lại → gắn 4; B xoá luận điểm → không lưu, nháp còn, cho chọn không gắn; `/quyetdinh VCB` → "VCB chưa có luận điểm"; `/quyetdinh MWG` → tạo chủ đề; lượt sau `bodies` không có chuỗi đánh dấu trong lý do, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T029 [S4] Form quyết định: giữ bản đã hiện, đọc lại lúc xác nhận, câu hỏi khi bản khác, ca bị xoá (plan §3.5), `src/tui/dialogs/notebook-form/forms.tsx` (T028 xanh)
- [x] T030 [S5] Test: `/baihoc` lưu #8; "Không bao giờ bắt đáy" → cảnh báo hai nút, "Lưu thành ràng buộc" mở form ghi nhớ đã chọn Ràng buộc và điền sẵn câu; "Dùng P/B và ROE, không dùng P/E" không cảnh báo; "áp dụng cho" có tên chưa có → hỏi tạo chủ đề ngành; tiêu đề 121 ký tự không xác nhận được; trùng tiêu đề #7 → cảnh báo, vẫn lưu được, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T031 [S5] Form bài học và nút chuyển sang form ghi nhớ, `src/tui/dialogs/notebook-form/forms.tsx` (T030 xanh)

**Checkpoint:** Story 4 và Story 5 xanh; typecheck sạch.

## Giai đoạn 7: Story 7 `/memory` sửa, đổi trạng thái, xuất (P2)

- [x] T032 [P] [S7] Test `renderNotebookMarkdown` và `exportFileName`: bốn nhóm, mỗi mục có ID hoặc mã, số bản, ngày tuyệt đối, nguồn, điều kiện; không mục đã xoá; mặc định không có quyết định, bật thì có kèm căn cứ; tên trùng thêm giờ; vẫn trùng thì `undefined`; `exportMarkdown` không ghi đè, lỗi ghi trả `ok: false`, `test/memory-notebook-admin-write.test.ts` (phải đỏ)
- [x] T033 [P] [S7] Dựng Markdown, tên file, ghi file hạn 5 giây không ghi đè, `src/core/memory/notebook/export.ts`; `exportMarkdown` trong `src/core/memory/notebook/admin.ts` (T032 xanh)
- [x] T034 [S7] Test App headless: `s` trên luận điểm HPG mở form điền bản 3; trên ràng buộc mở form ghi nhớ đã chọn ngăn; trên bài học mở form bài học; quyết định không có `s`; `t` → "đã bị bác bỏ", hỏi lại, không tạo bản mới, danh sách "HPG · bản 3 · đã bị bác bỏ"; Ctrl+X → màn xuất có câu "File xuất là bản sao…", ô "Kèm nhật ký quyết định" tắt; bật → câu cảnh báo; file nằm trong `exports/`; lần mở sau ô lại tắt; câu sổ trống mới, `test/memory-notebook-forms-tui.test.tsx` (phải đỏ)
- [x] T035 [S7] Màn xuất, `src/tui/dialogs/notebook-form/export.tsx` [LÕI, file mới]
- [x] T036 [LÕI] [S7] Phím `s`, `t`, Ctrl+X; câu sổ trống, `src/tui/dialogs/notebook.tsx` (T034 xanh)
- [x] T037 [S7] Sửa câu "Sổ ghi nhớ còn trống" trong `test/memory-notebook-tui.test.tsx` cho khớp câu mới
- [x] T038 [P] Ca đường xuất ở vai người dùng (mặc định không có chuỗi đánh dấu của quyết định; bật thì có) và khẳng định mọi vai model không có "làm cho có hiệu lực", `test/memory-policy.test.ts`

**Checkpoint:** Story 7 xanh; typecheck sạch; toàn bộ `bun test` xanh.

## Giai đoạn cuối: Hoàn thiện

- [x] T039 Chạy toàn bộ: `bun run typecheck`, `bun test` (ghi số đạt, bỏ qua, trượt); chạy ba lần file có tiến trình phụ để bắt test chập chờn
- [x] T040 Rà style (không chấm phẩy, nháy kép, thụt 2, dòng khoảng 120; tên và comment tiếng Anh; chuỗi người dùng thấy tiếng Việt; không chữ "v5.1" trong chuỗi người dùng thấy); không chỗ trỏ tài liệu ngoài repo; không mã ý kiến duyệt trong code
- [x] T041 Cập nhật trạng thái: `docs/memory/specs/README.md` (dòng 003), `docs/STATUS.md`, `CHANGELOG.md` (`[Unreleased]`, tiếng Anh), `spec.md` (trạng thái), `tasks.md`; chỉ ghi `implemented` cho phần đã chạy thật; ghi chưa kiểm tay trên TUI thật (TC-015) nếu chưa làm
- [x] T042 `/spec-handoff`: cập nhật `handoff.md` của spec và `docs/memory/handoff.md`; soạn danh sách kiểm tay TC-015 cho người dùng

## Thứ tự và phụ thuộc

- Chuẩn bị → Nền tảng → Giai đoạn 3 (bộ điều phối, chặn mọi form) → 4 (khung form) → 5 (luận điểm, xung đột) → 6 → 7 → Hoàn thiện.
- T010 phụ thuộc T004; T012 phụ thuộc T010; T017 phụ thuộc T010 (dùng `problem()`), T003.
- T018 phụ thuộc T015, T016, T017. Mọi form phụ thuộc T020, T021.
- T027 (màn chỗ khác nhau) dùng chung cho T029, T031 và cho sửa từ `/memory` (T036).
- T036 phụ thuộc T022, T025, T031 (mở lại đúng form) và T035.

## Gói theo phiên

Người dùng muốn **một phiên code cho cả spec**, làm liền các gói; chỉ đổi phiên khi tràn bối cảnh. Mỗi gói kết thúc ở trạng thái typecheck và test xanh, để dừng được giữa chừng.

| Gói | Việc | Kết thúc ở trạng thái | Chờ duyệt |
| --- | --- | --- | --- |
| 1 | T001–T013 | Nền tảng memory xong, chưa đụng lõi; typecheck và test xanh | — |
| 2 | T014–T018 | Lệnh nhận ra trước lịch sử ô nhập; sổ tắt thì báo; form rỗng | Người dùng đã xác nhận dòng 1, 2, 3, 5 của plan §6; chủ repo duyệt trong PR |
| 3 | T019–T027 (kể cả T021b) | `/nho`, Ctrl+C hỏi lại trên form, `/luandiem`, xung đột chạy được | Dòng 3 (mục e), 5 của plan §6 |
| 4 | T028–T031 | `/quyetdinh`, `/baihoc` chạy được | Dòng 5 |
| 5 | T032–T042 | `/memory` sửa, đổi trạng thái, xuất; tài liệu; handoff | Dòng 4, 5 |
