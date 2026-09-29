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

**Bước 1 xong** (agent loop, tool registry, MCP client). **Bước 2 xong**: 2a (prompt theo tầng, skills chuẩn `SKILL.md`, hồ sơ nhà đầu tư) và 2b (hook, memory có bước duyệt, lưu và mở lại session). Tiếp theo: bước 3. Contract cho đồng nghiệp: [docs/contracts.md](contracts.md).

### Đã có

| Hạng mục | Trạng thái |
| --- | --- |
| TUI: logo, background động, Home, Chat, status bar | Xong |
| `/connect`: 204 provider (models.dev), `/model` gộp model của mọi provider | Xong |
| Chat stream, `esc` để dừng, lỗi hiển thị tiếng Việt, Tab hoàn thành lệnh | Xong |
| **Agent loop** (`src/core/agent.ts`) | Xong. Gọi tool nhiều bước; giới hạn 10 bước, bước cuối bắt model tổng kết; lỗi tool được trả về cho model; khi huỷ hoặc lỗi, history không còn tool-call nào thiếu kết quả |
| **Tool registry** (`src/core/tools/`) | Xong. Tool có sẵn và tool MCP dùng chung một interface; tool chỉ đọc chạy song song, tool khác chạy lần lượt; có timeout; output bị cắt ở 30.000 ký tự |
| Tool có sẵn: `current_time` (giờ VN), `load_skill` (nạp skill khi model cần) | Xong |
| **MCP client** (`src/core/mcp/`) | Xong. Hỗ trợ stdio và Streamable HTTP; đọc `~/.opentrading/mcp.json` và `.mcp.json` của project; server project phải được cho phép; hỗ trợ `${VAR}`; kết nối song song, có timeout; server không thấy API key của harness |
| `/mcp`, `/tools`, `ctrl+o`, trạng thái MCP trên status bar | Xong |
| Server mẫu cho đồng nghiệp: `examples/mcp-demo` | Xong |
| **Prompt theo tầng** (`src/core/prompt/`, nội dung ở `prompts/*.md`) | Xong. 3 kênh system / context / reminder; ngân sách theo hạng model; đồng hồ phiên từ `market/calendar.json`, chỉ gửi lại khi đổi phiên; cache cho Anthropic; `/context` |
| **Skills** (`src/core/skills/`) | Xong. `skills/<tên>/SKILL.md`; 3 nguồn project > user > bundled; activation auto/always/manual; catalog có ngân sách; gợi ý theo từ khoá (preroute L1); `load_skill` đọc được file phụ |
| Hồ sơ nhà đầu tư `~/.opentrading/INVESTOR.md`, `/profile` | Xong |
| **Hook** (`src/core/hooks.ts`): session-start, user-prompt (chặn hoặc thêm ngữ cảnh), turn-end, session-end | Xong |
| **Memory** (`src/core/memory/`): contract `MemoryProvider`, bản mẫu `FileMemory` (đề xuất → duyệt trong `/memory`, "Ghi nhớ: …"), mặc định tắt; bật trong `/config` | Xong |
| **Session** (`src/core/session/`): JSONL ghi nối, `/sessions`, `/new`, `--continue`, `--resume <id>`, vá tool-call thiếu kết quả | Xong |
| Test: typecheck + 81 test (tool, MCP với server thật qua stdio, agent loop, TUI, đường dẫn state) | Xong |

**Chưa kiểm tra:**
- Chưa chạy với key thật của provider nào. Tool calling mới được test trên định dạng OpenAI-compatible bằng API giả lập; Gemini và Anthropic cần thử bằng key thật.
- Chưa mở trong Windows Terminal thật.

Provider chưa hỗ trợ: xem `ToDoList.txt`.

## Phần khung harness còn thiếu

1. ~~Agent loop có tool calling~~ ✓
2. ~~Tool registry~~ ✓
3. ~~MCP client~~ ✓
4. ~~Ghép system prompt theo tầng~~ ✓ (2a)
5. ~~Skill loader hoàn chỉnh~~ ✓ (2a)
6. ~~Memory interface~~ ✓ (2b)
7. ~~Lưu session~~ ✓ (2b)
8. **Permission gate.** Tool không chỉ đọc phải được người dùng xác nhận trong TUI. AI SDK v6 có sẵn `needsApproval`.
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
| 3 | Permission gate, mở rộng config | Tiếp theo |

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
