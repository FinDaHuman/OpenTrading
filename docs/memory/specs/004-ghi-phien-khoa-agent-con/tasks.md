# Việc cần làm 004: Sửa lỗi lõi: ghi phiên, khoá file, agent con

**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

**Ký hiệu:**
- `[P]`: làm song song được;
- `[S1]`…`[S4]`: thuộc story 1…4 của spec;
- `[LÕI]`: sửa file của chủ repo, chỉ làm sau khi người dùng xác nhận dòng tương ứng (L1–L9) ở plan §7.

Đánh dấu `[x]` chỉ khi việc đã xong **và** đã chạy kiểm thật.

Thứ tự giai đoạn theo rủi ro tăng dần: agent con (Story 3) → khoá file (Story 4) → ghi phiên (Story 1, 2). Đây không phải thứ tự ưu tiên P1/P2 của spec. Gói rủi ro thấp làm trước để phát hiện sớm lỗi môi trường.

## Giai đoạn 1: Chuẩn bị

- [x] T001 Kiểm `bun.exe --version` = 1.4.2. Chạy `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` trên `feat/memory` **trước khi sửa gì**. Ghi số đạt/trượt lại làm mốc chuẩn (ghi chú làm việc của spec). Có test đỏ sẵn thì dừng và báo

**Checkpoint:** có mốc chuẩn ghi lại.

## Giai đoạn 2: Story 3, agent con không có tool lịch sử phiên (P1, rủi ro thấp nhất)

**Mục tiêu:** YC-014, YC-015, YC-016.
**Kiểm độc lập:** dựng `childRegistry` trong test, không gọi model.

- [x] T002 [S3] Viết test, phải đỏ trước, `test/subagent-session-tools.test.ts`:
  - đăng ký `sessionHistoryTools()` cùng vài tool thường vào registry cha;
  - với bộ lọc của cả 17 loại agent có sẵn (nạp như `test/agents.test.ts:60-62`) và một loại tự định nghĩa `tools: ["session_get", "session_list", "@chi-doc"]`: bộ tool con không có tool nào của `sessionHistoryTools()` (hoặc ném "không có tool nào" khi rỗng);
  - registry cha vẫn có đủ (TC-006);
  - **TC-007:** mọi tool `sessionHistoryTools()` trả về có `mainAgentOnly === true`
- [x] T003 [S3] Test đường giao tiếp việc và ultradesk, `test/subagent-session-tools.test.ts`:
  - `SubagentManager.start` với registry cha có tool lịch sử;
  - bộ tool của lần chạy không có tool lịch sử;
  - đối chiếu `manager.ts:249`, `manager.ts:338` dùng cùng `childRegistry`;
  - ultradesk dùng `start` của bộ quản lý (`runtime.ts:187`), nên đủ phủ khi `start` đúng;
  - nếu test tiếp tục việc (đường 338) cần dựng sidechain thật thì ghi lý do và chỉ kiểm qua `childRegistry`
- [x] T004 [S3] [LÕI L1] Thêm `mainAgentOnly?: boolean` vào `ToolDef`, `src/core/tools/types.ts`
- [x] T005 [S3] [LÕI L2] `sessionHistoryTools()` gắn `mainAgentOnly: true` cho mọi tool trả về, tại một chỗ, `src/core/tools/session/history.ts`
- [x] T006 [S3] [LÕI L3] `childRegistry` bỏ tool có `mainAgentOnly`; sửa chú thích, `src/core/subagents/manager.ts`

**Checkpoint:** T002, T003 xanh; `test/agent-tools.test.ts`, `test/agents.test.ts` xanh không sửa kỳ vọng; typecheck sạch.

## Giai đoạn 3: Story 4, khoá file (P2, rủi ro vừa)

**Mục tiêu:** YC-009 tới YC-013.
**Kiểm độc lập:** `withFileLock` trên thư mục tạm, một tiến trình và nhiều tiến trình.

- [x] T007 [P] [S4] Viết test trong một tiến trình, phải đỏ trước, `test/file-lock.test.ts`:
  - **(a) Story 4 kịch bản 1:** A giữ khoá lâu hơn `staleMs` nhưng vẫn làm mới (`refreshMs` nhỏ). B chờ rồi hết hạn với lỗi "đang giữ khoá", không chiếm.
  - **(b) Kịch bản 3, theo ví dụ ở plan §3.2:** A không làm mới (`refreshMs` lớn), `staleMs` 100 ms. B chiếm khoá và ghi "B". `beforeCommit` của A ném lỗi. File là "B".
  - **(c) Kịch bản 4:** A nhả khoá khi khoá là của B, file khoá của B còn nguyên với `token` của B.
  - **(d)** Khoá cũ thiếu `token` của tiến trình đã chết vẫn bị chiếm.
  - **(e)** File khoá rỗng không bị coi là chết.
  - **(f) Vòng thử lại:**
    - `spyOn(jsonFiles, "rename")` lần đầu ghi đè file khoá bằng `token` của B (mô phỏng B chiếm khoá trong lúc chờ), rồi ném lỗi `code: "EBUSY"`;
    - kỳ vọng `writeJson` qua `updateWatchlists`, hoặc `withFileLock` với `beforeCommit: lock.assertHeld`: lần thử 2 gọi `assertHeld` và ném lỗi; `rename` chỉ được gọi **một** lần; watchlist không đổi; không còn file `.tmp`.
- [x] T008 [P] [S4] Viết tiến trình phụ `test/fixtures/scripts/lock-contender.ts`:
  - nhận đường dẫn file, thời gian giữ, `staleMs`, `refreshMs`;
  - trong vùng giữ khoá ghi nối dòng `enter <pid> <ms>` và `exit <pid> <ms>` vào một file nhật ký.
- [x] T009 [S4] Test nhiều tiến trình, `test/file-lock.test.ts`:
  - **TN3:** ba tiến trình, A giữ lâu hơn `staleMs` và vẫn làm mới, B và C vào sau. Đọc nhật ký: không có hai khoảng `enter`–`exit` chồng nhau (TC-005).
  - **Kịch bản 2:** giết tiến trình giữ khoá bằng `proc.kill()`. Tiến trình sau chiếm được trong hạn chờ.
- [x] T010 [S4] [LÕI L4] Viết lại phần giữ và nhả khoá theo plan §3.2, `src/core/file-lock.ts`:
  - `token`;
  - làm mới, với bộ hẹn giờ không giữ tiến trình sống;
  - chiếm theo chủ chết hoặc lâu không làm mới (mặc định 30 giây);
  - nhả có kiểm chủ;
  - `HeldLock.assertHeld`;
  - giữ nguyên câu báo hết hạn chờ.
- [x] T011 [S4] [LÕI L5] `writeJson` nhận tuỳ chọn `beforeCommit`, gọi sau khi ghi file tạm và **trước mỗi lần thử `rename`** trong vòng thử lại; lỗi thì không đổi tên, xoá file tạm rồi ném lại; `rename` gọi qua `jsonFiles` để test (f) giả lập `EBUSY`, `src/core/store.ts`. Hành vi khi không truyền `beforeCommit` giữ nguyên
- [x] T012 [S4] [LÕI L6] `updateWatchlists` truyền `lock.assertHeld` làm `beforeCommit`, `src/core/tools/watchlist/local.ts`

**Checkpoint:** T007, T009 xanh; `test/watchlist-local.test.ts` xanh không sửa kỳ vọng (gồm bài ba tiến trình và bài khoá chết hoặc sống); typecheck sạch.

## Giai đoạn 4: Story 1 và Story 2, ghi phiên ở lõi (P1, rủi ro cao)

**Mục tiêu:** YC-001 tới YC-007, YC-017, YC-018.
**Kiểm độc lập:** lớp `Session` trên `OPENTRADING_HOME` tạm, không cần TUI.

- [x] T013 [S1] Viết test, phải đỏ trước, `test/session-write.test.ts`. Mẫu dựng thư mục tạm theo `test/session.test.ts:7-18`.
  - **TC-001 (TN1):**
    - tạo phiên với **ngày cố định** `Session.create(new Date("2026-10-29T08:00:00Z"))`, và tính tên file chặn từ năm trong `createdAt` của phiên, không viết cứng theo năm hiện tại (tránh test xanh giả khi chạy từ năm 2027);
    - tạo file `sessions/<năm của phiên>` (ở đây `sessions/2026`) chặn thư mục năm;
    - `appendTurn` lượt 1 cho biên nhận `pending: [1]`, có lỗi;
    - gỡ file chặn; lượt 2 cho `saved: [1, 2]`;
    - lượt 3 bình thường;
    - file phiên có dòng thông tin phiên ở đầu và đủ 3 lượt đúng thứ tự, mỗi lượt một lần;
    - `listSessions` có phiên với `turns: 3`.
  - **Kịch bản 3:** lỗi lượt 3 và lượt 4 khác nhau; biên nhận lượt 4 mang lỗi của lần thử mới.
  - **Kịch bản 4:** bản nén lỗi được ghi bù trước lượt kế tiếp; `loadSession` bắt đầu từ bản nén.
- [x] T014 [S1] Test YC-018, `test/session-write.test.ts`:
  - **TC-002:** `spyOn(sessionFiles, "append")` ghi thật hai dòng đầy đủ và nửa dòng rồi ném `ENOSPC`. File bị cắt về kích thước cũ; lượt sau ghi bù; không tin nhắn trùng.
  - **Cắt cũng lỗi:** thêm `spyOn(sessionFiles, "truncate")` ném `EBUSY`. Biên nhận `stopped: true`; lượt sau không gọi `append`; file không đổi.
- [x] T015 [S1] Test chỉ mục, `test/session-write.test.ts`: lần ghi chỉ mục lỗi (giả lập `append` lỗi đúng với file `index.jsonl`) cho `indexPending: true`; lượt sau ghi bù; `listSessions` thấy phiên (YC-005).
- [x] T016 [S2] Test, `test/session-write.test.ts`:
  - **TC-003 (TN2):** ghi 2 lượt, cắt 25 byte cuối, `Session.continue`, ghi lượt 3; `loadSession` có "câu 3" và "đáp 3".
  - **Chỉ mục có dòng cuối cụt:** phiên mới vẫn hiện trong `listSessions`.
- [x] T017 [S2] Test TC-004 phần lõi, `test/session-write.test.ts`: gọi `appendTurn` không đợi, rồi `await flush()`; file có đủ lượt và biên nhận rỗng.
- [x] T018 [S1] Test TC-008, `test/session-write.test.ts`: một file phiên mẫu đúng định dạng hiện tại, viết tay trong test, mở lại cho lịch sử giống hệt; ghi thêm một lượt vẫn đọc được.
- [x] T019 [S1] [LÕI L7] Viết lại phần ghi của `Session` theo plan §3.3, `src/core/session/store.ts`:
  - hàng chờ, hàm xả hàng nối tiếp tự bắt lỗi;
  - `SaveReceipt`;
  - dòng thông tin phiên ở lần thành công đầu;
  - kích thước trước khi ghi, chống dòng cụt, cắt khi lỗi, ngừng ghi;
  - chỉ mục cần ghi lại;
  - `sessionFiles`;
  - **Giới hạn hai cửa sổ:** ở chỗ chống dòng cụt của file chỉ mục, thêm một dòng chú thích nêu giới hạn: hai cửa sổ cùng ghi `index.jsonl`, cửa sổ A đọc byte cuối đúng lúc B đang ghi dở thì A có thể chèn `\n` cắt đôi dòng của B. Dòng đó tự lành ở lượt kế tiếp của B, vì mỗi lượt ghi lại dòng chỉ mục.

  Phần đọc (`listSessions`, `loadSession`, `closeDanglingToolCalls`) không đổi.

**Checkpoint:** T013–T018 xanh; `test/session.test.ts`, `test/session-tools.test.ts`, `test/session-export.test.ts` xanh không sửa kỳ vọng; typecheck sạch.

## Giai đoạn 5: Story 1 và Story 2, giao diện và đường thoát (rủi ro cao)

**Mục tiêu:** YC-003, YC-008.

- [x] T020 [S1] Viết test, phải đỏ trước, `test/session-write.test.ts`:
  - hàm định dạng câu báo từ biên nhận và `settleForExit`: đủ bốn mẫu câu ở plan §3.3, câu khi chuyển phiên, câu quá hạn khi thoát;
  - **"flush treo thì đổi phiên vẫn xong trong hạn":**
    - `spyOn(sessionFiles, "append")` trả một promise do test giữ, chưa cho xong;
    - `settleSession(old, 100)` (hạn thu nhỏ) trả "quá hạn" trong khoảng 100 ms, không đợi promise treo;
    - test cho promise xong: phiên cũ ghi lượt vào **đúng file của nó**, biên nhận sau đó có `saved` chứa lượt đó, câu báo nêu đúng tên phiên cũ;
    - một phiên mới tạo trong lúc đó có file riêng, không bị lẫn.

  Nếu hàm định dạng và `settleSession` nằm ở `src/tui/session.ts`, test import từ đó như `test/tui.test.tsx` đang làm với `src/tui/*`.
- [x] T021 [S1] [LÕI L8] `src/tui/session.ts`:
  - `recordTurn`, `recordCompact` báo theo biên nhận, nêu đúng phiên đã ghi;
  - thêm `settleSession(session, ms = 2000)`;
  - `startSession`, `resumeSession` gọi `settleSession` cho phiên đang rời: có biên nhận thì báo phần chưa lưu; quá hạn thì vẫn đổi phiên, và báo khi phiên cũ có biên nhận;
  - thêm `settleForExit`.
- [x] T022 [S2] [LÕI L9] `exit()` thêm `settleForExit()` vào `Promise.all` có hạn 2 giây; sau `renderer.destroy()` in câu báo ra stderr nếu có, `src/tui/app.tsx`
- [x] T023 Chạy `test/tui.test.tsx` cả file (không dùng `-t`, vì các test trong file có trạng thái nối tiếp): xanh không sửa kỳ vọng

**Checkpoint:** toàn bộ `bun test` xanh; typecheck sạch.

## Giai đoạn cuối: Hoàn thiện

- [x] T024 Đối chiếu lại mọi YC-001…YC-018 và TC-001…TC-009 với test đã có; ghi kết quả vào ghi chú làm việc của spec
- [x] T025 Trước khi commit: trong `spec.md`, `plan.md`, `tasks.md`, thay mỗi mã ý kiến duyệt bằng một cụm giải thích ngắn, vì người đọc PR không tra được các mã này. Sau đó cập nhật trạng thái, chỉ ghi `implemented` cho phần đã chạy thật:
  - `docs/memory/specs/README.md`: dòng 004;
  - `docs/STATUS.md`: mục Memory v5.1, sửa lỗi lõi;
  - `CHANGELOG.md` `[Unreleased]`, tiếng Anh: Fixed: session writes recover after a failed write, torn lines, file lock ownership; Changed: subagents no longer get session history tools.
- [x] T026 Soạn sẵn cho bước commit:
  - thân commit liệt kê L1–L9 kèm lý do một dòng;
  - mô tả PR có bảng "Thay đổi lõi cần chủ repo duyệt" và dòng nhắc người phụ trách prompt.

  Chỉ soạn, không commit khi người dùng chưa cho phép. Lần push đầu dùng `git push -u origin feat/memory`.

## Thứ tự và phụ thuộc

- T001 trước mọi việc.
- Giai đoạn 2, 3 và 4 không phụ thuộc nhau về code. Vẫn làm theo thứ tự rủi ro tăng dần ở đầu file.
- **Trong giai đoạn 3:**
  - T007, T008 làm song song được;
  - T009 cần T008;
  - T012 cần T010 và T011.
- **Giai đoạn 5 cần giai đoạn 4:** `SaveReceipt` và `flush()` mới.
- T025, T026 cuối cùng.

## Gói theo phiên

| Phiên | Việc | Kết thúc ở trạng thái | Chờ duyệt |
| --- | --- | --- | --- |
| 1 | T001–T006 | Mốc chuẩn ghi lại; agent con không có tool lịch sử; typecheck và test xanh | Người dùng xác nhận L1, L2, L3 |
| 2 | T007–T012 | Khoá file mới; watchlist kiểm khoá trước khi đổi tên; typecheck và test xanh | Người dùng xác nhận L4, L5, L6 |
| 3 | T013–T019 | Ghi phiên ở lõi có hàng chờ, biên nhận, cắt, ngừng ghi; typecheck và test xanh | Người dùng xác nhận L7 |
| 4 | T020–T026 | Giao diện và đường thoát; toàn bộ test xanh; trạng thái tài liệu cập nhật; thông điệp commit và mô tả PR soạn sẵn | Người dùng xác nhận L8, L9; người dùng kiểm tay "hỏi, thoát ngay, mở lại" (plan §8); sau đó cổng 3 |
