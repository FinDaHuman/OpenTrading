# Plan 006: Phương án Y đầy đủ trong lõi: nhãn trong lịch sử, che khi xoá, mã lượt

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (06/11/2026, qua cổng 2 vòng 2). Người dùng xác nhận §6 dòng 1–11 |
| **Ngày** | 06/11/2026 |
| **Spec** | [spec.md](spec.md) · [research.md](research.md) · [data-model.md](data-model.md) |
| **Nhánh** | `feat/memory`, viết trên `c2776f5` (sau khi gộp `main` ngày 06/11/2026) |

## 1. Tóm tắt

Sổ ghi nhớ thôi nhớ "đã gửi gì" trong RAM. Lõi đưa cho nó **lịch sử sẽ gửi**; sổ tự tách các khối, dòng nhắc, dòng trỏ của chính nó từ hai kênh memory (phần `<memory_lien_quan>` của tin nhắn người dùng và kết quả `memory_read`). Nhờ vậy:
- mở lại phiên hay khởi động lại app không làm khối bị chèn lặp hoặc thiếu;
- `memory_read` biết khối nào model đang thấy ở bước đó, qua danh sách tin nhắn mà AI SDK đưa cho tool.

**Che:**
- Một bộ kiểm mở `memory.db` chỉ để đọc, theo cách của spec 005, và trả cho từng khối một trong bốn kết quả (research R-1):
  - **đã xoá:** kho có dấu xoá của đúng mục và bản đó, hoặc không có mục hay bản đó;
  - **khác nội dung:** có mà nội dung bất biến không trùng, ví dụ kho tạo lại trùng số;
  - **còn**;
  - **cụt, còn:** khối bị dấu cắt của lõi cắt ngang thì không so nội dung.
- Vòng agent che ở đầu mỗi lượt, giao diện che ở đầu mỗi lần nén và ngay sau khi xoá, bộ đọc phiên che khi đọc lại.
- Chỉ khối "đã xoá" mới bị che vĩnh viễn: thay trong lịch sử và thành **dòng che** đi qua bộ ghi phiên của spec 004.
- Kho vắng, kho lỗi, hay khối "khác nội dung" thì chỉ **tạm che** trong những gì gửi đi: không thay lịch sử, không ghi gì. Lý do: dòng che không gỡ được, mà "khác nội dung" có thể xảy ra với mục còn sống (kết quả tool bị cắt ở trần 30.000 ký tự, bản app sau đổi định dạng dòng).

File phiên có thêm **mã lượt** ở dòng kết thúc lượt; mở lại phiên thì đếm tiếp từ file. Không đụng phần nén (`compact.ts`), không sửa `FileMemory`.

## 2. Bối cảnh kỹ thuật

| Mục | Giá trị |
| --- | --- |
| Runtime | Bun 1.4.2 (`C:\Users\Admin\anaconda3\Scripts\bun.exe`), TypeScript 7.0.2 strict, ESM |
| LLM | `ai` 7.0.159. Tool nhận `ToolExecutionOptions.messages` (research R-3) |
| Lưu trữ | `memory.db` (`bun:sqlite`), lược đồ vẫn bản 1, chỉ đọc. File phiên JSONL, bộ ghi spec 004 |
| Kiểm cấu trúc | `zod@^4`. Dòng mới của file phiên đọc bằng kiểm tay như `isStoredMessage`, không dùng `z.object` rồi ghi lại |
| Test | `bun:test`, `OPENTRADING_HOME` tạm, `fetch` giả, ghi request vào `bodies` (mẫu `test/agent.test.ts`) |
| Nền tảng | Windows và Ubuntu. Đóng kết nối SQLite trước khi xoá thư mục tạm |

**Đã kiểm trong code (`c2776f5`):**
- `src/core/memory/types.ts:28-30`: `MemoryContext` chỉ có `sessionId`.
- `src/core/agent.ts:1016`: `bindTurn` (spec 005) chạy đầu lượt, ném lỗi hoãn lượt trước mọi hook.
- `src/core/agent.ts:1039-1041`: `recall` rồi in mỗi mục `- text` vào phần nhắc nhở.
- `src/core/agent.ts:1305`: `turn-end` phát sau `done`.
- `src/core/agent.ts:354-365`: `userMessage` đặt phần nhắc nhở thành phần văn bản riêng, trước chữ gõ.
- `src/core/prompt/assemble.ts:245`: thẻ `memory_lien_quan`.
- `src/core/tools/registry.ts:183-188`: `execute` chỉ chuyển `abortSignal`, `toolCallId` vào `ToolContext` (`src/core/tools/types.ts:7-16`).
- `node_modules/ai/dist/index.js:9692-9694, 9913`: tin nhắn đưa cho tool là bản sau `prepareStep` (đã dọn).
- `src/core/session/store.ts`:
  - `24-62`: loại dòng `meta`, `message`, `turn_end` (có `dataGaps` của `main`), `compact`, `chart`, `harness`;
  - `166-183`: `SaveReceipt` có `pendingCompactions`, tính ở `receipt()` (`:411`) bằng "phần trong hàng − số lượt";
  - `304-305`, `316`: `Session.continue` lấy số lượt từ dòng chỉ mục;
  - `376-398`: `appendTurn`;
  - `561`: `loadSession` bỏ qua loại dòng lạ.
- Đường đọc phiên:
  - `src/tui/session.ts:271-272` (mở lại);
  - `src/tui/session.ts:293` (`/export`, `/save`);
  - `src/core/tools/session/history.ts:76` (`session_get`, đọc `display`);
  - `sessionHistoryTools()` không nhận tham số, đăng ký ở `src/core/runtime.ts:165`.
- `src/core/runtime.ts:220`: `createConstraintReader(path.join(home, "memory.db"))`. Bộ kiểm che đặt cạnh đó.
- `src/tui/app.tsx`:
  - `147-205`: `compact()` của giao diện gọi `compactHistory(state.history, …)` rồi `recordCompact`;
  - `606-626`: `runAgent({ history: state.history, …, constraints, waive })`.
- `src/tui/dialogs/notebook.tsx:71-77`: xoá gọi `admin.remove` rồi `say(message)`. File do spec 002 tạo.
- `src/core/memory/notebook/admin.ts:255-257, 320, 324`: câu "Đã ngừng dùng …"; quyết định đã là "Đã xoá … khỏi ứng dụng".
- `src/core/memory/notebook/session-ledger.ts`: `sent`, `notified`, `pointers`, `errorSent`, chờ `turn-end` xác nhận, cửa sổ chủ đề 3 lượt.
- `src/core/memory/notebook/provider.ts`: `recall`, `compose`, `reads` (`track` theo `Ledgers.current`).
- `src/core/memory/notebook/render.ts:117-165`: định dạng khối, `labelOf`, `reminders`.
- `src/core/memory/notebook/escape.ts`: nội dung không mở đầu dòng, không có dòng trống.
- `src/core/memory/store/read-only.ts`, `src/core/memory/binding/timed-read.ts`, `src/core/memory/binding/constraints.ts:96-125`: mẫu đọc kho chỉ đọc, có hạn chờ.
- `src/core/memory/store/schema.ts`: không có mã kho; `subject_aliases` giữ bí danh đã thôi dùng (`retired_at`); `thesis_versions.deleted_at`, `lessons.deleted_at`.
- `src/core/memory/policy.ts:80`: `match` chỉ trả bí danh đang dùng.
- Dấu cắt của lõi (khối chạm dấu này là khối cụt, research R-1):
  - `src/core/tools/wrap.ts:88-93, 181`: `truncate` mọi kết quả tool, trần `DEFAULT_MAX_OUTPUT_CHARS = 30_000` (`src/core/tools/types.ts:157`), giữ 70% đầu và phần cuối, chèn `[... đã lược N ký tự ...]` ở giữa;
  - `src/core/agent.ts:777-778`: `cap` phần nhắc nhở thêm `[… đã cắt bớt]`;
  - `src/core/prompt/budget.ts:57`: `fit` thêm `[… phần còn lại đã được cắt bớt để vừa ngân sách ngữ cảnh]`.
- `src/core/tools/wrap.ts:13-20, 175-176`: `stampRef` chỉ áp nguồn `mcp:`, dòng báo nguồn chỉ khi `sourceEnvelope`. `memory_read` (nguồn `memory:`) không bị chèn thêm chữ trước kết quả.

## 3. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | |
| Module mới dưới `src/core/memory/`, lõi không import TUI | Đạt | Đạt | Code mới: `memory/notebook/history-blocks.ts`, `memory/redaction/`, `memory/store/presence.ts`. Lõi (`store.ts`, `agent.ts`) import từ `memory/redaction`, như `agent.ts` đã import `memory/binding` |
| Mỗi module một trách nhiệm | Đạt | Đạt | Tách khối / hỏi kho / che. Không có `utils.ts` |
| I/O có timeout; lỗi đọc không bị nuốt | Đạt | Đạt | Bộ kiểm dùng `timedRead` (hạn `DEADLINE_MS`). Lỗi thành `failed` kèm lý do, rồi tạm che và báo. Không bao giờ coi lỗi là "không có gì bị xoá" |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | |
| Windows và Ubuntu | Đạt | Đạt | Kho mở rồi đóng `close(true)` trong mỗi lần kiểm; test giả lỗi bằng `spyOn` |
| Model không có tool ghi; chỉ người dùng làm memory có hiệu lực | Đạt | Đạt | Không thêm tool. Che chỉ xảy ra sau thao tác xoá của người dùng hoặc khi kho cho biết mục không còn |
| Append-only; xoá là che | Đạt | Đạt | Dòng che là dòng nối thêm qua hàng ghi của spec 004; lượt chờ ghi nguyên văn |
| Quyết định không vào context | Đạt | Đạt | Quyết định không có khối; bộ kiểm không đọc bảng quyết định |
| Bộ kiểm đọc ngoài bảng chính sách | — | Có lý do | Bộ kiểm không trả nội dung ra ngoài, chỉ trả "còn" hay "không còn" (research R-7). Có test chứng minh kết quả không mang chữ nào của kho |

## 4. Cấu trúc file

```
src/core/memory/notebook/history-blocks.ts   MỚI. Tách khối, dòng nhắc, dòng trỏ, dòng lỗi, khối đã che từ hai
                                             kênh memory của một danh sách tin nhắn. Không đọc kho
src/core/memory/store/presence.ts            MỚI. Đọc bản (kể cả bản cũ) và mọi bí danh (kể cả đã thôi dùng)
                                             của các mục mà khối nhắc tới; chỉ dùng trong bộ kiểm che
src/core/memory/store/read-only.ts           Sửa: trạng thái "open" có thêm presence(refs)
src/core/memory/redaction/check.ts           MỚI. createRedactionCheck(file): mở kho chỉ đọc có hạn chờ, so
                                             nội dung bất biến, trả checked / missing / failed
src/core/memory/redaction/redact.ts          MỚI. Áp dòng che của file, che theo kết quả kiểm, tạm che;
                                             chữ thay khối; danh sách mục để ghi dòng che; câu báo
src/core/memory/notebook/render.ts           Sửa: chữ thay khối đã che; câu ngắn của memory_read
src/core/memory/notebook/session-ledger.ts   Sửa: chỉ còn cửa sổ chủ đề; bỏ sent/notified/pointers/xác nhận
src/core/memory/notebook/provider.ts         Sửa: recall dựa vào ctx.history; memory_read dựa vào ctx.messages
src/core/memory/notebook/read-tool.ts        Sửa: chuyển ngữ cảnh tool (messages) vào phần đọc
src/core/memory/notebook/admin.ts            Sửa: câu báo xoá (spec YC-012)
src/tui/dialogs/notebook.tsx                 Sửa (file của memory, spec 002 tạo): sau khi xoá thì che lịch sử
                                             đang mở
src/core/memory/types.ts                     [LÕI] MemoryContext.history
src/core/tools/types.ts                      [LÕI] ToolContext.messages
src/core/tools/registry.ts                   [LÕI] chuyển options.messages vào ToolContext
src/core/events.ts                           [LÕI] sự kiện "memory-redaction"
src/core/agent.ts                            [LÕI] RunOptions.redaction; che đầu lượt; bản xem cho recall và request
src/core/session/store.ts                    [LÕI] dòng che, mã lượt, appendRedaction, biên nhận, loadSession che
src/core/tools/session/history.ts            [LÕI] tool đọc phiên cũ đọc qua bộ đọc có che
src/core/runtime.ts                          [LÕI] tạo bộ kiểm che; truyền cho tool lịch sử
src/tui/session.ts                           [LÕI] mở lại phiên: mã lượt, che, dòng che, câu báo; báo dòng che
                                             chưa lưu; /export có che; che phiên đang mở khi xoá
src/tui/app.tsx                              [LÕI] truyền bộ kiểm cho vòng agent; nhận sự kiện che; che đầu compact()
test/memory-history-blocks.test.ts           MỚI
test/memory-store-presence.test.ts           MỚI
test/memory-redaction.test.ts                MỚI (bộ kiểm và che, thuần)
test/session-redact.test.ts                  MỚI (dòng che, mã lượt, bộ đọc, biên nhận)
test/memory-redaction-agent.test.ts          MỚI (vòng agent: Story 1, 2, 6 qua request đã gửi)
test/memory-notebook-recall.test.ts          Sửa: phần sổ phiên viết lại theo lịch sử
test/memory-notebook-read-tool.test.ts       Sửa: câu ngắn
test/memory-notebook-tui.test.tsx            Sửa: câu báo xoá; che khi xoá; mở lại; tạm che khi chạy tiếp
test/session-tools.test.ts, test/session-export.test.ts   Sửa: đọc có che, không ghi
```

## 5. Giao diện

```ts
// src/core/memory/notebook/history-blocks.ts
export type BlockKind = "thesis" | "lesson"
export interface HistoryBlock {
  kind: BlockKind
  /** Lesson number, or the thesis name exactly as in the label. */
  ref: number | string
  version: number
  channel: "reminder" | "tool"
  label: string
  /** The block's lines after the label, as sent. */
  lines: readonly string[]
  /** Where it sits: message index, content part index, character range in that part's text. */
  at: { message: number; part: number; start: number; end: number }
  /** False when one of the core's cut marks ends the block early (tool output cap, reminder cap, layer budget). */
  complete: boolean
}
export type HistoryLine =
  | { kind: "note"; key: string }
  | { kind: "pointer"; key: string }
  | { kind: "error"; reason: string }
  | { kind: "masked"; item: { kind: BlockKind; ref: number | string } }
export function memoryLines(messages: readonly ModelMessage[]): { blocks: HistoryBlock[]; lines: HistoryLine[] }

// src/core/memory/store/presence.ts
export type PresenceRef = { kind: "lesson"; id: number; version: number } | { kind: "thesis"; name: string; version: number }
/** Stored fields of the live versions that match, for content comparison only. */
export function readPresence(db: Database, refs: readonly PresenceRef[]): PresenceVersion[]

// src/core/memory/redaction/check.ts
/** research R-1. A cut block is never "mismatch": its content is not compared. */
export type BlockVerdict = "deleted" | "mismatch" | "live"
export type StoreCheck =
  | { state: "checked"; verdict: (block: HistoryBlock) => BlockVerdict }
  | { state: "missing" }
  | { state: "failed"; reason: string }
export interface RedactionCheck {
  readonly file: string
  check(blocks: readonly HistoryBlock[]): Promise<StoreCheck>
}
export function createRedactionCheck(file: string, opts?: { deadlineMs?: number; busyTimeoutMs?: number }): RedactionCheck

// src/core/memory/redaction/redact.ts
export type RedactItem = { kind: "lesson"; id: number; versions: number[] } | { kind: "thesis"; name: string; versions: number[] }
export interface Redaction {
  /** History with confirmed masks applied: what the open session keeps. */
  kept: ModelMessage[]
  /** What is sent: `kept` plus temporary masks (store missing or failed: every block; checked: "mismatch" blocks). */
  sent: ModelMessage[]
  /** Items the store confirmed deleted or absent ("deleted" only): one redact line in the session file. */
  record: RedactItem[]
  temporary?: { state: "missing" | "failed" | "mismatch"; reason?: string; blocks: number }
}
export function redactHistory(messages: readonly ModelMessage[], check: RedactionCheck | undefined): Promise<Redaction>
export function applyRedactLines(entries: …): …   // used by loadSession, pure
export function temporaryNotice(t: NonNullable<Redaction["temporary"]>): string

// src/core/memory/types.ts [LÕI]
export interface MemoryContext {
  sessionId: string
  /** The history this turn sends, before the user's message (masks applied). Absent: none. */
  history?: readonly ModelMessage[]
}

// src/core/tools/types.ts [LÕI]
export interface ToolContext { /* … */ messages?: readonly ModelMessage[] }

// src/core/events.ts [LÕI]
| { type: "memory-redaction"; kept: ModelMessage[]; record: RedactItem[]; temporary?: Redaction["temporary"] }

// src/core/agent.ts [LÕI]
interface RunOptions { /* … */ redaction?: RedactionCheck }

// src/core/session/store.ts [LÕI]
type SessionEntry = … | { type: "redact"; ts: string; items: RedactItem[] }   // turn_end gains turn?: number
interface SaveReceipt { /* … */ pendingRedactions: number }
class Session {
  static continue(summary: SessionSummary, lastTurn: number): Session
  appendRedaction(items: RedactItem[]): Promise<SaveReceipt>
}
interface LoadedSession { /* … */ lastTurn: number; redaction: { fromFile: number; confirmed: RedactItem[]; temporary?: Redaction["temporary"] } }
export function loadSession(id: string, opts?: { check?: RedactionCheck }): Promise<LoadedSession>

// src/core/tools/session/history.ts [LÕI]
export function sessionHistoryTools(deps?: { redaction?: RedactionCheck }): ToolDef[]

// src/tui/session.ts [LÕI]
export function recordRedaction(items: RedactItem[]): void
export async function redactOpen(runtime: Runtime): Promise<void>
```

**Ví dụ qua một lượt** (Story 2 kịch bản 1). Lịch sử có lượt 1 với kết quả `memory_read` là khối `[Memory · bài học · #7 · bản 1 · …]`, chứa `DANHDAU-7`. Người dùng xoá #7 lúc rảnh.

1. `notebook.tsx` xoá xong thì gọi `redactOpen`.
2. `memoryLines` tìm thấy một khối (lesson 7, bản 1, kênh tool).
3. Bộ kiểm mở kho: bài học 7 có `deleted_at`, nên khối đó là `deleted`. Nếu thay vào đó kho có #7 bản 1 chưa xoá mà nội dung khác (kho tạo lại), kết quả là `mismatch`: `kept` giữ nguyên, `sent` tạm che, `record` rỗng.
4. `redactHistory` trả:
   - `kept`: khối thay bằng `[Memory · bài học #7 đã bị người dùng xoá]`;
   - `record`: `[{kind:"lesson",id:7,versions:[1]}]`.
5. Giao diện đặt `state.history = kept`. `appendRedaction` xếp dòng che sau các lượt đang chờ; biên nhận báo như spec 004.
6. Lượt 2 "Còn ACB thì sao?":
   - vòng agent chạy lại `redactHistory`, lần này không còn gì để che (`record` rỗng);
   - `recall` nhận `history` có dòng đã che nhưng chưa có dòng nhắc xoá, nên trả `[Memory · nhắc] Bài học #7 đã bị người dùng xoá; …`;
   - request không chứa `DANHDAU-7`.

## 6. Điểm đụng lõi (người dùng xác nhận từng dòng)

| # | File [LÕI] | Sửa gì | Vì sao | Cỡ | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/core/memory/types.ts` | Thêm `history?: readonly ModelMessage[]` vào `MemoryContext` (trường không bắt buộc, provider khác bỏ qua). Sửa chú thích hợp đồng | YC-001, YC-003: memory quyết định theo lịch sử thật, không theo RAM | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 2 | `src/core/tools/types.ts` | Thêm `messages?: readonly ModelMessage[]` vào `ToolContext` | YC-017: `memory_read` biết phần model thấy ở bước này | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 3 | `src/core/tools/registry.ts` | `execute` nhận `options.messages` của AI SDK và chuyển vào `ToolContext` (một dòng) | Như dòng 2 | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 4 | `src/core/events.ts` | Thêm sự kiện `memory-redaction` (`kept`, `record`, `temporary`) | Vòng agent báo giao diện thay lịch sử và xếp dòng che, không để lõi chạm trạng thái giao diện | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 5 | `src/core/agent.ts` | `RunOptions.redaction`. Ngay sau `bindTurn`, trước hook và `recall`: gọi `redactHistory`; phát sự kiện khi có `record` hoặc `temporary`; dùng `sent` thay `opts.history` cho phần còn lại của lượt (request, các lần gửi lại của stop gate). `recall` nhận `{ sessionId, history: sent }`. Không truyền gì cho agent con | YC-005, YC-006, YC-010; R-4 (sau `bindTurn` để lượt bị hoãn không báo tạm che) | Vừa | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 6 | `src/core/session/store.ts` | Loại dòng `redact`; trường `turn` ở `turn_end` (cạnh `dataGaps`, không đổi đường `dataGaps`); `Session.appendRedaction` (phần hàng `redact`, cùng luật ngừng ghi và cắt lại của spec 004); `SaveReceipt.pendingRedactions` và đếm `pendingCompactions` theo loại; `loadSession(id, { check })`: áp dòng che theo vị trí (kể cả phần lịch sử của dòng nén), hỏi kho, trả `lastTurn` và `redaction`; `Session.continue(summary, lastTurn)` | YC-007, YC-008, YC-014–YC-016, YC-018; data-model §1, §2 | Vừa | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 7 | `src/core/tools/session/history.ts` | `sessionHistoryTools({ redaction })`; `session_get` đọc bằng `loadSession(id, { check })`, kho vắng hoặc lỗi thì tạm che kết quả; không ghi file | YC-008, YC-009, YC-010 | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 8 | `src/core/runtime.ts` | `createRedactionCheck(path.join(home, "memory.db"))` cạnh bộ đọc ràng buộc; `Runtime.redaction`; truyền cho `sessionHistoryTools` | Một bộ kiểm cho mọi đường, chạy cả khi sổ tắt | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 9 | `src/tui/session.ts` | Mở lại: `loadSession(id, { check: runtime.redaction })`, `Session.continue(summary, lastTurn)`, xếp dòng che cho `confirmed`, câu "Đã che N mục memory đã xoá trong phiên này" hoặc câu tạm che (chỉ khi có khối). `recordRedaction` và `receiptLines` báo "Chưa lưu được dòng che…" (YC-013). `/export`, `/save` đọc có che. `redactOpen(runtime)` cho đường xoá | YC-008, YC-009, YC-010, YC-013, YC-015 | Vừa | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 10 | `src/tui/app.tsx` | Truyền `redaction: runtime.redaction` vào `runAgent`. Nhận `memory-redaction`: đặt `state.history = kept`, `recordRedaction(record)`, báo tạm che một lần cho mỗi trạng thái. Đầu `compact()` (cả nén khi rảnh): `redactHistory(state.history, …)`, lưu phần xác nhận (`kept`, `recordRedaction`), đưa `sent` cho `compactHistory`. Vì nén chỉ thấy `sent`, phần lịch sử giữ lại sau nén mang chữ tạm che ở chỗ khối "khác nội dung" hay khối của kho vắng. Đây không phải dòng che; khối còn sống được sổ chèn lại ở bản hiện hành khi chủ đề còn tập trung. **Không sửa `compact.ts`** | YC-005; request tóm tắt không mang nội dung đã xoá | Nhỏ | đã xác nhận 06/11; `blocked-by-core` tới khi chủ repo duyệt |
| 11 | `src/tui/dialogs/notebook.tsx` (file của memory, spec 002 tạo, nằm trong `src/tui`) | Sau khi xoá thành công một luận điểm hoặc bài học: gọi `redactOpen(runtime)` chỉ khi không có lượt đang chạy **và** không có lần nén đang chạy, kể cả nén khi rảnh (`state.streaming`, `state.compacting`). Đang chạy hay đang nén thì không làm gì; bước che đầu lượt sau làm | Story 4 kịch bản 3: dòng che được ghi lúc xoá. Lần nén đang chạy giữ bản lịch sử cũ và khi xong sẽ đặt lịch sử bằng kết quả nén; che lúc đó thì mất phần che, và lượt sau có thể ghi dòng che lần hai (research R-4) | Nhỏ | đã xác nhận 06/11 |

**Chỗ chạm phần `main` mới (gộp 06/11):**
- `dataGaps`: dòng 6 thêm `turn` vào cùng đối tượng `turn_end` mà `appendTurn` đang dựng (cạnh `...(info.dataGaps ? …)`). Đường `dataGaps` từ `app.tsx` qua `recordTurn` giữ nguyên. Test ba trường và `dataGaps` hiện có phải xanh nguyên.
- `compact.ts`: **không đụng**. Mẫu tóm tắt, mục "Lỗi và dữ liệu còn thiếu", cách dọn kết quả lỗi của `main` giữ nguyên. Dòng 10 chỉ đổi danh sách tin nhắn đưa vào hàm nén (bản đã che), ở `app.tsx`.
- Bộ chạy eval (`scripts/eval/runner.ts:219`, `scripts/dev/desk-eval.ts:86`): gọi `runAgent` không có `redaction` (cũng không có `constraints`), nên không che. Lịch sử eval không có khối memory. **Giữ nguyên**, ghi vào mô tả PR.
- `loop/stop-gate.ts`: các lần gửi lại trong cùng lượt dùng cùng bản `sent` của đầu lượt (dòng 5). Không sửa file này.
- `subagents/manager.ts`, `chat.ts`: không truyền `redaction`. Agent con không có lịch sử của agent chính.

## 7. Cách kiểm

```
C:\Users\Admin\anaconda3\Scripts\bun.exe --version                    (1.4.2)
C:\Users\Admin\anaconda3\Scripts\bun.exe install --frozen-lockfile     (khi node_modules lệch)
C:\Users\Admin\anaconda3\Scripts\bun.exe run typecheck
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-history-blocks.test.ts test/memory-store-presence.test.ts test/memory-redaction.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/session-redact.test.ts test/session.test.ts test/session-write.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-redaction-agent.test.ts test/memory-notebook-recall.test.ts test/memory-notebook-read-tool.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-notebook-tui.test.tsx test/session-tools.test.ts test/session-export.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test                           (toàn bộ; mốc trước khi sửa: 1.623 đạt, 3 bỏ qua)
```

**Đối chiếu TC → test:**

| TC | Test |
| --- | --- |
| TC-001, TC-002 | `memory-redaction-agent`: chuỗi lượt; dựng provider mới (mô phỏng khởi động lại) với cùng lịch sử, so phần nhắc nhở từng byte |
| TC-003 | `memory-redaction-agent`: Story 2 kịch bản 1–8, tìm `DANHDAU-7` trong `bodies`; kịch bản 7 dùng một tool dữ liệu giả xoá #7 khi đang chạy |
| TC-004 | `session-redact` (bộ đọc), `session-tools`, `session-export`, `memory-notebook-tui` (mở lại) |
| TC-005 | `memory-history-blocks`: nhãn giả trong chữ gõ, kết quả tool khác, câu trả lời model |
| TC-006 | `session-redact`: dòng che ghi lỗi rồi bù, thứ tự sau lượt chờ, ngừng ghi, so byte các dòng cũ |
| TC-007 | `memory-redaction` (missing, failed, ca im lặng), `memory-notebook-tui` (chuyển file kho đi rồi trả về; chọn "Chạy lượt này không có ràng buộc") |
| TC-008 | `memory-notebook-tui`: câu báo |
| TC-009 | `session-redact`: mã lượt năm ca |
| TC-010 | `memory-notebook-read-tool`, `memory-redaction-agent` (kết quả bị dọn giữa lượt) |
| TC-011 | `session-redact`: phiên mẫu cũ; bộ đọc bản trước bỏ qua dòng mới (đọc bằng một bộ đọc chỉ biết các loại cũ) |
| TC-012 | `memory-redaction`: dòng che, `record`, kết quả kiểm không mang chuỗi đánh dấu của quyết định |
| TC-013 | typecheck, toàn bộ `bun test`, CI |

**Đối chiếu YC → việc** (`tasks.md`):

| YC | Việc |
| --- | --- |
| YC-001 | T002, T003, T011, T014 |
| YC-002 | T002, T003 (nhãn giả không tính) |
| YC-003, YC-004 | T015, T016 |
| YC-005, YC-006 | T006, T007, T010, T014, T022, T023 |
| YC-007, YC-014, YC-015, YC-016, YC-018 | T008, T009 |
| YC-008, YC-009 | T008, T009, T018, T020, T021 |
| YC-010 | T006, T007, T010, T018, T021, T022 |
| YC-011 | T004–T007 |
| YC-012 | T018, T023 |
| YC-013 | T008, T018, T021 |
| YC-017 | T010, T017 |
| YC-019 | T004 (không đọc quyết định), T006 (TC-012) |

**Kiểm tay (người dùng, sau khi code xong):** xoá một bài học đã đọc trong phiên, hỏi tiếp, thoát, mở lại phiên, `/export`. Chỗ khối cũ chỉ còn dòng "đã bị người dùng xoá".

## 8. Theo dõi độ phức tạp

| Vi phạm | Vì sao cần | Phương án đơn giản hơn bị loại vì |
| --- | --- | --- |
| Bộ kiểm che đọc kho ngoài bảng chính sách | Phải đọc bản luận điểm cũ và bí danh đã thôi dùng để biết khối còn hay không (R-1) | Thêm hành động vào bảng của vai model: bảng chặn nội dung tới model, còn bộ kiểm không đưa nội dung nào đi |
| Lõi import `memory/redaction` từ `store.ts` | Bộ đọc phiên phải che ở mọi đường đọc (YC-008); để mỗi nơi gọi tự che thì dễ quên một đường | Mỗi nơi gọi tự che: ba đường đọc, dễ sót (đúng loại lỗi H5) |
