# Việc cần làm 006: Phương án Y đầy đủ trong lõi

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md) · [research.md](research.md) · [data-model.md](data-model.md)

**Ký hiệu:**
- `[P]`: làm song song được;
- `[S1]`…`[S6]`: thuộc story 1 tới 6 của spec;
- `[LÕI n]`: sửa file của chủ repo, chỉ làm sau khi người dùng xác nhận dòng `n` ở plan §6.

Đánh dấu `[x]` chỉ khi việc đã xong **và** đã chạy kiểm thật. Test viết trước, chạy thấy đỏ, rồi mới viết code cho xanh; ghi lại kết quả đỏ, xanh.

## Giai đoạn 1: Chuẩn bị

- [x] T001 Kiểm môi trường:
  - `bun.exe --version` là 1.4.2;
  - `bun install --frozen-lockfile` nếu `node_modules` lệch;
  - `bun run typecheck` sạch và `bun test` đạt trên HEAD trước khi sửa (mốc 1.623 đạt, 3 bỏ qua trên `c2776f5`).

  Ghi lại kết quả.

## Giai đoạn 2: Nền tảng của memory (không đụng lõi)

**Mục tiêu:** tách khối từ lịch sử; biết khối còn hay không trong kho; che thuần trên danh sách tin nhắn.

- [x] T002 [P] Viết test `test/memory-history-blocks.test.ts` (đỏ):
  - **Phần nhắc nhở:** khối luận điểm và bài học trong `<memory_lien_quan>` (dạng `- [Memory · …]`, nhiều dòng). Lấy được loại, mục, bản, kênh, các dòng, vị trí ký tự; khối kết thúc ở mục kế tiếp hoặc cuối thẻ.
  - **Kết quả `memory_read`:** một khối; kết quả tìm từ khoá có hai khối cách nhau bằng dòng trống; câu "Sổ không có …" không tạo khối.
  - **Dòng khác:** dòng nhắc (bản mới, đổi trạng thái, xoá luận điểm, xoá bài học), dòng trỏ (hết chỗ, dài hơn trần), dòng lỗi kho, khối đã che (bài học và luận điểm). Mỗi dòng nhận đúng khoá.
  - **Nhãn giả không tính** (spec TC-005): nằm trong chữ gõ (phần văn bản thứ hai của tin nhắn người dùng), trong kết quả một tool khác, trong câu trả lời của model.
  - **Nội dung không tạo nhãn:** nội dung chứa `[Memory · bài học · #9 …]` sau khi escape (đứng sau tiền tố hoặc thụt dòng) không tạo khối.
  - Nhãn có phần "thay cho bản N…" vẫn tách đúng bản.
  - **Khối cụt:** mỗi ca đánh dấu `complete: false`:
    - một kết quả `memory_read` tìm nhiều bài học dài hơn 30.000 ký tự, đi qua `truncate` thật của `src/core/tools/wrap.ts`: khối đứng ngay trước `[... đã lược N ký tự ...]` là cụt;
    - đoạn sau dấu đó không mở đầu bằng nhãn thì không tạo khối;
    - phần nhắc nhở kết thúc bằng `[… đã cắt bớt]`;
    - lớp kết thúc bằng dấu cắt ngân sách.

    Khối đầy đủ trong cùng kết quả vẫn `complete: true`.
- [x] T003 `src/core/memory/notebook/history-blocks.ts`: `memoryLines(messages)`. Tên thẻ lấy từ hằng của lõi (`REMINDER_TAG`), không chép chuỗi. **Lệch đã được chấp nhận khi duyệt code:** tên thẻ được chép thành hằng `REMINDER_PART_TAG`, có test so với `REMINDER_TAG`, vì import `agent.ts` tạo vòng import `session/store` → `history-blocks` → `agent` → `session/store`. Tên tool `memory_read` lấy từ `read-tool.ts`. Bảng mẫu câu nhắc dựng từ `reminders` trong `render.ts`, không viết lại chữ. T002 xanh.
- [x] T004 [P] Viết test `test/memory-store-presence.test.ts` (đỏ). Kho tạm có:
  - HPG luận điểm bản 2, 3;
  - bí danh HPG đã thôi dùng, nay chủ đề HPX (cùng chủ đề);
  - bài học #7 bản 1;
  - một chủ đề mới dùng lại bí danh cũ "ABC";
  - luận điểm bị xoá;
  - bài học bị xoá.

  Ca kiểm:
  - `readPresence` trả bản sống theo số bài học và bản;
  - theo tên luận điểm, khớp cả bí danh đã thôi dùng, nhiều chủ đề cùng tên thì trả cả hai;
  - bản đã xoá không trả;
  - không trả gì của quyết định;
  - kết nối đóng (xoá được thư mục tạm).
- [x] T005 `src/core/memory/store/presence.ts` và `src/core/memory/store/read-only.ts` (trạng thái `open` có `presence(refs)`). T004 xanh; `test/memory-store-read-only.test.ts` vẫn xanh.
- [x] T006 [P] Viết test `test/memory-redaction.test.ts` (đỏ):
  - **Bộ kiểm:**
    - không có file kho: `missing`, không tạo file;
    - kho lược đồ mới hơn, kho hỏng: `failed` kèm lý do;
    - kho đọc được: khối #7 bản 1 có `deleted_at` là `deleted`; bài học không có trong kho là `deleted`; khối HPG bản 3 là `live`;
    - khối luận điểm mang tên bí danh đã thôi dùng vẫn nhận ra (YC-011);
    - **kho tạo lại cùng ngày:** #7 bản 1 khác nội dung là `mismatch` (không phải `deleted`), trùng nội dung là `live`;
    - **khối cụt:** mục còn thì `live`, không so nội dung; mục đã xoá thì vẫn `deleted`;
    - **định dạng dòng lệch:** một dòng nội dung đổi cách escape so với bản dựng lại thì `mismatch`, không phải `deleted`;
    - đổi "Trạng thái:" hay "Liên quan:" không làm khối thành `mismatch`;
    - hạn chờ: `spyOn` lần dò file treo thì `failed` trong hạn;
    - lịch sử không có khối: không mở kho.
  - **Che (`redactHistory`):**
    - chỉ đoạn chữ của khối bị thay, phần còn lại của phần văn bản và của tin nhắn giống từng byte;
    - hai khối trong cùng kết quả tool, chỉ một bị che;
    - mọi bản của mục bị che;
    - `record` gom theo mục và bản;
    - `missing` / `failed`: `kept` không đổi, `sent` tạm che mọi khối, `record` rỗng, `temporary.blocks` đúng;
    - `mismatch` (kho tạo lại cùng ngày): `kept` không đổi từng byte, `sent` tạm che đúng khối đó, `record` rỗng, `temporary.state = "mismatch"`;
    - khối cụt của mục còn: `kept` và `sent` giữ nguyên, `record` rỗng;
    - chữ tạm che khác chữ "đã bị người dùng xoá";
    - lịch sử không có khối: không có `temporary` (ca im lặng);
    - chạy hai lần liền thì lần hai `record` rỗng.
  - **Áp dòng che theo vị trí:** khối sau dòng che không bị che.
  - **Không lộ:** kết quả kiểm và `record` không mang chuỗi đánh dấu nào của kho hay của quyết định (TC-012).
- [x] T007 `src/core/memory/redaction/check.ts` (`createRedactionCheck`: dò file bất đồng bộ, `openStoreReadOnly`, `presence`, dựng lại dòng nội dung bất biến bằng hàm dựng khối của `render.ts`, đóng `close(true)`, `timedRead` như `binding/constraints.ts`) và `src/core/memory/redaction/redact.ts` (`redactHistory`, `applyRedactLines`, `temporaryNotice`). Thêm vào `src/core/memory/notebook/render.ts`: chữ thay khối đã che, câu ngắn của `memory_read`. T006 xanh.

**Checkpoint:** typecheck sạch; T002, T004, T006 xanh; toàn bộ `bun test` vẫn đạt.

## Giai đoạn 3: File phiên: dòng che và mã lượt (Story 3, 5) [LÕI 6]

**Mục tiêu:** bộ ghi và bộ đọc phiên biết dòng che, mã lượt; mọi đường đọc qua `loadSession` đều che.
**Kiểm độc lập:** ghi và đọc file phiên trong thư mục tạm, không cần model.

- [x] T008 [S3] [S5] Viết test `test/session-redact.test.ts` (đỏ). Kho tạm qua bộ kiểm thật; lỗi đĩa qua `sessionFiles` + `spyOn`, như spec 004.
  - **Mã lượt (Story 5 kịch bản 1–5):**
    - ghi thường: 1, 2, 3;
    - lưu bù giữ số 1, và biên nhận cùng số;
    - dòng cụt cuối file;
    - phiên cũ không có `turn`, 4 lượt: số tiếp là 5;
    - chỉ mục lệch (6 lượt trong file, chỉ mục nói 4): số tiếp là 7.
  - **Dòng che (data-model §1.2):**
    - `appendRedaction` nối một dòng sau các lượt đang chờ;
    - lượt chờ lưu bù có khối #7, xoá rồi ghi bù: file có lượt nguyên văn rồi dòng che;
    - ghi dòng che lỗi giữa chừng: cắt lại, chờ, ghi bù; biên nhận có `pendingRedactions`, `pendingCompactions` vẫn 0;
    - phiên ngừng ghi: dòng che không vào file;
    - so byte mọi dòng có trước (TC-006 d).
  - **`loadSession`:**
    - áp dòng che theo vị trí, kể cả khối trong phần lịch sử của dòng nén;
    - có bộ kiểm và kho xác nhận #7 đã xoá: che, `confirmed` có #7;
    - không có file kho: `temporary`, `confirmed` rỗng;
    - dòng che cụt bị bỏ qua;
    - phiên mẫu ghi trước spec này mở lại giống hệt (TC-011);
    - bộ đọc chỉ biết các loại dòng cũ đọc được file có `redact` và `turn` (TC-011).
  - **Phần `main`:** test ba trường `turn_end` và `dataGaps` trong `test/session.test.ts` vẫn xanh, không sửa kỳ vọng.
- [x] T009 [LÕI 6] `src/core/session/store.ts`: loại dòng `redact`; `turn` ở `turn_end`; `appendRedaction`; phần hàng `redact` theo cùng luật ngừng ghi và cắt lại; `pendingRedactions` và đếm theo loại; `loadSession(id, { check })` trả `lastTurn` và `redaction`; `Session.continue(summary, lastTurn)`. Sửa chỗ gọi `Session.continue` ở `src/tui/session.ts` cho typecheck sạch (chỉ truyền `loaded.lastTurn`; phần còn lại của dòng 9 làm ở T018). T008 xanh.

**Checkpoint:** typecheck sạch; `session*.test.ts` xanh; toàn bộ `bun test` đạt.

## Giai đoạn 4: Vòng agent và sổ ghi nhớ theo lịch sử (Story 1, 2, 6) [LÕI 1–5]

**Mục tiêu:** sổ quyết định theo lịch sử thật; vòng agent che đầu lượt; `memory_read` trả câu ngắn.
**Kiểm độc lập:** vòng agent với `fetch` giả, so `bodies`.

- [x] T010 [S1] [S2] [S6] Viết test `test/memory-redaction-agent.test.ts` (đỏ), mẫu `test/memory-notebook-agent.test.ts` và `test/agent.test.ts`:
  - **Story 1 kịch bản 1–6:**
    - khởi động lại = provider mới, cùng lịch sử;
    - mở lại sau khi HPG có bản 4, hai câu hỏi khác nhau;
    - dòng nhắc không lặp sau lần mở lại thứ hai;
    - lượt bị bỏ vì "hội thoại quá dài" rồi gửi lại;
    - tắt rồi bật sổ.
  - **TC-002:** phần nhắc nhở của request khi chạy liền và khi mở lại giống từng byte.
  - **Story 2 kịch bản 1–8**, tìm `DANHDAU-7` trong `bodies`. Kịch bản 7: một tool dữ liệu giả xoá #7 bằng quyền ghi của kho trong lúc lượt chạy; các request còn lại của lượt vẫn có khối; lượt sau không còn.
  - **Lượt bị hoãn (spec 005)** khi kho lỗi: không có sự kiện `memory-redaction`. Chạy tiếp với `waive`: có `temporary`, request không chứa nội dung khối.
  - **Story 6 kịch bản 1–4:** gọi `memory_read` hai lần; bản mới; kết quả cũ bị dọn giữa lượt (đẩy context qua ngưỡng); phần giữ lại sau nén.
- [x] T011 [LÕI 1] `src/core/memory/types.ts`: `MemoryContext.history`.
- [x] T012 [LÕI 2] [LÕI 3] `src/core/tools/types.ts` (`ToolContext.messages`), `src/core/tools/registry.ts` (chuyển `options.messages`).
- [x] T013 [LÕI 4] `src/core/events.ts`: sự kiện `memory-redaction`.
- [x] T014 [LÕI 5] `src/core/agent.ts`:
  - `RunOptions.redaction`;
  - sau `bindTurn`: `redactHistory`, phát sự kiện, dùng `sent` cho phần còn lại của lượt;
  - `recall(input, { sessionId, history: sent })`.
- [x] T015 [S1] [S2] Viết lại phần "session ledger" của `test/memory-notebook-recall.test.ts` theo lịch sử (đỏ):
  - đã gửi, đã nhắc, đã trỏ, dòng lỗi lấy từ `ctx.history`;
  - khối đã che kéo theo dòng nhắc xoá một lần;
  - cửa sổ chủ đề giữ nguyên các test hiện có.

  Các test Story 3, 4 hiện có chuyển sang truyền `history` giữa các lượt, giữ nguyên kỳ vọng. Riêng test "a turn that never ended … gets its block again" giữ ý, đổi cách dựng.
- [x] T016 `src/core/memory/notebook/session-ledger.ts` (chỉ còn cửa sổ chủ đề), `src/core/memory/notebook/provider.ts`:
  - `recall` dựng trạng thái "đã gửi" từ `memoryLines(ctx.history ?? [])`, ánh xạ tên luận điểm qua bí danh đang dùng;
  - bỏ `Ledgers.current`, `track`, móc `turn-end`.

  T015 xanh.
- [x] T017 [S6] `src/core/memory/notebook/read-tool.ts`, `provider.ts`: `memory_read` nhận `ctx.messages`. Đúng bản đó có trong phần model thấy thì trả câu ngắn (YC-017): "Bài học #7 bản 1 đã có phía trên trong hội thoại, ở khối có nhãn [Memory · bài học · #7 · bản 1 · ghi …]; nội dung không đổi." Nhãn chép nguyên văn. Sửa `test/memory-notebook-read-tool.test.ts` (đỏ trước). T010 xanh.

**Checkpoint:** typecheck sạch; T010, T015, T017 xanh; toàn bộ `bun test` đạt.

## Giai đoạn 5: Giao diện, runtime, tool lịch sử, câu báo (Story 2, 3, 4) [LÕI 7–10], dòng 11

**Mục tiêu:** che khi xoá và khi mở lại trên TUI; mọi đường đọc che; câu báo đúng.
**Kiểm độc lập:** test giao diện headless (`test/tui.test.tsx` làm mẫu; nhớ `afterEach` gọi `startSession(runtime, "clear")`).

- [x] T018 [S3] [S4] Viết test (đỏ):
  - **`test/memory-notebook-tui.test.tsx`:**
    - Story 4 kịch bản 1–3: câu báo bài học, luận điểm, ràng buộc; không có chữ "vĩnh viễn", "hoàn toàn", "khỏi máy"; ghi dòng che lỗi thì câu xoá không đổi, có câu "Chưa lưu được dòng che…";
    - xoá lúc rảnh thì `state.history` đã che và file phiên có dòng che;
    - **xoá trong lúc nén** (giữ cho nén chạy chậm bằng model giả chờ, cả nén khi rảnh qua `idleTimerForTests`): lúc xoá không che, không ghi gì. Nén xong rồi tới lượt sau thì không request nào chứa `DANHDAU-7`, `state.history` đã che, file phiên có **đúng một** dòng che cho #7;
    - kho tạo lại cùng ngày (thay file kho bằng kho mới có #7 bản 1 khác nội dung), mở lại phiên: request tạm che khối #7, file phiên không đổi byte nào;
    - Story 3 kịch bản 1, 2, 6, 7:
      - mở lại có che và câu "Đã che 1 mục…";
      - chuyển file kho đi rồi trả về: tạm che, file không đổi; trả về thì HPG nguyên văn, #7 che, có dòng che;
      - kho lỗi, chọn "Chạy lượt này không có ràng buộc": request có khối đã tạm che, file không có dòng che;
    - ca im lặng: không có kho, phiên không có khối thì không có câu báo.
  - **`test/session-tools.test.ts`:** `session_get` che, không ghi file, tạm che khi không có kho.
  - **`test/session-export.test.ts`:** `/export` che, không ghi file.
- [x] T019 [LÕI 8] `src/core/runtime.ts`: `createRedactionCheck`, `Runtime.redaction`, truyền cho `sessionHistoryTools`.
- [x] T020 [LÕI 7] `src/core/tools/session/history.ts`: `sessionHistoryTools({ redaction })`, đọc có che, tạm che.
- [x] T021 [LÕI 9] `src/tui/session.ts`:
  - mở lại: kiểm, xếp dòng che cho `confirmed`, câu báo;
  - `recordRedaction`;
  - `receiptLines` thêm "Chưa lưu được dòng che…" (YC-013);
  - `/export`, `/save` đọc có che;
  - `redactOpen(runtime)`.
- [x] T022 [LÕI 10] `src/tui/app.tsx`:
  - truyền `redaction` vào `runAgent`;
  - nhận `memory-redaction`;
  - báo tạm che một lần cho mỗi trạng thái của phiên;
  - đầu `compact()` (cả nén khi rảnh): che, lưu phần xác nhận, đưa `sent` cho `compactHistory`.

  Không sửa `src/core/compact.ts`.
- [x] T023 Dòng 11 `src/tui/dialogs/notebook.tsx`: sau khi xoá thành công luận điểm hoặc bài học, gọi `redactOpen(runtime)` chỉ khi không có lượt đang chạy và không có lần nén đang chạy (`state.streaming`, `state.compacting`). `src/core/memory/notebook/admin.ts`: câu báo theo spec Story 4 (bỏ `stopped`; luận điểm và bài học có bốn ý; ràng buộc và cách trình bày "Đã xoá … khỏi ứng dụng", "từ lượt sau, model không còn nhận…", "Bản đã gửi provider không thu hồi được"). T018 xanh.

**Checkpoint:** typecheck sạch; T018 xanh; toàn bộ `bun test` đạt.

## Giai đoạn cuối: Hoàn thiện

- [x] T024 Quét:
  - không có mã ý kiến duyệt hay chỗ trỏ ra ngoài repo trong code, test, tài liệu;
  - chuỗi người dùng thấy là tiếng Việt, tên và chú thích tiếng Anh;
  - `git diff --stat` chỉ chạm file ở plan §4.
- [x] T025 Cập nhật trạng thái (chỉ ghi `implemented` cho phần đã chạy thật):
  - `docs/memory/specs/README.md`: dòng 006, và hai dòng giới hạn "được gỡ ở 006";
  - `docs/STATUS.md`;
  - `CHANGELOG.md` (`[Unreleased]`, tiếng Anh): dòng che, mã lượt, che khi đọc lại, câu báo xoá, `MemoryContext.history`, `ToolContext.messages`;
  - `docs/contracts.md` §6: trường `history` của `MemoryContext`; §8: dòng che, trường `turn`, luật áp dòng che khi đọc;
  - `tasks.md` này.
- [x] T026 Chạy toàn bộ: `bun run typecheck`, `bun test`. Ghi lại số đạt, bỏ qua, trượt. Báo "xong spec 006" để sang cổng duyệt code.

## Thứ tự và phụ thuộc

- T001 → giai đoạn 2 (T002–T007) → giai đoạn 3 (T008–T009) → giai đoạn 4 (T010–T017) → giai đoạn 5 (T018–T023) → T024–T026.
- T009 dùng `applyRedactLines` và `RedactionCheck` của T007.
- T014 cần T011–T013. T016, T017 cần T003, T011, T012.
- T021–T023 cần T009, T014, T019.

## Gói theo phiên

| Phiên | Việc | Kết thúc ở trạng thái | Chờ duyệt |
| --- | --- | --- | --- |
| 1 | T001–T007 | Nền tảng memory xong, chưa nối vào app; typecheck và test xanh | — |
| 2 | T008–T009 | File phiên có dòng che, mã lượt; mọi đường đọc qua `loadSession` che; typecheck và test xanh | [LÕI 6] người dùng xác nhận; chủ repo duyệt ở PR |
| 3 | T010–T017 | Vòng agent che đầu lượt; sổ theo lịch sử; câu ngắn `memory_read`; typecheck và test xanh | [LÕI 1–5] |
| 4 | T018–T026 | TUI, runtime, tool lịch sử, câu báo; tài liệu; toàn bộ test xanh; báo "xong spec 006" | [LÕI 7–10], dòng 11 |
