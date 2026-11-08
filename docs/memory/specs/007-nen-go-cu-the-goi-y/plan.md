# Plan 007: Nén hội thoại, gỡ memory cũ, thẻ gợi ý

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (07/11/2026, qua cổng 2, người dùng xác nhận LÕI 1–9) |
| **Spec** | [spec.md](spec.md) (đã duyệt cổng 1, 07/11/2026) |
| **Kèm** | [research.md](research.md), [data-model.md](data-model.md) |
| **Nhánh** | `feat/memory` |

## 1. Tóm tắt

Ba phần, làm theo thứ tự **gỡ memory cũ → nén → thẻ**:

1. **Gỡ memory cũ:** xoá `FileMemory`, `propose_memory`, hook "Ghi nhớ:"; lựa chọn memory còn `"none" | "notebook"`; `"file"` được hiểu là `"notebook"` ở mọi chỗ đọc, giao diện ghi lại và báo một lần; bỏ phần hợp đồng chỉ memory cũ dùng.
2. **Nén:** `summarizeConversation` lược nội dung khối memory khỏi phần đầu (chỉ còn dòng nhãn) và dựng request không có memory, mục lục, `rang_buoc`; mẫu tóm tắt hai bản có "Ràng buộc và sở thích" và câu dặn nhãn; sổ nói dòng nhắc nén ở lượt đầu sau mỗi lần nén và dựng lại mục lục.
3. **Thẻ:** lớp prompt hướng dẫn thẻ khi lượt bật thẻ; lõi tách khối `<the_goi_y>` khỏi câu trả lời trước khi vào lịch sử và phát sự kiện thẻ khi khối hợp lệ; giao diện ẩn khối lúc stream, hiện hàng thẻ, mở form spec 003 điền sẵn, ghi dòng thẻ; sổ báo kết quả thẻ lượt sau.

Gỡ memory cũ làm trước vì nó thu nhỏ hợp đồng và các test giao diện mà hai phần sau dựa vào. Nén độc lập với thẻ.

## 2. Bối cảnh kỹ thuật

**Nén hôm nay** (khảo sát 07/11/2026):
- Chỉ giao diện gọi nén: `compact()` ở `src/tui/app.tsx:150-238` (tự động trước lượt, khi tràn ngữ cảnh, khi rảnh, `/compact`). Nó che trước (`redactHistory`), rồi `compactHistory` (`src/core/compact.ts:370-406`) gọi callback `summarize`, callback gọi `summarizeConversation` (`src/core/agent.ts:932-971`).
- `summarizeConversation` dựng request bằng `prepare()` như một lượt: có hướng dẫn memory, mục lục (`withContext`), `rang_buoc`; không gọi `recall()`. Phần đầu giữ nguyên các khối nhắc nhở và kết quả `memory_read` dưới 500 ký tự (lớn hơn đã bị dọn).
- Mẫu tóm tắt ở `compactPrompt` (`compact.ts:136-172`): bản đầy đủ có "Ràng buộc và sở thích", bản rút gọn không có; không nhắc memory.
- Dấu nén là tin nhắn người dùng dạng chuỗi (`compactPair`, `compact-marker.ts:60-70`), bản tóm tắt là tin nhắn assistant ngay sau. `memoryLines` không đọc hai tin nhắn này.
- Sau nén, sổ tự chèn lại khối của chủ đề đang bàn ở bản hiện hành (spec 006); mục lục còn ghim theo phiên (sửa review điểm 4).

**Memory cũ hôm nay:** `src/core/memory/file-memory.ts` (thư mục `<home>/memory/*.md`, tool `propose_memory`, hook `user-prompt` cho "Ghi nhớ:"); chọn ở `src/core/runtime.ts:97-107`, `src/core/config.ts:11-12`, `src/tui/dialogs/config.tsx:35-49, 198, 463`, `src/tui/dialogs/memory.tsx:22-96`, `src/tui/dialogs/notebook-form/open.ts:36`. 9 file test, 18 ca phụ thuộc (danh sách ở §7).

**Hạ tầng thẻ dùng lại:**
- Bỏ chữ khỏi câu trả lời trước khi vào lịch sử: mẫu `stripEchoMessages` (`agent.ts:325-340`, gọi ở `:1293`).
- Dòng chỉ ghi nhật ký theo lượt: `noteChart`, `noteHarness` (`src/core/session/store.ts:371-382`); dòng riêng trong hàng ghi: `appendRedaction` (`:398-404`).
- Thẻ có phím: `HoldCard` (`src/tui/hold-card.tsx`, `GRACE_MS`), chuỗi giữ phím (`app.tsx:790`, `state.ts:268`).
- Mở form từ code: `openNotebookRequest` (`notebook-form/open.ts:31-44`), `NotebookFormRequest` (`state.ts:99-104`); kết quả lưu `SaveResult.saved` (`notebook/admin.ts:97-98`).
- Bảng chính sách: `policyRule("main_agent", "propose", kind)` (`src/core/memory/policy.ts:86-112`).
- Chữ người dùng gõ: `typedText` (`src/core/memory/notebook/topics.ts:16`).
- Dòng nhắc theo lịch sử: `reminders` (`render.ts`), mẫu nhận lại (`history-blocks.ts`), `viewOf` + `say` (`provider.ts`).

## 3. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | Băm mã nén bằng `node:crypto` |
| Module mới dưới `src/core/memory/`, lõi không import TUI | Đạt | Đạt | `memory/cards/` (đọc, tách khối), `memory/notebook/labels-only.ts`. Lõi import từ `memory/` như đã import `memory/redaction` |
| Mỗi module một trách nhiệm | Đạt | Đạt | Tách khối / kiểm thẻ / lọc stream là ba hàm; không có `utils.ts` |
| I/O có timeout; lỗi không bị nuốt | Đạt | Đạt | Không thêm I/O mới ngoài ghi dòng thẻ (qua hàng ghi spec 004) và ghi cấu hình (lỗi thì báo, §3 spec) |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | |
| Windows và Ubuntu | Đạt | Đạt | Chạy `bun test` cả hai (WSL) trước khi push |
| Model không có tool ghi; chỉ người dùng làm memory có hiệu lực | Đạt | Đạt | Bỏ `propose_memory`. Thẻ không gọi kho; chỉ form lưu khi người dùng bấm Xác nhận |
| Append-only | Đạt | Đạt | Dòng thẻ chỉ nối thêm |
| Quyết định không vào context | Đạt | Đạt | Không có thẻ quyết định; dòng thẻ và dòng nhắc không đọc bảng quyết định |

## 4. Cấu trúc file

**Mới**
```
src/core/memory/cards/
  block.ts        đọc khối <the_goi_y>: tách mọi khối khỏi chữ, lấy khối cuối hợp lệ (data-model §1)
  check.ts        kiểm thẻ: bảng chính sách, câu gốc (research R-10), giới hạn và khoá của form
  stream.ts       bộ lọc stream: push(chunk) → chữ hiện được; end() → phần còn lại (khối không đóng thả ra)
  types.ts        Card, CardOutcome, CardKind
src/core/memory/notebook/labels-only.ts
                  thay mỗi khối trong hai kênh bằng dòng nhãn + câu lược (data-model §4)
src/tui/card-row.tsx      hàng thẻ và phím (mẫu HoldCard)
src/tui/cards.ts          danh sách thẻ của phiên, đổi trạng thái, ghi dòng thẻ, MemoryContext.cards
prompts/memory-cards.md   hướng dẫn tạo thẻ (spec YC-015)
test/memory-cards-block.test.ts, test/memory-cards-stream.test.ts, test/memory-cards-agent.test.ts,
test/memory-cards-tui.test.tsx, test/memory-compact.test.ts, test/memory-legacy-migration.test.ts
```

**Xoá:** `src/core/memory/file-memory.ts`; các ca test chỉ của memory cũ (§7).

**Sửa (lõi, xem §6):** `src/core/agent.ts`, `src/core/compact.ts`, `src/core/compact-marker.ts`, `src/core/config.ts`, `src/core/runtime.ts`, `src/core/events.ts`, `src/core/memory/types.ts`, `src/core/prompt/assemble.ts`, `src/core/prompt/budget.ts` (khoá `memory_cards`, không cắt), `src/tui/dialogs/context.tsx` (tên lớp trong `/context`), `src/core/session/store.ts`, `src/tui/app.tsx`, `src/tui/state.ts`, `src/tui/transcript.tsx`, `src/tui/session.ts`, `src/tui/main.tsx`, `src/tui/commands.ts`, `src/tui/dialogs/config.tsx`, `src/tui/dialogs/memory.tsx`, `src/tui/dialogs/notebook.tsx`, `src/tui/dialogs/notebook-form/forms.tsx`, `open.ts`.

**Sửa (memory):** `src/core/memory/notebook/provider.ts`, `render.ts`, `history-blocks.ts`, `admin.ts`, `prompts/memory.md`.

**Tài liệu:** `docs/contracts.md` §6, §8; `README.md`, `README.en.md`; `docs/STATUS.md`; `docs/memory/specs/README.md`; `CHANGELOG.md`; chú thích ở `tools/types.ts:96`, `tools/registry.ts:110`.

## 5. Giao diện

### 5.1 Gỡ memory cũ
```ts
// config.ts
memory?: { provider?: "none" | "notebook" | "file"; cards?: boolean }   // "file": chỉ để đọc cấu hình cũ
export function memoryChoiceOf(config: Config): "none" | "notebook"     // "file" → "notebook"
export const cardsEnabled = (config: Config) => memoryChoiceOf(config) === "notebook" && config.memory?.cards !== false
// runtime.ts
export type MemoryChoice = "none" | "notebook"
// tui/main.tsx: lúc khởi động
//   raw === "file" → saveConfig({ memory: { ...config.memory, provider: "notebook" } }), rồi câu báo
//   (đường dẫn <home>/memory nếu có file .md); ghi lỗi → báo lỗi, vẫn dùng Sổ
```
`MemoryProvider` bỏ `approve`, `reject`; `MemoryItem` bỏ `status`; các phần khác (`list`, `remove`, `problems`) bỏ nếu chỉ màn memory cũ gọi (kiểm bằng tìm chỗ gọi khi làm; ghi vào mô tả PR).

### 5.2 Nén
```ts
// memory/notebook/labels-only.ts
export function labelsOnly(history: readonly ModelMessage[]): ModelMessage[]
// agent.ts summarizeConversation: head = labelsOnly(opts.head); prepare({ ...opts, memory: undefined, constraints: undefined, … })
// compact.ts compactPrompt: lean có "## Ràng buộc và sở thích"; cả hai bản thêm câu dặn: không chép nội dung
//   khối memory, ràng buộc đã lưu hay hồ sơ nhà đầu tư (các thứ này được gửi lại mỗi request); nhắc tới thì ghi nhãn.
//   Hồ sơ INVESTOR.md vẫn có trong request tóm tắt (người dùng chỉ chốt bỏ rang_buoc)
// memory/notebook/render.ts reminders.compacted(code); history-blocks.ts mẫu tương ứng
// provider.ts recall: dấu nén mới nhất trong history → code = sha1(summary).slice(0, 6);
//   chưa có note compacted:<code> sau dấu → say(...); code ≠ ledger.lastCompact → bỏ pinnedIndex
```
Request tóm tắt mất phần đầu hệ thống chung với lượt thường (research R-2). Hướng dẫn chung của sổ (`prompts/memory.md`) cũng không có trong request tóm tắt: model tóm tắt chỉ thấy dòng nhãn và câu dặn của mẫu.

### 5.3 Thẻ
```ts
// memory/cards/types.ts
export type CardKind = "constraint" | "style" | "lesson"
export interface CardDraft { kind: CardKind; text?: string; title?: string; summary?: string; quote?: string }
export interface Card extends CardDraft { id: string; turn: number }   // id, turn do giao diện gán
export interface CardOutcome { id: string; kind: CardKind; state: "pending" | "saved" | "dismissed"; saved?: { group: CardKind; id: number } }
// memory/cards/block.ts
export function stripCardBlocks(text: string): { text: string; last?: RawCardBlock }   // last: khối cuối cùng, đúng vị trí cuối
// memory/cards/check.ts
export function acceptCard(raw: RawCardBlock, ctx: { typed: string }): CardDraft | undefined
//   lõi kiểm: hình khối, bảng chính sách, câu gốc với typedText(input), giới hạn và khoá của form
// tui/cards.ts: nhận CardDraft + mã lượt vừa xếp ghi → Card; bỏ thẻ trùng thẻ "chờ"/"đã bỏ qua" (YC-021);
//   id = the-<turn>-<4 hex băm nội dung>, nên lượt bị bỏ rồi gửi lại không trùng id
// memory/cards/stream.ts
export function cardStreamFilter(): { push(chunk: string): string; end(): string }
// agent.ts runAgent: RunOptions.cards; tier C → coi như false
//   assemble: lớp "memory_cards" (prompts/memory-cards.md) khi cards
//   MỌI lượt (bật thẻ hay không): sau stripEchoMessages, tách mọi khối khỏi mọi tin nhắn assistant của lượt
//   CHỈ khi cards: khối cuối của câu trả lời cuối → acceptCard → yield { type: "card", card } trước "done"
// events.ts: { type: "card"; card: CardDraft }   // nội dung đã kiểm, chưa có id
// session/store.ts: Session.noteCard(card) (bộ đệm lượt), Session.appendCardState(id, state, saved?) (hàng ghi),
//   LoadedSession.cards: { card, state, saved?, at: number }[]   // at = vị trí trong display
// memory/types.ts: MemoryContext.cards?: readonly CardOutcome[]
// provider.ts compose: cardPending / cardSaved / cardDismissed, khoá có id (data-model §3)
// tui: Line { kind: "card"; card; state }; CardRow (Enter → form, x → bỏ qua, Esc → về ô nhập);
//   thẻ không tự giữ phím (research R-9): /goiy chọn thẻ, rồi Enter / x / Esc;
//   bộ lọc stream ở text-delta và closeText, chạy MỌI lượt; một bộ lọc cho mỗi dòng assistant: tạo khi mở dòng,
//   end() ở mỗi closeText (kể cả trước một hàng tool); lượt cứu do dài quá nối vào cùng dòng nên giữ trạng thái;
//   /goiy chọn lại thẻ chờ mới nhất;
//   NotebookFormRequest thêm điền sẵn + card; form lưu xong gọi cards.saved(id, saved), nguồn "card"
```

**Màn hình** (mẫu):
```
● Ghi nhận: mình sẽ không gợi ý cổ phiếu penny cho bạn nữa.

  ┌ Gợi ý lưu · ràng buộc ─────────────────────────────┐
  │ Không gợi ý cổ phiếu penny                          │
  │ Bạn đã nói: "từ giờ đừng bao giờ gợi ý cổ phiếu     │
  │ penny cho tôi"                                      │
  │ Enter mở form · x bỏ qua · Esc về ô nhập            │
  └─────────────────────────────────────────────────────┘
```
Bài học ghi "Gợi ý lưu · bài học (model đề xuất)". Đã lưu: "✓ Đã lưu thành ràng buộc #2", không còn phím. Đã bỏ qua: "Đã bỏ qua", mờ.

## 6. Điểm đụng lõi (người dùng xác nhận từng dòng)

| # | File | Sửa gì | Vì sao |
| --- | --- | --- | --- |
| LÕI 1 | `config.ts`, `runtime.ts`, `tui/main.tsx` | Bỏ `"file"`, `memoryChoiceOf`, `cardsEnabled`, chuyển cấu hình và câu báo | YC-009–YC-012 |
| LÕI 2 | `memory/types.ts`, `docs/contracts.md` | Bỏ phần hợp đồng của memory cũ; thêm `MemoryContext.cards` | YC-014, YC-029 |
| LÕI 3 | `tui/dialogs/config.tsx`, `memory.tsx`, `notebook.tsx`, `notebook-form/open.ts` | Hai lựa chọn + công tắc thẻ; bỏ màn memory cũ; trạng thái công tắc trong `/memory` | YC-009, YC-013, YC-031, YC-032 |
| LÕI 4 | `agent.ts` (`summarizeConversation`) | Lược khối, bỏ memory/mục lục/`rang_buoc` khỏi request tóm tắt | YC-001–YC-003 |
| LÕI 5 | `compact.ts`, `compact-marker.ts` | Mẫu hai bản; dùng `REMINDER_TAG` ở dấu nén | YC-004, YC-005 |
| LÕI 6 | `agent.ts` (`runAgent`, `previewContext`), `events.ts`, `prompt/assemble.ts`, `prompt/budget.ts`, `tui/dialogs/context.tsx` | `RunOptions.cards` (cả `previewContext`, để `/context` hiện lớp thẻ lượt sau sẽ gửi), lớp prompt thẻ và khoá ngân sách, tách khối mọi lượt, sự kiện `card` | YC-015–YC-022 |
| LÕI 7 | `session/store.ts` | Dòng `card`: ghi, đọc, `LoadedSession.cards` | YC-027, YC-028 |
| LÕI 8 | `tui/app.tsx`, `state.ts`, `transcript.tsx`, `session.ts`, `commands.ts`, file mới `card-row.tsx`, `cards.ts` | Lọc stream, hàng thẻ, phím, `/goiy`, mở lại phiên hiện thẻ, đưa `cards` vào `runAgent` và `MemoryContext` | YC-017, YC-023, YC-026, YC-028 |
| LÕI 9 | `tui/dialogs/notebook-form/forms.tsx`, `open.ts`, `state.ts` | Điền sẵn, hiện câu gốc, nguồn "card", báo kết quả lưu cho thẻ | YC-024, YC-025 |

Phần thuộc memory (không phải lõi): `memory/cards/*`, `labels-only.ts`, dòng nhắc trong `provider.ts`/`render.ts`/`history-blocks.ts`, `admin.ts` nhận nguồn, `prompts/memory.md` (luật bỏ qua memory), `prompts/memory-cards.md`.

## 7. Cách kiểm

**Gỡ memory cũ** (`test/memory-legacy-migration.test.ts` mới + sửa test cũ):
- `memoryChoiceOf` ba giá trị; `createMemory` với cấu hình `"file"` mở Sổ; dòng lệnh không ghi cấu hình.
- Giao diện headless: cấu hình `"file"` + 3 file `.md` → cấu hình thành `"notebook"`, câu báo một lần, file không đổi byte (so băm trước/sau); khởi động lần hai không báo; chạy dòng lệnh trước rồi giao diện vẫn báo một lần.
- Không có `propose_memory` trong danh sách tool; "Ghi nhớ: …" không lưu gì.
- Sửa test cũ (khảo sát 07/11/2026): `test/memory.test.ts` (bỏ 7 ca của FileMemory, giữ ca HookBus chung `:63-79`); `test/agent.test.ts:502-519` (thay FileMemory bằng provider giả, giữ ca duy nhất của vòng agent cho index/recall/câu báo); `test/agent-tools.test.ts:30`; `test/tui.test.tsx` (runtime chung `:259-274` dựng bằng Noop; `/memory` duyệt/xoá `:1872`, `:1886` bỏ; `/config` `:1961`; số tool `/tools` 35 → 34 ở `:792`, `:831`); `test/memory-binding-agent.test.ts` (`"file"` trong các vòng lặp `:198`, `:307`); `test/memory-notebook-lifecycle.test.ts:143-159`; `test/memory-notebook-forms-tui.test.tsx:254-267`; `test/memory-notebook-tui.test.tsx:173-180`, `:323-333`; `test/turn-hold-tui.test.tsx:66`.

**Nén** (`test/memory-compact.test.ts` mới):
- `labelsOnly`: khối nhắc nhở, khối trong kết quả `memory_read`, nhiều khối trong một kết quả, khối bị cắt, nhãn giả trong tin nhắn người dùng và tool khác không bị đụng, tin nhắn không có khối là cùng đối tượng.
- Nén **thành công** với model giả qua `compact()` của giao diện: request tóm tắt không có chuỗi đánh dấu, không có `<memory>`, không có `rang_buoc`, không có hướng dẫn sổ; dòng nhãn còn đúng chỗ.
- Lượt đầu sau nén: dòng nhắc nén đúng một lần; hai lần nén gần nhau đều có; chỉ dọn tool thì không; sổ tắt thì không; khối HPG bản hiện hành; mục lục dựng lại.
- Xoá sau nén: không request nào có chuỗi đánh dấu.
- Đổi có chủ đích: `test/compact.test.ts:219` (bản rút gọn có "Ràng buộc và sở thích"); `test/memory-binding-agent.test.ts:355-362` (request tóm tắt không còn phần hệ thống y hệt lượt, không có ràng buộc); `test/memory-redaction-agent.test.ts:452` dựng dấu nén đúng dạng chuỗi như `compactPair`.

**Thẻ:**
- `test/memory-cards-block.test.ts`: một khối cuối hợp lệ ba loại; hai khối; khối giữa câu trả lời; trong code fence; dòng trích dẫn; khối không đóng (chữ sau giữ nguyên, bỏ dòng mở); trường thiếu, trường lạ; quá 2.000 ký tự; loại luận điểm, quyết định.
- `check`: câu gốc khớp, khác hoa thường, khác khoảng trắng, NFD so với NFC; câu gốc chỉ có trong thông báo agent con hay kết quả tool; dưới 8 ký tự; chuỗi giống khoá API; trùng thẻ chờ, đã bỏ qua.
- `test/memory-cards-stream.test.ts`: cắt khối ở mọi vị trí ký tự (vòng lặp từng điểm cắt) → không chunk nào lộ chữ của khối; chữ thường có `<` không bị giữ mãi; khối không đóng thả ra khi `end()` và khi vượt giới hạn.
- `test/memory-cards-agent.test.ts` (model giả): lịch sử không có khối; sự kiện `card` đúng; không có thẻ khi `cards` tắt, hạng C, lượt không có chữ gõ, khối ở bước có tool call, lượt bị dừng; dòng nhắc chờ/đã lưu/đã bỏ qua đúng một lần, hai thẻ bỏ qua không gộp; hướng dẫn thẻ chỉ có khi bật.
- `test/memory-cards-tui.test.tsx` (giao diện headless): hàng thẻ hiện, chữ của khối không lọt lúc stream; Enter mở form `/nho` điền sẵn câu đề xuất, hiện câu gốc; Xác nhận → kho có mục nguồn `card`, thẻ "đã lưu", dòng thẻ trong file; đóng form → vẫn "chờ"; `x` → "đã bỏ qua"; gửi tin nhắn mới không đổi thẻ; `/goiy`; mở lại phiên hiện thẻ ở đúng chỗ và trạng thái; Sổ tắt khi bấm Enter thì báo; `/config` công tắc; `/memory` hiện trạng thái.
- `test/session*.test.ts`: dòng thẻ qua hàng ghi (lỗi rồi lưu bù), dòng sau cùng thắng, bộ đọc bản trước đọc file có dòng thẻ không lỗi.
- Không request, dòng thẻ, dòng nhắc nào có chuỗi đánh dấu của lý do quyết định.

**Đóng gói:** `scripts/build.ts` đưa file trong `prompts/` vào bản build bằng `git ls-files`, nên `prompts/memory-cards.md` vào bản build sau khi commit; CI job build, install, npm kiểm điều này.

**Toàn bộ:** `bun run typecheck`; `bun test` trên Windows và Linux (WSL Ubuntu); CI 12/12 trên PR. Kiểm tay cho người dùng (mình không dùng key của người dùng): `/compact` có khối memory; một thẻ với model thật; chuyển cấu hình từ `"file"`.

## 8. Theo dõi độ phức tạp

| Chỗ thêm phức tạp | Vì sao cần | Cách đơn giản hơn đã bỏ |
| --- | --- | --- |
| Bộ lọc stream riêng cho thẻ | Spec YC-017 cấm lộ chữ của khối kể cả lúc stream | Chỉ tách lúc đóng câu trả lời: người dùng thấy tag thô chạy qua |
| Mã nén trong dòng nhắc | Hai lần nén gần nhau (spec Story 3.6) | Một dòng nhắc cố định: lần nén sau bị chặn |
| `MemoryContext.cards` | Model phải biết kết quả và thẻ đang chờ (research R-7) | Không báo: model đề xuất lại (bài học Claude Code) |
| Hai nơi tách thẻ (lõi, giao diện) | Lõi quyết định lịch sử; chỉ giao diện thấy chữ đang stream | Một nơi: hoặc lộ lúc stream, hoặc lịch sử phụ thuộc giao diện |
| Lệnh `/goiy` | Thẻ không chặn ô nhập nên cần cách chọn lại | Thẻ chặn phím như thẻ hoãn lượt: không cho gõ tiếp khi có thẻ |

> Ghi chú (08/11/2026): `/goiy` và việc thẻ nhận phím trong transcript đã bỏ. Thẻ đang chờ được lưu hoặc bỏ qua ở tab Gợi ý của `/memory` (CHANGELOG, mục Unreleased).
