# Plan 001: Kho memory và bảng chính sách theo loại

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (01/11/2026, qua cổng 2 sau khi sửa R54) |
| **Ngày** | 01/11/2026 |
| **Spec** | [spec.md](spec.md) · Mô hình dữ liệu: [data-model.md](data-model.md) |
| **Nhánh** | `feat/memory` |

## 1. Tóm tắt

Thêm module kho memory v5.1 dưới `src/core/memory/`, chưa nối vào app:
- **mở kho** từ đường dẫn tường minh: kiểm nhận diện và phiên bản lược đồ trước khi ghi bất cứ gì, tạo hoặc nâng lược đồ trong một transaction, đóng ngay khi lỗi;
- **bốn nhóm ghi và đọc** (ràng buộc và cách trình bày; chủ đề, bí danh, luận điểm; bài học; quyết định), mỗi lần ghi một transaction `BEGIN IMMEDIATE` có kiểm mốc phiên bản;
- **kiểm văn bản** ở một chỗ cho mọi lần ghi: rỗng, giới hạn ký tự, mẫu khoá bí mật;
- **bảng chính sách** là hằng số, và **cổng đọc** duy nhất cho model hỏi bảng đó;
- quyền **tách thành ba đối tượng**: đọc cho người dùng, ghi, cổng đọc theo chính sách.

Mọi API của kho là **đồng bộ** (`bun:sqlite` đồng bộ). Thời gian chờ quyền ghi 1 giây là giới hạn thời gian của I/O.

## 2. Bối cảnh kỹ thuật

| Mục | Giá trị |
| --- | --- |
| Runtime | Bun 1.4.2 (`C:\Users\Admin\anaconda3\Scripts\bun.exe`), TypeScript strict, ESM, import nội bộ không có đuôi `.ts` |
| Lưu trữ | `bun:sqlite` (SQLite 3.53.2 đi kèm Bun 1.4.2), chế độ WAL, `strict: true` |
| Kiểm cấu trúc | Không cần `zod` ở spec này: đầu vào là đối số có kiểu từ code (form của spec 003), không phải JSON lạ. Cột JSON (điều kiện, tag) do chính kho ghi; đọc lại kiểm là mảng chuỗi, sai thì báo lỗi kho hỏng, không nuốt |
| Test | `bun:test`, thư mục tạm qua `mkdtemp`, không gọi mạng, không gọi model; tiến trình phụ cho test hai tiến trình |
| Nền tảng | Windows và Ubuntu (CI chạy cả hai) |
| Đếm ký tự | `Intl.Segmenter` mức grapheme sau NFC (đã chạy: "Hòa Phát" dạng NFD đếm 8; "👍🏽" đếm 1) |

**Đã kiểm trong code và bằng thí nghiệm (01/11/2026):**
- `src/core/memory/` chỉ có `types.ts` (hợp đồng `MemoryProvider`) và `file-memory.ts`. Chưa file nào trong `src/` hay `test/` dùng `bun:sqlite`. Spec này không sửa hai file đó.
- `src/core/home.ts:12`: `dataDir()` đọc `OPENTRADING_HOME`. Kho không gọi hàm này; nhận đường dẫn tường minh (YC-002).
- `src/core/store.ts:34–35`: file bí mật ghi với `mode 0o600` và `chmod` lại trên hệ không phải Windows. Kho theo cùng cách cho file kho mới.
- `src/core/auth.ts:36`: `maskKey`. Không dùng ở đây: câu báo khoá bí mật không chứa chuỗi khoá, kể cả bản che.
- `src/tui/session.ts:45`: `SETTLE_MS = 2000` (spec 004, chưa commit), thời gian chờ ngắn nhất của giao diện. Thời gian chờ quyền ghi của kho phải dưới số này.
- `tsconfig.json`: `include` có `test`, nên `@ts-expect-error` trong test được typecheck kiểm (TC-012).
- `node_modules/bun-types/sqlite.d.ts`: `close(throwOnError = false)` dùng `sqlite3_close_v2`, kết nối chỉ nhả khi mọi câu lệnh `prepare` được giải phóng; `close(true)` nhả ngay. `transaction(fn).immediate` chạy `BEGIN IMMEDIATE`, lỗi trong `fn` thì rollback. Lỗi là `SQLiteError` có `code`.
- Thí nghiệm `bun:sqlite` trên Windows (scratchpad, không vào repo):
  - mở file văn bản: hàm tạo không lỗi; câu truy vấn đầu tiên ném `SQLITE_NOTADB`; file không đổi;
  - kho có `user_version = 2`: đọc `PRAGMA user_version` không đổi byte nào của file;
  - đóng `close(true)` rồi xoá thư mục ngay: thành công, không còn file `-wal`, `-shm`;
  - `PRAGMA data_version` **không** đổi khi chính kết nối đó ghi, **có** đổi khi kết nối khác ghi;
  - tiến trình phụ giữ `BEGIN IMMEDIATE` 2,5 giây, tiến trình chính ghi với `busy_timeout = 1000`: ném `SQLITE_BUSY` sau khoảng 1,16 giây.
- Mẫu test hai tiến trình: `test/file-lock.test.ts:239` gọi script `test/fixtures/scripts/lock-contender.ts` bằng `Bun.spawn`.

## 3. Quyết định thiết kế

### 3.1. Mở kho

Thứ tự, mỗi bước lỗi thì `close(true)` rồi ném `MemoryStoreError`:

1. Tạo thư mục cha nếu thiếu. File chưa có và không phải Windows: tạo file rỗng với `mode 0o600` trước (SQLite tạo `-wal`, `-shm` cùng quyền với file kho).
2. Mở `new Database(path, { create: true, readwrite: true, strict: true })`, đặt `busy_timeout = 1000`. Giá trị truyền vào không phải số hữu hạn không âm thì dùng mặc định (R78): SQLite đọc `busy_timeout = NaN` là 0, tức "không chờ", mà không báo lỗi.
3. **Đọc trước, chưa ghi gì:** `application_id`, `user_version`, số bảng trong `sqlite_master`.
   - `SQLITE_NOTADB` hoặc lỗi đọc khác → `not_a_store` / `open_failed`.
   - `user_version > SCHEMA_VERSION` → `newer_schema`. File không bị chạm (đã kiểm bằng thí nghiệm).
   - Có bảng mà `application_id` khác của kho → `not_a_store`.
4. Thiết lập theo kết nối, không giữ khoá: `foreign_keys = ON`, `secure_delete = ON` (R58: xoá thì SQLite ghi đè 0 lên byte cũ trong file kho; bản sao lưu, bản đã gửi provider vẫn không thu hồi được, nên giao diện không hứa xoá vật lý).
5. **Kho đã ở bản mới nhất thì mở xong luôn, không giữ quyền ghi** (R73): cửa sổ khác đang ghi lâu cũng không làm lần mở báo "bận".
6. Cần nâng lược đồ: bật WAL (`journal_mode = WAL`; hệ tệp không hỗ trợ thì SQLite giữ chế độ cũ, kho vẫn đúng). Rồi mỗi bước một transaction `IMMEDIATE`; **bên trong** đọc lại `user_version`: lớn hơn bản app hiểu thì `newer_schema` (một bản app mới hơn vừa nâng), bằng thì xong (cửa sổ khác vừa nâng), nhỏ hơn thì chạy bước, đặt `user_version` và `application_id`. Lỗi giữa chừng thì rollback: không có kho nửa lược đồ. Cửa sổ khác đang giữ quyền ghi quá thời gian chờ thì lần mở báo `busy`.
7. **Mở lỗi không bao giờ xoá file**, kể cả file do lần mở này tạo (R61): hai cửa sổ cùng khởi động, cửa sổ kia có thể đang dùng file đó. Lược đồ tạo trong một transaction nên file sót lại chỉ là file rỗng, lần mở sau tạo lược đồ. Tạo thư mục và tạo file (`wx`, `0o600`) nằm trong cùng khối bắt lỗi; `EEXIST` coi như file đã có. `SQLITE_BUSY` khi mở thành lỗi `busy` (thử lại), `SQLITE_CORRUPT` thành `corrupt` (R63).

Danh sách bước nâng là một mảng trong `schema.ts`. Bản 1 chỉ có bước "rỗng → 1". `openMemoryStore` nhận tuỳ chọn `migrations` **chỉ để test** kiểm cơ chế nâng (bước chạy theo thứ tự; bước lỗi thì rollback và `user_version` giữ nguyên).

### 3.2. Ghi

- Mỗi thao tác ghi: kiểm văn bản (§3.3) **trước** transaction, rồi một `transaction(...).immediate()`: đọc mốc, so, ghi, tăng `constraint_set` nếu cần. Vì `IMMEDIATE` giữ quyền ghi từ đầu, lần đọc mốc và lần ghi không bị tiến trình khác chen giữa.
- Mã lỗi SQLite được đổi sang `MemoryStoreError` **ở một chỗ** (`errors.ts`): `SQLITE_BUSY` → `busy` ("Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại."); lỗi khác → `write_failed` kèm mã.
- Đồng hồ tiêm được (`now`), mặc định `new Date()`. Một thao tác lấy thời điểm **một lần** và dùng cho mọi dòng nó ghi, nên `valid_to` của bản cũ bằng đúng `valid_from` của bản mới.
- Mỗi lần đọc chạy trong một transaction đọc (`deferred`, R62): một lần đọc gồm nhiều câu `SELECT` thấy cùng một ảnh chụp, không thấy nửa chừng lần xoá của cửa sổ khác.
- Sau mỗi lần xoá đã commit: `PRAGMA wal_checkpoint(TRUNCATE)` với `busy_timeout = 0` (R75). Đưa nội dung WAL vào file kho rồi cắt WAL về 0, để chữ đã xoá không nằm lại trong `memory.db-wal` khi kho còn mở. Cố gắng hết sức: cửa sổ khác đang đọc làm checkpoint không trọn thì không báo lỗi, không thử lại, không chờ (checkpoint tự động của SQLite làm nốt sau). Lần xoá đã commit nên bước này không bao giờ làm lần xoá thất bại.
- "Đã ghi" (cho `changed()`) chỉ được đánh dấu khi `total_changes()` của kết nối đổi (R74): một lần ghi không đổi dòng nào, như đặt lại đúng trạng thái luận điểm đang có, không phải thay đổi.
- Giá trị liệt kê (nguồn, loại ràng buộc, loại chủ đề, trạng thái luận điểm, mức tự tin) kiểm lúc chạy ở bước kiểm đầu vào, sai thì `invalid` nêu trường (R76). Câu báo không bao giờ chép chữ chưa qua bước kiểm (R72).
- Phát hiện thay đổi (YC-007): giữ `data_version` lần kiểm trước và một cờ "chính kết nối này vừa ghi" (thí nghiệm cho thấy `data_version` không đổi khi chính kết nối ghi). `changed()` trả `true` nếu một trong hai đổi, rồi đặt lại.

### 3.3. Kiểm văn bản (một chỗ cho mọi lần ghi)

Theo thứ tự, cho mỗi trường văn bản của một lần ghi:
1. chuẩn hoá NFC, cắt khoảng trắng hai đầu (R64; một ràng buộc 200 ký tự dán kèm xuống dòng cuối vẫn là 200);
2. trường bắt buộc rỗng hoặc chỉ khoảng trắng → `invalid` (nêu trường);
3. **mẫu khoá bí mật** (YC-031) → `secret` ("Trường «lý do» có chuỗi giống khoá bí mật (khoá API). Kho memory không lưu khoá; bỏ chuỗi đó rồi lưu lại."). Không chép chuỗi, không che một phần;
4. giới hạn ký tự (bảng §3.4) → `limit` (nêu trường, số ký tự, giới hạn).

Kiểm tổng (ràng buộc 1.500, cách trình bày 1.000) chạy **trong** transaction vì cần đọc các mục đang có.

**Mẫu khoá bí mật** (chỉ mẫu có độ chắc cao, H3; tiền tố cố định cộng phần đuôi đủ dài):

| Mẫu | Của |
| --- | --- |
| `sk-ant-[A-Za-z0-9_-]{20,}` | Anthropic |
| `sk-(proj-\|or-v1-)?[A-Za-z0-9_-]{20,}` | OpenAI, OpenRouter |
| `gsk_[A-Za-z0-9]{20,}` | Groq |
| `AIza[0-9A-Za-z_-]{35}` | Google |
| `xai-[A-Za-z0-9]{20,}` | xAI |
| `nvapi-[A-Za-z0-9_-]{20,}` | NVIDIA |
| `tvly-[A-Za-z0-9_-]{20,}` | Tavily |
| `gh[pousr]_[A-Za-z0-9]{36,}` | GitHub (token cũ) |
| `github_pat_[A-Za-z0-9_]{22,}` | GitHub (token loại mới; máy chủ MCP GitHub yêu cầu loại này, R56) |
| `AKIA[0-9A-Z]{16}` | AWS |
| `-----BEGIN [A-Z ]*PRIVATE KEY-----` | khoá riêng PEM |

Mỗi mẫu có ranh giới từ ở đầu, để "task-…" hay "risk-…" không khớp. Danh sách nằm trong `secrets.ts`, thêm mẫu mới là thêm một dòng cộng một ca test.

### 3.4. Bảng tham số giới hạn (H4)

Một hằng số trong `limits.ts`, mỗi dòng có lý do. Số do spec quy định (YC-024, theo C2) và số plan tự chọn cho trường spec không nêu:

| Trường | Giới hạn | Nguồn, lý do |
| --- | --- | --- |
| Ràng buộc: mỗi mục / tổng đang có hiệu lực | 200 / 1.500 | C2; ràng buộc đi vào mọi request, kể cả agent con, không bao giờ cắt |
| Cách trình bày: tổng | 1.000 | C2 |
| Luận điểm: văn bản / chi tiết | 350 / 4.000 | C2 |
| Luận điểm: số điều kiện × độ dài | 8 × 160 | C2 |
| Bài học: tiêu đề / tóm tắt / chi tiết | 120 / 320 / 4.000 | C2 |
| Quyết định: việc / lý do | 120 / 2.000 | C2 |
| Bài học: ngoại lệ | 320 | Plan chọn: ngang tóm tắt, vì ngoại lệ là một phần của tóm tắt khi đọc nhanh |
| Bài học: tag | 10 tag × 40 | Plan chọn: tag chỉ để lọc |
| Bài học: áp dụng cho | 20 chủ đề, bỏ trùng giữ thứ tự trước khi đếm | R77: bài học cho cả ngành dùng chủ đề ngành, không liệt kê từng mã |
| Quyết định: kỳ vọng / điều gì làm đổi ý | 2.000 / 2.000 | Plan chọn: ngang lý do |
| Bí danh | 40 | Plan chọn: đủ cho tên ngành ("Bất động sản khu công nghiệp") |

Đếm theo grapheme sau NFC. Đúng bằng giới hạn thì lưu được.

### 3.5. Bảng chính sách và cổng đọc

Bảng là một mảng **luật cho phép** (mặc định từ chối), mỗi luật có hình dạng Cedar:

```
{ role, action, kind, shared, fields }
```

- `role`: `user`, `main_agent`, `subagent` (R50: chỉ các vai đọc kho).
- `action`: `system` (vào phần hệ thống), `index` (vào mục lục), `block` (vào khối có nhãn), `memory_read`, `propose`, `activate`.
- `kind`: `constraint`, `style`, `thesis`, `lesson`, `decision`.
- `shared`: bối cảnh "đã chia sẻ". Bản 1 mọi luật có `shared: false`; không có luật nào cho quyết định ở bất kỳ vai model nào.
- `fields`: các trường được trả (phép chiếu). Ví dụ mục lục luận điểm chỉ `display` và tên ngành `sectorDisplay`; mục lục bài học `id`, `title`.

Nội dung bảng bản 1 (khớp C2, ADR 0006):

| Vai | Hành động | Loại | Trường |
| --- | --- | --- | --- |
| `main_agent` | `system` | `constraint` | id, version, text, scope |
| `main_agent` | `system` | `style` | id, version, text |
| `subagent` | `system` | `constraint` | id, version, text, scope |
| `main_agent` | `index` | `thesis` | subjectId, display, sectorDisplay (tên hiển thị của chủ đề ngành, nếu có; ADR 0004: "HPG (Thép)"), state (R60: luận điểm đã bị bác bỏ, đã đóng vẫn vào mục lục, kèm trạng thái) |
| `main_agent` | `index` | `lesson` | id, title |
| `main_agent` | `block` | `thesis` | subjectId, display, sectorId, sectorDisplay (R60: để spec 002 viết dòng trỏ luận điểm ngành), version, text, conditions, reviewBy, state, validFrom |
| `main_agent` | `memory_read` | `constraint`, `style` | như `system` |
| `main_agent` | `memory_read` | `thesis` | như `block` cộng `detail` |
| `main_agent` | `memory_read` | `lesson` | id, version, title, summary, appliesTo, exceptions, detail, tags, createdAt |
| `main_agent` | `propose` | `constraint`, `style`, `lesson` | — (thẻ, spec 007) |
| `user` | `activate` | mọi loại | — |

Cổng đọc (`gate.read`) nhận vai, hành động, bối cảnh và bộ lọc tuỳ chọn (danh sách chủ đề, danh sách bài học) mà spec 002 cần; trả các mục còn hiệu lực đã chiếu theo `fields`. Hành động `propose`, `activate` không trả dữ liệu; hỏi qua `gate.allows`.

Test duyệt bảng (YC-028) viết **bảng kỳ vọng riêng trong test**, không đọc lại hằng số của code. Đổi chính sách thì phải đổi ở hai nơi, nên không ai đổi nhầm mà test vẫn xanh.

### 3.6. Tách quyền (YC-023)

`openMemoryStore` trả một đối tượng gồm:
- `reader`: đọc mọi loại, kể cả quyết định và mục đã xoá (cho `/memory` của spec 003, do người dùng xem);
- `writer`: mọi thao tác ghi;
- `gate`: cổng đọc theo chính sách, **đường duy nhất** spec 002, 005 được đưa cho model;
- `changed()`, `close()`, `path`.

Ba đối tượng là object đông cứng (`Object.freeze`), chỉ có đúng các hàm của nó, không giữ tham chiếu ra ngoài tới `Database`. Spec 002 chỉ chuyền `gate` vào phần model. Đây là object-capability: không có tham số "ai đang gọi".

## 4. Cấu trúc file

```
src/core/memory/policy.ts            bảng chính sách (hằng số) và hàm hỏi bảng; không I/O
src/core/memory/limits.ts            bảng tham số giới hạn và đếm ký tự grapheme
src/core/memory/store/types.ts       kiểu công khai của kho (đầu vào, bản ghi, kết quả đọc)
src/core/memory/store/errors.ts      MemoryStoreError, các loại lỗi, đổi lỗi SQLite (một chỗ)
src/core/memory/store/schema.ts      SCHEMA_VERSION, APPLICATION_ID, các bước nâng lược đồ (bản 1)
src/core/memory/store/open.ts        mở, kiểm, nâng, đóng; ghép reader, writer, gate
src/core/memory/store/text.ts        kiểm văn bản cho mọi lần ghi: NFC, rỗng, khoá bí mật, giới hạn
src/core/memory/store/secrets.ts     danh sách mẫu khoá bí mật
src/core/memory/store/constraints.ts ràng buộc, cách trình bày, phiên bản bộ ràng buộc
src/core/memory/store/subjects.ts    chủ đề và bí danh
src/core/memory/store/theses.ts      bản luận điểm, trạng thái, xoá
src/core/memory/store/lessons.ts     bài học và bản bài học
src/core/memory/store/decisions.ts   quyết định ghi nối
src/core/memory/store/gate.ts        cổng đọc theo chính sách

test/memory-store-open.test.ts             Story 1, cơ chế nâng lược đồ, đóng kết nối
test/memory-store-constraints.test.ts      Story 2
test/memory-store-theses.test.ts           Story 3 (chủ đề, bí danh, luận điểm)
test/memory-store-lessons.test.ts          Story 4
test/memory-store-decisions.test.ts        Story 5
test/memory-store-text.test.ts             giới hạn, ký tự đặc biệt, khoá bí mật (TC-009, TC-010, TC-014)
test/memory-store-concurrency.test.ts      hai tiến trình, kho bận, phát hiện thay đổi (TC-004, TC-005, TC-011)
test/memory-policy.test.ts                 Story 6, duyệt bảng, tách quyền (TC-008, TC-012)
test/fixtures/scripts/memory-store-contender.ts   tiến trình phụ: sửa một ràng buộc, hoặc giữ quyền ghi N ms
```

Không file nào là **[LÕI]**. `src/core/memory/types.ts` và `file-memory.ts` không sửa. Không có `utils.ts`, `manager.ts`.

## 5. Giao diện

```ts
// src/core/memory/policy.ts
export type MemoryRole = "user" | "main_agent" | "subagent"
export type MemoryAction = "system" | "index" | "block" | "memory_read" | "propose" | "activate"
export type MemoryKind = "constraint" | "style" | "thesis" | "lesson" | "decision"
export interface PolicyContext { shared: boolean }
export interface PolicyRule {
  readonly role: MemoryRole
  readonly action: MemoryAction
  readonly kind: MemoryKind
  readonly shared: boolean
  readonly fields: readonly string[]
}
export const MEMORY_POLICY: readonly PolicyRule[]
export function policyRule(role: MemoryRole, action: MemoryAction, kind: MemoryKind, ctx: PolicyContext): PolicyRule | undefined

// src/core/memory/limits.ts
export const MEMORY_LIMITS: Readonly<Record<LimitKey, { max: number; why: string }>>
export function countChars(text: string): number

// src/core/memory/store/errors.ts
export type MemoryStoreErrorKind =
  | "newer_schema" | "not_a_store" | "open_failed" | "busy" | "write_failed"
  | "conflict" | "deleted" | "not_found" | "invalid" | "limit" | "secret" | "alias_taken"
export class MemoryStoreError extends Error {
  readonly kind: MemoryStoreErrorKind
  readonly current?: unknown        // bản hiện hành khi kind = "conflict", để giao diện hiện diff
}

// src/core/memory/store/types.ts (rút gọn)
export type Source = "manual" | "card" | "investor_import"
export type ThesisState = "none" | "watching" | "refuted" | "closed"
export type Confidence = "low" | "medium" | "high"
export type Deleted = { deleted: true; deletedAt: string }
export interface ConstraintVersion { id: number; kind: "constraint" | "style"; version: number; text: string; scope: string; source: Source; createdAt: string }
export interface Subject { id: number; kind: "ticker" | "sector" | "market"; display: string; aliases: AliasEntry[]; sectorId?: number; uppercaseOnly: boolean; lastVersion: number; currentVersion?: number; thesisState: ThesisState; thesisStateAt?: string }
export interface ThesisVersion { subjectId: number; version: number; text: string; detail?: string; conditions: string[]; reviewBy?: string; validFrom: string; validTo?: string; source: Source }
export interface LessonVersion { id: number; version: number; title: string; summary: string; appliesTo: number[]; exceptions?: string; detail?: string; tags: string[]; source: Source; createdAt: string }
export interface Decision { id: number; subjectId: number; basis: { version: number } | { version: number; deleted: true } | "none"; constraintSet: number; action: string; reason: string; expectation?: string; confidence?: Confidence; reviewOn?: string; changeMind?: string; source: Source; createdAt: string }
export interface Saved { id: number; version: number }

// src/core/memory/store/open.ts
export interface MemoryStoreOptions {
  now?: () => Date
  busyTimeoutMs?: number                       // mặc định 1000
  migrations?: readonly Migration[]            // chỉ test dùng
}
export interface MemoryStore {
  readonly path: string
  readonly reader: MemoryReader
  readonly writer: MemoryWriter
  readonly gate: MemoryGate
  changed(): boolean
  close(): void
}
export function openMemoryStore(file: string, opts?: MemoryStoreOptions): MemoryStore

export interface MemoryReader {
  constraints(kind: "constraint" | "style"): ConstraintVersion[]          // chỉ mục còn hiệu lực, bản hiện hành
  constraint(id: number): ConstraintVersion | ({ id: number } & Deleted) | undefined
  constraintVersion(id: number, version: number): ConstraintVersion | { version: number; deleted: true } | undefined
  constraintSet(): number
  subjects(): Subject[]
  subject(id: number): Subject | undefined
  subjectByAlias(alias: string): Subject | undefined                       // không phân biệt hoa thường, chỉ bí danh đang dùng
  thesis(subjectId: number): ThesisVersion | undefined                      // bản hiện hành
  thesisVersion(subjectId: number, version: number): ThesisVersion | { version: number; deleted: true } | undefined
  lessons(): LessonVersion[]
  lesson(id: number): LessonVersion | ({ id: number } & Deleted) | undefined
  lessonVersion(id: number, version: number): LessonVersion | { version: number; deleted: true } | undefined
  decisions(): (Decision | ({ id: number } & Deleted))[]
  decision(id: number): Decision | ({ id: number } & Deleted) | undefined
}

export interface MemoryWriter {
  addConstraint(input: { kind: "constraint" | "style"; text: string; source?: Source }): Saved
  reviseConstraint(id: number, expected: number, input: { text: string; source?: Source }): Saved
  deleteConstraint(id: number, expected: number): void
  createSubject(input: { kind: Subject["kind"]; alias: string; sectorId?: number; uppercaseOnly?: boolean }): { id: number }
  addAlias(subjectId: number, alias: string): void
  retireAlias(subjectId: number, alias: string): void
  saveThesis(subjectId: number, expected: number | null, input: { text: string; detail?: string; conditions: string[]; reviewBy?: string; source?: Source }): Saved
  setThesisState(subjectId: number, expected: number, state: Exclude<ThesisState, "none">): void
  deleteThesis(subjectId: number, expected: number): void
  addLesson(input: { title: string; summary: string; appliesTo?: number[]; exceptions?: string; detail?: string; tags?: string[]; source?: Source }): Saved
  reviseLesson(id: number, expected: number, input: /* như addLesson */ Parameters<MemoryWriter["addLesson"]>[0]): Saved
  deleteLesson(id: number, expected: number): void
  addDecision(input: { subjectId: number; thesisVersion?: number; action: string; reason: string; expectation?: string; confidence?: Confidence; reviewOn?: string; changeMind?: string; source?: Source }): { id: number }
  deleteDecision(id: number): void
}

export interface GateItem { kind: MemoryKind; fields: Readonly<Record<string, unknown>> }
export interface MemoryGate {
  read(role: MemoryRole, action: MemoryAction, ctx?: PolicyContext,
       filter?: { subjectIds?: number[]; lessonIds?: number[] }): GateItem[]
  allows(role: MemoryRole, action: MemoryAction, kind: MemoryKind, ctx?: PolicyContext): boolean
}
```

`MemoryWriter` không có `update` hay `revise` cho quyết định (YC-018). Chữ ký chi tiết có thể đổi nhỏ khi code; đổi hình dạng ba đối tượng `reader`, `writer`, `gate` thì báo lại.

## 6. Điểm đụng lõi

Không có. Spec 002 sẽ nối kho vào app (chọn provider trong `/config`, mở kho trong thư mục dữ liệu, đóng khi tắt app hoặc tắt memory); việc đó sửa lõi và được liệt kê ở plan của 002.

## 7. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | `bun:sqlite`, `Intl.Segmenter` có sẵn; không dùng `zod` ở spec này |
| Module mới dưới `src/core/memory/`, lõi không import TUI | Đạt | Đạt | Mọi file mới trong `src/core/memory/`; không import `src/tui` |
| Mỗi module một trách nhiệm; không `utils.ts`, `manager.ts` | Đạt | Đạt | 14 file, mỗi file một việc (§4) |
| I/O có timeout; lỗi đọc không bị nuốt | Đạt | Đạt (có ghi chú) | Quyền ghi chờ tối đa 1 giây rồi báo bận. Đọc ghi đĩa của SQLite đồng bộ, không đặt hạn được từng lệnh; file cục bộ, mỗi thao tác vài mili giây. Mở lỗi, cột JSON hỏng đều ném lỗi, không trả rỗng |
| Lỗi upstream đổi một lần ở biên | Đạt | Đạt | Lỗi SQLite đổi sang `MemoryStoreError` chỉ ở `errors.ts` |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | Đường dẫn tường minh trong `mkdtemp`; không gọi `dataDir()` |
| Chạy được trên Windows và Ubuntu | Đạt | Đạt | `close(true)` trước khi xoá thư mục tạm (đã thử trên Windows); quyền `0o600` chỉ áp trên hệ không phải Windows; không phụ thuộc xuống dòng |
| Model không có tool ghi; chỉ người dùng làm memory có hiệu lực | Đạt | Đạt | Spec này không có tool. `gate` không có hàm ghi; chỉ `user` có `activate`; kho không có trạng thái đề xuất |
| Quyết định không tự vào context | Đạt | Đạt | Không luật nào cho quyết định ở vai model; test duyệt bảng với bảng kỳ vọng riêng |
| Bí mật không vào memory, log, câu báo | Đạt | Đạt | Chặn mẫu khoá trước transaction; câu báo không chép chuỗi |
| Ràng buộc không bị cắt | Đạt | Đạt | Vượt giới hạn thì từ chối lần ghi |
| Zod: không `z.object` rồi ghi đè | Không áp dụng | Không áp dụng | Không có đường "đọc JSON lạ rồi ghi lại"; cột cố định nên T4 không xảy ra (YC-029) |

Không có mục trượt; §9 trống.

## 8. Cách kiểm

```
C:\Users\Admin\anaconda3\Scripts\bun.exe install --frozen-lockfile   (chỉ khi node_modules lệch lockfile)
C:\Users\Admin\anaconda3\Scripts\bun.exe run typecheck
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/memory-store-open.test.ts test/memory-store-constraints.test.ts test/memory-store-theses.test.ts test/memory-store-lessons.test.ts test/memory-store-decisions.test.ts test/memory-store-text.test.ts test/memory-store-concurrency.test.ts test/memory-policy.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test
```

Kết quả mong đợi: typecheck sạch; 8 file test mới xanh; toàn bộ `bun test` xanh, số test cũ không đổi kỳ vọng. Test hai tiến trình chạy lại 3 lần liền đều xanh trên Windows. Không có kiểm tay: kho chưa nối vào app.

**Đối chiếu yêu cầu và tiêu chí:**

| Tiêu chí | Yêu cầu | Test |
| --- | --- | --- |
| TC-001 | YC-001–005 | `memory-store-open` |
| TC-002 | YC-008 | `memory-store-constraints`, `-theses`, `-lessons`, `-decisions` (mỗi loại có ID) |
| TC-003 | YC-009, YC-010, YC-016 | `memory-store-theses` |
| TC-004 | YC-006, YC-011 | `memory-store-concurrency` |
| TC-005 | YC-006 | `memory-store-concurrency` |
| TC-006 | YC-018, YC-019, YC-021 | `memory-store-decisions` |
| TC-007 | YC-020 | mỗi file theo loại, cộng `memory-policy` (cổng không trả mục đã xoá) |
| TC-008 | YC-025–028 | `memory-policy` |
| TC-009 | YC-024 | `memory-store-text` |
| TC-010 | (§3 spec) | `memory-store-text` |
| TC-011 | YC-007 | `memory-store-concurrency` |
| TC-012 | YC-022, YC-023 | `memory-policy` (`@ts-expect-error` và kiểm lúc chạy) |
| TC-013 | YC-002, YC-005 | mọi file: `afterEach` đóng kho rồi xoá thư mục tạm |
| TC-014 | YC-031 | `memory-store-text` |
| — | YC-012–015, YC-017, YC-029, YC-030 | theo file của từng loại; YC-029 bằng ca "kho có cột lạ do bản sau thêm vẫn đọc ghi được, cột lạ giữ nguyên" ở `memory-store-open` |

## 9. Theo dõi độ phức tạp

(Không có mục trượt.)
