# Eval

Bộ câu hỏi kiểm tra OpenTrading từ đầu đến cuối, kèm kết quả từng lần chạy.

| File | Nội dung |
| --- | --- |
| `samples.md` | Bộ câu hỏi theo nhóm (A–G) và kết quả mong đợi |
| `samples-answer.md` | Kết quả lần chạy ngày 02/10/2026 |

## Đây là bản ghi lịch sử

Mỗi file kết quả ghi lại đúng những gì đã thấy ở một thời điểm. **Không sửa nội dung cũ**: chạy lại thì thêm file mới (ví dụ `answers-2026-10-20.md`) và ghi ngày chạy, commit của `main`, model và server MCP đã dùng.

Từ lần chạy 02/10/2026 tới nay, harness đã thay đổi những điểm sau, nên vài chỗ trong hai file trên không còn đúng:

- **Preset:** không còn preset tool (`preset scan`, `switch_preset`). Tool MCP được hoãn và nạp qua `tool_search` (PR #19, #20).
- **`Long.md` và `/mcp-setup`:** đã bỏ. Kết nối server công ty bằng `mcp add` cùng `mcp secret set` (xem `docs/mcp.md`).
- **Prompt của MCP:** gọi bằng `/server:prompt tham_số` (ví dụ `/opentrading:ticker_analysis VCB`), cả trong TUI lẫn `bun src/core/chat.ts`.
- **Nén hội thoại** đã có (PR #23), nên mục G3 không còn đúng.
- **Skill** đã lên bản 1.3.0. Biểu đồ giờ là text thuần, không màu (PR #25).

## Chạy lại

Luôn chạy với một thư mục dữ liệu tạm, không dùng `~/.opentrading`:

```sh
OPENTRADING_HOME=/tmp/ot-eval bun src/core/chat.ts "giá FPT 30 phiên"
```

Lần chạy dùng key LLM thật tốn quota. Ghi rõ model đã dùng và câu nào bị dừng vì hết quota, để không nhầm với lỗi của harness.

## Đo định tuyến offline (không cần key)

`test/routing-eval.test.ts` đo hai tầng quyết định model có thấy đúng tool/skill hay không, chạy trong CI:

- **tool**: câu hỏi đi qua `tool_search` thật trên catalog MCP đã chụp (`test/fixtures/mcp-catalog/opentrading.json`) → tool kỳ vọng có được nạp không;
- **skill**: lời nhắc `goi_y_skill` do `assemble` gắn vào tin nhắn → skill kỳ vọng có được gợi ý không, và gợi ý sai bao nhiêu.

Nhãn viết tay trong `test/fixtures/eval-routing.json` (67 câu lấy từ đề 236 câu ngày 12/10, chỉ có câu hỏi). `split` đã cố định: chỉnh trên `dev`, báo cáo cả `heldout`. Test giữ các ngưỡng đã đo (`FLOOR`); thay đổi làm tụt số nào là test hỏng, cải thiện thì nâng ngưỡng.

```sh
bun scripts/dev/routing-eval.ts        # các câu trượt + tổng hợp dev/heldout
bun scripts/dev/routing-eval.ts --all  # mọi câu
```

Catalog chụp lại từ checkout `opentrading-mcp` (ghi commit đang chạy trên Render):

```sh
uv run python ../OpenTrading/scripts/dev/dump-mcp-catalog.py ../OpenTrading/test/fixtures/mcp-catalog/opentrading.json <commit>
```

Số tool là proxy: model thật tự viết truy vấn `tool_search`. Vẫn dùng được để so trước/sau khi đổi hint, mô tả tool hay synonyms.

