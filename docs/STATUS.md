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
| `/connect`: 204 provider (models.dev), `/model` gộp model của mọi provider | Xong |
| Chat stream, `esc` để dừng, lỗi hiển thị tiếng Việt, Tab hoàn thành lệnh | Xong |
| **Agent loop** (`src/core/agent.ts`) | Xong. Gọi tool nhiều bước; giới hạn 10 bước, bước cuối bắt model tổng kết; lỗi tool được trả về cho model; khi huỷ hoặc lỗi, history không còn tool-call nào thiếu kết quả |
| **Tool registry** (`src/core/tools/`) | Xong. Tool có sẵn và tool MCP dùng chung một interface; tool chỉ đọc chạy song song, tool khác chạy lần lượt; có timeout; output bị cắt ở 30.000 ký tự |
| Tool có sẵn: `current_time` (giờ VN), `load_skill` (nạp skill khi model cần) | Xong |
| **MCP client** (`src/core/mcp/`) | Xong, ngang Claude Code/opencode: |
| ↳ transport | stdio, Streamable HTTP, SSE (tự fallback); tự thử lại, tự kết nối lại, khôi phục khi session hết hạn |
| ↳ đăng nhập | OAuth 2.1 (DCR, PKCE, refresh); secret trong `mcp-auth.json` |
| ↳ cấu hình | `~/.opentrading/mcp.json` + `.mcp.json` (project phải được cho phép); lọc tool `enabledTools`/`disabledTools` |
| ↳ tool | schema chuẩn hoá theo provider; tối đa 128 tool/request; tìm tool `tool_search` (tool MCP hoãn, nạp theo nhu cầu); ảnh trong kết quả; prompts → `/server:prompt`; resources |
| ↳ CLI | `opentrading mcp add/list/login/secret/debug…` |
| `/mcp` (giống Claude Code: danh sách → server → tool → chi tiết; danh mục server có sẵn, mặc định tắt), `/tools`, `ctrl+o` | Xong |
| **Xác nhận tool ghi** (`src/core/permission.ts`) | Xong. Tool không chỉ đọc phải được cho phép: một lần / cả phiên / luôn (gắn với server) / không (kèm lời nhắn) |
| Server mẫu cho đồng nghiệp: `examples/mcp-demo` | Xong |
| **Prompt theo tầng** (`src/core/prompt/`, nội dung ở `prompts/*.md`) | Xong. 3 kênh system / context / reminder; ngân sách theo hạng model; đồng hồ phiên từ `market/calendar.json`, chỉ gửi lại khi đổi phiên; cache cho Anthropic; `/context` |
| **Skills** (`src/core/skills/`) | Xong. `skills/<tên>/SKILL.md`; 3 nguồn project > user > bundled; activation auto/always/manual; catalog có ngân sách; gợi ý theo từ khoá (preroute L1); `load_skill` đọc được file phụ |
| Hồ sơ nhà đầu tư `~/.opentrading/INVESTOR.md`, `/profile` | Xong |
| **Hook** (`src/core/hooks.ts`): session-start, user-prompt (chặn hoặc thêm ngữ cảnh), turn-end, session-end | Xong |
| **Memory** (`src/core/memory/`): contract `MemoryProvider`, bản mẫu `FileMemory` (đề xuất → duyệt trong `/memory`, "Ghi nhớ: …"), mặc định tắt; bật trong `/config` | Xong |
| **Session** (`src/core/session/`): JSONL ghi nối, `/sessions`, `/new`, `--continue`, `--resume <id>`, vá tool-call thiếu kết quả | Xong |
| **Subagent** (`src/core/subagents/`, `src/core/agents/`, PR #32–#34) | Xong. `spawn_subagent` chạy song song, giới hạn trong `/config` (mặc định 10, xếp hàng); khối tiến độ kiểu Claude Code; tool ghi hỏi ở UI chính (chỉ Enter); 4 loại có sẵn + `.opentrading/agents/*.md`; chạy nền, `<thong_bao_subagent>`, `send_message`/`stop_agent`, `/agents`, `/tasks`; transcript riêng trong `sessions/…/subagents/` |
| Test: typecheck + 296 test (tool, MCP qua stdio/HTTP/SSE/OAuth giả, schema thật, agent loop, subagent, TUI headless, quyền) | Xong |

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
