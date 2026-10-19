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

## Giới hạn miễn phí thực tế của các model harness gọi được

Số liệu lấy từ trang [Rate limit của AI Studio](https://aistudio.google.com/rate-limit?timeRange=last-28-days) cho project của người dùng (gói Free), chép ngày 07/10/2026. Danh sách model là những gì `/model` hiện ra với provider Google (catalog models.dev qua `chatModels`, `src/core/providers.ts`). Giới hạn tính theo project nên project khác có thể khác. Hãy xem lại trang trên trước khi dựa vào các số này.

**Dùng được cho chat, có gọi tool, có quota miễn phí:**

| Model trong `/model` (id) | RPM | TPM (đầu vào) | RPD | Ghi chú |
| --- | --- | --- | --- | --- |
| Gemini 3.5 Flash Lite (`gemini-3.5-flash-lite`) | 15 | 250K | **500** | Nên dùng cho key miễn phí, kể cả làm "Model cho subagent" |
| Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`) | 15 | 250K | **500** | Như trên. Người dùng đã thử thật, kể cả subagent |
| Gemini 2.5 Flash-Lite (`gemini-2.5-flash-lite`) | 10 | 250K | 20 | Chỉ 20 request/ngày. AI Studio ghi đã dùng 25/20 RPD và 12/10 RPM: đây là quota hết nhanh ở 09/2026 |
| Gemini 2.5 Flash (`gemini-2.5-flash`) | 5 | 250K | 20 | |
| Gemini 3 Flash Preview (`gemini-3-flash-preview`) | 5 | 250K | 20 | AI Studio ghi là "Gemini 3 Flash" |
| Gemini 3.5 / 3.6 / 3.7 / 3.8 Flash (`gemini-3.x-flash`) | 5 | 250K | 20 | |
| Gemma 4 26B A4B / Gemma 4 31B (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) | 30 | **16K** | 14.4K | Nhiều request/ngày, nhưng TPM 16K/phút rất nhỏ: một request của OpenTrading (system prompt, tool, history) có thể đã gần 16K, nên chỉ chạy được 1 request mỗi phút hoặc bị 429 ngay |
| Gemini Flash Latest / Flash-Lite Latest (`gemini-flash-latest`, `gemini-flash-lite-latest`) | — | — | — | Bí danh, trỏ tới model Flash / Flash-Lite mới nhất; quota là quota của model được trỏ tới. AI Studio không có dòng riêng |

**Có trong `/model` nhưng không dùng được ở gói miễn phí** (AI Studio ghi 0/0):
- Gemini 2.5 Pro.
- Gemini 3.1 Pro Preview và bản Custom Tools.
- Gemini 2.5 Computer Use Preview.
- Deep Research Preview / Max Preview.
- Nano Banana Pro (`gemini-3-pro-image*`), Nano Banana 2 (`gemini-3.1-flash-image*`), Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`).

Trang Pricing ghi Gemini 2.5 Pro "Free of charge", nhưng project này có giới hạn 0. Hãy tin trang Rate limit của project bạn.

**Có trong `/model` nhưng không phải model chat**, chọn sẽ lỗi:
- Embedding (`gemini-embedding-001`, `gemini-embedding-2`).
- Lyria (`lyria-3-*`), Nano Banana (`gemini-2.5-flash-image`).
- `gemini-3.1-flash-live-preview`: dùng Live API, harness gọi qua `generateContent` nên không chạy.

Harness chưa lọc các model này khỏi `/model`, đã ghi vào việc cần làm.

**Ước lượng ngân sách với 3.5/3.1 Flash Lite (15 RPM, 500 RPD):**
- Một câu hỏi thường tốn 1–4 request, nên khoảng 125–500 câu mỗi ngày.
- 3 subagent song song, mỗi con tới 10 bước, có thể cần ~30 request trong 1–2 phút. Như vậy là vượt 15 RPM, các bước sẽ gặp 429 và phải chờ. Đặt "Subagent chạy song song" là 1–2.
- 250K TPM: nếu mỗi request mang ~20K token ngữ cảnh thì chỉ được khoảng 12 request/phút.

## Kinh nghiệm thực tế với OpenTrading

- **Tháng 09/2026**: key miễn phí hết quota sau khoảng 20 request trong ngày. Bảng trên giải thích lý do: `gemini-2.5-flash-lite` chỉ có 20 RPD, còn 3.1/3.5 Flash Lite có 500.
- **Tháng 10/2026**: `/compact` từng gặp 503 từ Google; thử lại thì được. 503 là lỗi quá tải phía Google, không phải 429.
- **Thử lại tự động** (`src/core/retry.ts`): 503/5xx được thử lại tới 4 lần. 429 thì đọc chi tiết lỗi của Google: `quotaId` có `PerDay` là hết quota ngày, không thử lại (thử lại chỉ tốn thêm request); 429 theo phút chờ đúng `retryDelay` Google báo rồi thử lại tối đa 2 lần.

**Một câu hỏi tốn bao nhiêu request**, vì mỗi bước của agent loop là một request:
- Câu hỏi thường: 1–4 request (gọi tool, `tool_search`, câu trả lời).
- Mỗi **subagent** tốn thêm tới `maxSteps` request: `nghien-cuu` tối đa 10, `tra-cuu` 6, `phan-bien` và `tin-tuc` 8.
- "Định giá 3 mã song song" có thể tốn khoảng 20–30 request, tức hết cả ngày của một model 20 RPD.
- Mỗi **subagent nền** khi xong lúc đang rảnh tốn thêm 1 request để agent chính đọc kết quả.
- `/compact` và tự nén tốn 1 request.

## Cài đặt nên dùng với key miễn phí

- `/model`: chọn **Gemini 3.5 Flash Lite** hoặc **3.1 Flash Lite** (500 RPD). Tránh các model 20 RPD (2.5 Flash-Lite, 2.5 Flash, 3.x Flash) cho việc dài.
- `/config` → **Subagent chạy song song**: đặt 1–2. Mặc định là 10, vượt xa 15 RPM.
- `/config` → **Model cho subagent**: dùng một model Flash Lite khác với model chính để mỗi bên có quota riêng (quota tính theo từng model), hoặc dùng một provider khác Gemini.
- Khi cần chạy **5 subagent một lượt**: đặt "Subagent chạy song song" = 2–3 và dùng `gemini-3.5-flash-lite`. Xác nhận 19/10/2026: model còn sống, `tool_call=true`, `reasoning=true`; harness bật `includeThoughts` nên Gemini gửi phần suy luận về, và phần đó được tính là tiến triển (watchdog subagent và bộ đếm 5 phút không nhận dữ liệu). Nếu subagent vẫn bị dừng vì im lặng, tăng `subagents.idleMs` (xem [subagents.md](subagents.md)).
- Gặp 429 thì chờ sang phút sau (RPM/TPM), hoặc đợi RPD đặt lại lúc nửa đêm giờ Pacific (khoảng 14:00–15:00 giờ Việt Nam).
- Theo dõi mức đã dùng ở AI Studio → Rate limit (xem được 28 ngày gần nhất).
