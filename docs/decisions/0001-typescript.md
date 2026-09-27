# 0001 · TypeScript là ngôn ngữ chính

- Trạng thái: chấp nhận, 27/09/2026
- Ghi đè: khuyến nghị ở `HarnessPlan.html` §12.2 (lõi Rust + ratatui + Tauri)

## Bối cảnh

HarnessPlan §12 khuyến nghị dùng Rust cho lõi và ratatui cho TUI. Đội muốn TypeScript là ngôn ngữ chính, nhưng vẫn cần:

- một TUI đẹp ngang ratatui;
- dùng được các thư viện quant và AI chỉ có ở Python.

## Quyết định

1. **Lõi và TUI viết bằng TypeScript, chạy trên Bun.**
   - TUI dùng OpenTUI và SolidJS, cùng stack với opencode.
   - OpenTUI có native core, có binary cho Windows, macOS và Linux.
   - OpenTUI cho vẽ trực tiếp lên framebuffer (xem `src/tui/background.tsx`), nên biểu đồ nến hay braille sau này vẽ được bằng TS mà không cần Rust.
2. **LLM gọi qua Vercel AI SDK.**
   - Có sẵn `@ai-sdk/groq` và `@ai-sdk/google`.
   - Dùng `@ai-sdk/openai-compatible` cho NVIDIA NIM và các provider tương thích OpenAI khác.
3. **Python chỉ là sidecar, và chỉ thêm từ P2 trở đi.**
   - Sidecar là một tiến trình con chạy MCP server qua stdio: pandas, statsmodels, backtest, thư viện dữ liệu VN.
   - Lõi TS gọi sidecar như một tool. Đường nóng (UI, agent loop, provider) vẫn nằm ở TS.
   - Code Python cũ được giữ trong `legacy-python/` làm điểm xuất phát.
4. **Không dùng TUI Rust kết hợp lõi TS.** Hai ngôn ngữ cho phần giao diện làm tăng gấp đôi độ phức tạp, trong khi không mang lại gì mà OpenTUI chưa có.

## Hệ quả

- Người dùng cần cài Bun, hoặc sau này dùng `bun build --compile` để ra một file chạy duy nhất.
- Khởi động chậm hơn Rust (khoảng vài trăm ms). Mức này chấp nhận được với bản demo.
- `src/core/` không import UI. Nhờ đó sau này có thể tách lõi thành daemon JSON-RPC như HarnessPlan §2 mô tả.
