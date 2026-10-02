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

## 2. Thêm server bằng lệnh

Cách nhanh nhất. Lệnh ghi vào `~/.opentrading/mcp.json` (dùng ở mọi thư mục); thêm `-s project` để ghi vào `.mcp.json` của thư mục hiện tại.

```shell
bun run dev -- mcp add context7 https://mcp.context7.com/mcp
bun run dev -- mcp add playwright -- npx -y @playwright/mcp@latest
bun run dev -- mcp list            # kết nối thử, in trạng thái từng server
bun run dev -- mcp help            # mọi lệnh: get, add-json, import, remove, enable/disable, login/logout, secret, debug
```

Khi đã cài thành lệnh `opentrading`, bỏ `bun run dev --` đi.

### Ví dụ các server phổ biến

| Server | Lệnh thêm | Đăng nhập |
| --- | --- | --- |
| Context7 (tài liệu thư viện) | `mcp add context7 https://mcp.context7.com/mcp` | Không cần |
| Playwright (điều khiển trình duyệt) | `mcp add playwright -- npx -y @playwright/mcp@latest` | Không cần (cần Node.js) |
| Filesystem | `mcp add fs -- npx -y @modelcontextprotocol/server-filesystem D:/du-lieu` | Không cần; chỉ truy cập thư mục đã ghi |
| Fetch | `mcp add fetch -- uvx mcp-server-fetch` | Không cần (cần [uv](https://docs.astral.sh/uv/)) |
| Notion | `mcp add notion https://mcp.notion.com/mcp` | OAuth: `mcp login notion` |
| Linear | `mcp add linear https://mcp.linear.app/mcp` | OAuth: `mcp login linear` |
| Sentry | `mcp add sentry https://mcp.sentry.dev/mcp` | OAuth: `mcp login sentry` |
| Atlassian (Jira, Confluence) | `mcp add atlassian https://mcp.atlassian.com/v1/sse -t sse` | OAuth: `mcp login atlassian` |
| GitHub | `mcp add github https://api.githubcopilot.com/mcp/ -H "Authorization: Bearer ${GITHUB_PAT}"` rồi `mcp secret set GITHUB_PAT` | Personal Access Token (GitHub không cho đăng nhập OAuth tự động) |
| MCP server công ty | `mcp add opentrading https://opentrading-mcp-web.onrender.com/mcp -H "Authorization: Bearer ${OPENTRADING_MCP_TOKEN}"` rồi `mcp secret set OPENTRADING_MCP_TOKEN` | Token nhóm (xin admin) |

Đã có server trong Claude Code hoặc Claude Desktop? `mcp import claude` liệt kê, `mcp import claude --all` nhập hết.

## 3. File cấu hình

Định dạng giống `.mcp.json` của Claude Code, nên một file dùng được cho cả hai.

| File | Phạm vi | Cần cho phép? |
| --- | --- | --- |
| `~/.opentrading/mcp.json` | Máy của bạn, mọi thư mục | Không |
| `.mcp.json` ở thư mục chạy `opentrading` | Project | Có, một lần. Hỏi lại nếu lệnh, URL hoặc header đổi |
| `~/.opentrading/mcp-auth.json` | Secret và token OAuth (quyền 600 trên macOS/Linux) | — |

Nếu hai file có server trùng tên, cấu hình của project được dùng. Lệnh `mcp add/remove/enable/disable` chỉ sửa đúng server được nêu; các server và khoá khác trong file giữ nguyên. File JSON bị lỗi thì lệnh dừng, không ghi đè.

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
    // Streamable HTTP ("type" có thể bỏ khi có "url"). Server cũ chỉ có SSE: tự thử lại bằng SSE.
    "internal-data": {
      "type": "http",
      "url": "https://data.example.com/mcp",
      "headers": { "Authorization": "Bearer ${DATA_TOKEN}" },
      "startupTimeoutMs": 15000,         // mặc định 30000
      "enabledTools": ["get_*", "search"],   // chỉ hiện các tool này (có thể dùng *)
      "disabledTools": ["get_raw_*"],        // ẩn các tool này
      "maxOutputChars": 12000                // cắt kết quả dài (giữ đầu + cuối)
    },
    // SSE kiểu cũ
    "legacy": { "type": "sse", "url": "https://old.example.com/sse" },
    // OAuth: mặc định tự nhận ra khi server yêu cầu. Chỉ cần khai khi nhà cung cấp bắt dùng app riêng.
    "jira": {
      "type": "sse",
      "url": "https://mcp.atlassian.com/v1/sse",
      "oauth": { "clientId": "...", "scope": "read write", "callbackPort": 47123 }
    },
    "tam-tat": { "command": "bun", "args": ["x.ts"], "enabled": false }
  }
}
```

**Biến và secret.**
- Dùng `${VAR}` hoặc `${VAR:-giá trị mặc định}` trong `command`, `args`, `env`, `cwd`, `url` và `headers`.
- Giá trị lấy từ biến môi trường trước, sau đó từ secret đã lưu bằng `mcp secret set VAR` (nằm trong `mcp-auth.json`).
- Thiếu biến thì `/mcp` báo `Thiếu biến: VAR` kèm lệnh để lưu.
- Đừng ghi thẳng token vào file cấu hình.

**Server stdio không thấy API key của OpenTrading.** Nó chỉ nhận một số biến cơ bản (`PATH`, `HOME`, `SystemRoot`…) cộng những biến bạn khai báo trong `env`. Server cần key nào thì truyền key đó qua `env`.

## 4. Đăng nhập OAuth

Notion, Linear, Sentry, Atlassian… dùng OAuth: không cần token, chỉ cần đăng nhập một lần.

- Khi khởi động, server chưa đăng nhập hiện **! cần đăng nhập**. OpenTrading không tự mở trình duyệt.
- Đăng nhập: `/mcp` → chọn server → Enter, hoặc `opentrading mcp login <tên>`.
  - Trình duyệt mở trang đăng nhập của nhà cung cấp. Link luôn được in ra để bạn tự mở nếu trình duyệt không bật lên.
  - Sau khi bạn đồng ý, trình duyệt quay về `http://127.0.0.1:<port>/callback` trên máy bạn. Chờ tối đa 5 phút; Esc để huỷ.
- Token được lưu trong `mcp-auth.json` và tự làm mới khi hết hạn.
- Đăng xuất: `/mcp` → chọn server → `x`, hoặc `opentrading mcp logout <tên>`.
- Server có header `Authorization` cố định, hoặc khai `"oauth": false`, thì không bao giờ dùng OAuth.
- Server không cho đăng ký ứng dụng tự động (DCR): tạo OAuth app trên trang của nhà cung cấp và khai `"oauth": { "clientId": "..." }`.
- Kết nối có vấn đề: `opentrading mcp debug <tên>` in phản hồi thô của server, header `WWW-Authenticate`, máy chủ OAuth và việc có hỗ trợ DCR hay không.

## 5. Quy ước khi viết server

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

## 6. Windows

- Lệnh `npx` và `uvx` chạy được, vì SDK dùng `cross-spawn`.
- Nếu báo không tìm thấy lệnh, ghi đường dẫn đầy đủ, ví dụ `"command": "C:\\Users\\me\\.local\\bin\\uvx.exe"`.
- Khi thoát bằng `/exit` hoặc `ctrl+c`, OpenTrading đóng mọi server trước, đợi tối đa 2 giây.

## 7. Kiểm tra

- `/mcp`: xem trạng thái (● đã kết nối, … đang kết nối, ✕ lỗi, ? chờ cho phép, ! cần đăng nhập, ○ đã tắt), transport, lỗi, lệnh hoặc URL, và danh sách tool. Enter để cho phép, đăng nhập hoặc kết nối lại.
- `opentrading mcp list`: như `/mcp` nhưng chạy ngoài TUI.
- `/tools`: liệt kê mọi tool model đang gọi được. ◇ là tool chỉ đọc.
- `ctrl+o` trong khung chat: mở rộng hoặc thu gọn toàn bộ kết quả tool.
- Có thể thử mà không cần TUI: `bun src/core/chat.ts "mấy giờ rồi?"`. Lệnh này chỉ dùng các tool có sẵn.

**Tự phục hồi.** Lỗi mạng hoặc server quá tải (429/5xx) lúc kết nối được thử lại 2 lần. Server remote bị rớt kết nối thì tự kết nối lại (tối đa 5 lần, chờ tăng dần). Server quên phiên (HTTP 404) thì gọi tool lại một lần sau khi khởi tạo phiên mới.

Chưa hỗ trợ trong bản này: transport WebSocket, `headersHelper`, resources và prompts của MCP, elicitation, roots.
