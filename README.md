# OpenTrading

Harness AI phân tích chứng khoán Việt Nam, chạy trong terminal. Viết bằng TypeScript: Bun, [OpenTUI](https://github.com/sst/opentui), SolidJS và Vercel AI SDK.

> **Bản demo v0.** Hiện chỉ có TUI, kết nối LLM và chat stream. Chưa có dữ liệu thị trường, chưa có tool, chưa lưu session. Đây không phải tư vấn đầu tư.

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
| `/skills`, `/skill <tên>` | Bật hoặc tắt skill trong `skills/` |
| `/clear`, `/help`, `/exit` | Xoá hội thoại, trợ giúp, thoát |

Phím tắt: `tab` hoàn thành lệnh đang gõ (`/con` → `/connect`), `↑↓` chọn gợi ý, `esc` dừng câu trả lời hoặc đóng hộp thoại, `ctrl+c` thoát.

Danh sách provider và model lấy từ [models.dev](https://models.dev), cùng nguồn với opencode. Danh sách được cache 1 giờ ở `~/.opentrading/cache/models.json`. Các provider cần SDK riêng hoặc cấu hình thêm (Azure, Bedrock, Vertex…) bị ẩn và được ghi trong `ToDoList.txt`.

Key được lưu ở `~/.opentrading/auth.json`, nằm ngoài repo. Có thể đổi thư mục bằng biến `OPENTRADING_HOME`. Nếu provider chưa có key trong file này, chương trình đọc key từ biến môi trường của provider đó, ví dụ `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`.

Muốn thử provider mà không mở TUI: `bun src/core/chat.ts "xin chào"`.

## Kiểm tra

```shell
bun run typecheck
bun test          # smoke test TUI chạy headless; SHOW_FRAME=1 để in khung hình
```

## Cấu trúc

```
src/core/     provider, auth, config, chat stream, skills, system prompt (không import UI)
src/tui/      giao diện: theme, logo, background động, màn hình, dialog
skills/       skill dạng markdown (frontmatter: name, description)
handbook/     tài liệu thiết kế
legacy-python/  scaffold Python cũ, giữ lại để làm sidecar quant sau này
docs/decisions/ các quyết định kiến trúc
```

Xem [docs/decisions/0001-typescript.md](docs/decisions/0001-typescript.md) để biết vì sao chọn TypeScript và Python sẽ được dùng ở đâu.
