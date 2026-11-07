# Plan 004: Sửa lỗi lõi: ghi phiên, khoá file, agent con

| | |
| --- | --- |
| **Trạng thái** | Đã duyệt (29/10/2026, qua cổng 2 sau một vòng sửa theo ý kiến duyệt; người dùng xác nhận L1–L9). Đã code (31/10/2026); các điều chỉnh khi code và duyệt code ở §10 |
| **Ngày** | 29/10/2026 |
| **Spec** | [spec.md](spec.md) (đã duyệt 29/10/2026) |
| **Nhánh** | `feat/memory` |

## 1. Tóm tắt

Ba phần độc lập, làm theo rủi ro tăng dần.

| Gói | Phần việc | Cách làm |
| --- | --- | --- |
| 1 | **Agent con** | Thêm một cờ khai báo trên tool: "chỉ agent chính". Bộ tool lịch sử phiên tự gắn cờ này cho mọi tool của nó. Chỗ lọc duy nhất của agent con bỏ mọi tool có cờ |
| 2 | **Khoá file** | Khoá mang mã chủ ngẫu nhiên, được làm mới định kỳ. Khoá chỉ bị chiếm khi chủ đã chết hoặc khoá lâu không được làm mới. Nhả khoá có kiểm chủ. Watchlist kiểm "khoá còn của mình" ngay trước khi đổi tên file |
| 3 | **Ghi phiên** | Mỗi phiên có một danh sách "phần ghi đang chờ" trong RAM. Mỗi lần ghi trả về biên nhận, không bao giờ làm kẹt lần sau. Ghi lỗi giữa chừng thì cắt file về kích thước trước lần ghi. Ghi nối có chống dòng cụt. Giao diện báo theo biên nhận. Đường thoát và đường chuyển phiên đợi phần chờ |

Không đổi định dạng file phiên, file chỉ mục hay file khoá. Không thêm dependency.

## 2. Bối cảnh kỹ thuật

| Mục | Giá trị |
| --- | --- |
| Runtime | Bun 1.4.2 (`C:\Users\Admin\anaconda3\Scripts\bun.exe`), TypeScript strict, ESM |
| Lưu trữ | File JSONL (phiên, chỉ mục) và JSON (watchlist), `node:fs/promises`. Không có SQLite trong spec này |
| Kiểm cấu trúc | Không thêm schema mới. File khoá đọc bằng regex như hiện nay |
| Test | `bun:test`; `OPENTRADING_HOME` tạm (mẫu `test/session.test.ts:7-18`); `spyOn` của `bun:test` cho nhánh lỗi; tiến trình phụ bằng `Bun.spawn` (mẫu `test/watchlist-local.test.ts:83-94`) |
| Nền tảng | Windows và Ubuntu (CI chạy cả hai) |
| `ai` | 7.0.137; spec này không đụng tới model |

**Đã kiểm trong code** (trên `origin/main` `4c5ffc0`, ngày 29/10/2026):

- **Agent con.**
  - Chỗ lọc duy nhất là `childRegistry` (`src/core/subagents/manager.ts:48-55`).
  - Cả ba đường tạo agent con đều đi qua đây:
    - chạy mới: `manager.ts:249`;
    - giao tiếp việc cho agent đã chạy: `manager.ts:338`;
    - ultradesk: `src/core/runtime.ts:187` truyền chính bộ quản lý agent con làm `starter`, và `desk/engine.ts:395` gọi `start`.
  - Bộ lọc theo loại agent (`src/core/agents/resolve.ts:13-23`) chỉ thu hẹp, không thêm được tool đã loại.
- **Tool lịch sử phiên.**
  - Do `sessionHistoryTools()` tạo (`src/core/tools/session/history.ts:39`), gồm `session_list` và `session_get`.
  - Đăng ký một chỗ ở `runtime.ts:129`.
  - Nguồn của chúng là `LOCAL_SOURCE` = `"local"`, **dùng chung** với nhiều tool khác: chart, tìm và ghi file, shell, web, watchlist, `spawn_subagent`, `doctor_local`.
  - Danh sách tool hoãn trong prompt **gom nhóm theo nguồn** (`src/core/prompt/assemble.ts:131-140`, `src/core/agent.ts:929-930`).
- **Khoá file.**
  - `src/core/file-lock.ts:27-39`: khoá cũ hơn `staleMs` (30 giây) bị coi là chết, bất kể chủ còn sống.
  - `file-lock.ts:73-77`: nhả khoá xoá file không kiểm chủ.
  - Người dùng duy nhất là `updateWatchlists` (`src/core/tools/watchlist/local.ts:91-103`). Nó ghi bằng `writeJson` (`src/core/store.ts:16-32`): ghi file tạm rồi đổi tên, có thử lại trên Windows.
- **Ghi phiên.**
  - Hàng đợi `this.writing = this.writing.then(...)` (`src/core/session/store.ts:119, 154, 169`): một lần từ chối làm mọi `.then` sau bỏ qua và trả lại đúng lỗi đó (T1).
  - `this.file` gán **trước** khi ghi (`store.ts:176-179`).
  - Cả lượt ghi bằng **một** `appendFile` nhiều dòng (`store.ts:195`).
  - Chỉ mục ghi sau file phiên (`store.ts:213-214`).
  - Không có chống dòng cụt ở cả hai.
- **Giao diện.**
  - `recordTurn` bắn rồi quên, chỉ `.catch(saveFailed)` (`src/tui/session.ts:19-35, 56-57`).
  - Đường thoát (`src/tui/app.tsx:578-598`) đợi tối đa 2 giây cho `inflight`, agent con, ultradesk, hook, MCP, nhưng **không đợi ghi phiên**.
  - Test TUI headless truyền `onExit` (`test/tui.test.tsx:272`), mà `exit()` trả về sớm khi có `onExit` (`app.tsx:580`), nên **không chạy được đường thoát thật trong test**.
- **Đọc lại.** `loadSession` và `allSessions` đã bỏ dòng không đọc được (`store.ts:244-257, 294-313`). YC-007 đã đạt ở phía đọc; spec này chỉ thêm test.

## 3. Quyết định thiết kế

### 3.1. Chặn tool lịch sử theo nhóm

| Phương án | Được | Mất |
| --- | --- | --- |
| A. Thêm `session_list`, `session_get` vào `EXCLUDED_TOOLS` | Hai dòng | Theo tên: thêm `session_search` mà quên thì rò. Test không có cách nhận ra "tool lịch sử" nếu không có dấu hiệu chung |
| B. Đổi nguồn của tool lịch sử thành `"session"` rồi lọc theo nguồn | Lọc theo nhóm | **Sai.** Prompt gom tool hoãn theo nguồn (`assemble.ts:131-140`): nhóm `"session"` sẽ hiện như một máy chủ MCP, kèm gợi ý tìm `mcp__session` không tồn tại. `/tools` và dòng đếm tool (`agent.ts:929-930`) cũng đổi |
| **C (chọn). Cờ mới trên `ToolDef`: `mainAgentOnly`** | Lọc theo nhóm: `sessionHistoryTools()` gắn cờ cho **mọi** tool nó trả về, ở một chỗ, nên tool lịch sử thêm vào đó sau này tự có cờ. Chỗ lọc agent con chỉ cần `!t.mainAgentOnly`. Không đổi nguồn, prompt, `/tools` | Thêm một trường vào kiểu dùng chung `ToolDef` (lõi, cỡ nhỏ) |

Ví dụ chạy qua chỗ lọc:

| Đầu vào: tool | Đầu ra: agent chính | Đầu ra: agent con `tra-cuu` (`@chi-doc`) |
| --- | --- | --- |
| `session_get` | có | **không** (cờ `mainAgentOnly`) |
| `doctor_local` | có | có (không thuộc nhóm lịch sử) |
| `web_search` | có | có |

TC-007 kiểm theo nhóm: mọi tool `sessionHistoryTools()` trả về đều có cờ, và không tool nào trong số đó lọt vào `childRegistry`, kể cả khi bộ lọc của loại agent ghi đích danh tên tool.

### 3.2. Khoá file (T3)

**Nội dung khoá:**
- Thêm `token` (chuỗi ngẫu nhiên, mỗi lần giữ một mã), cạnh `pid` và `at` đang có.
- Đọc vẫn bằng regex, nên khoá cũ thiếu `token` vẫn hiểu được.

**Làm mới:**
- Trong lúc giữ, mỗi `refreshMs` (mặc định 5 giây), chủ đọc lại khoá:
  - còn đúng `token` thì cập nhật thời điểm sửa file;
  - sai `token` hoặc mất file thì đánh dấu **đã mất khoá** và dừng làm mới.
- Bộ hẹn giờ không giữ tiến trình sống, và được huỷ khi nhả.

**Chiếm khoá:**
- **Chủ đã chết:** `pid` không còn chạy và khác tiến trình hiện tại thì chiếm ngay (giữ hành vi `file-lock.ts:36-38`).
- **Lâu không làm mới:** thời điểm sửa file cũ hơn `staleMs`.
  - Mặc định giữ **30 giây** như cũ, tức 6 lần chu kỳ làm mới (chủ khoá chết mà mã tiến trình bị dùng lại thì người ghi bị chặn không lâu hơn trước).
  - Rule này bắt cả hai trường hợp: mã tiến trình bị dùng lại, và máy ngủ.
- Cách gỡ khoá cũ giữ nguyên kiểu "so nội dung rồi mới xoá" (`file-lock.ts:60-64`).

**Nhả khoá:**
- Đọc khoá, chỉ xoá khi còn đúng `token`.

**Kiểm trước khi hoàn tất (YC-012):**
- `withFileLock` đưa cho hàm chạy một đối tượng `HeldLock` có `assertHeld()`. Hàm này:
  - báo lỗi nếu đã đánh dấu mất khoá;
  - đọc lại khoá, báo lỗi nếu `token` khác.
- `writeJson` nhận thêm tuỳ chọn `beforeCommit`, gọi sau khi ghi file tạm, **trước mỗi lần thử `rename`** trong vòng thử lại.
  - Vòng thử lại hiện có (`store.ts:23-31`) chờ tăng dần tới khoảng 1 giây khi Windows báo `EPERM`, `EBUSY`, `EACCES`. Nếu chỉ kiểm một lần trước vòng, khe có thể dài gần 1 giây.
- Watchlist truyền `assertHeld` vào chỗ này.
- **Khe còn lại** chỉ là khoảng giữa lần đọc khoá trong `assertHeld` gần nhất và **chính lần `rename`** ngay sau nó, đúng như spec chấp nhận.
- `assertHeld` lỗi, ở bất kỳ lần thử nào, thì không đổi tên nữa, file tạm bị xoá, watchlist không đổi. Người dùng thấy lỗi "khoá đã bị tiến trình khác chiếm, thay đổi chưa được lưu".

Ví dụ vòng thử lại:

```
thử 1: beforeCommit → khoá còn của A → rename → EBUSY (phần mềm diệt virus đang mở file) → chờ 20 ms
       (trong lúc chờ, B chiếm khoá)
thử 2: beforeCommit → token trên đĩa là của B → lỗi → xoá file tạm, không rename
Kết quả: watchlist giữ bản của B; A báo lỗi
```

**Tương thích:**
- Người gọi cũ `withFileLock(file, async () => …)` vẫn chạy, vì tham số thêm có thể bỏ qua.
- Câu báo hết hạn chờ giữ nguyên ("đang giữ khoá"), test cũ `watchlist-local.test.ts:96-104` không phải sửa.

**Ví dụ (Story 4 kịch bản 3, thời gian thu nhỏ: `staleMs` 100 ms, A không làm mới):**

```
t=0     A giữ khoá token=a1, đọc watchlist, chuẩn bị ghi "A"
t=50    B xin khoá: khoá chưa cũ → chờ
t=120   B: khoá cũ hơn 100 ms → chiếm, token=b7, ghi "B", đổi tên xong, vẫn giữ khoá
t=200   A: ghi file tạm xong → beforeCommit → assertHeld: token trên đĩa là b7 ≠ a1 → lỗi
        A xoá file tạm; nhả khoá: token b7 ≠ a1 → không xoá
Kết quả: watchlist = "B"; A báo lỗi; khoá của B còn nguyên
```

### 3.3. Ghi phiên (T1, T2)

**Hàng chờ thay cho chuỗi promise.**
- Mỗi `Session` giữ:
  - danh sách **phần ghi đang chờ** theo thứ tự (lượt, bản nén), mỗi phần kèm số lượt và thông tin của lượt;
  - cờ **chỉ mục cần ghi lại**;
  - cờ **đã ngừng ghi**.
- Mọi lần ghi (lượt, bản nén, tiêu đề) đi qua **một hàm xả hàng** duy nhất, chạy nối tiếp bằng một chuỗi **luôn tự bắt lỗi**, nên lần trước lỗi không chặn lần sau (YC-001).

**Xả hàng, với từng phần theo thứ tự:**

1. File chưa "thành lập" thì ghép dòng thông tin phiên vào đầu khối (YC-004). Chỉ khi ghi thành công mới gán `file`. Getter `path` vẫn trả `undefined` trước đó, khớp test `session.test.ts:44`.
2. Đọc kích thước file trước khi ghi (chưa có file thì là 0). File khác rỗng mà byte cuối không phải `\n` thì thêm `\n` vào đầu khối (YC-006).
3. Ghi nối cả khối bằng một lần ghi.
4. **Lỗi:**
   - file đã dài hơn kích thước cũ thì cắt về kích thước cũ (YC-018);
   - cắt lỗi thì bật **đã ngừng ghi**: mọi phần còn lại và phần đến sau không bao giờ được ghi vào file này nữa;
   - dừng xả, trả biên nhận lỗi.
5. **Thành công:** bỏ phần đó khỏi hàng chờ, tăng `turns`, bật "chỉ mục cần ghi lại".

Hết hàng thì ghi dòng chỉ mục nếu cần, cũng có chống dòng cụt. Chỉ mục lỗi thì giữ cờ, thử lại lần sau (YC-005). Không cắt file chỉ mục: dòng chỉ mục trùng vô hại, vì bộ đọc lấy dòng cuối của mỗi phiên (`store.ts:245-253`).

**Biên nhận thay cho promise bị từ chối.**
- `appendTurn`, `appendCompact`, `flush` trả `Promise<SaveReceipt>`, **không bao giờ từ chối**.
- Giao diện dựa vào biên nhận để báo (YC-003).

**Chỗ nối cho test.**
- `store.ts` xuất một đối tượng `sessionFiles` gom các thao tác đĩa mà phần ghi phiên dùng:
  - ghi nối;
  - đọc kích thước;
  - đọc byte cuối;
  - cắt;
  - tạo thư mục.
- Code thật luôn gọi qua đối tượng này. Test dùng `spyOn(sessionFiles, …)` của `bun:test` để giả lập lỗi.
- Không thêm dependency, không dùng `mock.module` (ảnh hưởng cả tiến trình test).

**Cách test nhánh "cắt cũng lỗi" mà không cần Windows:**

1. `spyOn(sessionFiles, "append")` một lần: ghi thật **hai dòng đầy đủ và nửa dòng thứ ba** của lượt vào file tạm, rồi ném lỗi có `code: "ENOSPC"`. Đây là lần ghi lỗi giữa chừng thật trên đĩa.
2. `spyOn(sessionFiles, "truncate")` một lần: ném lỗi có `code: "EBUSY"` và câu "resource busy or locked". Đó là mã lỗi Windows trả khi tiến trình khác (đồng bộ đám mây, diệt virus) giữ file; Node và Bun dùng cùng mã trên mọi hệ điều hành, nên test chạy được ở Ubuntu.
3. **Kỳ vọng:**
   - biên nhận có `stopped: true` và lỗi EBUSY;
   - lượt sau **không** gọi `sessionFiles.append` nữa (đếm số lần gọi);
   - file trên đĩa giữ nguyên phần dở, không bị ghi chồng;
   - danh sách lượt chưa lưu tăng dần.
4. **Ca đối chứng (TC-002):** như bước 1 nhưng **không** giả lập cắt lỗi. File được cắt thật về kích thước cũ. Lượt sau ghi bù. `loadSession` trả đúng từng tin nhắn một lần.

**Ví dụ (Story 1, kịch bản 1–2):**

```
Lượt 1: thư mục sessions/2026 bị chặn bởi một file
  xả hàng: tạo thư mục lỗi ENOTDIR/EEXIST → biên nhận {saved: [], pending: [1], error}
  giao diện: "Chưa lưu được lượt 1: <lỗi>. Sẽ thử lại ở lượt sau."
(gỡ file chặn)
Lượt 2: hàng chờ [1, 2]
  ghi khối 1 = dòng thông tin phiên + lượt 1 → được; ghi khối 2 = lượt 2 → được; chỉ mục turns=2
  biên nhận {saved: [1, 2], pending: []} → giao diện: "Đã lưu bù lượt 1."
```

**Giao diện (`src/tui/session.ts`):**

| Biên nhận | Câu báo |
| --- | --- |
| Có lượt chưa lưu, chưa ngừng | `Chưa lưu được lượt 3–4: <lỗi>. Sẽ thử lại ở lượt sau.` |
| Ghi bù được lượt cũ | `Đã lưu bù lượt 3–4.` (không báo lượt vừa xong) |
| Ngừng ghi | `Ngừng lưu phiên "<tiêu đề>" từ lượt 5: không khôi phục được file sau lần ghi lỗi (<lỗi>). Các lượt sau của phiên này không được lưu.` (chỉ báo một lần) |
| Chỉ mục lỗi | `Đã lưu lượt nhưng chưa cập nhật được danh sách phiên: <lỗi>. Sẽ thử lại.` |

- Lỗi chỉ gồm `message` của lỗi hệ thống, không gồm nội dung tin nhắn.
- **Đợi có hạn.**
  - Ghi đĩa không có hạn chờ riêng (§4). Ổ mạng hay thư mục đồng bộ đám mây bị treo có thể làm `flush()` không trả về.
  - Vì vậy `src/tui/session.ts` có một hàm `settleSession(session, ms = 2000)`: chạy đua `flush()` với hạn `ms`, trả biên nhận hoặc "quá hạn".
  - Đường chuyển phiên và đường thoát dùng chung hàm này, cùng hạn 2 giây như đường thoát hiện có.
- **`/new`, `/clear`, mở lại phiên khác:** `startSession` và `resumeSession` gọi `settleSession` cho phiên đang rời **trước** khi thay `current`.
  - Có biên nhận mà còn phần chờ thì báo: `Phiên "<tiêu đề>" còn 2 lượt chưa lưu được: <lỗi>.`
  - **Quá hạn thì vẫn đổi phiên.** Hàng chờ gắn với từng đối tượng `Session` và ghi vào đúng file của phiên đó. Vì vậy phiên cũ tự xả hàng tiếp ở nền, không lẫn với phiên mới.
  - Lần xả đang treo của phiên cũ có biên nhận thì báo kèm tên phiên: `Phiên "<tiêu đề>": đã lưu bù lượt 5.` hoặc câu lỗi tương ứng.
  - Hàm báo theo biên nhận nhận **chính phiên** đã ghi, không đọc `current`, nên câu báo luôn nêu đúng phiên.
- **Thoát:** `app.tsx` thêm `settleForExit()` (gọi `settleSession` cho phiên hiện tại) vào cùng `Promise.all` có hạn 2 giây. Sau `renderer.destroy()`, nếu còn phần chờ hoặc quá hạn thì in câu báo ra stderr rồi mới `process.exit(0)`. Quá hạn: `Phiên "<tiêu đề>": chưa ghi xong trong 2 giây khi thoát; lượt cuối có thể chưa được lưu.`

Ví dụ (ổ đĩa treo khi đổi phiên):

```
Phiên P1 có lượt 5 đang ghi, ổ mạng treo
/new → settleSession(P1, 2000) → quá hạn sau 2 giây → current = P2, giao diện chạy tiếp
(ổ mạng hết treo sau 30 giây) → P1 ghi lượt 5 vào file của P1 → biên nhận {saved: [5]}
giao diện: "Phiên "Định giá HPG": đã lưu bù lượt 5."
```

**TC-004 và đường thoát.** Đường thoát thật không chạy được trong test TUI headless, vì `onExit` làm `exit()` trả về sớm (`app.tsx:580`). Vì vậy TC-004 được kiểm theo hai phần:
- test lõi: `appendTurn` không được đợi, rồi `flush()` chỉ trả về sau khi lượt đã xuống đĩa;
- test của hàm `settleForExit` trong `src/tui/session.ts`: trả đúng câu báo khi còn phần chờ.

Hai dòng nối vào `exit()` được phiên duyệt đọc ở cổng 3. **Đây là chỗ lệch nhỏ so với chữ "TUI headless" của TC-004**, cần phiên duyệt chấp nhận ở cổng 2.

## 4. Cổng kiểm

| Mục | Trước thiết kế | Sau thiết kế | Ghi chú |
| --- | --- | --- | --- |
| Không thêm dependency | Đạt | Đạt | `spyOn` có sẵn trong `bun:test` |
| Module memory dưới `src/core/memory/`; lõi không import TUI | Không áp dụng | Đạt | Spec 004 chỉ sửa lõi, không có code memory. `src/core/*` không import `src/tui` |
| Mỗi module một trách nhiệm | Đạt | Đạt | Không tạo file chung chung. `sessionFiles` nằm trong `store.ts`, cạnh code dùng nó |
| I/O có timeout; lỗi không bị nuốt | Đạt | Đạt (xem ghi chú) | Thao tác đĩa cục bộ, như code hiện có, không có timeout riêng. Chờ khoá có hạn `timeoutMs`. Chỗ giao diện đợi ghi phiên (thoát, `/new`, `/clear`, mở lại phiên) có hạn 2 giây qua `settleSession`. Lỗi ghi phiên không còn bị nuốt: mọi lỗi thành biên nhận và câu báo |
| Test không chạm mạng, không chạm `~/.opentrading` | Đạt | Đạt | `OPENTRADING_HOME` tạm, thư mục `mkdtemp` |
| Windows và Ubuntu | Đạt | Đạt | Mã lỗi giả lập (`EBUSY`, `ENOSPC`) dùng chung mọi hệ điều hành. File chặn thư mục năm cho lỗi trên cả hai hệ. Không dùng `chmod` để gây lỗi |
| Model không có tool ghi memory | Không áp dụng | Đạt | Không thêm tool; gói 1 bớt tool của agent con |
| Lịch sử phiên chỉ ghi nối | Đạt | Đạt | Ngoại lệ duy nhất YC-018 (cắt phần dở của chính lần ghi lỗi) |
| Bí mật | Đạt | Đạt | Câu báo chỉ có `message` lỗi hệ thống, đường dẫn, số lượt |

## 5. Cấu trúc file

```
src/core/tools/types.ts                [LÕI] thêm trường mainAgentOnly vào ToolDef
src/core/tools/session/history.ts      [LÕI] sessionHistoryTools() gắn mainAgentOnly cho mọi tool trả về
src/core/subagents/manager.ts          [LÕI] childRegistry bỏ tool có mainAgentOnly; sửa chú thích
src/core/file-lock.ts                  [LÕI] token, làm mới, chiếm theo chủ chết hoặc lâu không làm mới, nhả có kiểm chủ, HeldLock
src/core/store.ts                      [LÕI] writeJson nhận tuỳ chọn beforeCommit (gọi ngay trước rename)
src/core/tools/watchlist/local.ts      [LÕI] truyền lock.assertHeld làm beforeCommit
src/core/session/store.ts              [LÕI] hàng chờ, biên nhận, cắt khi ghi lỗi, ngừng ghi, chống dòng cụt, sessionFiles
src/tui/session.ts                     [LÕI] báo theo biên nhận; flush khi chuyển phiên; settleForExit
src/tui/app.tsx                        [LÕI] exit() đợi settleForExit trong hạn 2 giây; in phần chưa lưu ra stderr

test/subagent-session-tools.test.ts    mới: Story 3, TC-006, TC-007
test/file-lock.test.ts                 mới: Story 4 kịch bản 1–4, TC-005 phần trong một tiến trình
test/fixtures/scripts/lock-contender.ts mới: tiến trình phụ cho TN3 (ghi nhật ký vào/ra vùng ghi)
test/session-write.test.ts             mới: Story 1, Story 2, YC-018, TC-001–TC-004, TC-008
```

File test **mới**, không sửa test có sẵn (TC-009: test cũ không phải sửa kỳ vọng).

## 6. Giao diện

```ts
// src/core/tools/types.ts
export interface ToolDef<I = any> {
  // …
  /** Never given to a subagent, whatever its type's tool list says (session history: K9). */
  mainAgentOnly?: boolean
}

// src/core/file-lock.ts
export interface HeldLock {
  /** Throws when another process took the lock over since it was acquired. */
  assertHeld(): Promise<void>
}
export function withFileLock<T>(
  file: string,
  run: (lock: HeldLock) => Promise<T>,
  opts?: { timeoutMs?: number; staleMs?: number; refreshMs?: number },
): Promise<T>

// src/core/store.ts
export function writeJson(file: string, value: unknown, secret?: boolean, opts?: { beforeCommit?: () => Promise<void> }): Promise<void>
/** The rename writeJson retries; a seam so tests can make the first attempt fail with EBUSY on any OS. */
export const jsonFiles: { rename(from: string, to: string): Promise<void> }

// src/core/session/store.ts
export interface SaveReceipt {
  /** Turns this call wrote, including earlier ones it caught up on. */
  saved: number[]
  /** Turns still waiting, oldest first. */
  pending: number[]
  /** Compactions still waiting. */
  pendingCompactions: number
  /** The index line could not be written; retried on the next write. */
  indexPending: boolean
  /** Truncating after a failed write failed too: nothing more goes into this file. */
  stopped: boolean
  /** The latest attempt's error, when anything is still pending or stopped. */
  error?: Error
}
export const sessionFiles: {
  append(file: string, text: string): Promise<void>
  size(file: string): Promise<number> // 0 when missing
  lastByte(file: string, size: number): Promise<number | undefined>
  truncate(file: string, size: number): Promise<void>
  mkdir(dir: string): Promise<void>
}
export class Session {
  appendTurn(messages: ModelMessage[], info: TurnInfo): Promise<SaveReceipt> // never rejects
  appendCompact(entry: CompactEntry): Promise<SaveReceipt> // never rejects
  setTitle(title: string): Promise<void>
  /** Retries whatever is pending; resolves when the attempt is over. */
  flush(): Promise<SaveReceipt>
}

// src/tui/session.ts
/** Waits for a session's writes at most `ms`; a disk that hangs must not freeze /new or exit. */
export function settleSession(session: Session, ms?: number): Promise<SaveReceipt | "timeout">
/** For exit: settleSession on the current session; the line to print when some stay unsaved. */
export function settleForExit(): Promise<string | undefined>
```

Kiểu trả về của `flush()` đổi từ `Promise<void>` sang `Promise<SaveReceipt>`. Người gọi duy nhất là `transcriptOfCurrent` (`src/tui/session.ts:64`), chỉ `await` nên vẫn đúng.

## 7. Điểm đụng lõi

Người dùng xác nhận **từng dòng** trước khi code. Tất cả đang `blocked-by-core`.

| # | File [LÕI] | Sửa gì | Vì sao | Cỡ |
| --- | --- | --- | --- | --- |
| L1 | `src/core/tools/types.ts` | Thêm trường tuỳ chọn `mainAgentOnly` vào `ToolDef`, có chú thích | Đánh dấu nhóm tool agent con không bao giờ nhận, không phụ thuộc tên (YC-014) | Nhỏ (3 dòng) |
| L2 | `src/core/tools/session/history.ts` | `sessionHistoryTools()` gắn `mainAgentOnly: true` cho mọi tool trả về, tại một chỗ | Tool lịch sử thêm sau vào cùng nhóm tự được chặn (YC-014, TC-007) | Nhỏ |
| L3 | `src/core/subagents/manager.ts` | `childRegistry` thêm điều kiện `!t.mainAgentOnly`; sửa chú thích | Chỗ lọc duy nhất cho mọi đường tạo agent con (YC-014, YC-015) | Nhỏ (1 dòng và chú thích) |
| L4 | `src/core/file-lock.ts` | `token` trong khoá; làm mới định kỳ; chiếm khi chủ chết hoặc lâu không làm mới (mặc định 30 giây); nhả có kiểm chủ; `HeldLock.assertHeld` | T3 (YC-009 tới YC-013) | Vừa (viết lại phần lớn file 78 dòng) |
| L5 | `src/core/store.ts` | `writeJson` nhận tuỳ chọn `beforeCommit`, gọi sau khi ghi file tạm và **trước mỗi lần thử `rename`** trong vòng thử lại; lỗi thì không đổi tên, xoá file tạm, ném lại. `rename` gọi qua đối tượng `jsonFiles` để test giả lập `EBUSY` | Kiểm "khoá còn của mình" sát bước hoàn tất nhất có thể, kể cả khi Windows bắt thử lại (YC-012) | Nhỏ |
| L6 | `src/core/tools/watchlist/local.ts` | `updateWatchlists` nhận `HeldLock`, truyền `assertHeld` cho `writeJson` | Người dùng duy nhất của khoá (YC-012) | Nhỏ (2–3 dòng) |
| L7 | `src/core/session/store.ts` | Thay chuỗi promise bằng hàng chờ có biên nhận; ghi dòng thông tin phiên ở lần thành công đầu; cắt khi ghi lỗi; ngừng ghi khi cắt lỗi; chống dòng cụt cho file phiên và chỉ mục; ghi bù chỉ mục; `sessionFiles` | T1, T2 (YC-001 tới YC-007, YC-017, YC-018) | Vừa (lớp `Session`, khoảng 130 dòng; phần đọc không đổi) |
| L8 | `src/tui/session.ts` | `recordTurn`, `recordCompact` báo theo biên nhận, nêu đúng phiên đã ghi; thêm `settleSession` (đợi `flush()` tối đa 2 giây); `startSession`, `resumeSession` gọi `settleSession` cho phiên đang rời, quá hạn thì vẫn đổi phiên và báo khi phiên cũ có biên nhận; thêm `settleForExit` | YC-003, YC-008 (ổ treo không làm đứng `/new`) | Vừa-nhỏ |
| L9 | `src/tui/app.tsx` | `exit()` thêm `settleForExit()` vào `Promise.all` có hạn 2 giây; sau `renderer.destroy()` in câu báo ra stderr nếu có | Đường thoát hiện không đợi ghi phiên (YC-008, T2) | Nhỏ (khoảng 4 dòng) |

**Mô tả PR phải có** (spec §7): nhắc người phụ trách nội dung system prompt rằng agent con không còn tool lịch sử phiên, nên agent chính phải tự trích đoạn lịch sử khi giao việc.

## 8. Cách kiểm

```
C:\Users\Admin\anaconda3\Scripts\bun.exe --version                    (phải 1.4.2)
C:\Users\Admin\anaconda3\Scripts\bun.exe install --frozen-lockfile    (chưa chạy trên feat/memory; chạy trước lần đầu)
C:\Users\Admin\anaconda3\Scripts\bun.exe run typecheck
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/subagent-session-tools.test.ts test/agent-tools.test.ts test/agents.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/file-lock.test.ts test/watchlist-local.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test test/session-write.test.ts test/session.test.ts test/session-tools.test.ts
C:\Users\Admin\anaconda3\Scripts\bun.exe test                                   (toàn bộ, cuối mỗi gói)
```

**Mốc chuẩn chưa có.** Chưa chạy `typecheck` và `bun test` trên `feat/memory` (`dbb94eb`, trên `4c5ffc0`). Gói 1 chạy mốc chuẩn trước khi sửa, để phân biệt test đỏ có sẵn với test đỏ do mình.

**Kiểm tay (bắt buộc, người dùng làm trước cổng 3):** mở TUI với `OPENTRADING_HOME` tạm, hỏi một câu, thoát ngay, mở lại phiên và thấy đủ lượt. Kiểm này bù cho phần TC-004 không chạy được trong test TUI headless.

## 9. Theo dõi độ phức tạp

Không có mục cổng kiểm nào trượt.

| Điểm cần lưu ý | Vì sao cần | Phương án đơn giản hơn bị loại vì |
| --- | --- | --- |
| Thêm trường vào kiểu dùng chung `ToolDef` (L1) | Chặn theo nhóm | Lọc theo tên: quên được. Lọc theo nguồn: vỡ cách gom nhóm trong prompt (§3.1) |
| `writeJson` có thêm tuỳ chọn (L5) | Kiểm khoá ngay trước mỗi lần thử `rename` | Kiểm trong watchlist trước khi gọi `writeJson`, hoặc một lần trước vòng thử lại: khe dài thêm bằng thời gian ghi file tạm và các lần thử lại `rename` trên Windows (tới khoảng 1 giây) |

## 10. Điều chỉnh khi code và duyệt code

Ba vòng duyệt code (`/code-review`) tìm thêm các trường hợp plan chưa tính. Bản đã code khác §3 ở các điểm sau; mọi điểm vẫn nằm trong L1–L9.

**Báo trạng thái lưu phiên.**
- "Đã lưu bù" chỉ báo cho lượt từng được báo là chưa lưu, mỗi lượt một lần, ở lần báo đầu tiên sau khi lượt đó xuống đĩa. Một lần xả hàng có thể ghi cả lượt của lần gọi khác, nên không dựa vào `saved` của từng biên nhận.
- `setTitle` trả biên nhận như mọi lần ghi; `Session` có thêm getter chỉ đọc `lastTurn`.
- Câu cho phiên không phải phiên hiện tại nói "Sẽ thử lại khi thoát hoặc khi mở lại phiên này". Câu khi rời phiên nêu đủ lượt, bản nén và việc chưa vào danh sách phiên.
- `/save`, `/export` đợi ghi có hạn 2 giây và cảnh báo khi bản lưu thiếu lượt.

**Mỗi mã phiên một đối tượng `Session`.**
- Giao diện giữ mọi `Session` đã mở trong lần chạy. Mở lại một phiên luôn dùng lại đối tượng đó (một bộ ghi cho mỗi file); thoát đợi mọi phiên đã mở.
- Phiên đích được kiểm **trước** khi rời phiên hiện tại. Phiên còn phần chưa lưu thì không mở lại (file đọc lại sẽ thiếu phần đó). Phiên đã ngừng ghi thì không mở lại trong lần chạy này; phần đã lưu mở lại được sau khi khởi động lại.

**Ghi phiên ở lõi.**
- Dòng chỉ mục được ghi ngay khi có lượt xuống đĩa, kể cả khi phần sau trong hàng chờ lỗi. Yêu cầu ghi chỉ mục được đếm, không phải cờ: tiêu đề đến khi dòng chỉ mục đầu đang ghi vẫn được ghi.
- Cắt file sau lần ghi lỗi chỉ khi phần đuôi mới thêm đúng là phần đầu khối mình gửi. Có dữ liệu của bộ ghi khác, hoặc vẫn không đọc lại được file sau vài lần thử, thì không cắt mà ngừng ghi phiên đó (YC-018).
- Phần chờ không giữ nội dung tin nhắn (chỉ chữ câu hỏi đầu để làm tiêu đề); phiên đã ngừng ghi chỉ đếm lượt và bản nén.

**Khoá file.**
- Kiểm chủ có ba kết quả: của mình, mất (sai mã hoặc file không còn), chưa biết (lỗi đọc thoáng qua). "Chưa biết" thì làm mới bỏ lượt đó, kiểm trước khi ghi thử lại vài lần rồi từ chối, nhả khoá thử lại rồi để lại.
- Tạo khoá gặp `EPERM`, `EACCES`, `EBUSY` (Windows còn đang xoá file khoá cũ) thì chờ như khi khoá đang có người giữ.
- Chiếm khoá so cả nội dung và thời điểm sửa file, nên chủ vừa làm mới không mất khoá.
- `staleMs` mặc định 30 giây (6 lần chu kỳ làm mới); `refreshMs` mặc định `min(5000, staleMs / 6)`.
- Ghi nội dung khoá lỗi thì xoá file khoá rỗng.

**`writeJson`.** Xoá file tạm ở mọi nhánh lỗi (với `auth.json`, file tạm chứa khoá API).
