# Tìm kiếm và đọc web (`web_search`, `web_fetch`)

Hai tool local, làm theo cách của Claude Code (WebSearch/WebFetch) và Codex (`web.run`). Cả hai được hoãn nạp: model nạp bằng `tool_search` hoặc qua skill.

## `web_search`

Thứ tự backend:

1. **Tìm kiếm của chính provider**, chạy trong một lệnh gọi model phụ chỉ có tool search:
   - Gemini: `googleSearch`, cần Gemini 2.0 trở lên;
   - Anthropic: `web_search`;
   - OpenAI: `web_search` của Responses API, chỉ khi dùng API gốc của OpenAI, không qua proxy.

   Tool này không bao giờ được trộn vào lượt chính. Lý do: với Gemini trước bản 3, SDK sẽ bỏ hết function tool khi có provider tool trong cùng request.
2. **API có key**, theo thứ tự: `EXA_API_KEY` → `PARALLEL_API_KEY` → `TAVILY_API_KEY` → `BRAVE_API_KEY`.
3. **DuckDuckGo** (trang HTML; hay bị chặn).

Backend nào lỗi thì thử backend tiếp theo. Kết quả ghi rõ backend đã dùng và các lần đã thử.

**Tham số**

| Tham số | Ý nghĩa |
|---|---|
| `allowed_domains` / `blocked_domains` | Chỉ lấy, hoặc loại, kết quả từ các domain này. Không dùng cùng lúc cả hai. |
| `preset` | `vn_finance`, `vn_news`, `vn_official`: nhóm nguồn Việt Nam, xem `src/core/tools/web/domains.ts`. |
| `recency_days` | Chỉ lấy kết quả trong N ngày gần đây. |

Backend nào không tự lọc được domain hoặc ngày thì câu truy vấn được thêm toán tử `site:`/`after:`, rồi kết quả được lọc lại một lần nữa.

**Kết quả**
- Danh sách đánh số `[n] tiêu đề — domain — ngày`, kèm URL và đoạn trích.
- Phần tóm tắt của bộ tìm kiếm, nếu có.
- Lời nhắc trích nguồn: link markdown đặt cạnh khẳng định, cuối câu trả lời có mục "Nguồn:".
- Kết quả được cache 5 phút.

## `web_fetch`

- **Kiểm URL:** chỉ https (http tự nâng lên), không chứa user/password, dài tối đa 2000 ký tự.
- **Chặn địa chỉ nội bộ:** từ chối localhost/LAN/CGNAT, kiểm trên IP sau khi phân giải DNS. Đây là giảm thiểu, chưa chặn được DNS rebinding.
- **Chuyển hướng:** cùng site thì tự đi theo; sang host khác thì báo lại cho model kèm URL mới, không tự đi theo.
- **HTML:** lấy phần nội dung chính (Readability), chuyển sang markdown (turndown, giữ link và bảng), nhận đúng charset.
- **PDF:** lấy chữ bằng `unpdf`. PDF dạng scan thì báo không có lớp chữ.
- **`prompt`:** model phụ đọc trang (tối đa 100k ký tự) và chỉ trả phần cần. Model phụ giữ nguyên số liệu, ngày tháng và mã cổ phiếu; trích nguyên văn tối đa 125 ký tự mỗi đoạn.
- **Không có `prompt`:** trả mỗi lần 50k ký tự; đọc tiếp bằng `start_char`.
- **Cache:** 15 phút.
- **Duyệt theo domain:**
  - Các domain trong preset VN và `*.gov.vn` không cần hỏi.
  - Domain khác hỏi một lần, kèm lựa chọn cho phép lần này / cả phiên / luôn luôn (lưu theo từng domain).
  - Không có giao diện để hỏi thì từ chối.

## Model phụ

Mặc định dùng model của phiên. Đổi trong `/config` → "Model cho tìm kiếm / đọc web" (khoá `webModel` trong `config.json`); nên chọn model rẻ, ví dụ Gemini Flash Lite, để tiết kiệm quota.
