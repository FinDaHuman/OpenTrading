# Trạng thái dự án & kế hoạch

Cập nhật: 30/09/2026 · nhánh `step2b-session-memory`

## Phân công

| Phần | Người phụ trách |
| --- | --- |
| Khung harness: agent loop, tool registry, MCP client, TUI, provider, session, permission, config | Chủ repo |
| Memory | Đồng nghiệp |
| MCP server (dữ liệu chứng khoán…) | Đồng nghiệp, xem [docs/mcp.md](mcp.md) |
| Nội dung skills | Đồng nghiệp |
| Nội dung system prompt | Đồng nghiệp |

## Hiện tại

**Bước 1, 2a, 2b xong.**
- **MCP xong**, ngang Claude Code/opencode: OAuth, SSE, CLI, schema theo provider, `/mcp`, xác nhận tool ghi (PR #12–#14).
- **Giao diện giống Claude Code**:
  - danh sách 1 dòng, dialog thành panel, phần `/` (PR #15);
  - khung chat `❯`/`●`/`⎿`, tool hỏi người dùng `ask_user` (PR D2).

- **Sau đó (tới 07/10/2026)**:
  - tool search #19–#20; prompt, todo, nén hội thoại #21–#24;
  - skills và tool local #25; ô nhập kiểu Claude Code #29–#31;
  - **subagent #32–#34**: [docs/subagents.md](subagents.md).

Giới hạn Gemini API: [docs/gemini-limits.md](gemini-limits.md).

Contract cho đồng nghiệp: [docs/contracts.md](contracts.md).

### Đã có

| Hạng mục | Trạng thái |
| --- | --- |
| TUI: logo, background động, Home, Chat, status bar | Xong |
| Giao diện giống Claude Code | Xong |
| ↳ khung chat | `❯` tin nhắn, `●` trả lời và tool, kết quả dưới `⎿` (3 dòng, ctrl+o mở rộng) |
| ↳ panel và danh sách | mọi dialog là panel thay chỗ ô nhập; danh sách 1 dòng, cột thẳng, cắt `…` |
| ↳ phần `/` | Enter chạy, Tab điền, Esc đóng tới khi gõ thêm |
| **Tool hỏi người dùng** `ask_user` (`src/core/ask.ts`) | Xong. 1–4 câu trắc nghiệm, chọn nhiều, tự nhập, xem lại trước khi gửi; chờ trả lời không tính timeout |
| `/connect`: 204 provider (models.dev), `/model` gộp model của mọi provider | Xong. `/model` và `/config` chỉ liệt kê model chat gọi được tool (ẩn embedding, TTS, ảnh/video/nhạc, live/realtime, rerank, guard, deep-research, computer-use, bản deprecated/alpha); model đang cấu hình luôn hiện |
| Chat stream, `esc` để dừng, lỗi hiển thị tiếng Việt, Tab hoàn thành lệnh | Xong |
| **Agent loop** (`src/core/agent.ts`) | Xong. Gọi tool nhiều bước; mặc định không chặn số bước (model tự dừng, `maxSteps` trong config để đặt trần — có trần thì bước cuối bắt model tổng kết); lỗi tool được trả về cho model; khi huỷ hoặc lỗi, history không còn tool-call nào thiếu kết quả. Request lỗi được thử lại theo loại lỗi (`src/core/retry.ts`): hết quota ngày, key sai, request sai, context quá dài thì dừng ngay; 429 theo phút chờ đúng thời gian provider báo (tối đa 60 giây, 2 lần); quá tải/5xx/mạng chờ 2s→4s→8s→16s (tối đa 4 lần); giao diện hiện "thử lại sau Ns (lần n/m)", Esc để dừng |
| **Tool registry** (`src/core/tools/`) | Xong. Tool có sẵn và tool MCP dùng chung một interface; tool chỉ đọc chạy song song, tool khác chạy lần lượt; có timeout; output bị cắt ở 30.000 ký tự |
| Tool có sẵn: `current_time` (giờ VN), `load_skill` (nạp skill khi model cần) | Xong |
| **MCP client** (`src/core/mcp/`) | Xong, ngang Claude Code/opencode: |
| ↳ transport | stdio, Streamable HTTP, SSE (tự fallback); tự thử lại, tự kết nối lại, khôi phục khi session hết hạn |
| ↳ đăng nhập | OAuth 2.1 (DCR, PKCE, refresh); secret trong `mcp-auth.json` |
| ↳ cấu hình | `~/.opentrading/mcp.json` + `.mcp.json` (project phải được cho phép); lọc tool `enabledTools`/`disabledTools` |
| ↳ tool | schema chuẩn hoá theo provider; tối đa 128 tool/request; tìm tool `tool_search` (tool MCP hoãn, nạp theo nhu cầu); ảnh trong kết quả; prompts → `/server:prompt`; resources |
| ↳ CLI | `opentrading mcp add/list/login/secret/debug…` |
| `/mcp` (giống Claude Code: danh sách → server → tool → chi tiết; danh mục server có sẵn, mặc định tắt), `/tools`, `ctrl+o` | Xong |
| **Xác nhận tool ghi** (`src/core/permission/`) | Xong. Tool không chỉ đọc phải được cho phép: một lần / cả phiên / luôn (gắn với server) / không (kèm lời nhắn). Từ #92 là pipeline: chặn cứng → quy tắc chặn → vùng chỉ người dùng duyệt → quy tắc hỏi/cho phép → chế độ |
| **File và shell** (`src/core/fs/`, `src/core/tools/fs/`, `src/core/tools/shell/`, PR #91 #92 #94 #96) | `read_file` (text, thư mục, PDF, ảnh, .xlsx, .docx), `glob_files`, `grep_files`, `write_file`, `edit_file` (đọc trước, kiểm file đổi, giữ encoding, diff khi duyệt), `shell` (PowerShell/bash, timeout giết cả cây, lọc key khỏi env). Workspace = thư mục đang mở + `/add-dir`. `/undo`. Xem [permissions.md](permissions.md) |
| **Chế độ quyền** (PR #92, #95) | `‖ chỉ đọc` / `▸ sửa có hỏi` / `▸▸ tự động` (model duyệt 2 bước, luật mặc định có "giao dịch thật", 3/20 lần chặn thì hỏi tay), Shift+Tab, `/permissions`, `/config`. Bộ đánh giá 76 ca: `bun scripts/dev/auto-mode-eval.ts --yes` |
| Server mẫu cho đồng nghiệp: `examples/mcp-demo` | Xong |
| **Prompt theo tầng** (`src/core/prompt/`, nội dung ở `prompts/*.md`) | Xong. 3 kênh system / context / reminder; ngân sách theo hạng model; đồng hồ phiên từ `market/calendar.json`, chỉ gửi lại khi đổi phiên; cache cho Anthropic; `/context` |
| **Skills** (`src/core/skills/`) | Xong. `skills/<tên>/SKILL.md`; 3 nguồn project > user > bundled; activation auto/always/manual; catalog có ngân sách; gợi ý theo từ khoá (preroute L1); `load_skill` đọc được file phụ |
| Hồ sơ nhà đầu tư `~/.opentrading/INVESTOR.md`, `/profile` | Xong |
| **Hook** (`src/core/hooks.ts`): session-start, user-prompt (chặn hoặc thêm ngữ cảnh), turn-end, session-end | Xong |
| **Memory** (`src/core/memory/`): contract `MemoryProvider`, Sổ ghi nhớ v5.1 (xem mục dưới), mặc định tắt; bật trong `/config`. Memory cũ (`FileMemory`) đã gỡ ở spec 007 | Xong |
| **Session** (`src/core/session/`): JSONL ghi nối, `/sessions`, `/new`, `--continue`, `--resume <id>`, vá tool-call thiếu kết quả | Xong |
| **Subagent** (`src/core/subagents/`, `src/core/agents/`, PR #32–#34) | Xong. `spawn_subagent` chạy song song, giới hạn trong `/config` (mặc định 10, xếp hàng); khối tiến độ kiểu Claude Code; tool ghi hỏi ở UI chính (chỉ Enter); 4 loại có sẵn + `.opentrading/agents/*.md`; chạy nền, `<thong_bao_subagent>`, `send_message`/`stop_agent`, `/agents`, `/tasks`; transcript riêng trong `sessions/…/subagents/` |
| Test: typecheck + bộ test (tool, MCP qua stdio/HTTP/SSE/OAuth giả, schema thật, agent loop, subagent, TUI headless, quyền, file, shell, auto mode) | Xong; số test hiện tại: `bun test` |

### Memory v5.1 (đang làm, nhánh `feat/memory`)

Trạng thái: kiến trúc và quyết định đã chốt. Spec 004 (sửa lỗi lõi) **`implemented`**: test chạy trên máy, chưa chạy CI. Spec 001 (kho `memory.db` và bảng chính sách theo loại) **`implemented`**: test chạy trên máy, chưa chạy CI, chưa qua duyệt code. Spec 002 (provider v5.1, đường đọc) **`implemented`**: test chạy trên máy, chưa chạy CI, chưa qua duyệt code, chưa thử tay trên TUI và chưa thử với model thật. Người dùng chọn **"Sổ ghi nhớ"** trong `/config` (bên cạnh "Tắt" và "Memory cũ"); ràng buộc và cách trình bày vào phần hệ thống của mọi request, không bị cắt; mục lục sổ vào phần bối cảnh; khi người dùng nhắc một mã có luận điểm, khối luận điểm có nhãn được chèn một lần trong phiên; model đọc thêm bằng `memory_read` (chỉ đọc); `/memory` cho xem năm nhóm và xoá có hỏi lại. Spec 003 (đường ghi) **`implemented`**: test chạy trên máy, chưa chạy CI, chưa qua duyệt code, chưa thử tay trên TUI. Bốn lệnh `/nho` (ràng buộc hoặc cách trình bày), `/luandiem <mã>`, `/baihoc`, `/quyetdinh <mã>` mở form chạy tại máy, không gọi model; chỉ lưu khi người dùng bấm Xác nhận; lịch sử ô nhập chỉ giữ tên lệnh; hai cửa sổ cùng sửa thì cửa sổ lưu sau thấy chỗ khác nhau, không ghi đè; `/memory` thêm sửa (`s`), đổi trạng thái luận điểm (`t`), xuất Markdown (Ctrl+X, mặc định không kèm nhật ký quyết định). Spec 005 (ràng buộc tới agent con và hồ sơ) **`implemented`**: test chạy trên máy, chưa chạy CI, chưa qua duyệt code, chưa thử tay trên TUI và chưa thử với model thật; phần lõi `blocked-by-core` tới khi chủ repo duyệt. Ràng buộc trong `memory.db` tới agent chính và mọi agent con (giao việc mới, giao tiếp việc, ultradesk) ở cả ba lựa chọn memory, đúng một lần, không bị cắt; hồ sơ `INVESTOR.md` hoặc kho ràng buộc đọc lỗi thì lượt bị hoãn trước khi gửi, giao diện hiện thẻ "Thử lại" / "Chạy lượt này không có …" / "Huỷ", dòng lệnh thử provider báo lỗi và thoát mã 1; file mẫu `/profile` mới đưa ví dụ vào chú thích, và khi gửi thì bỏ chú thích cùng dòng ví dụ của mẫu cũ; hồ sơ được escape trước khi bọc. Spec 007 (nén hội thoại, gỡ memory cũ, thẻ gợi ý) **`implemented`**: test chạy trên máy Windows và Linux, chưa qua duyệt code, chưa thử tay trên TUI và chưa thử với model thật (xem đoạn spec 007 dưới). Bản mẫu `FileMemory` ở trên giữ nguyên.

Spec 006 (nhãn trong lịch sử, che khi xoá, mã lượt) **`implemented`**: test chạy trên máy, chưa chạy CI, chưa qua duyệt code, chưa thử tay trên TUI và chưa thử với model thật. Phần sửa lõi (`memory/types.ts`, `tools/types.ts`, `tools/registry.ts`, `events.ts`, `agent.ts`, `session/store.ts`, `tools/session/history.ts`, `runtime.ts`, `tui/session.ts`, `tui/app.tsx`) **`blocked-by-core`** tới khi chủ repo duyệt. Hai giới hạn của bản tối thiểu (spec 002) đã gỡ:
- Sổ ghi nhớ không còn tự nhớ trong RAM khối nào đã gửi: mỗi lượt nó đọc khối, dòng nhắc và dòng trỏ từ lịch sử sẽ gửi. Khởi động lại, mở lại phiên, tắt rồi bật sổ, hay lượt bị bỏ rồi gửi lại đều không làm khối bị chèn lặp hay thiếu. Chỉ còn danh sách chủ đề đang bàn nằm trong RAM, và nó được dựng lại từ chữ người dùng gõ trong lịch sử khi phiên vừa mở lại hay app vừa khởi động lại, nên câu hỏi nối tiếp vẫn giữ chủ đề của các lượt trước.
- Xoá luận điểm hay bài học thì che khối của mục đó: trong hội thoại đang mở (ngay lúc xoá nếu không có lượt hay lần nén đang chạy, không thì từ lượt sau), khi mở lại phiên, trong `/export` và trong tool đọc phiên cũ. Che là thay khối bằng "[Memory · bài học #7 đã bị người dùng xoá]" và ghi một dòng `redact` nối vào file phiên; không dòng nào đã lưu bị sửa. Dòng che chỉ được ghi khi kho đọc được và còn bản ghi xoá của đúng mục và bản đó (xoá là logic, ID không dùng lại). Không có kho, kho không đọc được, kho không biết mục đó (tạo lại rỗng, chuyển máy chỉ copy `sessions/`, khôi phục backup cũ), hay khối khác nội dung với kho (kho tạo lại trùng số) thì chỉ tạm che trong những gì gửi đi, có câu báo riêng, không ghi gì. Câu báo xoá nói "đã xoá khỏi ứng dụng" và bản đã gửi provider không thu hồi được.
- Dòng `turn_end` có số lượt; mở lại phiên đếm tiếp từ file, không từ dòng chỉ mục.
- `memory_read` trả một câu ngắn trỏ tới nhãn khối khi đúng bản đó đang nằm trong phần model thấy.
- Ngân sách tự chèn và mục lục theo hạng của model nhận lượt (`MemoryContext.tier`; A 4.000, B 2.800, C 1.200 ký tự), không còn lấy hạng nhỏ nhất cho mọi model. Form luận điểm cảnh báo khi khối dài hơn giới hạn tự chèn. Mục lục quá dài thì bỏ mục cũ nhất trước.
- Mục lục được ghim theo phiên: lưu, sửa hay đổi trạng thái một mục không đổi phần bối cảnh (không vỡ cache); mục mới được báo một lần bằng dòng nhắc nối thêm. Mục lục chỉ dựng lại khi một mục trong nó bị xoá (ADR 0002 chấp nhận vỡ cache ở đây) hoặc khi đổi hạng model; trạng thái luận điểm trong mục lục có thể cũ tới lúc đó.

Chủ đề đổi mã sau khi khối đã gửi: sổ nhận ra khối mang mã cũ (qua bí danh đã thôi dùng) nên không chèn lại; chữ người dùng gõ vẫn chỉ khớp mã đang dùng. Giới hạn bản tóm tắt chép nội dung khối memory đã gỡ ở spec 007.

Spec 007 **`implemented`**. Phần sửa lõi (`config.ts`, `runtime.ts`, `memory/types.ts`, `agent.ts`, `compact.ts`, `compact-marker.ts`, `events.ts`, `prompt/assemble.ts`, `prompt/budget.ts`, `session/store.ts`, `tui/app.tsx`, `tui/state.ts`, `tui/transcript.tsx`, `tui/session.ts`, `tui/main.tsx`, `tui/commands.ts`, `tui/dialogs/*`) **`blocked-by-core`** tới khi chủ repo duyệt.
- Nén: model tóm tắt không còn thấy nội dung khối memory (chỉ dòng nhãn), mục lục, hướng dẫn sổ hay khối `rang_buoc`; mẫu tóm tắt hai bản có "Ràng buộc và sở thích" và dặn không chép memory, ràng buộc đã lưu, hồ sơ. Lượt đầu sau mỗi lần nén có dòng nhắc mang mã nén; mục lục dựng lại.
- Memory cũ (`FileMemory`, `propose_memory`, hook "Ghi nhớ: …") đã gỡ; `/config` còn "Tắt" và "Sổ ghi nhớ". Cấu hình `"file"` được hiểu là Sổ ghi nhớ; giao diện ghi lại và báo một lần, thư mục `memory/` cũ giữ nguyên. Việc 31a (lưu trùng) hết.
- Thẻ gợi ý: model có thể kết thúc câu trả lời bằng một khối `<the_goi_y>` (ràng buộc, cách trình bày, bài học). Lõi tách khối khỏi lịch sử ở mọi lượt; giao diện ẩn cả lúc stream, hiện thẻ dưới câu trả lời. Thẻ ràng buộc và cách trình bày phải trích đúng câu người dùng gõ. Enter mở form spec 003 điền sẵn, `x` bỏ qua, `/goiy` chọn lại. Lưu từ thẻ có nguồn "từ thẻ gợi ý". Dòng `card` trong file phiên; mở lại phiên hiện lại thẻ. Lượt sau model được báo kết quả. Công tắc "Cho phép thẻ gợi ý" trong `/config`; không có thẻ với model hạng C, agent con, dòng lệnh không giao diện.
- Hướng dẫn sổ có luật "người dùng bảo bỏ qua memory".

- Kiến trúc: [docs/memory/ra-soat-v5.md](memory/ra-soat-v5.md), phần C.
- Quyết định: ADR [0002](decisions/0002-memory-ban-ghi-co-nhan.md) (bản ghi có nhãn trong hội thoại), [0003](decisions/0003-memory-kho-sqlite-va-dinh-danh.md) (kho SQLite và định danh), [0004](decisions/0004-memory-muc-luc-va-model-tu-doc.md) (mục lục, model tự đọc bài học), [0005](decisions/0005-memory-rang-buoc-co-cau-truc.md) (ràng buộc có cấu trúc), [0006](decisions/0006-memory-ranh-gioi-theo-loai.md) (bảng chính sách, agent con không đọc lịch sử phiên).
- Lộ trình và trạng thái từng spec: [docs/memory/specs/README.md](memory/specs/README.md).
- **Thay đổi lõi dự kiến** (cần chủ repo duyệt, nằm chung PR `feat/memory`; mỗi spec một commit, thân commit liệt kê từng file lõi đã sửa kèm lý do, mô tả PR có bảng "Thay đổi lõi cần chủ repo duyệt"):
  - sửa lỗi ghi phiên và khoá file (spec 004, đã code);
  - agent con không có tool lịch sử phiên (spec 004, đã code);
  - thêm lựa chọn provider "Sổ ghi nhớ" (spec 002, đã code): `src/core/config.ts`, `src/core/runtime.ts` (mở kho, `closeMemory`), `src/tui/dialogs/config.tsx` (màn con ba lựa chọn), `src/tui/app.tsx` (báo lỗi mở kho lúc khởi động, đóng kho khi thoát), `src/tui/dialogs/memory.tsx` và file mới `src/tui/dialogs/notebook.tsx` (màn `/memory` của sổ ghi nhớ);
  - lệnh và form memory trong TUI (spec 003, đã code): `src/tui/commands.ts` (bốn lệnh), `src/tui/state.ts` (hộp thoại form, hai cờ cho Ctrl+C), `src/tui/app.tsx` (nhận ra lệnh memory trước khi ghi lịch sử ô nhập, mở form, Ctrl+C trên form có thay đổi thì hỏi lại), `src/tui/dialogs/notebook.tsx` (sửa, đổi trạng thái, xuất), thư mục mới `src/tui/dialogs/notebook-form/`;
  - ràng buộc tới agent con và hồ sơ (spec 005, đã code): `src/core/profile.ts` (đọc nghiêm, hạn chờ, lọc mẫu, mẫu mới), `src/core/prompt/assemble.ts` và `budget.ts` (lớp `rang_buoc`, `nguon_chua_nap`, escape hồ sơ), `src/core/agent.ts` (bước ràng buộc ở đầu lượt), `src/core/runtime.ts`, `src/core/subagents/manager.ts`, `src/core/chat.ts`, `src/tui/state.ts`, file mới `src/tui/hold-card.tsx`, `src/tui/app.tsx` (thẻ hoãn), `src/tui/dialogs/config.tsx`, `src/tui/dialogs/notebook-form/open.ts` và `forms.tsx`, `src/tui/dialogs/context.tsx`;
  - che khối memory trong lịch sử khi xoá.

**Chưa kiểm tra:**
- Đã thử với key Gemini thật, gồm cả subagent (người dùng xác nhận ngày 07/10/2026). Anthropic và OpenAI chưa thử bằng key thật.
- Chưa mở trong Windows Terminal thật.

Provider chưa hỗ trợ (cần SDK riêng hoặc biến cấu hình thêm) bị ẩn khỏi `/connect`: xem `isSupported()` trong `src/core/providers.ts`.

## Phần khung harness còn thiếu

1. ~~Agent loop có tool calling~~ ✓
2. ~~Tool registry~~ ✓
3. ~~MCP client~~ ✓
4. ~~Ghép system prompt theo tầng~~ ✓ (2a)
5. ~~Skill loader hoàn chỉnh~~ ✓ (2a)
6. ~~Memory interface~~ ✓ (2b)
7. ~~Lưu session~~ ✓ (2b)
8. ~~Permission gate~~ ✓ (`src/core/permission.ts`)
9. **Mở rộng config**: thư mục skills, tuỳ chọn memory, giới hạn số bước.

Việc phụ:
- Thử key thật với Gemini, Anthropic, OpenAI, OpenRouter.
- Cập nhật `CONTRIBUTING.md` và `handbook/`.
- Đóng gói bằng `bun build --compile`.
- Chuyển `dependabot.yml` từ pip sang npm.

## Kế hoạch

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 1 | Agent loop, tool registry, MCP client, tool mẫu, TUI hiển thị tool call | **Xong** |
| 2a | Ghép prompt theo tầng, skills chuẩn `SKILL.md`, hồ sơ nhà đầu tư, `/context`, `docs/contracts.md` | **Xong** |
| 2b | Hook, `MemoryProvider` + bản mẫu, `/memory`, lưu và mở lại session (`/sessions`, `--continue`) | **Xong** |
| MCP | Kết nối MCP phổ biến (OAuth, SSE, CLI), tương thích tool, `/mcp`, xác nhận tool ghi | **Xong** (#12–#14) |
| UI | Giao diện giống Claude Code, `ask_user` | **Xong** (#15, D2) |
| Subagent | `spawn_subagent`, loại agent, chạy nền, `/agents`, `/tasks` | **Xong** (#32–#34) |
| File/shell + quyền | Tool đọc/ghi file, shell, 3 chế độ quyền, auto mode có model duyệt | **PR mở** (#91 #92 #94 #95 #96, tài liệu: [permissions.md](permissions.md)) |
| 3 | Mở rộng config (giới hạn bước…), `/why`, đóng gói `bun build --compile` | Tiếp theo |

## Cho đồng nghiệp: bắt đầu thế nào

```shell
git checkout main && git pull
bun install
bun run dev        # mở TUI
bun run typecheck
bun test
```

- **MCP server:** đọc [docs/mcp.md](mcp.md), bắt đầu từ `examples/mcp-demo/server.ts`. Cắm server vào `.mcp.json` rồi kiểm tra bằng `/mcp` và `/tools`.
- **Skills:** viết `skills/<tên>/SKILL.md` theo [docs/contracts.md §3](contracts.md). Kiểm tra bằng `/skills` (lỗi frontmatter hiện ở đây).
- **System prompt:** sửa các file `prompts/*.md` theo [docs/contracts.md §2](contracts.md). Xem kết quả bằng `/context`, không cần build lại.
- **Memory:** cài `MemoryProvider` theo [docs/contracts.md §6](contracts.md); bắt đầu từ `src/core/memory/file-memory.ts`.

Cấu trúc code: xem `README.md`. Lý do chọn TypeScript: xem `docs/decisions/0001-typescript.md`.
