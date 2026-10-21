# OpenTrading

Harness AI phân tích chứng khoán Việt Nam, chạy trong terminal. Viết bằng TypeScript: Bun, [OpenTUI](https://github.com/sst/opentui), SolidJS và Vercel AI SDK.

*English:* OpenTrading is a terminal AI harness for researching Vietnamese equities. Connect any of 200+ LLM providers, plug in MCP servers for market data, and let the agent call tools, run subagents and cite its sources. The UI, prompts and docs are in Vietnamese. It is not investment advice (see [Disclaimer](#miễn-trừ-trách-nhiệm--disclaimer)). Licensed under Apache-2.0.

> **Bản demo.** Đã có TUI, kết nối LLM, agent loop gọi tool, MCP client (dữ liệu thị trường qua server `opentrading-mcp`), skills, subagent, nén hội thoại và lưu phiên. Đây không phải tư vấn đầu tư. Tiến độ: [docs/STATUS.md](docs/STATUS.md).

## Chạy

Cần [Bun](https://bun.sh) 1.3 trở lên; chạy trên Windows, macOS và Linux.

```shell
bun install
bun run dev
```

### Dữ liệu thị trường

OpenTrading không kèm dữ liệu. Số liệu đến từ MCP server bạn gắn vào (xem [docs/mcp.md](docs/mcp.md)):

- Server `opentrading` trong `/mcp` cần token do người quản lý server cấp. Không có token thì bỏ qua mục này.
- Mã nguồn server: [opentrading-mcp](https://github.com/DoanDuyLong212/opentrading-mcp). Bạn có thể tự chạy server này, hoặc gắn bất kỳ MCP server nào khác.
- Không có MCP server thì agent chỉ còn các tool có sẵn (web, file, chart, watchlist) để làm việc.

Trong TUI:

| Lệnh | Việc |
| --- | --- |
| `/connect` | Nhập API key cho hơn 200 provider (Groq, Gemini, NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek…) |
| `/model` | Chọn model từ mọi provider đã kết nối, gõ để lọc |
| `/skills`, `/skill <tên>` | Danh sách skill; bật hoặc tắt một skill cho cả phiên |
| `/profile` | Mở hồ sơ nhà đầu tư `~/.opentrading/INVESTOR.md` |
| `/context` | Xem các tầng ngữ cảnh gửi cho model và số token |
| `/mcp` | Trạng thái các MCP server; cho phép server của project hoặc kết nối lại |
| `/tools` | Liệt kê mọi tool model đang gọi được |
| `/sessions`, `/new` | Mở lại một phiên đã lưu; bắt đầu phiên mới |
| `/compact [hướng dẫn]` | Nén hội thoại (dọn kết quả tool cũ, tóm tắt phần đầu) |
| `/save` | Copy toàn bộ hội thoại (Markdown, kèm input/output tool) vào clipboard |
| `/export [đường dẫn] [--force]` | Lưu hội thoại ra file `.md`; không có đường dẫn thì vào `~/.opentrading/exports/<id phiên>.md` |
| `/agents` | Các loại subagent (có sẵn, cá nhân, dự án) và tool của từng loại |
| `/tasks` | Subagent của phiên: đang chạy, đã xong; xem kết quả, dừng (ctrl+x) |
| `/add-dir [thư mục] [--luu]` | Thêm thư mục vào workspace (nơi agent ghi file); không tham số: xem workspace |
| `/undo [số] [--force]` | Hoàn tác thay đổi file do agent ghi (`write_file`/`edit_file`) |
| `/permissions` | Chế độ quyền, workspace, quy tắc cho phép/chặn, các lần auto mode chặn |
| `/memory` | Xem, duyệt, xoá memory |
| `/config` | Cài đặt, có hiệu lực ngay: memory, tìm tool, tự nén, số subagent chạy song song, model cho subagent, chế độ quyền khi mở, model duyệt auto mode |
| `/clear`, `/help`, `/exit` | Xoá màn hình và bắt đầu phiên mới, trợ giúp, thoát |

Phím tắt: `tab` hoàn thành lệnh đang gõ (`/con` → `/connect`), `↑↓` chọn gợi ý, `esc` dừng câu trả lời hoặc đóng hộp thoại, `ctrl+o` mở rộng/thu gọn kết quả tool, `shift+tab` (hoặc `alt+m`) đổi chế độ quyền, `ctrl+c` thoát.

**File và lệnh.** Agent đọc được file bạn đưa đường dẫn (text, CSV, PDF, ảnh, Excel `.xlsx`, Word `.docx`), tạo hay sửa file (kế hoạch `.md`, bảng `.csv`, trang `.html`) và chạy lệnh shell. Có 3 chế độ quyền: `‖ chỉ đọc` (mặc định, mọi lần ghi hay chạy lệnh đều hỏi), `▸ sửa có hỏi`, `▸▸ tự động` (một model duyệt thay bạn). File chứa khoá/mật khẩu, cấu hình OpenTrading và việc ghi ra ngoài workspace luôn hỏi bạn. Xem [docs/permissions.md](docs/permissions.md).

Model gọi được tool có sẵn (`current_time`, `load_skill`, `todo_write`, `ask_user`, `tool_search`, chart, watchlist, web…) và tool từ MCP server, rồi trả lời dựa trên kết quả. Cách gắn MCP server: xem [docs/mcp.md](docs/mcp.md).

Model có thể giao việc cho **subagent**: chạy song song, chạy nền, chọn loại agent. Xem [docs/subagents.md](docs/subagents.md).

**Dùng key Gemini miễn phí?** Quota theo ngày và theo phút rất thấp, và subagent tốn nhiều request. Xem [docs/gemini-limits.md](docs/gemini-limits.md) trước khi dùng.

Danh sách provider và model lấy từ [models.dev](https://models.dev), cùng nguồn với opencode. Danh sách được cache 1 giờ ở `~/.opentrading/cache/models.json`. Các provider cần SDK riêng hoặc cấu hình thêm (Azure, Bedrock, Vertex…) bị ẩn và được lọc bởi `isSupported()` trong `src/core/providers.ts`.

Key được lưu ở `~/.opentrading/auth.json`, nằm ngoài repo. Có thể đổi thư mục bằng biến `OPENTRADING_HOME`. Nếu provider chưa có key trong file này, chương trình đọc key từ biến môi trường của provider đó, ví dụ `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`.

Mở lại phiên gần nhất: `bun run dev -- --continue`; một phiên cụ thể: `bun run dev -- --resume <id>`. Hội thoại được lưu ở `~/.opentrading/sessions/`.

Muốn thử provider mà không mở TUI (chỉ dùng tool có sẵn): `bun src/core/chat.ts "mấy giờ rồi?"`.

## Kiểm tra

```shell
bun run typecheck
bun test          # smoke test TUI chạy headless; SHOW_FRAME=1 để in khung hình
```

## Cấu trúc

```
src/core/     provider, auth, config, agent loop, hồ sơ nhà đầu tư (không import UI)
  prompt/     ghép prompt theo tầng, ngân sách token, đồng hồ phiên
  skills/     schema SKILL.md, loader 3 nguồn, catalog, preroute
  memory/     contract MemoryProvider, bản mẫu FileMemory
  session/    lưu phiên JSONL, mở lại, dựng lại transcript
  tools/      tool registry, giới hạn/timeout, tool có sẵn
  subagents/  subagent: manager, giới hạn slot, transcript riêng, thông báo nền
  agents/     loại subagent (file agents/*.md)
  mcp/        MCP client: config, cho phép, đặt tên tool, quản lý kết nối
examples/     MCP server mẫu (examples/mcp-demo)
src/tui/      giao diện: theme, logo, background động, màn hình, dialog
prompts/      nội dung system prompt theo tầng (identity, tools, citations, style)
skills/       skill dạng skills/<tên>/SKILL.md (xem docs/contracts.md)
agents/       loại subagent có sẵn (xem docs/subagents.md)
market/       lịch phiên giao dịch (dữ liệu, chưa kiểm chứng)
handbook/     tài liệu thiết kế
docs/decisions/ các quyết định kiến trúc
```

Xem [docs/decisions/0001-typescript.md](docs/decisions/0001-typescript.md) để biết vì sao chọn TypeScript và Python sẽ được dùng ở đâu.

## Miễn trừ trách nhiệm / Disclaimer

OpenTrading là phần mềm nghiên cứu. Nó **không phải dịch vụ tư vấn đầu tư chứng khoán** và không đặt lệnh giao dịch.

- Câu trả lời do model AI viết, có thể sai, thiếu hoặc dựa trên số liệu cũ. Hãy kiểm tra lại với nguồn gốc trước khi dùng.
- Mọi quyết định đầu tư và rủi ro đi kèm là của bạn.
- Tác giả và người đóng góp không chịu trách nhiệm về thiệt hại phát sinh từ việc dùng phần mềm (xem điều 7–8 của `LICENSE`).

OpenTrading is research software, not an investment advisory service, and it does not place orders. Answers are written by AI models and may be wrong, incomplete or based on stale data; verify them against the original sources. You are solely responsible for your investment decisions. The software is provided "AS IS", without warranties (see sections 7–8 of `LICENSE`).

## Giấy phép / License

[Apache License 2.0](LICENSE). Một số file được chuyển thể từ opencode (MIT): xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) và [NOTICE](NOTICE). Khi đóng góp code, bạn đồng ý phát hành đóng góp đó theo cùng giấy phép (xem [CONTRIBUTING.md](CONTRIBUTING.md)).
