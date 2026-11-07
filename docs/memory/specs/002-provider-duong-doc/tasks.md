# Việc cần làm 002: Provider memory v5.1, đường đọc

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

**Ký hiệu:**
- `[P]`: làm song song được;
- `[S1]`: thuộc story 1;
- `[LÕI]`: sửa file của chủ repo, chỉ làm sau khi người dùng xác nhận dòng tương ứng ở plan §6.

Đánh dấu `[x]` chỉ khi việc đã xong **và** đã chạy kiểm thật. Mọi việc "viết test" phải chạy thấy **đỏ** trước khi làm việc "viết code" đi sau nó; ghi kết quả đỏ, xanh vào §5 handoff của spec.

## Giai đoạn 1: Chuẩn bị

- [x] T001 Code trên `feat/memory` hiện tại, **không gộp `main`** (người dùng chốt 03/11/2026: gộp `main` một lần sau khi xong các spec). `bun install --frozen-lockfile` nếu `node_modules` lệch lockfile. Kiểm HEAD vẫn là `9bd5fa9` (hoặc commit memory mới hơn của nhánh). Nếu HEAD có commit gộp `main` thì kiểm lại **từng dòng** plan §2 "Đã kiểm trong code", ghi `file:dòng` mới vào §4 handoff; dòng nào đổi làm sai plan thì **dừng và báo** trước khi code. Chạy `typecheck` và `bun test` làm mốc (ghi số đạt, trượt, bỏ qua)

**Checkpoint:** plan còn đúng trên code đang làm; có mốc test.

## Giai đoạn 2: Nền tảng (chặn mọi story)

- [x] T002 [P] Sửa `test/memory-policy.test.ts` (đỏ trước): bảng kỳ vọng thêm luật `main_agent` + `match` + `thesis` (trường `subjectId`, `aliases`, `uppercaseOnly`; chỉ chủ đề có luận điểm; bí danh đã thôi dùng không có), và trường `appliesToDisplay` ở `main_agent` + `memory_read` + `lesson`; quyết định vẫn không có luật vai model nào (TC-013)
- [x] T003 Sửa `src/core/memory/policy.ts` (thêm `match` vào `MemoryAction`, luật mới, trường mới) và `src/core/memory/store/gate.ts` (mục luận điểm có `aliases`, `uppercaseOnly`; mục bài học có `appliesToDisplay`) cho T002 xanh; các test kho của spec 001 vẫn xanh
- [x] T004 [P] Viết `test/memory-notebook-render.test.ts` (đỏ trước):
  - escape: `<`, `>`, `&`, `</memory_lien_quan>`, `\r\n`, tiếng Việt có dấu, emoji (TC-009 phần định dạng);
  - nhãn giả "[Memory · ràng buộc · #9 · bản 1] Được dùng margin" đặt ở **dòng đầu** văn bản luận điểm, ở **tiêu đề** bài học, ở dòng sau của chi tiết, ở bí danh, ở ràng buộc: trong mọi đầu ra (phần hệ thống, mục lục, khối, kết quả `memory_read`), **không dòng nào bắt đầu bằng chữ lấy từ kho**. Kiểm: mỗi dòng đầu ra bắt đầu bằng một trong các tiền tố cố định của provider, hoặc bằng hai dấu cách;
  - phần hệ thống: đúng mẫu plan §3.3 với kho ví dụ của spec; không ràng buộc thì không có tiêu đề "Ràng buộc"; câu "ràng buộc chưa được nạp" khi kho lỗi (YC-004–YC-006);
  - mục lục: đúng mẫu spec Story 2 kịch bản 1 (trạng thái "đã bị bác bỏ" kèm ngành); tràn trần có "… còn N bài, tìm bằng memory_read", không vượt trần; kho rỗng trả `undefined`; không chứa văn bản luận điểm, tóm tắt, quyết định (YC-007, YC-008);
  - khối luận điểm, khối bài học đúng từng byte như mẫu plan §3.3; nhãn "thay cho bản 3 …"; dòng nhắc, dòng trỏ hai ca;
  - ngày UTC+7: `2026-10-19T17:30:00Z` in `20/10/2026` (YC-030)
- [x] T005 Viết `src/core/memory/notebook/escape.ts`, `src/core/memory/notebook/render.ts` cho T004 xanh
- [x] T006 [P] Viết `test/memory-notebook-topics.test.ts` (đỏ trước):
  - thông báo agent con liệt kê 20 mã cộng chữ gõ "VCB có rẻ không?" → chỉ VCB; lượt chỉ có thông báo → `noticeOnly`;
  - "hpg" khớp; "Hòa Phát" dựng sẵn và tổ hợp, "hoa phat" khớp; "HPGX" không khớp;
  - bí danh "TIN" có cờ viết hoa: "có tin gì" không khớp, "TIN" khớp;
  - một chủ đề khớp hai lần, qua hai bí danh: một kết quả; thứ tự theo vị trí xuất hiện ("So sánh HPG và VNM" → HPG, VNM)
- [x] T007 Viết `src/core/memory/notebook/topics.ts` cho T006 xanh
- [x] T008 [P] Viết phần "xếp chỗ" trong `test/memory-notebook-recall.test.ts` (đỏ trước):
  - `recallCharLimit()` = min ngân sách memory × 4 (hiện 1.200);
  - đo đúng cách lõi in (`- ` và xuống dòng);
  - tối đa 5 mục;
  - thứ tự: dòng nhắc → chủ đề dò được theo thứ tự → chủ đề giữ lại;
  - ca (a) hết chỗ → `roomless`; ca (b) dài hơn trần → `tooLong`;
  - dòng nhắc không vừa thì hoãn
- [x] T009 Viết `src/core/memory/notebook/pack.ts` cho T008 xanh
- [x] T010 [P] Viết phần "sổ theo dõi" trong `test/memory-notebook-recall.test.ts` (đỏ trước):
  - mục tạm gửi chỉ thành đã gửi khi chuỗi nhãn có trong `messages` của `turn-end` cùng phiên;
  - recall kế tiếp bỏ mục tạm gửi chưa xác nhận;
  - lượt chỉ có thông báo xác nhận ngay;
  - gửi lại cùng câu sau lượt chưa xác nhận thì thay mục cửa sổ, không thêm;
  - cửa sổ giữ chủ đề dò được của 3 lượt gõ
- [x] T011 Viết `src/core/memory/notebook/session-ledger.ts` cho T010 xanh

**Checkpoint:** typecheck sạch; T002–T011 xanh; test cũ xanh.

## Giai đoạn 3: Story 1 và 2, phần hệ thống và mục lục (P1)

**Mục tiêu:** provider mở kho, đưa ràng buộc, cách trình bày, mục lục qua cổng.
**Kiểm độc lập:** gọi `instructions()`, `index()` của provider trên kho seed.

- [x] T012 [P] [S1] [S2] Viết phần provider trong `test/memory-notebook-recall.test.ts` (đỏ trước):
  - Story 1 kịch bản 1, 3, 4 (kết nối thứ hai sửa ràng buộc #1 thành bản 3 → lần gọi sau có bản 3);
  - Story 2 kịch bản 1, 3, 4; hai lần gọi liền không đổi kho → giống hệt;
  - `instructions()` không bao giờ ném, kể cả khi kho đã đóng hoặc hỏng
- [x] T013 [S1] [S2] Viết `src/core/memory/notebook/lifecycle.ts` (`openNotebook`, trạng thái lỗi), `src/core/memory/notebook/provider.ts` (`instructions`, `index`, `problems`, bộ đệm làm mới theo `changed()`), `prompts/memory.md` (hướng dẫn spec YC-005) cho T012 xanh

**Checkpoint:** Story 1, 2 chạy ở mức provider; typecheck sạch.

## Giai đoạn 4: Story 3 và 4, khối có nhãn và dòng nhắc (P1)

**Mục tiêu:** `recall()` chèn khối đúng luật, nhắc thay đổi, xếp dưới trần, xác nhận qua `turn-end`.
**Kiểm độc lập:** chuỗi lượt gọi `recall()` và phát `turn-end` giả, so mục trả về.

- [x] T014 [P] [S3] [S4] Viết phần chuỗi lượt trong `test/memory-notebook-recall.test.ts` (đỏ trước):
  - Story 3 kịch bản 1–4 (T3 có khối bản 4 kèm "thay cho", **không** có dòng nhắc trùng), 7, 8 (hai lượt, dòng trỏ không lặp), 9 (T1–T3, dòng trỏ một lần mỗi bản), 10 (cửa sổ T1–T4 và cách kiểm bằng bản 4 trước T3, trước T4);
  - Story 4 kịch bản 1–5 (kịch bản 2 đủ T1–T5; kịch bản 1 dùng `memory_read` ở T1 để có #7 trong sổ theo dõi);
  - lượt không có `turn-end` (bị bỏ vì tràn ngữ cảnh) rồi gửi lại cùng câu → khối có lại;
  - TC-012: 100 chủ đề có luận điểm, 100 bài học, dựng nguội (phần hệ thống, mục lục, dò chủ đề, khối) dưới 50 ms, in số đo
- [x] T015 [S3] [S4] Viết `recall()` và hook `turn-end` trong `src/core/memory/notebook/provider.ts` cho T014 xanh. TC-012 trượt thì gộp truy vấn luận điểm trong `src/core/memory/store/gate.ts` (đọc theo lô), test kho spec 001 vẫn xanh

**Checkpoint:** Story 3, 4 chạy ở mức provider.

## Giai đoạn 5: Story 5, `memory_read` (P1)

**Mục tiêu:** tool chỉ đọc, ba cách hỏi, không bao giờ trả quyết định.
**Kiểm độc lập:** gọi `execute` của tool trên kho seed.

- [x] T016 [P] [S5] Viết `test/memory-notebook-read-tool.test.ts` (đỏ trước):
  - Story 5 kịch bản 1–5 ("dinh gia ngan hang" → #7 đứng đầu; #99 → "Sổ không có bài học #99 …");
  - hai trường cùng lúc hoặc không trường nào → câu hướng dẫn; trường lạ bị từ chối;
  - chuỗi đánh dấu trong lý do quyết định không có trong mọi kết quả;
  - kết quả đã escape;
  - sau khi đóng kho → "Sổ ghi nhớ vừa được tắt; không đọc được sổ.";
  - tool có `readOnly: true`, `mainAgentOnly: true`; provider chỉ có đúng một tool
- [x] T017 [S5] Viết `src/core/memory/notebook/read-tool.ts`, `src/core/memory/notebook/lesson-search.ts`, `tools()` của provider cho T016 xanh

**Checkpoint:** Story 5 chạy.

## Giai đoạn 6: Story 8 và kiểm đầu cuối qua vòng agent (P1)

**Mục tiêu:** kiểm trên request thật mà lõi gửi đi (không chỉ mục provider trả).
**Kiểm độc lập:** `runAgent` với `fetch` giả, ghi `bodies` (mẫu `test/agent.test.ts`), `OPENTRADING_HOME` tạm.

- [x] T018 [P] [S1] [S2] [S3] [S8] Viết `test/memory-notebook-agent.test.ts` (đỏ trước):
  - ba model giả có context 300k (A), 100k (B), 32k (C): phần hệ thống có đủ 1.500 ký tự ràng buộc, không có dấu "đã cắt bớt" ở bất kỳ phần memory nào, kể cả với năm luận điểm dài tối đa (TC-001, TC-005, TC-015);
  - hai lượt liên tiếp: phần mục lục giống hệt;
  - T1 "Luận điểm Hòa Phát…" có khối; T2: tin nhắn T1 trong request T2 giống hệt tin nhắn T1 trong request T1 (TC-003);
  - Story 8 kịch bản 1 (chuỗi đóng thẻ, nhãn giả) và 2 (chuỗi đánh dấu của quyết định, kể cả qua lời gọi `memory_read` do model giả thực hiện);
  - agent con không có `memory_read` trong danh sách tool
- [x] T019 Sửa provider nếu T018 lộ chỗ lệch giữa mục provider trả và request thật; T018 xanh

**Checkpoint:** typecheck sạch; mọi test memory-notebook xanh; toàn bộ `bun test` xanh.

## Giai đoạn 7: Story 7 phần memory, quyền quản trị cho Story 6 (P1, P2)

**Mục tiêu:** vòng đời kho trong module memory và tay cầm quản trị, chưa đụng lõi.
**Kiểm độc lập:** gọi trực tiếp `openNotebook`, `notebookAdmin`, `switchMemory` có sẵn.

- [x] T020 [P] [S6] [S7] Viết `test/memory-notebook-lifecycle.test.ts` (đỏ trước):
  - kho lược đồ mới hơn: `problems()` nêu lý do và đường dẫn; `instructions()` có câu "ràng buộc chưa được nạp" ở **mọi** lần gọi; `recall()` trả dòng `[Memory · lỗi] …` ở lượt đầu của phiên, **không** trả lại ở lượt sau (sau khi `turn-end` xác nhận), trả lại ở phiên mới và khi lý do đổi; file giữ nguyên; không tự thử lại;
  - kho bận lúc mở (tiến trình phụ `test/fixtures/scripts/memory-store-contender.ts` giữ quyền ghi khi tạo kho mới): recall kế tiếp thử lại một lần, mở được thì hết lỗi;
  - kho hỏng giữa phiên: chuyển sang trạng thái lỗi, không ném;
  - `switchMemory` sang `NoopMemory` đóng kho: xoá thư mục tạm ngay được;
  - `notebookAdmin(provider)`:
    - có cho sổ ghi nhớ, không có cho `FileMemory`, `NoopMemory`;
    - `entries()` đủ năm nhóm theo kho ví dụ;
    - `remove` với bản đang xem → ok;
    - với bản cũ → `conflict` kèm bản hiện hành;
    - kho bận → `busy` trong dưới 2 giây;
    - mục đã xoá → `deleted`;
  - test quét mã: ngoài `test/` và chính thư mục `src/core/memory/notebook/` (nơi tạo tay cầm), chỉ `src/tui/dialogs/notebook.tsx` và `src/tui/dialogs/memory.tsx` import `src/core/memory/notebook/admin`. Phiên code có thể đảo chiều (để `admin.ts` tự đăng ký tay cầm) nếu gọn hơn; chọn cách nào thì ghi vào handoff và sửa luật quét cho khớp;
  - `FileMemory` không đổi hành vi khi chuyển qua lại (YC-001, Story 7 kịch bản 5)
- [x] T021 [S6] [S7] Viết `src/core/memory/notebook/admin.ts`, hoàn thiện `lifecycle.ts` (thử lại khi bận với chờ khoá 200 ms; hàm dọn đóng kho) cho T020 xanh

**Checkpoint:** toàn bộ phần memory xong; typecheck sạch; `bun test` xanh. Từ đây là việc `[LÕI]`.

## Giai đoạn 8: Story 6 và 7, nối vào app (P1, P2) [LÕI]

**Mục tiêu:** người dùng chọn sổ ghi nhớ trong `/config`, xem và xoá trong `/memory`, kho đóng khi thoát.
**Kiểm độc lập:** giao diện headless (`testRender`) với `OPENTRADING_HOME` tạm.
**Điều kiện:** người dùng đã xác nhận dòng 1–5 ở plan §6.

- [x] T022 [P] [S6] [S7] [LÕI] Viết `test/memory-notebook-tui.test.tsx` (đỏ trước):
  - `/config` → Memory → màn con ba lựa chọn; chọn "Sổ ghi nhớ" → `runtime.memory.id === "notebook"`, cấu hình lưu `{ provider: "notebook" }`, `memory_read` có trong registry; chọn "Tắt" → `memory_read` mất, xoá được `memory.db` ngay;
  - `memory.db` lược đồ mới hơn → `/config` hiện lỗi và cách xử lý; render `App` với provider lỗi → dòng lỗi lúc khởi động;
  - `/memory` với kho ví dụ: năm nhóm; chi tiết luận điểm HPG; `d` → màn hỏi lại; Enter → xoá, câu báo đúng từng chữ của spec Story 6 kịch bản 3; Esc → không xoá;
  - xung đột (kết nối khác lưu bản 2 trong lúc xem bản 1) → câu "Mục này vừa được sửa ở nơi khác (đang là bản 2). Mở lại để xem bản mới.";
  - bận (tiến trình phụ giữ quyền ghi) → câu "Kho memory đang bận …" trong dưới 2 giây;
  - memory cũ: `/memory` như hiện nay (Story 6 kịch bản 6)
- [x] T023 [S7] [LÕI] Sửa `src/core/config.ts` (dòng 1 plan §6) và `src/core/runtime.ts` (dòng 2: `"notebook"`, `createMemory`, `closeMemory`); thêm ca `closeMemory` đóng kho vào `test/memory-notebook-lifecycle.test.ts` (đỏ trước)
- [x] T024 [S7] [LÕI] Sửa `src/tui/dialogs/config.tsx` (dòng 3: màn con ba lựa chọn, câu báo, lỗi mở kho). Sửa test "/config turns memory off and on" trong `test/tui.test.tsx` theo màn con, giữ ý cũ (tắt và bật memory cũ không cần khởi động lại); ghi lý do đổi kỳ vọng trong commit
- [x] T025 [S6] [LÕI] Sửa `src/tui/dialogs/memory.tsx`, viết `src/tui/dialogs/notebook.tsx` (dòng 5)
- [x] T026 [S7] [LÕI] Sửa `src/tui/app.tsx` (dòng 4: báo lỗi mở kho lúc khởi động; `closeMemory` ở đường thoát)
- [x] T027 T022 xanh; chạy `test/tui.test.tsx` cả file (không chạy riêng bằng `-t`); toàn bộ `bun test` xanh; test có tiến trình phụ chạy 3 lần liền đều xanh trên Windows

**Checkpoint:** Story 6, 7 chạy; toàn bộ test xanh.

## Giai đoạn cuối: Hoàn thiện

- [x] T028 Cập nhật trạng thái:
  - `docs/memory/specs/README.md`: dòng 002 `implemented`, chờ duyệt code, CI;
  - `docs/STATUS.md`: provider v5.1 đường đọc; **ghi ba giới hạn** của bản tối thiểu, không viết như đã giải quyết;
  - `CHANGELOG.md` `[Unreleased]`, tiếng Anh;
  - `spec.md` dòng trạng thái, `tasks.md` này.
  
  Không trỏ tới tài liệu ngoài repo. Chỉ ghi `implemented` cho phần đã chạy thật.
- [x] T029 Đối chiếu: mọi YC-001–YC-030 có test hoặc việc; mọi TC-001–TC-016 có test (bảng plan §8); `git diff --stat` chỉ chạm file trong plan §4; không file `handoff.md` nào trong danh sách sẽ commit. Báo "xong spec" để mở cổng 3

## Thứ tự và phụ thuộc

- T001 trước mọi việc (không cần gộp `main`).
- Nền tảng: T002→T003, T004→T005, T006→T007, T008→T009, T010→T011; bốn cặp sau song song được.
- T012–T013 cần T003, T005, T007. T014–T015 cần T009, T011, T013. T016–T017 cần T013. T018–T019 cần T015, T017.
- T020–T021 cần T013. Giai đoạn 8 cần T021 **và** người dùng xác nhận dòng lõi; T023 trước T024–T026.
- T028–T029 sau cùng.

## Gói theo phiên

Người dùng muốn làm liền một phiên code cho cả spec; các gói dưới đây là điểm dừng an toàn nếu phải đổi phiên (tràn bối cảnh).

| Phiên | Việc | Kết thúc ở trạng thái | Chờ duyệt |
| --- | --- | --- | --- |
| 1 | T001–T015 | Nền tảng và Story 1–4 ở mức provider; typecheck sạch, `bun test` xanh | — |
| 2 | T016–T021 | `memory_read`, kiểm đầu cuối, vòng đời, quyền quản trị; toàn bộ phần memory xong; test xanh | — |
| 3 | T022–T029 | Nối vào app; toàn bộ test xanh; báo "xong spec" | Người dùng xác nhận dòng 1–5 plan §6 trước T022; chủ repo duyệt trong PR |
