# Việc cần làm 007: Nén hội thoại, gỡ memory cũ, thẻ gợi ý

Theo [plan.md](plan.md) (đã duyệt cổng 2, 07/11/2026). Mỗi giai đoạn: test của giai đoạn xanh trước khi sang giai đoạn sau. `[LÕI n]` là điểm đụng lõi ở plan §6.

## Giai đoạn 1: Gỡ memory cũ (Story 4) [LÕI 1–3]

- [x] T001 `config.ts`: `memoryChoiceOf`, `cardsEnabled`; `memory.cards`. `runtime.ts`: `MemoryChoice = "none" | "notebook"`, `createMemory` dùng `memoryChoiceOf`.
- [x] T002 Xoá `src/core/memory/file-memory.ts`; bỏ chỗ dùng (`runtime.ts`, chú thích `tools/types.ts`, `tools/registry.ts`, `app.tsx`, `notebook/admin.ts`, `memory/types.ts`).
- [x] T003 `memory/types.ts`: bỏ `approve`, `reject`, `status`, `MemoryStatus` và phần chỉ màn memory cũ gọi (tìm chỗ gọi trước).
- [x] T004 `/config`: hai lựa chọn; công tắc "Cho phép thẻ gợi ý". `/memory`: bỏ màn memory cũ, giữ màn tắt; Sổ hiện trạng thái công tắc. `notebook-form/open.ts:36`.
- [x] T005 `tui/main.tsx`: `"file"` → ghi `"notebook"` + câu báo một lần (đường dẫn thư mục memory cũ nếu có `.md`); ghi lỗi thì báo.
- [x] T006 Sửa 9 file test (plan §7); test mới trong `test/memory.test.ts` (chuyển cấu hình) và `test/memory-notebook-forms-tui.test.tsx` (câu báo một lần).

## Giai đoạn 2: Nén (Story 1–3) [LÕI 4, 5]

- [x] T010 `memory/notebook/labels-only.ts` + test.
- [x] T011 `summarizeConversation`: `labelsOnly(head)`, request không có memory, mục lục, `rang_buoc`.
- [x] T012 `compactPrompt`: lean có "Ràng buộc và sở thích"; câu dặn nhãn (memory, ràng buộc đã lưu, hồ sơ). `compact-marker.ts` dùng `REMINDER_TAG`.
- [x] T013 Sổ: dòng nhắc nén theo mã bản tóm tắt; bỏ ghim mục lục khi mã đổi; mẫu trong `history-blocks.ts`.
- [x] T014 Test trong `test/memory-redaction-agent.test.ts` (lược khối, request tóm tắt, dòng nhắc sau nén, hai lần nén, dựng lại mục lục); đổi có chủ đích `compact.test.ts:219`, `memory-binding-agent.test.ts:355`, `memory-redaction-agent.test.ts:452`.

## Giai đoạn 3: Thẻ — lõi (Story 5–7) [LÕI 2, 6]

- [x] T020 `memory/cards/types.ts`, `block.ts` (`stripCardBlocks`), `check.ts` (`acceptCard`), `stream.ts` (`cardStreamFilter`) + test.
- [x] T021 `prompts/memory-cards.md`; lớp `memory_cards` (`assemble.ts`, `budget.ts`, `/context`); `prompts/memory.md` luật bỏ qua memory.
- [x] T022 `runAgent`: `RunOptions.cards` (hạng C → tắt); tách khối mọi lượt; sự kiện `card`; `previewContext`.
- [x] T023 `MemoryContext.cards`; Sổ nói `cardPending`/`cardSaved`/`cardDismissed`; mẫu trong `history-blocks.ts`.
- [x] T024 Test `test/memory-cards-agent.test.ts`.

## Giai đoạn 4: Thẻ — phiên và giao diện [LÕI 7–9]

- [x] T030 `session/store.ts`: dòng `card` (`noteCard`, `appendCardState`, `LoadedSession.cards`) + test.
- [x] T031 `tui/cards.ts`: danh sách thẻ, gán id, lọc trùng, đổi trạng thái, `MemoryContext.cards`.
- [x] T032 `app.tsx`: bộ lọc stream mỗi dòng assistant; nhận sự kiện `card`; đưa `cards` vào `runAgent`; `/goiy`.
- [x] T033 `card-row.tsx`, `state.ts` (dòng `card`), `transcript.tsx`; phím Enter / x / Esc.
- [x] T034 Form: điền sẵn, câu gốc, nguồn `card`, báo kết quả lưu; `admin.ts` nhận nguồn.
- [x] T035 Mở lại phiên hiện thẻ (`tui/session.ts`).
- [x] T036 Test trong `test/memory-notebook-forms-tui.test.tsx` (hiện thẻ, form, lưu, bỏ qua, `/goiy`, tắt thẻ, mở lại phiên); `test/memory-cards-block.test.ts`, `test/memory-cards-session.test.ts`.

## Giai đoạn cuối: Hoàn thiện

- [x] T040 Tài liệu: `contracts.md` §6, §8; `README.md`, `README.en.md`; `STATUS.md`; `specs/README.md`; `CHANGELOG.md`; trạng thái spec, plan.
- [x] T041 Ghi chú ngoài repo: lỗi lưu trùng "Ghi nhớ:" hết nhờ 007; memory kiểu Claude Code thay bằng Sổ + thẻ, việc theo sau: xuất thư mục Markdown.
- [x] T042 `bun run typecheck`, `bun test` Windows và Linux; một commit `feat(memory): spec 007 …`; push có chặn.
