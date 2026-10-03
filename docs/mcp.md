# Gắn MCP server vào OpenTrading

OpenTrading là **MCP client**. Tool mà MCP server cung cấp (dữ liệu giá, BCTC, tin tức…) sẽ tự xuất hiện cho model gọi, bên cạnh các tool có sẵn (`current_time`, `load_skill`).

## 1. Chạy thử với server mẫu

```shell
cp examples/mcp-demo/.mcp.json.example .mcp.json
bun run dev
```

- Gõ `/mcp`. Server `demo` hiện ở trạng thái **? chờ cho phép**: server khai báo trong project phải được bạn cho phép một lần.
- Chọn server `demo`, rồi chọn **Cho phép chạy server này**. Trạng thái chuyển thành **✓ đã kết nối**, server có 4 tool:
  - `echo`, `add`, `fail`: chỉ đọc.
  - `ghi_chu`: tool ghi, nên OpenTrading hỏi bạn trước khi chạy.
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

Server bạn tự thêm (bằng `add`, `add-json`, `import`) **luôn ở trạng thái bật**: lệnh kết nối thử ngay, và mỗi lần mở OpenTrading sẽ tự kết nối. Tắt bằng `mcp disable <tên>`. Thêm vào project (`-s project`) cũng được coi là đã cho phép, vì chính bạn thêm. Các server có sẵn trong danh mục của OpenTrading thì mặc định tắt, chỉ kết nối khi bạn bật.

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
| GitHub | `mcp add github https://api.githubcopilot.com/mcp/ -H 'Authorization: Bearer ${GITHUB_PAT}'` rồi `mcp secret set GITHUB_PAT` | Personal Access Token (GitHub không cho đăng nhập OAuth tự động) |
| MCP server công ty | `mcp add opentrading https://opentrading-mcp-web.onrender.com/mcp -H 'Authorization: Bearer ${OPENTRADING_MCP_TOKEN}'` rồi `mcp secret set OPENTRADING_MCP_TOKEN` | Token nhóm (xin admin) |

**Header có `${BIẾN}` phải đặt trong nháy đơn** (`'...'`). Trong nháy kép, PowerShell và bash thay `${BIẾN}` bằng giá trị (thường là rỗng) trước khi lệnh nhận được; lệnh sẽ báo lỗi nếu header bị rỗng.

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
- **`annotations.readOnlyHint: true`** cho tool chỉ đọc dữ liệu. Các tool này chạy song song và không cần xác nhận. Tool không có hint này chạy lần lượt từng cái và **phải được người dùng cho phép** trước khi chạy. Hãy đặt `destructiveHint: true` cho tool xoá hoặc ghi đè dữ liệu; hộp xác nhận sẽ hiện màu đỏ.
- **Báo lỗi** bằng `{ isError: true, content: [{ type: "text", text: "lý do" }] }`. Model nhận được lý do và có thể thử cách khác. Đừng trả dữ liệu rỗng thay cho lỗi.
- **Kết quả nên là text hoặc JSON gọn.**
  - Mỗi kết quả tối đa khoảng 30.000 ký tự; phần dài hơn bị cắt, chỉ giữ đầu và cuối.
  - Luôn kèm **nguồn** và **thời điểm dữ liệu** (`asof`), vì system prompt yêu cầu model nêu chúng khi trích số liệu.
  - Nếu `content` rỗng mà có `structuredContent`, JSON đó sẽ được gửi cho model.
  - Ảnh (`image`, hoặc resource nhúng là ảnh png/jpeg/gif/webp) được gửi cho model nếu model xem được ảnh và provider là Anthropic, OpenAI hoặc Google. Với model khác, ảnh thay bằng một dòng mô tả. Tối đa 4 ảnh mỗi kết quả, mỗi ảnh tối đa 5MB. Ảnh không được lưu vào file phiên.
  - Âm thanh hiện chỉ hiển thị dưới dạng placeholder.
- **`outputSchema`**: OpenTrading không kiểm `structuredContent` theo `outputSchema`, nên kết quả lệch schema vẫn được đọc, thay vì báo lỗi sau khi tool đã chạy.
- **Schema tham số** được chuẩn hoá theo provider trước khi gửi:
  - `$ref` được thay bằng nội dung; bỏ `title`/`$schema`; `const` thành `enum`; mảng luôn có `items`.
  - Với Gemini: enum số được chuyển vào mô tả, bỏ `format` lạ.
  - Schema quá 6000 ký tự thì được rút gọn.
  - Tên tham số không bao giờ bị đổi. Viết schema gọn, phẳng sẽ tốn ít token hơn.
- **Không in gì ra stdout** ngoài giao thức, vì stdout là kênh MCP. Log thì ghi ra stderr. Khi server không khởi động được, 3 dòng stderr cuối cùng hiện trong `/mcp`.
- **Timeout:** mặc định 30s để khởi động và 60s cho mỗi lần gọi tool. Đổi bằng `startupTimeoutMs` và `toolTimeoutMs`.

## 6. Windows

- Lệnh `npx` và `uvx` chạy được, vì SDK dùng `cross-spawn`.
- Nếu báo không tìm thấy lệnh, ghi đường dẫn đầy đủ, ví dụ `"command": "C:\\Users\\me\\.local\\bin\\uvx.exe"`.
- Khi thoát bằng `/exit` hoặc `ctrl+c`, OpenTrading đóng mọi server trước, đợi tối đa 2 giây.

## 7. Prompts, resources, tìm tool và giới hạn số tool

- **Prompts** của server hiện thành lệnh `/<server>:<prompt>` trong gợi ý khi gõ `/`, ví dụ `/demo:phan_tich VCB biên lãi`.
  - Tham số theo thứ tự khai báo; tham số cuối nhận phần còn lại của dòng.
  - Hoặc ghi theo tên: `/data:risk_check symbols=VCB,CTG side=buy`.
  - Thiếu tham số bắt buộc thì hiện cách dùng.
  - Nội dung prompt được gửi như tin nhắn của bạn và hiện đầy đủ trong khung chat.
- **Resources**: khi có server cung cấp resource, model có thêm 2 tool chỉ đọc là `list_mcp_resources` và `read_mcp_resource`.
- **Tìm tool (nạp theo nhu cầu)**: khi có nhiều tool MCP, model chỉ nhận **tên** của chúng, không nhận schema. Khi cần thì model gọi `tool_search` để nạp, giống ToolSearch của Claude Code.
  - Chế độ (`/config` → Tìm tool, hoặc `toolSearch` trong `~/.opentrading/config.json`):

    | Chế độ | Hành vi |
    | --- | --- |
    | `auto` (mặc định) | Hoãn mọi tool MCP khi có hơn 40 tool (`toolSearchMinTools`) hoặc schema chiếm hơn 10% context của model |
    | `on` | Luôn hoãn |
    | `off` | Gửi mọi tool như trước |

  - Danh sách tên tool hoãn nằm trong system prompt (`<tool_hoan>`), nhóm theo server. Danh sách quá dài thì chỉ ghi số tool của mỗi server.
  - `tool_search` nhận `select:a,b` (tên đầy đủ, `server/tool` hoặc tên ngắn) hoặc từ khoá. Tìm từ khoá không phân biệt dấu và hiểu một số thuật ngữ tiếng Việt như "lịch sử giá", "khối ngoại", "BCTC".
  - Tool đã nạp gọi được ngay ở bước kế tiếp và giữ nguyên trong cả phiên, kể cả sau `--resume`, vì OpenTrading suy ra từ lịch sử hội thoại. Model gọi thẳng tên ngắn thì OpenTrading tự đổi sang tên đầy đủ.
  - Server muốn luôn gửi đủ schema thì đặt `"alwaysLoad": true` trong cấu hình server.
  - `/tools` ghi `hoãn ·` / `đã nạp ·` trước mô tả. `/context` có dòng "Danh sách tool hoãn".
- **Giới hạn số tool**: OpenAI, Gemini và Anthropic nhận tối đa khoảng 128 tool mỗi request.
  - Với tìm tool đang tắt (hoặc tool không hoãn được), vượt mức thì OpenTrading giữ tool có sẵn trước, rồi tới tool MCP theo thứ tự server trong file cấu hình, và báo một lần trong chat là đang ẩn bao nhiêu tool của server nào.
  - Model chọn tool kém đi khi có quá nhiều tool (từ khoảng 30–50); tìm tool hoặc `enabledTools`/`disabledTools` giải quyết việc này.
  - `/context` hiện số token mà định nghĩa tool chiếm.

## 8. Quản lý bằng `/mcp`

Màn hình làm theo Claude Code. Nó là một panel thay chỗ ô nhập, gồm 4 bậc; Esc lùi lại một bậc.

1. **Danh sách**, chia nhóm:
   - **Project** (`.mcp.json`) và **Của bạn** (`~/.opentrading/mcp.json`). Mỗi dòng có dạng `tên · ✓ đã kết nối · N tool`.
   - **Có sẵn**: các server phổ biến, **mặc định tắt**. Chọn một mục để bật; nếu cần token thì dán token, nếu cần OAuth thì trình duyệt mở để đăng nhập.
   - **+ Thêm server tuỳ chỉnh**: nhập tên và URL hoặc lệnh.
   - Phím: space bật/tắt, `r` kết nối lại.
   - Ký hiệu trạng thái:

     | Ký hiệu | Nghĩa |
     | --- | --- |
     | ✓ | đã kết nối |
     | ◌ | đang kết nối |
     | ✘ | lỗi |
     | △ | cần đăng nhập |
     | ? | chờ cho phép |
     | ○ | đã tắt / có sẵn |

2. **Server**: Trạng thái, Đăng nhập, URL/Lệnh, Cấu hình, Khả năng (tools · resources · prompts), số tool, các prompt.
   - Các lựa chọn: Xem tool · Đăng nhập / Đăng nhập lại / Đăng xuất · Kết nối lại · Bật/Tắt · Xoá khỏi cấu hình.
3. **Tool của server**:
   - Nhãn (như `[destructive]` của Claude Code, không dùng emoji):
     - `[chỉ đọc]` (xanh): chạy ngay.
     - `[ghi]` (vàng): hỏi trước khi chạy.
     - `[không hoàn tác]` (đỏ): tool khai `destructiveHint`, có thể xoá hoặc ghi đè dữ liệu; hỏi trước, khung đỏ.
     - `[ra ngoài]` (mờ): tool khai `openWorldHint`, tác động ra ngoài hệ thống.
4. **Chi tiết tool**: các nhãn, tên đầy đủ, mô tả, và tham số (`• tên (bắt buộc): kiểu - mô tả`).

Lệnh nhanh không mở panel: `/mcp enable <tên>`, `/mcp disable <tên>`, `/mcp reconnect <tên>`.

## 9. Xác nhận trước khi chạy tool ghi

- Tool có `readOnlyHint: true` chạy ngay. Tool khác (tạo issue, ghi file, click trên trình duyệt…) dừng lại chờ bạn: một khung **Cần xác nhận** hiện thay chỗ ô nhập.
- Khung hiện tên tool, tối đa 3 tham số và mô tả ngắn. Có 4 lựa chọn:
  1. **Có**: chạy lần này.
  2. **Có, cả phiên này**: không hỏi lại tool này cho tới khi thoát OpenTrading.
  3. **Luôn cho phép**: lưu vào `~/.opentrading/config.json` (`permissions.allow`). Quyền này gắn với đúng server đó (URL hoặc lệnh), nên server khác trùng tên vẫn bị hỏi.
  4. **Không**: model nhận thông báo bị từ chối và đi tiếp. Tab để kèm lời nhắn cho model.
- Phím: ↑↓ + Enter, hoặc 1–4. Esc là từ chối lời gọi đó; lượt trả lời vẫn tiếp tục.
- Nhiều tool cùng chờ thì hiện lần lượt. Chọn "cả phiên này" thì các lời gọi cùng tool đang chờ được chạy luôn.
- Thời gian chờ bạn quyết định không tính vào timeout của tool.
- Chạy không có giao diện (script, test) thì tool ghi luôn bị từ chối.

## 10. Kiểm tra

- `/mcp`: quản lý server (mục 8).
- `opentrading mcp list`: như `/mcp` nhưng chạy ngoài TUI.
- `/tools`: liệt kê mọi tool model đang gọi được. ◇ là tool chỉ đọc. Tool đang hoãn ghi `hoãn ·`; có hơn 128 tool không hoãn thì báo số tool bị ẩn.
- `ctrl+o` trong khung chat: mở rộng hoặc thu gọn toàn bộ kết quả tool.
- Có thể thử mà không cần TUI: `bun src/core/chat.ts "mấy giờ rồi?"`. Lệnh này chỉ dùng các tool có sẵn.

**Tự phục hồi.** Lỗi mạng hoặc server quá tải (429/5xx) lúc kết nối được thử lại 2 lần. Server remote bị rớt kết nối thì tự kết nối lại (tối đa 5 lần, chờ tăng dần). Server quên phiên (HTTP 404) thì gọi tool lại một lần sau khi khởi tạo phiên mới.

Chưa hỗ trợ trong bản này: transport WebSocket, `headersHelper`, elicitation, roots, đăng ký theo dõi resource.
