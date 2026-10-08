# OpenTrading

Harness AI phân tích chứng khoán Việt Nam, chạy trong terminal. Viết bằng TypeScript: Bun, [OpenTUI](https://github.com/sst/opentui), SolidJS và Vercel AI SDK.

> **Bản demo.** Đã có TUI, kết nối LLM, agent loop gọi tool, MCP client (dữ liệu thị trường qua server `opentrading-mcp`), skills, subagent, nén hội thoại và lưu phiên. Đây không phải tư vấn đầu tư. Tiến độ: [docs/STATUS.md](docs/STATUS.md).

## Chạy

```shell
bun install
bun run dev
```

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
| `/agents` | Các loại subagent (có sẵn, cá nhân, dự án) và tool của từng loại |
| `/tasks` | Subagent của phiên: đang chạy, đã xong; xem kết quả, dừng (ctrl+x) |
| `/memory` | Xem, duyệt, xoá memory |
| `/config` | Cài đặt, có hiệu lực ngay: memory, tìm tool, tự nén, số subagent chạy song song, model cho subagent |
| `/clear`, `/help`, `/exit` | Xoá màn hình và bắt đầu phiên mới, trợ giúp, thoát |

Phím tắt: `tab` hoàn thành lệnh đang gõ (`/con` → `/connect`), `↑↓` chọn gợi ý, `esc` dừng câu trả lời hoặc đóng hộp thoại, `ctrl+o` mở rộng/thu gọn kết quả tool, `ctrl+c` thoát.

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
