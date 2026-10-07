# Giới hạn sử dụng Gemini API (Google AI Studio)

Tóm tắt từ tài liệu chính thức của Google, đọc ngày 07/10/2026:
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), trang ghi cập nhật lần cuối 02/09/2026.
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing), trang ghi cập nhật lần cuối 07/10/2026.

Google thay đổi các con số này thường xuyên. Trước khi dựa vào một số cụ thể, hãy mở lại hai trang trên.

## Giới hạn được tính thế nào

- Ba chiều giới hạn:
  - **RPM**: số request mỗi phút;
  - **TPM**: số token đầu vào mỗi phút;
  - **RPD**: số request mỗi ngày.

  Vượt bất kỳ chiều nào cũng bị lỗi giới hạn.
- Giới hạn tính **theo project**, không theo API key. Tạo thêm key trong cùng project không có thêm quota.
- **RPD được đặt lại lúc nửa đêm giờ Thái Bình Dương (Pacific time)**, tức khoảng 14:00 hoặc 15:00 giờ Việt Nam tuỳ mùa (giờ mùa hè hay giờ chuẩn của Mỹ).
- Vượt giới hạn thì API trả `429 RESOURCE_EXHAUSTED`. OpenTrading hiện lỗi này thành "Hết quota hoặc bị giới hạn tốc độ (429)".
- **Google không công bố bảng số RPM/TPM/RPD cho từng model.** Trang rate limits chỉ ghi "rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio".
  - Con số áp cho project của bạn xem ở [AI Studio → Rate limit](https://aistudio.google.com/rate-limit?timeRange=last-28-days).
  - Google cũng ghi giới hạn "không được đảm bảo, năng lực thực tế có thể khác".

## Các hạng (tier)

| Hạng | Điều kiện | Trần chi tiêu |
| --- | --- | --- |
| Free | Project đang hoạt động hoặc đang dùng thử | — |
| Tier 1 | Đã gắn tài khoản thanh toán | $250 |
| Tier 2 | Đã chi trên $100 và đã 3 ngày kể từ lần thanh toán đầu | $2.000 |
| Tier 3 | Đã chi trên $1.000 và đã 30 ngày kể từ lần thanh toán đầu | $20.000–$100.000+ |

- Từ Tier 1 trở lên còn có **giới hạn theo chi tiêu**, tính trên cửa sổ trượt 10 phút: Tier 1 là $10, Tier 2 là $50, Tier 3 là $200 cho mỗi 10 phút. Vượt mức này cũng trả 429.
- Muốn lên hạng thì bật thanh toán trong AI Studio. Có thể xin tăng giới hạn qua form của Google, nhưng Google không cam kết sẽ duyệt.
- Batch API có giới hạn riêng, tách khỏi request thường. OpenTrading không dùng Batch API.

## Model nào dùng miễn phí được

Theo trang Pricing (07/10/2026):

- **Có gói miễn phí**:
  - Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash;
  - Gemini 3.5 Flash-Lite, 3.1 Flash-Lite;
  - Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite.
- **Không có gói miễn phí**: Gemini 3.1 Pro Preview.
- Ở gói miễn phí, dữ liệu gửi lên **được Google dùng để cải thiện sản phẩm**. Ở gói trả phí thì không. Đừng gửi thông tin cá nhân hay danh mục thật qua key miễn phí.

## Kinh nghiệm thực tế với OpenTrading

- **Tháng 09/2026**: key miễn phí của người dùng chỉ có khoảng **20 request/ngày**. Một lần debug bằng key đó đã dùng hết quota trong ngày. Đây là con số ghi nhận lúc đó, không phải số Google công bố, và có thể khác theo model; hãy kiểm tra lại trên trang Rate limit của AI Studio.
- **Tháng 10/2026**: `/compact` từng gặp 503 từ Google; thử lại thì được. 503 là lỗi quá tải phía Google, không trừ quota như 429.

**Một câu hỏi tốn bao nhiêu request**, vì mỗi bước của agent loop là một request:
- Câu hỏi thường: 1–4 request (gọi tool, `tool_search`, câu trả lời).
- Mỗi **subagent** tốn thêm tới `maxSteps` request: `nghien-cuu` tối đa 10, `tra-cuu` 6, `phan-bien` và `tin-tuc` 8.
- "Định giá 3 mã song song" có thể tốn khoảng 20–30 request, tức hết quota miễn phí trong một câu.
- Mỗi **subagent nền** khi xong lúc đang rảnh tốn thêm 1 request để agent chính đọc kết quả.
- `/compact` và tự nén tốn 1 request.

## Cài đặt nên dùng với key miễn phí

- `/config` → **Subagent chạy song song**: đặt 1–2. Mặc định là 10, quá nhiều cho RPM của gói miễn phí.
- `/config` → **Model cho subagent**: chọn một model rẻ hoặc có quota riêng; nếu được, dùng một provider khác Gemini cho subagent.
- Hạn chế yêu cầu kiểu "song song nhiều mã". Gặp 429 thì chờ, hoặc đợi RPD đặt lại theo giờ Pacific.
- Kiểm tra mức đã dùng ở AI Studio → Rate limit (xem được 28 ngày gần nhất).
