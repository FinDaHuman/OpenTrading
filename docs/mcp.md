# Gắn MCP server vào OpenTrading

OpenTrading là **MCP client**. Tool mà MCP server cung cấp (dữ liệu giá, BCTC, tin tức…) sẽ tự xuất hiện cho model gọi, bên cạnh các tool có sẵn (`current_time`, `load_skill`).

## 1. Chạy thử với server mẫu

```shell
cp examples/mcp-demo/.mcp.json.example .mcp.json
bun run dev
```

- Gõ `/mcp`. Server `demo` hiện ở trạng thái **? chờ cho phép**: server khai báo trong project phải được bạn cho phép một lần.
- Chọn server `demo`, rồi Enter để cho phép. Trạng thái chuyển thành **● đã kết nối** và có 3 tool: `mcp__demo__echo`, `mcp__demo__add`, `mcp__demo__fail`.
- Hỏi model: _"Dùng tool cộng 2 với 3"_. TUI sẽ hiện một dòng `⚙ demo · add({"a":2,"b":3})` kèm kết quả.

Mã nguồn server mẫu: [`examples/mcp-demo/server.ts`](../examples/mcp-demo/server.ts). Dùng file này làm template.

## 2. File cấu hình

Định dạng giống `.mcp.json` của Claude Code, nên một file dùng được cho cả hai.

| File | Phạm vi | Cần cho phép? |
| --- | --- | --- |
| `~/.opentrading/mcp.json` | Máy của bạn, mọi thư mục | Không |
| `.mcp.json` ở thư mục chạy `opentrading` | Project | Có, một lần. Hỏi lại nếu lệnh hoặc URL đổi |

Nếu hai file có server trùng tên, cấu hình của project được dùng.

```jsonc
{
  "mcpServers": {
    // stdio: OpenTrading tự chạy lệnh này và nói chuyện qua stdin/stdout
    "vnstock": {
      "command": "uvx",
      "args": ["vnstock-mcp"],
      "env": { "VNSTOCK_API_KEY": "${VNSTOCK_API_KEY}" },
      "cwd": "./servers/vnstock",        // tương đối so với file cấu hình
      "toolTimeoutMs": 120000            // mặc định 60000
    },
    // HTTP (Streamable HTTP)
    "internal-data": {
      "type": "http",
      "url": "https://data.example.com/mcp",
      "headers": { "Authorization": "Bearer ${DATA_TOKEN}" },
      "maxOutputChars": 12000,           // mặc định 12000; cắt đầu + đuôi kết quả dài
      "startupTimeoutMs": 15000          // mặc định 30000
    },
    "tam-tat": { "command": "bun", "args": ["x.ts"], "enabled": false }
  }
}
```

**Biến môi trường.**
- Dùng `${VAR}` hoặc `${VAR:-giá trị mặc định}` trong `command`, `args`, `env`, `cwd`, `url` và `headers`.
- Nếu thiếu biến, server báo lỗi `Thiếu biến môi trường: VAR` trong `/mcp`.
- Đừng ghi thẳng secret vào file cấu hình.

**Server stdio không thấy API key của OpenTrading.** Nó chỉ nhận một số biến cơ bản (`PATH`, `HOME`, `SystemRoot`…) cộng những biến bạn khai báo trong `env`. Server cần key nào thì truyền key đó qua `env`.

## 3. Quy ước khi viết server

- **Tên tool** mà model thấy có dạng `mcp__<server>__<tool>`.
  - Ký tự ngoài `[A-Za-z0-9_-]` bị đổi thành `_`.
  - Tên dài quá 64 ký tự thì bị rút gọn và thêm đuôi hash.
  - Nên đặt tên tool ngắn, dạng snake_case, ví dụ `get_quote` hoặc `financial_statements`.
- **Mô tả tool** là thứ model đọc để quyết định có gọi tool hay không. Viết rõ tool làm gì và khi nào nên dùng; có thể viết tiếng Việt. Mô tả dài quá 2048 ký tự sẽ bị cắt.
- **`annotations.readOnlyHint: true`** cho tool chỉ đọc dữ liệu. Các tool này được chạy song song; tool không có hint này chạy lần lượt từng cái. Bước 3 sẽ thêm hỏi xác nhận trước khi chạy tool không chỉ đọc.
- **Báo lỗi** bằng `{ isError: true, content: [{ type: "text", text: "lý do" }] }`. Model nhận được lý do và có thể thử cách khác. Đừng trả dữ liệu rỗng thay cho lỗi.
- **Kết quả nên là text hoặc JSON gọn.**
  - Mỗi kết quả tối đa khoảng 30.000 ký tự; phần dài hơn bị cắt, chỉ giữ đầu và cuối.
  - Luôn kèm **nguồn** và **thời điểm dữ liệu** (`asof`), vì system prompt yêu cầu model nêu chúng khi trích số liệu.
  - Nếu `content` rỗng mà có `structuredContent`, JSON đó sẽ được gửi cho model.
  - Ảnh và âm thanh hiện chỉ hiển thị dưới dạng placeholder.
- **Không in gì ra stdout** ngoài giao thức, vì stdout là kênh MCP. Log thì ghi ra stderr. Khi server không khởi động được, 3 dòng stderr cuối cùng hiện trong `/mcp`.
- **Timeout:** mặc định 30s để khởi động và 60s cho mỗi lần gọi tool. Đổi bằng `startupTimeoutMs` và `toolTimeoutMs`.

## 4. Windows

- Lệnh `npx` và `uvx` chạy được, vì SDK dùng `cross-spawn`.
- Nếu báo không tìm thấy lệnh, ghi đường dẫn đầy đủ, ví dụ `"command": "C:\\Users\\me\\.local\\bin\\uvx.exe"`.
- Khi thoát bằng `/exit` hoặc `ctrl+c`, OpenTrading đóng mọi server trước, đợi tối đa 2 giây.

## 5. Kiểm tra

- `/mcp`: xem trạng thái (● đã kết nối, … đang kết nối, ✕ lỗi, ? chờ cho phép, ○ đã tắt), số tool, lỗi, lệnh hoặc URL, và danh sách tool. Enter để cho phép hoặc kết nối lại. Single surface: model luôn thấy toàn bộ tools, không còn preset.
- `/tools`: liệt kê mọi tool model đang gọi được. ◇ là tool chỉ đọc.
- `ctrl+o` trong khung chat: mở rộng hoặc thu gọn toàn bộ kết quả tool.
- **Prompt workflows thành lệnh slash:** các MCP prompt của server hiện như lệnh (`/ticker_analysis VCB`, `/morning_briefing`…) trong gợi ý `/`; nội dung prompt được fetch từ server rồi gửi như tin nhắn user.
- **Ngân sách chống gọi tràn lan:** mỗi skill khai `tool_budget` (model tự giới hạn theo catalog); harness chặn cứng: tối đa 20 lần gọi tool/lượt, gọi giống hệt lần 3 → hỏi phê duyệt, tối đa 5 tool đọc chạy song song (upstream throttle).
- Có thể thử mà không cần TUI: `bun src/core/chat.ts "mấy giờ rồi?"`. Lệnh này chỉ dùng các tool có sẵn.

Không hỗ trợ trong bản này: OAuth cho MCP, transport SSE/WebSocket, resources của MCP.
