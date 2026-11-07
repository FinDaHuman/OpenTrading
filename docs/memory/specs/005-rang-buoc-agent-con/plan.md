# Plan 005: Ràng buộc tới agent con và hồ sơ nhà đầu tư

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (qua cổng 2 ngày 05/11/2026; người dùng xác nhận 14 dòng §6). Đã code xong, chờ cổng 3 |
| **Ngày** | 05/11/2026 |
| **Spec** | [spec.md](spec.md) |
| **Nhánh** | `feat/memory` (viết trên `2436f82`, sau khi gộp `main`) |

## 1. Tóm tắt

Mỗi lượt của agent chính và agent con bắt đầu bằng một bước **ràng buộc lượt** (đọc hồ sơ, đọc ràng buộc), chạy trước khi resolve model, trước hook và trước request đầu tiên.

**Đọc ràng buộc.** Ràng buộc được đọc bằng một bộ đọc riêng của memory. Bộ đọc này độc lập với lựa chọn memory trong `/config`:
- mỗi lần đọc mở `memory.db` ở chế độ không tạo file, không nâng lược đồ; đọc qua bảng chính sách đúng vai ("agent chính" hoặc "agent con") rồi đóng ngay;
- chưa có file thì là "chưa có", không tạo file.

**Đọc hồ sơ.** Hồ sơ `INVESTOR.md` được đọc nghiêm: phân biệt "chưa có" với "đọc lỗi", có hạn chờ, thử lại ngắn khi lỗi thoáng qua. Trước khi gửi, bỏ chú thích và các dòng trùng nguyên văn dòng ví dụ của mẫu cũ, rồi escape.

**Khi đọc lỗi.** Vòng agent ném một lỗi "hoãn lượt" trước khi gửi gì:
- giao diện hiện thẻ ba lựa chọn;
- dòng lệnh in lỗi rồi thoát với mã lỗi;
- agent con không chạy, agent chính nhận lý do.

**Lựa chọn của lượt** ("chạy không có …") do giao diện truyền vào vòng agent, và qua runtime tới agent con khởi động trong lượt đó.

**Hai khối mới ở phần hệ thống.** Ràng buộc thành một khối riêng `<rang_buoc>`, không bao giờ bị cắt. Sổ ghi nhớ thôi in ràng buộc ở phần của mình (không lặp). Khi người dùng chọn chạy tiếp, một khối `<nguon_chua_nap>` báo cho model nguồn nào không nạp được.

## 2. Bối cảnh kỹ thuật

| Mục | Giá trị |
| --- | --- |
| Runtime | Bun 1.4.2 (`C:\Users\Admin\anaconda3\Scripts\bun.exe`), TypeScript 7.0.2 strict, ESM |
| Lưu trữ | `bun:sqlite` (đọc `memory.db` sẵn có, không đổi lược đồ); `INVESTOR.md` chỉ đọc |
| Kiểm cấu trúc | Không cần schema mới. Không dùng `zod` cho phần đọc này |
| Model | `ai` 7.0.159; test bằng `fetch` giả (như `test/memory-notebook-agent.test.ts`) |
| Giao diện | OpenTUI 0.8.1 + SolidJS |
| Test | `bun:test`, `OPENTRADING_HOME` tạm, không gọi mạng; giả lập lỗi đĩa bằng đối tượng thao tác đĩa + `spyOn` (mẫu spec 004) |
| Nền tảng | Windows và Ubuntu (CI chạy cả hai) |
| Ràng buộc khác | Không thêm dependency. Không đổi lược đồ kho. Không sửa `FileMemory`, `compact.ts`, `loop/stop-gate.ts`, `idle-compact.ts`, `events.ts`, `config.ts` |

**Đã kiểm trong code:**

- **Đọc hồ sơ.** `loadProfile` nuốt mọi lỗi đọc. Nó chỉ có một chỗ gọi: `assembleFor` trong `agent.ts`.
- **Ba đường đi qua `assembleFor`:**
  - lượt trả lời (`runAgent` → `prepare`);
  - nén hội thoại (`summarizeConversation` → `prepare`), dùng cho nén tay, tự nén và nén khi rảnh (phần `main` mới thêm);
  - xem trước `/context` (`previewContext`).
- **Đặt tiêu đề phiên** dùng prompt riêng, không qua `assembleFor`.
- **Thứ tự đầu `runAgent`** (`main` viết lại): resolve model → ghi lời người dùng cho chế độ tự động → hook `user-prompt` → `recall` → `prepare`. Vòng stop gate chạy sau đó và dùng lại đúng `system` của lượt cho mọi lần chạy lại.
- **Lỗi trước khi gửi:** `runAgent` ném lỗi trước khi phát sự kiện nào (lỗi cấu hình). Ba nơi đã xử lý sẵn đường này:
  - giao diện: nhánh `catch` của `sendTurn`;
  - dòng lệnh: `fail()` của `chat.ts`, thoát mã 1;
  - agent con: nhánh `catch` của `manager.ts` ghi `run.error`. Tool giao việc ném "Subagent lỗi: …" về cho agent chính.
- **`describeError`** trả nguyên thông điệp khi lỗi là `ChatSetupError`.
- **Agent con.** Mọi lượt của agent con đi qua một lời gọi `runAgent({ role: "subagent" })` trong `manager.ts`. Ba đường khởi động:
  - giao việc mới (`start`);
  - giao tiếp việc (`continue`, có thể dựng lại từ sidechain);
  - ultradesk (`desk/engine.ts` gọi `start`).
- **Tiền lệ trạng thái theo lượt:** `runtime.deskOptIn` do giao diện đặt trước mỗi lượt; tool đọc qua hàm `() => runtime.deskOptIn`.
- **Mở kho.** `openMemoryStore` luôn tạo file và chạy nâng lược đồ. Bảng chính sách đã có luật "agent con · phần hệ thống · ràng buộc" (spec 001).
- **Sổ ghi nhớ hiện in ràng buộc** trong `memory_policy` qua `renderInstructions`. Kho lỗi thì in câu dặn model (`UNLOADED_NOTE`).
- **Hàm bọc thẻ** `tag()` của phần lắp request không escape. Lớp hồ sơ bị cắt theo ngân sách `investor_profile`.

## 3. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | |
| Module mới dưới `src/core/memory/`, lõi không import TUI | Đạt | Đạt | Phần mới của memory: `store/read-only.ts`, `binding/*`. Lõi (`agent.ts`) import `binding/bind.ts`; TUI import lõi, không chiều ngược lại |
| Mỗi module một trách nhiệm; không `utils.ts`, `manager.ts` | Đạt | Đạt | Mở kho chỉ đọc · đọc ràng buộc · chữ hiện ra · quyết định của lượt: bốn file riêng |
| I/O có timeout; lỗi đọc không bị nuốt | Trượt (hiện tại) | Đạt | Đây chính là T7. Sau thiết kế: mỗi nguồn có hạn chờ 2 giây, thử lại thoáng qua dưới 1 giây; lỗi thành "đọc lỗi" kèm lý do, không thành "chưa có". Đường nén hội thoại và `/context` đọc kiểu dễ dãi **có chủ ý** (xem §8) |
| Lỗi upstream đổi một lần ở biên | Đạt | Đạt | Lỗi SQLite → `MemoryStoreError` ở `store/errors.ts` như cũ; lỗi đĩa của hồ sơ → lý do tiếng Việt chỉ ở `profile.ts` |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | `fetch` giả đếm request; thư mục dữ liệu tạm; dòng lệnh thử bằng tiến trình con với `OPENTRADING_HOME` tạm, hoãn trước khi resolve model nên không cần mạng |
| Chạy được trên Windows và Ubuntu | Đạt | Đạt | Đóng kết nối kho ngay sau mỗi lần đọc (`close(true)`); lỗi quyền giả lập bằng `spyOn`, không dùng `chmod`; "đọc lỗi" thật đa nền tảng bằng cách đặt `INVESTOR.md` là thư mục; CRLF trong `INVESTOR.md` |
| Model không có tool ghi; chỉ người dùng làm memory có hiệu lực | Đạt | Đạt | Không thêm tool. Bộ đọc không có đường ghi; mở kho không nâng lược đồ |
| Quyền do code quyết định | Đạt | Đạt | Lựa chọn "chạy không có …" chỉ do giao diện truyền theo nút người dùng bấm; không lưu; model và agent con không có đường nào đặt nó |
| Escape nội dung vào prompt | Trượt (hồ sơ) | Đạt | Hồ sơ nay escape `&`, `<`, `>` như memory; ràng buộc giữ cách escape của spec 002 |
| Ràng buộc không bao giờ bị cắt | Đạt (chỉ khi sổ bật) | Đạt | Khối riêng, ngân sách "không cắt"; không vừa ngữ cảnh thì không gửi |
| Bí mật | Đạt | Đạt | Câu báo chỉ có đường dẫn và loại lỗi, không chép nội dung file |

## 4. Cấu trúc file

```
src/core/memory/store/read-only.ts      mở memory.db để đọc: không tạo file, không nâng lược đồ; trả cổng đọc theo chính sách
src/core/memory/binding/constraints.ts  bộ đọc ràng buộc theo vai: dò file (có hạn chờ), mở, đọc, đóng; thử lại thoáng qua
src/core/memory/binding/render.ts       chữ: khối ràng buộc, dòng "không nạp được", câu hoãn (kèm lối ra), nhãn nút, dòng "N ràng buộc vẫn áp dụng"
src/core/memory/binding/bind.ts         ràng buộc của một lượt: đọc hai nguồn, áp lựa chọn của lượt, kiểm vừa ngữ cảnh, lỗi hoãn lượt
src/core/memory/notebook/render.ts      renderInstructions chỉ còn chỉ dẫn và cách trình bày; bỏ UNLOADED_NOTE
src/core/memory/notebook/provider.ts    instructions() không in ràng buộc; câu chỉ dẫn dự phòng
prompts/memory.md                       câu đầu trỏ tới khối ràng buộc thay cho "bên dưới"

src/core/profile.ts                     [LÕI] đọc nghiêm, hạn chờ, thử lại; lọc chú thích, dòng mẫu cũ, mục trống; mẫu mới
src/core/prompt/assemble.ts             [LÕI] hai lớp rang_buoc, nguon_chua_nap; escape hồ sơ; hàm lớp danh tính dùng chung
src/core/prompt/budget.ts               [LÕI] khoá ngân sách "constraints" không cắt
src/core/agent.ts                       [LÕI] RunOptions thêm constraints, waive; bước ràng buộc ở đầu runAgent; nén và /context đọc dễ dãi
src/core/runtime.ts                     [LÕI] runtime.constraints, runtime.turnWaiver; truyền cho manager
src/core/subagents/manager.ts           [LÕI] nhận bộ đọc và lựa chọn của lượt; truyền vào mọi runAgent của agent con
src/core/chat.ts                        [LÕI] truyền bộ đọc ràng buộc vào runAgent
src/tui/state.ts                        [LÕI] trường turnHold; blocked() tính thẻ hoãn
src/tui/hold-card.tsx                   [LÕI, file mới] thẻ hoãn lượt: câu báo, ba lựa chọn, Esc
src/tui/app.tsx                         [LÕI] truyền bộ đọc, lựa chọn; xử lý hoãn: thẻ, thử lại, chạy tiếp, huỷ; nén truyền bộ đọc; câu báo sổ tắt
src/tui/dialogs/config.tsx              [LÕI] màn Memory: dòng "N ràng buộc vẫn áp dụng…" khi sổ tắt
src/tui/dialogs/notebook-form/open.ts   [LÕI] câu báo "sổ đang tắt" thêm dòng ràng buộc vẫn áp dụng
src/tui/dialogs/context.tsx             [LÕI] /context truyền bộ đọc; tên hai lớp mới

test/profile-read.test.ts               mới: chưa có / đọc lỗi / thử lại / hạn chờ / giải mã; lọc mẫu; mẫu mới
test/memory-store-read-only.test.ts     mới: không tạo file; kho rỗng; lược đồ mới hơn, không phải kho, hỏng; giữ từng byte; bận
test/memory-binding.test.ts             mới: bộ đọc theo vai; chữ khối; câu hoãn và lối ra; nhãn nút; kiểm vừa ngữ cảnh
test/memory-binding-agent.test.ts       mới: request agent chính ba lựa chọn memory; agent con mọi đường; hoãn; lựa chọn của lượt
test/turn-hold-tui.test.tsx             mới: thẻ hoãn trên giao diện; /config; câu báo sổ tắt; /profile
test/chat-cli.test.ts                   mới: lệnh thử provider với hồ sơ đọc lỗi
test/fixtures/scripts/hold-memory-db.ts mới: tiến trình phụ giữ khoá ghi kho trong thời gian ngắn
test/memory-notebook-*.test.ts          sửa theo hành vi mới (ràng buộc ở khối riêng; kho lỗi thì hoãn)
test/memory-notebook-agent.test.ts      thêm đường "agent con" vào test duyệt bảng chính sách
```

Mọi file **[LÕI]** là file của chủ repo, kể cả file mới trong `src/tui/`.

## 5. Giao diện

```ts
// src/core/memory/store/read-only.ts
export type ReadOnlyStore =
  | { state: "missing" }                          // no file: never created here
  | { state: "empty" }                            // a file with no tables (an interrupted first open)
  | { state: "open"; gate: MemoryGate; close(): void }
/** Throws MemoryStoreError (newer_schema, not_a_store, corrupt, busy, open_failed). Never writes, never migrates. */
export function openStoreReadOnly(file: string, opts?: { busyTimeoutMs?: number }): ReadOnlyStore

// src/core/memory/binding/constraints.ts
export interface ConstraintLine { id: number; version: number; text: string }   // moved from notebook/render.ts
export interface SourceFailure {
  file: string
  /** Short Vietnamese reason, no file content. */
  reason: string
  /** newer_schema, not_a_store, corrupt: will not pass on its own (the message then shows a way out). */
  lasting: boolean
  newerSchema: boolean
}
export type ConstraintRead =
  | { state: "none" }
  | { state: "loaded"; lines: ConstraintLine[] }
  | { state: "failed"; failure: SourceFailure }
export interface ConstraintReader {
  readonly file: string
  read(role: "main_agent" | "subagent"): Promise<ConstraintRead>
}
export interface ConstraintReaderOptions { deadlineMs?: number; retryWindowMs?: number; busyTimeoutMs?: number }
export function createConstraintReader(file: string, opts?: ConstraintReaderOptions): ConstraintReader
/** Test seam (spyOn): the async look at the file before SQLite opens it, so a hung drive times out. */
export const constraintDisk: { probe(file: string): Promise<"missing" | "present"> }

// src/core/profile.ts  [LÕI]
export type ProfileRead =
  | { state: "none" }
  | { state: "loaded"; text: string }        // filtered, not yet escaped
  | { state: "failed"; file: string; reason: string }
export function readProfile(opts?: { file?: string; deadlineMs?: number; retryWindowMs?: number }): Promise<ProfileRead>
/** Comments, lines equal to an old template example, empty sections out; undefined when nothing is left. */
export function profileForPrompt(raw: string): string | undefined
export const OLD_TEMPLATE_EXAMPLES: readonly string[]                 // the 9 example lines of the old template
export const profileDisk: { readFile(file: string): Promise<Uint8Array> }   // test seam (spyOn)
export function ensureProfile(): Promise<{ file: string; created: boolean }>   // unchanged contract, new template

// src/core/memory/binding/bind.ts
export type BoundSource = "profile" | "constraints"
/** The user's choice for one turn: run without the sources that failed. Never stored. */
export interface Waiver { profile?: boolean; constraints?: boolean }
export type TurnHold =
  | { kind: "unreadable"; profile?: SourceFailure; constraints?: SourceFailure }
  | { kind: "too-large"; model: string }
export class TurnHeldError extends ChatSetupError {
  constructor(readonly hold: TurnHold, readonly role: "main" | "subagent")
}
export interface Bound {
  /** Filtered and escaped profile text (main agent only). */
  profile?: string
  /** The rendered <rang_buoc> body; undefined when there is no constraint. */
  constraints?: string
  /** The rendered <nguon_chua_nap> body when the user chose to run without a failed source. */
  unread?: string
}
/** Reads both sources for a turn; throws TurnHeldError when a source failed and was not waived. */
export function bindTurn(input: { role: "main" | "subagent"; constraints?: ConstraintReader; waive?: Waiver }): Promise<Bound>
/** Compaction and /context: a failed source is left out, never held (not an answer turn). */
export function bindLenient(input: { role: "main" | "subagent"; constraints?: ConstraintReader }): Promise<Bound>
/** Throws TurnHeldError("too-large") when the minimal system part plus the constraints cannot fit the model. */
export function checkFits(bound: Bound, role: "main" | "subagent", target: TargetLike, promptsDir?: string): void

// src/core/memory/binding/render.ts
export const CONSTRAINT_HEADING: string           // "Ràng buộc của người dùng (người dùng tự ghi, luôn áp dụng):"
export function renderConstraints(lines: readonly ConstraintLine[]): string | undefined
export function unreadNote(sources: readonly BoundSource[]): string
export function holdMessage(hold: TurnHold, role: "main" | "subagent"): string
export function waiveLabel(sources: readonly BoundSource[]): string
export function stillApplyLine(count: number): string

// src/core/agent.ts  [LÕI]  RunOptions thêm
constraints?: ConstraintReader
waive?: Waiver

// src/core/runtime.ts  [LÕI]  Runtime thêm
constraints: ConstraintReader
/** The waiver of the main turn now running (set by the UI per turn, like deskOptIn). */
turnWaiver?: Waiver

// src/core/subagents/manager.ts  [LÕI]  ManagerDeps thêm
constraints?: ConstraintReader
waiver?: () => Waiver | undefined

// src/core/prompt/assemble.ts  [LÕI]  AssembleInput thêm
constraints?: string
unread?: string
export function identityLayer(role: "main" | "subagent" | undefined, promptsDir?: string): string | undefined

// src/tui/state.ts  [LÕI]
turnHold: undefined as { text: string; waive: string; choose(c: "retry" | "waive" | "cancel"): void } | undefined
```

## 6. Điểm đụng lõi

Người dùng xác nhận **từng dòng** trước khi code. Mọi dòng là `blocked-by-core` tới khi chủ repo duyệt trong PR. Cột "Phần `main` mới" nói rõ dòng nào chạm code `main` vừa thêm.

| # | File [LÕI] | Sửa gì | Vì sao | Phần `main` mới | Cỡ |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/core/profile.ts` | Thay `loadProfile` (nuốt lỗi) bằng `readProfile`. `readProfile` trả "chưa có", "đã đọc" hoặc "đọc lỗi" kèm lý do. Nó có hạn chờ 2 giây, thử lại lỗi thoáng qua trong dưới 1 giây, và từ chối nội dung không phải UTF-8. Thêm `profileForPrompt`: bỏ chú thích, bỏ dòng trùng nguyên văn 9 dòng ví dụ của mẫu cũ, bỏ mục trống; còn lại toàn tiêu đề thì coi như chưa có. Mẫu mới: ví dụ nằm trong chú thích; mục "Ràng buộc" chỉ còn chú thích hướng dẫn `/nho`, `/memory`. `ensureProfile` giữ nguyên hợp đồng | T7, T8: YC-013, YC-019, YC-020, YC-022 tới YC-026 | Không | Vừa (khoảng 90 dòng) |
| 2 | `src/core/prompt/assemble.ts` | Thêm hai lớp phần hệ thống cho cả hai vai: `rang_buoc` (ràng buộc, không cắt) và `nguon_chua_nap` (dòng báo model khi người dùng chọn chạy tiếp). Hồ sơ escape `&`, `<`, `>` trước khi bọc. Tách lớp danh tính (agent chính, agent con) ra hàm `identityLayer` để bước kiểm vừa ngữ cảnh dùng chung | YC-001, YC-007, YC-011, YC-012, YC-016, YC-030 | Không | Nhỏ (khoảng 20 dòng) |
| 3 | `src/core/prompt/budget.ts` | Thêm khoá `constraints` với cả ba hạng "không cắt" | Ràng buộc không bao giờ bị cắt (YC-012); khoá tường minh để người đọc thấy | Không | Nhỏ (1 dòng) |
| 4 | `src/core/agent.ts` | `RunOptions` thêm `constraints`, `waive`. Đầu `runAgent` gọi `bindTurn` trước khi resolve model, trước nhật ký chế độ tự động và hook `user-prompt`; đọc lỗi mà không có lựa chọn thì ném `TurnHeldError`. Sau khi resolve model gọi `checkFits`. Kết quả truyền vào `prepare` → `assembleFor`. `summarizeConversation`, `previewContext` dùng `bindLenient`. Bỏ import `loadProfile` | YC-001, YC-005, YC-006, YC-012, YC-015 tới YC-017. Đọc trước hook để lượt bị hoãn không chạy hook hai lần khi thử lại | **Có.** Chỉ sửa phần mở đầu của vòng lượt `main` viết lại (trước hook). Vòng stop gate không đổi; các lần chạy lại của nó dùng đúng `system` của lượt, nên ràng buộc giữ nguyên trong một lượt. Nén hội thoại (cả nén khi rảnh) đọc dễ dãi: không bao giờ hiện thẻ hoãn khi người dùng vắng | Vừa (khoảng 30 dòng) |
| 5 | `src/core/runtime.ts` | Tạo `runtime.constraints = createConstraintReader(<home>/memory.db)` độc lập với `createMemory`; thêm `runtime.turnWaiver`. `SubagentManager` nhận `constraints` và `waiver: () => runtime.turnWaiver` (cùng kiểu `deskOptIn`) | YC-003, YC-006, YC-009, YC-016 | Không | Nhỏ (khoảng 6 dòng) |
| 6 | `src/core/subagents/manager.ts` | `ManagerDeps` thêm `constraints`, `waiver`. `start` và `continue` giữ lựa chọn của lượt lúc được gọi, cho lượt đầu của lần chạy đó; lượt nhận tin gửi thêm đọc lựa chọn hiện hành. Lời gọi `runAgent` truyền `constraints`, `waive` | YC-001 tới YC-003, YC-016, YC-017. Ultradesk đi qua `start` nên không sửa `desk/` | Không (`childRegistry`, `brief.ts` của `main` không đụng) | Nhỏ (khoảng 10 dòng) |
| 7 | `src/core/chat.ts` | Lời gọi `runAgent` truyền `constraints: runtime.constraints`. Lỗi hoãn đi qua `fail()` sẵn có: in câu báo, thoát mã 1 | YC-006, YC-021 | Không | Nhỏ (1 dòng) |
| 8 | `src/tui/state.ts` | Trường `turnHold`; `blocked()` tính cả thẻ hoãn (bàn phím thuộc thẻ) | YC-015 | Không | Nhỏ (3 dòng) |
| 9 | `src/tui/hold-card.tsx` (file mới) | Thẻ hoãn lượt theo khuôn thẻ duyệt ultradesk: câu báo, ba nút "Thử lại", "Chạy lượt này không có …", "Huỷ"; Esc là Huỷ | YC-015, YC-016 | Không | Vừa (khoảng 70 dòng) |
| 10 | `src/tui/app.tsx` | (a) `sendTurn` truyền `constraints`, `waive`; đặt và xoá `runtime.turnWaiver` quanh lượt; bắt `TurnHeldError` trả về "bị hoãn". Lượt bị hoãn gửi thông báo cửa sổ (`attention`) bằng **chính câu hoãn**, không lấy dòng cuối trên màn hình (dòng đó là câu trả lời của lượt trước). (b) `send` hiện thẻ và lặp: thử lại; chạy tiếp với lựa chọn; huỷ thì bỏ dòng câu hỏi khỏi màn hình và trả về ô nhập qua cùng hàm trả hàng chờ (`returnQueue` → `pullBack`), **một lần**: câu bị hoãn (chữ và ảnh) đứng **đầu** danh sách, sau đó các tin gõ thêm đang chờ, cuối cùng chữ đang có trong ô (giữ nguyên). Lượt thông báo agent con thì trả thông báo về hàng chờ. (c) Không vừa ngữ cảnh: dòng lỗi, chữ về ô nhập (cùng cách như huỷ), không thẻ. (d) Lời gọi nén truyền `constraints`. (e) Hai chỗ báo "sổ đang tắt" thêm dòng ràng buộc vẫn áp dụng. (f) Hiện thẻ; thẻ hoãn có trong `owner()` (cạnh `state.deskApproval`), để ô nhập ẩn và Esc chuyển cho thẻ như các thẻ duyệt khác | YC-006, YC-015, YC-016, YC-027 | **Có.** Nén khi rảnh: không sửa `idleCompact`; nó đã chờ khi còn `inflight`, và `inflight` giữ nguyên trong lúc thẻ mở nên không nén khi đang chờ người dùng chọn. Lời gọi `recordTurn` mang `gate` của `main` không đổi. Lượt bị hoãn không phát `done` nên không ghi gì vào file phiên | Vừa (khoảng 60 dòng) |
| 11 | `src/tui/dialogs/config.tsx` | Màn Memory: khi lựa chọn khác "Sổ ghi nhớ" và kho có ràng buộc thì hiện "N ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ. Bật Sổ ghi nhớ để xem, sửa hoặc xoá."; đọc lỗi thì hiện lý do | YC-027 | Không (dòng lưu `saveConfig((c) => …)` sau gộp giữ nguyên) | Nhỏ (khoảng 12 dòng) |
| 12 | `src/tui/dialogs/notebook-form/open.ts` (file của spec 003) | Hàm ghép câu báo "sổ đang tắt" với dòng "N ràng buộc vẫn áp dụng…" (đọc bất đồng bộ qua bộ đọc). Phiên code chọn cách đọc, với ba điều kiện: chữ đã gõ không mất; câu báo cũ hiện ngay, không chờ đọc kho; dòng "N ràng buộc vẫn áp dụng…" hiện liền sau khi đọc xong | YC-027 | Không | Nhỏ (khoảng 10 dòng) |
| 13 | `src/tui/dialogs/context.tsx` | `previewContext` truyền `constraints`; `LAYER_NAME` thêm "Ràng buộc", "Nguồn chưa nạp" | `/context` hiện đúng lớp sẽ gửi | Không | Nhỏ (3 dòng) |
| 14 | `src/tui/dialogs/notebook-form/forms.tsx` (file của spec 003) | Bỏ hằng `AGENT_NOTE` và chỗ hiện nó trong form `/nho` ngăn "Ràng buộc" | Câu "agent con chưa nhận (sẽ có ở bản sau)" hết đúng khi agent con nhận ràng buộc (thêm 05/11 trong phiên code, người dùng xác nhận) | Không | Nhỏ (2 dòng) |
| 15 | `src/core/desk/engine.ts` | `DeskEngine` nhận hàm đọc lựa chọn của lượt (truyền ở `runtime.ts`), đọc **một lần** trong `start`, gắn vào yêu cầu khởi động từng agent của run (`StartSpec.waiver`, `manager.ts` ưu tiên) | Run ultradesk chạy nền: agent của các bước sau khởi động khi lượt chính đã xong; không giữ lựa chọn thì cả run thất bại giữa chừng (thêm 05/11 sau cổng 3 vòng 1, người dùng xác nhận) | Không | Nhỏ (khoảng 8 dòng) |

**Không sửa:**
- `src/core/events.ts`: hoãn đi bằng lỗi ném trước khi gửi, không cần sự kiện mới;
- `src/core/config.ts`: không thêm khoá cấu hình;
- `src/core/compact.ts`, `src/core/loop/stop-gate.ts`, `src/core/idle-compact.ts`;
- `src/core/memory/types.ts`, `src/core/memory/file-memory.ts`, `src/core/memory/policy.ts`, lược đồ kho;
- `src/core/desk/*` trừ `engine.ts` (dòng 15), `src/core/tools/subagent/spawn.ts`, `src/core/session/*`;
- `src/tui/dialogs/tools.tsx`: gọi bản xem trước request chỉ để lấy phần tool, không cần ràng buộc;
- `prompts/identity.md`, `prompts/subagent.md`: nội dung prompt của người phụ trách prompt; chỉ ghi trong mô tả PR.

Phần memory tự làm, không phải lõi:
- `store/read-only.ts` và ba file `binding/*`;
- `notebook/render.ts`, `notebook/provider.ts`: thôi in ràng buộc, bỏ câu dặn kho lỗi;
- `prompts/memory.md`: câu đầu (file của spec 002).

## 7. Luồng xử lý (mức giữa)

### Một lượt của agent chính

1. **Giao diện gửi câu hỏi.** Ví dụ "HPG thế nào?", kèm bộ đọc ràng buộc. Lựa chọn của lượt chưa có.
2. **Bước ràng buộc lượt** đọc song song hai nguồn:
   - **Hồ sơ.** Có thể là "chưa có", "đã đọc" (đã lọc), hoặc "đọc lỗi: không có quyền đọc file".
   - **Ràng buộc.** Có thể là "chưa có" (không có file kho, kho rỗng), "đã đọc" (#1 bản 2, #4 bản 1), hoặc "đọc lỗi: kho do phiên bản OpenTrading mới hơn tạo".
3. **Có nguồn lỗi mà người dùng chưa chọn bỏ** thì ném lỗi hoãn. Không resolve model, không chạy hook, không gửi request.
   - Ví dụ chỉ hồ sơ lỗi: thẻ hiện "Chưa gửi câu hỏi: không đọc được hồ sơ nhà đầu tư (INVESTOR.md): không có quyền đọc file." cùng ba nút "Thử lại", "Chạy lượt này không có hồ sơ", "Huỷ".
4. **Người dùng bấm "Chạy lượt này không có hồ sơ".** Giao diện gửi lại câu hỏi với lựa chọn `{ hồ sơ }`.
   - Bước ràng buộc đọc lại cả hai nguồn. Hồ sơ vẫn lỗi nhưng đã được bỏ.
   - Phần hệ thống có `<rang_buoc>` (hai dòng #1, #4) và `<nguon_chua_nap>` với câu: "Hồ sơ nhà đầu tư của người dùng không nạp được ở lượt này; người dùng đã chọn chạy tiếp. Không giả định người dùng không có giới hạn nào."
   - Nếu lần này kho lại lỗi, mà kho không nằm trong lựa chọn, thì thẻ hiện lại với nguồn mới.
5. **Kiểm vừa ngữ cảnh.** Chỉ chạy khi có ràng buộc và biết cỡ ngữ cảnh của model. Phần danh tính cộng khối ràng buộc cộng phần dành cho câu trả lời (`min(output của model, 4.096)` token) phải nhỏ hơn ngữ cảnh. Không vừa thì ném lỗi hoãn "không vừa": giao diện báo "Chưa gửi: ràng buộc của bạn không vừa ngữ cảnh của model <tên>. Chọn model khác trong /model." và trả câu hỏi về ô nhập.
6. **Phần còn lại của lượt chạy như hiện nay:** nhật ký chế độ tự động, hook, memory, stop gate. Phần hệ thống cố định trong suốt lượt.

### Một lượt của agent con

- **Đọc như agent chính, trừ ba điểm:** agent con không đọc hồ sơ; ràng buộc đọc với vai "agent con"; dùng model của agent con.
- **Lựa chọn của lượt.** `start` và `continue` lấy lựa chọn đang có của lượt agent chính (`runtime.turnWaiver`). Ví dụ: người dùng đã chọn "Chạy lượt này không có ràng buộc", agent chính giao việc ngay trong lượt đó; agent con chạy không có ràng buộc, kèm dòng "Ràng buộc của người dùng không nạp được …".
- **Đọc lỗi mà không có lựa chọn** thì `runAgent` ném lỗi trước khi gửi, với câu "Agent con không chạy: không đọc được ràng buộc của người dùng (<lý do>)." `manager.ts` ghi lỗi đó vào kết quả; tool giao việc trả "Subagent lỗi: Agent con không chạy: …" cho agent chính.
- **Mỗi lượt của agent con đọc lại kho.** Ví dụ: người dùng sửa #1 thành bản 3 giữa hai lượt, thì lượt sau mang "[#1 · bản 3] Không dùng margin".

### Đường không phải lượt trả lời

- Nén hội thoại (tay, tự động, khi rảnh) và `/context` đọc **dễ dãi**: nguồn lỗi thì bỏ, không hoãn, không hiện thẻ.
- Nén vẫn mang khối ràng buộc khi đọc được. Lý do: request nén và request lượt dùng chung phần hệ thống (chú thích có sẵn trong `requestFor`), để prompt cache trùng.
- Đặt tiêu đề phiên không đổi.

## 8. Quyết định kỹ thuật tự chốt

| Điểm | Chốt | Lý do |
| --- | --- | --- |
| Đọc kho khi sổ tắt | Mỗi lần đọc mở rồi đóng kết nối (không giữ kết nối), cả khi sổ bật (kết nối riêng, song song kết nối của sổ) | Không bao giờ giữ khoá file trên Windows, nên "đóng khi thoát, khi đổi lựa chọn" tự đúng; mở SQLite tốn khoảng 1 ms. Một nguồn đọc duy nhất cho ba lựa chọn memory, nên ba lựa chọn cho cùng một khối |
| Chế độ mở | `new Database(file, { readwrite: true, create: false })`: đọc ghi, **không tạo**; không chạy nâng lược đồ, không ghi gì. File biến mất giữa lần dò và lần mở (mở báo lỗi không mở được): dò lại; không còn file thì là "chưa có", còn file thì giữ lỗi | Bun 1.4.2 với chỉ `{ create: false }` báo "bad parameter or other API misuse" kể cả khi file có thật, nên phải ghi rõ `readwrite: true`. Chế độ chỉ đọc của SQLite với kho WAL cần file `-shm` sẵn có, dễ lỗi giả; mở đọc ghi mà không ghi thì file kho chính giữ nguyên từng byte |
| Lược đồ cũ hơn bản app | Đọc được nếu bản lược đồ từ 1 tới bản hiện hành (bảng ràng buộc có từ bản 1); bản 0 không bảng thì là "chưa có" | Không nâng lược đồ khi sổ tắt. Ghi chú trong code: nâng lược đồ sau này mà đổi bảng ràng buộc thì phải sửa bộ đọc |
| Hạn chờ | 2 giây mỗi nguồn (hai nguồn đọc song song). Ràng buộc: dò file bất đồng bộ trước khi mở SQLite | SQLite trong Bun là đồng bộ, không cắt ngang được; bước dò bất đồng bộ bắt được ổ chưa sẵn sàng (trường hợp hay gặp). Còn lại một rủi ro hiếm: ổ treo đúng lúc SQLite đọc; ghi trong mô tả PR |
| Thử lại thoáng qua | Lỗi `EBUSY`, `EPERM`, `EAGAIN` và kho bận: thử lại cách 100, 200, 300 ms, dừng khi quá 900 ms tính từ lần lỗi đầu; mỗi lần chờ khoá kho tối đa 100 ms | YC-018: tổng dưới 1 giây |
| Lý do hiện cho người dùng | Hồ sơ: "không có quyền đọc file", "file đang bị chương trình khác giữ", "đường dẫn là thư mục, không phải file", "đọc quá 2 giây (ổ đĩa chưa sẵn sàng?)", "nội dung không phải văn bản UTF-8", còn lại "lỗi <mã>". Kho: dùng lại lý do sẵn có của sổ (lược đồ mới hơn, không phải kho, dữ liệu hỏng, đang nâng cấp, không mở được) | Không chép nội dung file (bất biến 4) |
| Lối ra cho kho hỏng lâu dài | `lasting` cho ba loại: lược đồ mới hơn, không phải kho, dữ liệu hỏng; ý "dùng phiên bản mới hơn" chỉ khi lược đồ mới hơn | YC-029, TC-019 |
| Lọc hồ sơ | Bỏ mọi đoạn `<!-- … -->` (cả nhiều dòng); `<!--` không đóng thì bỏ tới hết file, giống bản xem trước Markdown. So khớp dòng mẫu cũ sau khi bỏ khoảng trắng hai đầu, chấp nhận CRLF. Bỏ tiêu đề mục không còn nội dung | Một tiêu đề "## Ràng buộc" trống có thể bị đọc thành "không có ràng buộc" |
| Escape hồ sơ | Đổi `&`, `<`, `>` thành thực thể, như memory | YC-030; chặn cả thẻ giả mở khối khác, không chỉ thẻ đóng |
| Kiểm vừa ngữ cảnh | Chỉ khi có ít nhất một ràng buộc và biết cỡ ngữ cảnh model | Không có ràng buộc thì hành vi như hiện nay; câu báo nói "ràng buộc không vừa" mới đúng sự thật |
| Lựa chọn của lượt cho agent con | Giữ lúc `start`/`continue` cho lượt đầu của lần chạy (kể cả khi phải chờ chỗ chạy); lượt nhận tin gửi thêm đọc lựa chọn hiện hành | "Khởi động trong lượt đó" (YC-016); lượt về sau ngoài lượt đã chọn thì từ chối (YC-017) |
| Huỷ | Bỏ dòng câu hỏi khỏi màn hình (câu hỏi chưa gửi). Trả về ô nhập một lần qua cùng hàm trả hàng chờ: câu bị hoãn (chữ và ảnh) đứng đầu, rồi các tin gõ thêm đang chờ, rồi chữ đang có trong ô. Ví dụ "HPG thế nào?" bị hoãn, người dùng gõ thêm "so với HSG", bấm Huỷ: ô nhập là "HPG thế nào?" rồi "so với HSG". Lượt thông báo agent con thì trả thông báo về hàng chờ, gửi kèm câu người dùng gõ sau | Màn hình khớp những gì model đã thấy; giữ đúng thứ tự người dùng đã gõ; không mất chữ, không mất kết quả agent con |
| Hoãn khi thử lại sau nén vì tràn ngữ cảnh | Cùng thẻ và cùng vòng lựa chọn | Một đường xử lý cho mọi lượt |

## 9. Cách kiểm

```
C:\Users\Admin\anaconda3\Scripts\bun.exe --version                     (1.4.2)
C:\Users\Admin\anaconda3\Scripts\bun.exe install --frozen-lockfile     (chỉ khi node_modules lệch bun.lock)
C:\Users\Admin\anaconda3\Scripts\bun.exe run typecheck
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/profile-read.test.ts test/memory-store-read-only.test.ts test/memory-binding.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-binding-agent.test.ts test/chat-cli.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/turn-hold-tui.test.tsx test/tui.test.tsx
C:\Users\Admin\anaconda3\Scripts\bun.exe test
```

Kết quả mong đợi: typecheck sạch; toàn bộ `bun test` đạt (mốc trước spec: 1.379 đạt, 2 bỏ qua, 0 trượt).

Đối chiếu tiêu chí thành công:

| TC | Kiểm ở |
| --- | --- |
| TC-001, TC-002, TC-003 | `memory-binding-agent`: agent con qua `start`, `continue`, ultradesk (bộ máy ultradesk thật với manager thật); sửa #1 giữa hai lượt |
| TC-004, TC-005 | `memory-binding-agent`: ba lựa chọn memory; "Tắt" chưa có kho thì không có file nào được tạo |
| TC-006 | `turn-hold-tui` (thẻ, ba nút, Esc, hỏi lại lượt sau) và `memory-binding-agent` (request sau khi chạy tiếp, ca chỉ hồ sơ lỗi, ca chỉ kho lỗi, ca cả hai) |
| TC-007, TC-019 | `memory-store-read-only` (giữ từng byte) và `memory-binding` (câu báo, lối ra); `memory-binding-agent` (0 request ở cả ba lựa chọn; chuyển file đi thì lượt chạy) |
| TC-008 | `memory-store-read-only`: tiến trình phụ giữ khoá ghi khoảng 300 ms |
| TC-009 | `profile-read`, `memory-binding`: `spyOn` thao tác đĩa trả lời hứa không bao giờ xong; hoãn trong hạn chờ |
| TC-010 | `memory-binding-agent`: agent con chạy nền được giao tiếp việc sau khi lượt đã xong |
| TC-011 | `memory-binding-agent`: catalog có model ngữ cảnh nhỏ, cho cả agent chính và agent con |
| TC-012 | `memory-binding-agent`: ràng buộc có "</rang_buoc>", hồ sơ có "</ho_so_nha_dau_tu>" |
| TC-013, TC-014 | `profile-read` (lọc, giữ từng byte) và `turn-hold-tui` (`/profile` rồi hỏi) |
| TC-015 | `chat-cli`: tiến trình con, `INVESTOR.md` là thư mục, mã thoát khác 0 |
| TC-016 | `turn-hold-tui`: màn Memory của `/config` |
| TC-017 | `memory-notebook-agent`: test duyệt bảng chính sách thêm đường "agent con" |
| TC-018 | Toàn bộ `bun test` và typecheck |

Kiểm tay trên TUI (người dùng làm khi muốn):
- tắt Sổ ghi nhớ, xem dòng trong `/config`;
- đặt `INVESTOR.md` thành thư mục, hỏi một câu, bấm từng nút.

## 10. Việc ghi trong mô tả PR

- **Cho người phụ trách prompt:**
  - agent con nay nhận khối `<rang_buoc>` ở phần hệ thống;
  - chỉ dẫn agent con có thể cần một câu về cách áp ràng buộc khi báo cáo;
  - thứ tự ưu tiên trong `identity.md` xếp "hồ sơ nhà đầu tư" trên "memory", trong khi ràng buộc nằm trong kho memory nhưng luôn áp dụng.
- **Cho chủ repo:**
  - hồ sơ nay được escape;
  - đường nén hội thoại mang khối ràng buộc ở mọi lựa chọn memory (cùng phần hệ thống với lượt);
  - rủi ro còn lại: ổ treo đúng lúc SQLite đọc thì giao diện có thể đứng tới khi hệ điều hành trả lỗi.

## 11. Theo dõi độ phức tạp

| Vi phạm | Vì sao cần | Phương án đơn giản hơn bị loại vì |
| --- | --- | --- |
| Nén hội thoại và `/context` đọc hồ sơ, ràng buộc kiểu dễ dãi (lỗi thì bỏ) | Nén không phải lượt trả lời, và nén khi rảnh chạy lúc người dùng vắng: không ai bấm thẻ | Hoãn cả đường nén thì nén khi rảnh treo chờ người không có mặt; spec §8 để nén ngoài phạm vi |
| Một rủi ro hạn chờ còn lại (SQLite đồng bộ) | Chạy SQLite trong Worker thì cắt được, nhưng thêm một tiến trình, trao đổi thông điệp và đường lỗi riêng cho vài trăm byte ràng buộc | Bước dò bất đồng bộ trước khi mở bắt được trường hợp hay gặp (ổ chưa sẵn sàng) |
