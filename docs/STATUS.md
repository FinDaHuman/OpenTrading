# Trạng thái dự án & kế hoạch

Cập nhật: 28/09/2026 · nhánh `ts-v0`

## Phân công

| Phần | Người phụ trách |
| --- | --- |
| Khung harness: agent loop, tool registry, MCP client, TUI, provider, session, permission, config | Chủ repo |
| Memory | Đồng nghiệp |
| MCP server (dữ liệu chứng khoán…) | Đồng nghiệp |
| Nội dung skills | Đồng nghiệp |
| Nội dung system prompt | Đồng nghiệp |

## Hiện tại

**Hiện đã xong phần vỏ (TUI và kết nối LLM), phần lõi harness chưa có.**

App hiện chat và stream câu trả lời được, nhưng model chưa gọi được tool. Cũng chưa có interface để memory, MCP, skills và prompt gắn vào.

### Đã xong

| Hạng mục | Trạng thái |
| --- | --- |
| TUI: logo, background động, Home, Chat, status bar | Xong |
| `/connect`: 204 provider (danh mục models.dev); key lưu ở `~/.opentrading/auth.json`; đọc được biến môi trường | Xong |
| `/model`: gộp model từ mọi provider đã kết nối, có lọc | Xong |
| Chat stream, `esc` để dừng, lỗi báo bằng tiếng Việt | Xong |
| Slash command, Tab để hoàn thành lệnh, `/help` `/clear` `/exit` | Xong |
| Skills: đọc `skills/*.md`, bật/tắt, nối vào system prompt | Bản thô |
| System prompt | Chỉ là một chuỗi cố định trong `src/core/prompt.ts` |
| Test: typecheck + 9 smoke test TUI chạy headless | Xong |

**Chưa kiểm tra:**
- Chưa chạy với key thật của provider nào.
- Chưa mở trong Windows Terminal thật.

Provider chưa hỗ trợ được liệt kê trong `ToDoList.txt`.

## Phần khung harness còn thiếu

Mục tiêu là dựng các điểm gắn (interface), để đồng nghiệp làm song song mà không phải sửa code lõi.

1. **Agent loop có tool calling.** Đây là việc chặn tất cả việc khác.
   - Model gọi tool, harness chạy tool, trả kết quả cho model, lặp lại.
   - Có giới hạn số bước và có thể huỷ.
   - TUI hiển thị từng lần gọi tool và kết quả của nó.
2. **Tool registry.** Interface chung `{ name, description, schema, execute }`. Cả tool native lẫn tool đến từ MCP đều đi qua đây.
3. **MCP client.**
   - Khai báo server trong config.
   - Hỗ trợ stdio trước, HTTP sau.
   - Lệnh `/mcp` để xem trạng thái các server.
4. **Ghép system prompt theo tầng.** Các khối: base, danh sách skill, memory, ngữ cảnh phiên, danh sách tool. Người viết prompt chỉ viết nội dung từng khối.
5. **Skill loader hoàn chỉnh.**
   - Thống nhất frontmatter với người viết skill: `name`, `description`, trigger…
   - Nạp dần: system prompt chỉ có danh sách skill; nội dung skill được nạp khi model gọi tool `load_skill`.
6. **Memory interface.**
   - Các hàm `recall(query)`, `remember(fact)`, tóm tắt phiên.
   - Hook trước và sau mỗi lượt hỏi–đáp.
   - Đồng nghiệp viết phần cài đặt bên trong.
7. **Lưu session.**
   - Lưu hội thoại để mở lại (`/sessions`, tiếp tục phiên cũ).
   - Memory cần có phần này.
8. **Permission gate.** Tool nguy hiểm phải được người dùng xác nhận trong TUI. Đây là nền của bất biến "người quyết định" trong HarnessPlan.
9. **Mở rộng config.** Thêm vào `~/.opentrading/config.json`: danh sách MCP server, thư mục skills, tuỳ chọn memory.

Việc phụ:
- Thử key thật với Gemini, Anthropic, OpenAI, OpenRouter.
- Cập nhật `CONTRIBUTING.md` và `handbook/`; hai chỗ này vẫn mô tả quy trình Python cũ.
- Tách lõi thành daemon và đóng gói bằng `bun build --compile`.

## Kế hoạch đề xuất

| Bước | Nội dung | Sau bước này đồng nghiệp làm được gì |
| --- | --- | --- |
| 1 | Agent loop, tool registry, MCP client, 1–2 tool mẫu (`get_time`, `load_skill`), TUI hiển thị tool call | Người làm MCP server cắm server vào và thử được ngay |
| 2 | Ghép prompt theo tầng, interface cho skill và memory, lưu session, viết `docs/contracts.md` | Cả ba đồng nghiệp làm độc lập |
| 3 | Permission gate, mở rộng config | — |

## Cho đồng nghiệp: bắt đầu thế nào

```shell
git fetch && git checkout ts-v0
bun install
bun run dev        # mở TUI
bun run typecheck
bun test
```

Trong lúc chờ các interface ở bước 1–2:
- **Skills:** viết file `skills/<tên>.md` với frontmatter `name` và `description`. Xem 3 skill mẫu có sẵn. Định dạng có thể được bổ sung thêm trường ở bước 2.
- **System prompt:** bản hiện tại nằm ở `src/core/prompt.ts`. Nên viết nội dung trước, theo các tầng ở mục 4 phía trên.
- **MCP server:** viết theo chuẩn MCP, chạy qua stdio. Harness sẽ kết nối tới sau bước 1.
- **Memory:** đề xuất interface ở mục 6 để thống nhất trước bước 2.

Cấu trúc code: xem `README.md`. Lý do chọn TypeScript: xem `docs/decisions/0001-typescript.md`.
