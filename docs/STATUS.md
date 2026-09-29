# Trạng thái dự án & kế hoạch

Cập nhật: 29/09/2026 · nhánh `step1-agent-tools`

## Phân công

| Phần | Người phụ trách |
| --- | --- |
| Khung harness: agent loop, tool registry, MCP client, TUI, provider, session, permission, config | Chủ repo |
| Memory | Đồng nghiệp |
| MCP server (dữ liệu chứng khoán…) | Đồng nghiệp, xem [docs/mcp.md](mcp.md) |
| Nội dung skills | Đồng nghiệp |
| Nội dung system prompt | Đồng nghiệp |

## Hiện tại

**Bước 1 đã xong: agent loop, tool registry và MCP client.** Model gọi được tool có sẵn và tool từ MCP server, rồi trả lời dựa trên kết quả. TUI hiển thị từng lần gọi tool.

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
| Skills: đọc `skills/*.md`, bật/tắt, `load_skill` | Bản thô |
| System prompt: nguyên tắc cơ bản + phần hướng dẫn dùng tool | Bản thô, chưa chia tầng |
| Test: typecheck + 44 test (tool, MCP với server thật qua stdio, agent loop, TUI, đường dẫn state) | Xong |

**Chưa kiểm tra:**
- Chưa chạy với key thật của provider nào. Tool calling mới được test trên định dạng OpenAI-compatible bằng API giả lập; Gemini và Anthropic cần thử bằng key thật.
- Chưa mở trong Windows Terminal thật.

Provider chưa hỗ trợ: xem `ToDoList.txt`.

## Phần khung harness còn thiếu

1. ~~Agent loop có tool calling~~ ✓
2. ~~Tool registry~~ ✓
3. ~~MCP client~~ ✓
4. **Ghép system prompt theo tầng.** Các khối: base, danh sách skill, memory, ngữ cảnh phiên, danh sách tool. Người viết prompt chỉ viết nội dung từng khối.
5. **Skill loader hoàn chỉnh.**
   - Thống nhất frontmatter với người viết skill.
   - Nạp dần: `load_skill` đã có; bước 2 bỏ hẳn cách nối cả nội dung skill vào prompt.
6. **Memory interface.** Các hàm `recall(query)`, `remember(fact)`, tóm tắt phiên, cùng hook trước và sau mỗi lượt hỏi–đáp.
7. **Lưu session.** Lưu hội thoại để mở lại; hội thoại lúc này đã có history dạng message chuẩn của AI SDK (`state.history`).
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
| 2 | Ghép prompt theo tầng, interface cho skill và memory, lưu session, `docs/contracts.md` | Tiếp theo |
| 3 | Permission gate, mở rộng config | — |

## Cho đồng nghiệp: bắt đầu thế nào

```shell
git checkout main && git pull
bun install
bun run dev        # mở TUI
bun run typecheck
bun test
```

- **MCP server:** đọc [docs/mcp.md](mcp.md), bắt đầu từ `examples/mcp-demo/server.ts`. Cắm server vào `.mcp.json` rồi kiểm tra bằng `/mcp` và `/tools`.
- **Skills:** viết `skills/<tên>.md` với frontmatter `name` và `description`. Model tự gọi `load_skill` khi cần. Định dạng có thể được bổ sung ở bước 2.
- **System prompt:** bản hiện tại nằm ở `src/core/prompt.ts`. Nên viết nội dung trước theo các tầng ở mục 4.
- **Memory:** góp ý interface ở mục 6 trước bước 2.

Cấu trúc code: xem `README.md`. Lý do chọn TypeScript: xem `docs/decisions/0001-typescript.md`.
