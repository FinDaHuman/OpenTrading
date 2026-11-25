# Giới hạn sử dụng Gemini API (Google AI Studio)

Tóm tắt từ tài liệu chính thức của Google và trang quota của một project gói Free, đọc ngày 25/11/2026:
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Pricing](https://ai.google.dev/gemini-api/docs/pricing);
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [Release notes](https://ai.google.dev/gemini-api/docs/changelog);
- [API errors](https://ai.google.dev/gemini-api/docs/api-errors), [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting).

Google thay đổi các con số này thường xuyên. Trước khi dựa vào một số cụ thể, hãy mở lại các trang trên.

## Tóm tắt nhanh

- Dùng `gemini-3.5-flash-lite` hoặc `gemini-3.1-flash-lite`: 15 request/phút, 250.000 token vào/phút, 500 request/ngày. Các model Flash khác chỉ có 20 request/ngày.
- Quota tính **theo project**: mọi cửa sổ `ot`, mọi eval và mọi phiên làm việc dùng chung key thì dùng chung quota. Không chạy song song.
- Ở project đã kiểm, 429 của 3.1 Flash-Lite nhiều khả năng đến từ **giới hạn theo phút**: đỉnh 28 ngày là 20/15 RPM và 282.610/250.000 TPM, còn RPD mới 310/500.
- 503 là Google quá tải, không phải hết quota. Chờ rồi thử lại, hoặc đổi model.

## Giới hạn được tính thế nào

- Ba chiều giới hạn:
  - **RPM**: số request mỗi phút;
  - **TPM**: số token đầu vào mỗi phút;
  - **RPD**: số request mỗi ngày.

  Vượt bất kỳ chiều nào cũng bị lỗi giới hạn.
- Giới hạn tính **theo project**, không theo API key. Tạo thêm key trong cùng project không có thêm quota.
- **RPD được đặt lại lúc nửa đêm giờ Thái Bình Dương (Pacific time)**: 15:00 giờ Việt Nam vào mùa đông (giờ chuẩn), 14:00 vào mùa hè.
- Vượt giới hạn thì API trả `429 RESOURCE_EXHAUSTED`. Trang API errors tách hai loại: vượt giới hạn theo phút thì chờ rồi thử lại, hết quota ngày thì phải đợi đặt lại. OpenTrading hiện lỗi này thành "Hết quota hoặc bị giới hạn tốc độ (429)".
- **Google không công bố bảng số RPM/TPM/RPD cho từng model.** Trang rate limits chỉ ghi "rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio".
  - Con số áp cho project của bạn xem ở [AI Studio → Rate limit](https://aistudio.google.com/rate-limit?timeRange=last-28-days).
  - Google cũng ghi giới hạn "không được đảm bảo, năng lực thực tế có thể khác".

## Các hạng (tier)

| Hạng | Điều kiện | Trần chi tiêu |
| --- | --- | --- |
| Free | Project đang hoạt động hoặc đang dùng thử; vài project phải xác minh | — |
| Tier 1 | Đã gắn tài khoản thanh toán | $250 |
| Tier 2 | Đã chi trên $100 và đã 3 ngày kể từ lần thanh toán đầu | $2.000 |
| Tier 3 | Đã chi trên $1.000 và đã 30 ngày kể từ lần thanh toán đầu | $20.000–$100.000+ |

- Từ Tier 1 trở lên còn có **giới hạn theo chi tiêu**, tính trên cửa sổ trượt 10 phút: Tier 1 là $10, Tier 2 và Tier 3 là $200 cho mỗi 10 phút. Vượt mức này cũng trả 429.
- Muốn lên hạng thì bật thanh toán trong AI Studio. Có thể xin tăng giới hạn qua form của Google, nhưng Google không cam kết sẽ duyệt.
- Batch API có giới hạn riêng, tách khỏi request thường. OpenTrading không dùng Batch API.

## Model nào dùng miễn phí được

Theo trang Pricing (25/11/2026):

- **Có gói miễn phí**:
  - Gemini 4 Hydrogen (mới, 12/11/2026);
  - Gemini 3.8 Flash, 3.6 Flash, 3 Flash Preview;
  - Gemini 3.5 Flash-Lite, 3.1 Flash-Lite;
  - Gemini 2.5 Flash, 2.5 Flash-Lite (chỉ cho người đã từng dùng), Gemma 4.
- **Không có gói miễn phí**: Gemini 4 Carbon, Argon, Neon; Gemini 3.1 Pro Preview.
- **Tìm kiếm Google (grounding) không miễn phí với mọi model Gemini 3 trở lên.** Chỉ Gemini 2.5 Flash / Flash-Lite còn 500 lượt/ngày miễn phí (theo trang Pricing). Xem mục "web_search" bên dưới.
- Ở gói miễn phí, dữ liệu gửi lên **được Google dùng để cải thiện sản phẩm**. Ở gói trả phí thì không. Đừng gửi thông tin cá nhân hay danh mục thật qua key miễn phí.

### Model đã chuyển hướng hoặc sắp ngừng

| Model | Điều gì xảy ra |
| --- | --- |
| `gemini-3.5-flash` | Đã chuyển hướng sang `gemini-3.6-flash` (từ 08/10/2026) |
| `gemini-3.7-flash` | Đã chuyển hướng sang `gemini-3.8-flash` (từ 08/10/2026) |
| `gemini-2.5-flash` | Từ **01/12/2026** chuyển hướng sang `gemini-3.5-flash-lite` |
| `gemini-2.5-pro` | Từ **01/12/2026** chuyển hướng sang `gemini-3.8-flash` |
| `gemini-2.5-flash-lite` | Chưa có ngày ngừng |
| `gemini-3.1-flash-lite` | Ngừng sớm nhất 07/05/2027; Google khuyên chuyển sang `gemini-3.5-flash-lite` |

Google ghi các ngày trên là sớm nhất có thể và sẽ báo trước. Với model chuyển hướng, quota đi theo model nào thì trang không nói.

## Giới hạn miễn phí thực tế của các model harness gọi được

Số liệu chép ngày 25/11/2026 từ trang [Rate limit của AI Studio](https://aistudio.google.com/rate-limit?timeRange=last-28-days) của một project gói Free. Danh sách model là những gì `/model` hiện ra với provider Google (catalog models.dev qua `chatModels`, `src/core/providers.ts`). Giới hạn tính theo project nên project khác có thể khác.

Cột "Đỉnh 28 ngày" là mức dùng cao nhất AI Studio ghi lại ở project đó (RPM, TPM, RPD).

**Dùng được cho chat, có gọi tool, có quota miễn phí:**

| Model trong `/model` (id) | RPM | TPM (đầu vào) | RPD | Đỉnh 28 ngày | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) | 15 | 250K | **500** | 10 · 99,74K · 69 | Nên dùng cho key miễn phí, kể cả làm "Model cho subagent" |
| Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite`) | 15 | 250K | **500** | **20 · 282,61K** · 310 | Như trên, nhưng đã vượt RPM và TPM |
| Gemini 2.5 Flash-Lite (`gemini-2.5-flash-lite`) | 10 | 250K | 20 | 9 · 76,89K · **18** | Chỉ 20 request/ngày |
| Gemini 4 Hydrogen (`gemini-4-hydrogen`) | 5 | 250K | 20 | 0 · 0 · 0 | Chưa thử với OpenTrading |
| Gemini 3.8 Flash (`gemini-3.8-flash`) | 5 | 250K | 20 | 1 · 14K · 3 | |
| Gemini 3.6 Flash (`gemini-3.6-flash`) | 5 | 250K | 20 | 0 · 0 · 0 | |
| Gemini 3 Flash Preview (`gemini-3-flash-preview`) | 5 | 250K | 20 | 0 · 0 · 0 | AI Studio ghi là "Gemini 3 Flash" |
| Gemini 2.5 Flash (`gemini-2.5-flash`) | 5 | 250K | 20 | 0 · 0 · 0 | Chuyển hướng từ 01/12/2026 |
| Gemma 4 26B / 31B (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) | 30 | **16K** | 14,4K | 0 · 0 · 0 | Nhiều request/ngày, nhưng một request của OpenTrading có thể đã gần 16K token, nên chỉ chạy được 1 request mỗi phút hoặc bị 429 ngay |
| `gemini-flash-latest`, `gemini-flash-lite-latest` | — | — | — | — | Bí danh; quota là quota của model được trỏ tới. AI Studio không có dòng riêng |

**Có trong `/model` nhưng không dùng được ở gói miễn phí** (AI Studio ghi 0/0):
- Gemini 4 Carbon, Argon, Neon.
- Gemini 2.5 Pro, Gemini 3.1 Pro Preview và bản Custom Tools.
- Gemini 2.0 Flash / Flash-Lite, Computer Use Preview, Deep Research Pro Preview.
- Các model ảnh Nano Banana (`gemini-3-pro-image*`, `gemini-3.1-flash-image*`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`).

Trang Pricing ghi Gemini 2.5 Pro "Free of charge", nhưng project này có giới hạn 0. Hãy tin trang Rate limit của project bạn.

**Có trong `/model` nhưng không phải model chat**, chọn sẽ lỗi:
- Embedding (`gemini-embedding-001`, `gemini-embedding-2`), Lyria (`lyria-3-*`), model TTS.
- `gemini-3.1-flash-live-preview`: dùng Live API, harness gọi qua `generateContent` nên không chạy.

Harness chưa lọc các model này khỏi `/model`.

### web_search với key miễn phí

AI Studio ghi "Search grounding" của **Gemini 3 trở lên là 0/0**, của Gemini 2.5 là 1.500 lượt/ngày (đã dùng 1). Vì vậy `web_search` bằng model Gemini 3 trở lên luôn bị 429; harness nhận ra lỗi này, bỏ qua grounding tới lúc quota đặt lại và dùng các backend còn lại (`src/core/tools/web/side-model.ts`, [web.md](web.md)).
- Có thể đặt `/config` → "Model cho tìm kiếm / đọc web" = `gemini-2.5-flash-lite` để thử grounding miễn phí, nhưng model này chỉ có 20 request/ngày cho cả tìm kiếm lẫn đọc trang.
- Cách khác: đặt `EXA_API_KEY`, `TAVILY_API_KEY` hoặc `BRAVE_API_KEY`, hoặc bật tìm kiếm MCP hosted trong `/config`.

**Ước lượng ngân sách với 3.5/3.1 Flash Lite (15 RPM, 500 RPD):**
- Một câu hỏi thường tốn 1–4 request, nên khoảng 125–500 câu mỗi ngày.
- 3 subagent song song, mỗi con tới 10 bước, có thể cần ~30 request trong 1–2 phút. Như vậy là vượt 15 RPM, các bước sẽ gặp 429 và phải chờ. Đặt "Subagent chạy song song" là 1–2.
- 250K TPM: nếu mỗi request mang ~20K token ngữ cảnh thì chỉ được khoảng 12 request/phút.

## Kinh nghiệm thực tế với OpenTrading

- **Tháng 09/2026**: key miễn phí hết quota sau khoảng 20 request trong ngày. Bảng trên giải thích lý do: `gemini-2.5-flash-lite` chỉ có 20 RPD, còn 3.1/3.5 Flash Lite có 500.
- **Tháng 10/2026**: `/compact` từng gặp 503 từ Google; thử lại thì được. 503 là lỗi quá tải phía Google, không phải 429.
- **23–24/11/2026**: `gemini-3.1-flash-lite` trả 503 gần như mọi lần. Không thấy thông báo chính thức nào; diễn đàn Google có nhiều báo cáo 503 ở gói Free từ 09/2026 ([ví dụ](https://discuss.ai.google.dev/t/gemini-3-5-flash-lite-repeated-503-unavailable-including-minimal-text-request/185876)).
- **25/11/2026** (một đợt eval, tới 14:00, tính theo kết quả từng request): 3.5 Flash-Lite 69 lần được, 2 lần 429; 2.5 Flash-Lite 18 và 1; 3.1 Flash-Lite 14, với 2 lần 429 và 1 lỗi mạng. Cùng lúc có phiên khác dùng chung key. Thân lỗi 429 không được lưu, nên chưa biết từng lần là RPM, TPM hay RPD.
- **Thử lại tự động** (`src/core/retry.ts`): 503/5xx được thử lại tới 4 lần. 429 thì đọc chi tiết lỗi của Google: `quotaId` có `PerDay` là hết quota ngày, không thử lại (thử lại chỉ tốn thêm request); 429 theo phút chờ đúng `retryDelay` Google báo rồi thử lại tối đa 2 lần.

**Một câu hỏi tốn bao nhiêu request**, vì mỗi bước của agent loop là một request:
- Câu hỏi thường: 1–4 request (gọi tool, `tool_search`, câu trả lời).
- Mỗi **subagent** tốn thêm tới `maxSteps` request: `nghien-cuu` tối đa 10, `tra-cuu` 6, `phan-bien` và `tin-tuc` 8.
- "Định giá 3 mã song song" có thể tốn khoảng 20–30 request, tức hết cả ngày của một model 20 RPD.
- Mỗi **subagent nền** khi xong lúc đang rảnh tốn thêm 1 request để agent chính đọc kết quả.
- `/compact` và tự nén tốn 1 request.

## Cài đặt nên dùng với key miễn phí

- `/model`: chọn **Gemini 3.5 Flash-Lite** (hoặc **3.1 Flash-Lite** khi 3.5 gặp 503), mỗi model 500 RPD riêng. Tránh các model 20 RPD cho việc dài.
- `/config` → **Subagent chạy song song**: đặt 1–2. Mặc định là 10, vượt xa 15 RPM.
- `/config` → **Model cho subagent**: dùng một model Flash Lite khác với model chính để mỗi bên có quota riêng (quota tính theo từng model), hoặc dùng một provider khác Gemini.
- Khi cần chạy **5 subagent một lượt**: đặt "Subagent chạy song song" = 2–3 và dùng `gemini-3.5-flash-lite`. Xác nhận 19/10/2026: model còn sống, `tool_call=true`, `reasoning=true`; harness bật `includeThoughts` nên Gemini gửi phần suy luận về, và phần đó được tính là tiến triển (watchdog subagent và bộ đếm 5 phút không nhận dữ liệu). Nếu subagent vẫn bị dừng vì im lặng, tăng `subagents.idleMs` (xem [subagents.md](subagents.md)).
- **Mỗi lúc chỉ một nguồn gọi key**: không mở nhiều cửa sổ `ot`, nhiều eval, hay nhiều phiên agent cùng chạy model Gemini. Đây là cách dễ vượt 15 RPM nhất.
- **Chạy eval**: một tiến trình, khoảng 6 request/phút. Lượt eval mang 20K–40K token mỗi request thì TPM chạm trước RPM. Chạy phần lớn sau 15:00 giờ Việt Nam khi quota ngày vừa đặt lại, và lưu `quotaId`, `quotaValue`, `retryDelay` của mỗi lỗi 429.
- Gặp 429 theo phút thì chờ đúng `retryDelay`; hết quota ngày thì đợi 15:00 giờ Việt Nam (mùa đông). Gặp 503 liên tục thì đổi sang Flash-Lite còn lại hoặc chờ, đừng thử lại dồn dập.
- Theo dõi mức đã dùng ở AI Studio → Rate limit (xem được 28 ngày gần nhất).
