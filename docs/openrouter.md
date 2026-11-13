# Ghim provider OpenRouter

Một model trên OpenRouter thường có nhiều provider phục vụ, ví dụ `deepseek/deepseek-v4.1-flash-1017`. Các provider này khác nhau về quantization (fp4–fp8), giá, tốc độ và cả chất lượng câu trả lời. Mặc định, OpenRouter tự chọn provider cho từng request, và khi provider đó lỗi thì chuyển sang provider khác. Nếu cần kết quả lặp lại được (benchmark, so sánh), hãy ghim provider.

## Đặt trong `config.json`

```jsonc
// ~/.opentrading/config.json
"openrouter": {
  "routing": {
    "deepseek/deepseek-v4.1-flash-1017": { "order": ["deepseek"], "allow_fallbacks": false },
    "*": { "quantizations": ["fp8"] }
  }
}
```

- Khoá là model id trên OpenRouter. `"*"` áp dụng cho mọi model OpenRouter.
- Hai khối được gộp theo từng khoá, và khoá của model thắng. Với ví dụ trên, model DeepSeek nhận cả `order`, `allow_fallbacks` lẫn `quantizations`.
- Tên khoá giữ nguyên như khối `provider` trong [tài liệu provider routing của OpenRouter](https://openrouter.ai/docs/features/provider-routing):
  - `order`, `only`, `ignore`: danh sách slug provider, ví dụ `deepseek` hoặc `deepinfra/fp8`;
  - `allow_fallbacks`, `require_parameters`, `zdr`;
  - `quantizations`;
  - `data_collection` (`allow`/`deny`), `sort` (`price`/`throughput`/`latency`), `max_price`.
- Giá trị sai kiểu bị bỏ qua và không được gửi đi, vì OpenRouter sẽ từ chối cả request nếu có giá trị sai.

Ghim được gửi kèm **mọi** request tới model đó:
- agent chính và subagent;
- nén context và tóm tắt;
- tiêu đề phiên;
- model phụ của `web_search`/`web_fetch`;
- model duyệt của chế độ ▸▸.

Gateway khác có dùng lại SDK OpenRouter thì không nhận ghim.

**Cẩn thận với `"*"`.** Đặt `order` hoặc `only` dưới `"*"` sẽ ghim cả model phụ (web, tiêu đề, auto mode) vào provider đó. Nếu model phụ là một model khác hãng (ví dụ Gemini qua OpenRouter) và fallback đã tắt, request của nó sẽ lỗi. Hãy ghim provider theo từng model, và chỉ đặt dưới `"*"` những khoá chung như `quantizations` hay `data_collection`.

## Khi không có provider nào khớp

Nếu provider đã ghim không phục vụ model, hoặc đang sập mà fallback đã tắt, OpenRouter trả lỗi kiểu "No allowed providers…" hay "No endpoints found…", thường kèm mã 404 (đôi khi 502/503). OT hiện một dòng: "OpenRouter không có provider nào phục vụ được request này…" và nhắc kiểm tra `openrouter.routing`.

Khi OpenRouter gửi kèm lý do loại từng provider, dòng lỗi giữ lại các lý do đó và rút danh sách dài thành số đếm, ví dụ `Guardrails loại deepseek (Paid model training violation (account settings)); Fallback loại 47 provider`.

**Cài đặt tài khoản cũng loại provider.** Trang [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy) đặt chính sách dữ liệu của tài khoản. Nếu tài khoản không cho phép provider dùng prompt để huấn luyện, OpenRouter loại các provider làm việc đó, trong đó có `deepseek` chính hãng (đã gặp thật 08/11). Ghim `order: ["deepseek"]` và tắt fallback thì request sẽ lỗi. Khi đó, đổi cài đặt trên trang trên hoặc ghim một provider khác. Dòng lỗi có lý do "account settings" thì OT nhắc tới trang này.

## Trong eval

`scripts/eval/run.ts` không đọc ghim từ config của bạn. Mỗi lần chạy phải nêu bằng cờ, mỗi cờ ứng với một khoá:

```shell
bun scripts/eval/run.ts --questions set.json --memory none --yes \
  --model openrouter/deepseek/deepseek-v4.1-flash-1017 \
  --or-provider deepseek --or-no-fallback [--or-quant fp8]
```

- Thiếu `--or-provider`, hoặc có `--or-provider` mà thiếu `--or-no-fallback`: dòng ước tính in cảnh báo rằng kết quả có thể lẫn provider.
- Dùng cờ `--or-*` với model không phải OpenRouter thì lệnh dừng.
- Trace ghi `settings.openrouter_routing` ở dòng `run`, và `served_by` (số bước theo từng provider đã thật sự trả lời, kể cả bước của subagent) ở mỗi `answer`. Cuối lần chạy in tổng, ví dụ `DeepSeek 412`.
- `served_by` là tên hiển thị OpenRouter trả về (`DeepSeek`), không phải slug (`deepseek`). Đọc số này để biết ghim có bị lọt không; đừng so chuỗi tự động với `order`.
