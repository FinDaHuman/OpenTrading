# OpenTrading — số liệu đối trọng và kế hoạch đánh giá

*Cập nhật 26/10/2026. Số bên ngoài: đã công bố. Số OpenTrading: chưa đo. Các mục tiêu bên dưới là đề xuất để khóa trước thực nghiệm.*

## 1. Số liệu công bố

### 1.1. Nhiều harness, cùng model: FrontierHarness

**Kimi K3; 30 task coding/cấu hình; 12 cấu hình, 9 harness.** Dữ liệu ngày 22/08/2026, kiểm tra 26/10/2026. [Dữ liệu][fh], [phiên bản][fv]

| Harness/cấu hình | Phiên bản được đo | Đạt/30 | Cache hit p50¹ | Latency p50, giây¹ |
|---|---|---:|---:|---:|
| Codex | 0.148.0 | 20/30 | 88,0% | 403,3 |
| DSH Creator | 0.1.0-rc.8 | 19/30 | 84,3% | 403,9 |
| Claude Code | 2.1.237 | 19/30 | 67,8% | 578,0 |
| Pi | 0.84.2 | 18/30 | 79,4% | 453,3 |
| DSH PTC | 0.1.0-rc.8 | 18/30 | 87,2% | 463,8 |
| DSH Standard | 0.1.0-rc.8 | 18/30 | 86,5% | 376,5 |
| Oh My Pi | 17.4.0 | 17/30 | 82,2% | 406,4 |
| Kimi Code | 0.37.2 | 17/30 | 88,0% | 475,9 |
| DSH Minimal | 0.1.0-rc.8 | 17/30 | 84,6% | 341,2 |
| Exo | 0.1.0 | 16/30 | 70,3% | 377,2 |
| OpenCode | 1.18.19 | 15/30 | 78,4% | 387,3 |
| Hermes | 0.20.4 | 15/30 | 85,9% | 417,8 |

¹ Cache và latency tính **chỉ trên các task thành công**; tỷ lệ đạt tính trên toàn bộ 30. Các số cache/time đã được đối chiếu lại với JSON gốc. Đây là benchmark coding, không phải chất lượng tài chính.

### 1.2. Nghiên cứu nhỏ: cùng task, cùng GPT-5.6 Luna

Task sửa lỗi; **3 lần/harness**, số liệu trung vị. [Kết quả cộng đồng d1-m4ss][small]

| Harness | Đạt | Latency, giây | Tổng input, nghìn token | Cache hit |
|---|---:|---:|---:|---:|
| Codex | 3/3 | 107,73 | 505,4 | 90,1% |
| Pi | 3/3 | 140,96 | 525,4 | 90,9% |
| OpenCode stable | 3/3 | 274,43 | 1.797,1 | 93,9% |
| OpenCode beta | 3/3 | 402,75 | ≥1.015,4² | 91,4%² |

² Beta thiếu usage của subagent; token/cache chỉ phản ánh phần quan sát được. Nghiên cứu ít mẫu, không phát hành raw sessions; dùng làm tham khảo, không coi là thứ hạng tổng quát.

### 1.3. Workload thực tế, Cursor và tài chính

**TraceLab v2:** dữ liệu quan sát 4.265 session, nhiều model/người dùng; không phải thí nghiệm giữ model cố định. [Bảng 1, 10, 11][trace]

| Chỉ số | Claude Code | Codex |
|---|---:|---:|
| Cache hit token-weighted, toàn workload | 95,8% | 95,7% |
| Cache hit ở bước bắt đầu từ người dùng | 86,9% | 78,2% |
| Cache hit ở bước sau tool result | 97,9% | 97,2% |
| Tool overhead p50 / p90, giây | Không đủ số tương đương | 0,13 / 0,24 |

**Các bộ khác — giữ riêng vì khác cách chấm:**

| Benchmark | Hệ thống/điều kiện | Điểm công bố | Tài nguyên công bố |
|---|---|---:|---|
| [CursorBench 4.0][cursor] | Cursor + Opus 5.5 Max | 57,8% | 218.363 token; 185 bước |
| CursorBench 4.0 | Cursor + Sonnet 5.5 Max | 55,5% | 271.920 token; 170 bước |
| [Finance Agent v2.1][vals] | Harness chung + Claude Opus 5.5 | 67,85% | 33 phút; 8,91 USD/test |
| Finance Agent v2.1 | Harness chung + DeepSeek V4.1 Flash | 65,43% | 16 phút; 0,37 USD/test |
| Finance Agent v2.1 | Harness chung + GLM 5.3 Flash | 60,59% | 4 phút 56 giây; 0,07 USD/test |
| [FinSkillBench, preprint][fin] | Không cấp skill | 0,366 | 5.280 evaluations/điều kiện |
| FinSkillBench | Gói skill được biên soạn | 0,528 | Cùng tập phân tích ghép cặp |
| FinSkillBench | Tự tạo skill | 0,371 | Cùng tập phân tích ghép cặp |

Cursor: snapshot 26/10; Vals: trang cập nhật 24/10; FinSkillBench: bảng 2 của paper v1, phân tích ghép cặp tám model. Điểm Vals là **partial credit**, FinSkillBench là **mean score**; không phải điểm Claude Code hoặc tỷ lệ hoàn thành nghiêm ngặt.

**Cách dùng:** số công bố làm mốc tham khảo. Muốn nói OpenTrading hơn bao nhiêu, phải chạy lại đối chứng trên **cùng task tài chính và điều kiện**; không lấy latency tài chính so trực tiếp với latency coding.

## 2. Các thông số đo gì?

| Thông số | Ý nghĩa / cách đọc |
|---|---|
| **Strict success ↑** | Hoàn thành đủ yêu cầu và không sai tiêu chí bắt buộc; lượt lỗi vẫn tính trượt. |
| **All-success@3 ↑** | Tỷ lệ task đạt cả ba lần; đo độ ổn định khi hỏi lại. |
| **Rubric score ↑** | Điểm từng tiêu chí; có thể được điểm một phần dù chưa hoàn thành task. |
| **Cache hit ↑** | Phần input được provider đọc từ cache; không phải tỷ lệ câu trả lời đúng. |
| **p50 / p90 ↓** | Trung vị / mốc mà 90% quan sát không vượt quá; phải ghi cohort và số mẫu. |
| **TTFT ↓** | Thời gian đến token văn bản đầu tiên; tách khỏi keepalive, reasoning ẩn và tool event. |
| **E2E latency ↓** | Từ nhận task đến trả lời cuối; báo cả thời gian kết thúc lỗi/timeout riêng. |
| **Tool overhead ↓** | Thời gian quanh execution: RPC, queue, permission, serialize; không đồng nghĩa CPU harness. |
| **Cumulative input ↓** | Tổng input qua mọi request; khác kích thước context của request cuối. |
| **Request/token trên success ↓** | Tổng tài nguyên của mọi lượt, kể cả trượt, chia số lượt đạt. |
| **Stale rate ↓** | Tỷ lệ phản hồi cache sai phiên bản, kỳ hoặc thời điểm. |
| **CI 95%** | Khoảng bất định của ước lượng; khoảng chênh lệch chứa 0 thì chưa đủ bằng chứng hơn/kém. |

**Cache có hai tầng cần tách:** provider KV/prompt cache và cache dữ liệu/công cụ. Ghi cache thuộc provider, harness hay MCP server. Cache câu trả lời cuối tắt trong bài đo chất lượng.

## 3. Tổng quan thiết kế

### Đối chứng có thể chạy

| Harness mở | Vai trò đề xuất | Điều kiện đưa vào so sánh |
|---|---|---|
| **OpenCode** | Đối chứng chính | Khóa model/provider, MCP và session riêng. |
| **DeepSeek Harness** | Đối chứng thứ hai | Ghi profile Standard/Creator/Minimal/PTC cụ thể. |
| **Hermes** | Đối chứng thứ ba | Home sạch; tắt memory/skills lịch sử ngoài thiết kế. |
| **Pi** | Đối chứng tối giản | Cùng model và công cụ, thu đủ usage. |
| **Codex CLI** | Bổ sung khi cấu hình được provider chung | [CLI là mã nguồn mở][codex]; quyền dùng model/quota kiểm tra riêng. |
| **Cline** | Bổ sung nếu adapter đáp ứng | Headless, model/MCP chung, đủ trace. |

Mã nguồn mở không đồng nghĩa model miễn phí. Ưu tiên **OpenTrading–OpenCode**, sau đó DSH/Hermes; chỉ dùng quota miễn phí hợp lệ. Claude Code, Cursor, FreeBuff có thể thêm ở track sản phẩm nếu không khóa được model; không gộp vào kết luận về riêng harness.

### Bảy bài đánh giá

| ID | Câu hỏi cần trả lời | Mục tiêu OpenTrading đề xuất³ |
|---|---|---|
| E1 | Nghiên cứu tài chính có đúng và có bằng chứng? | Success hơn OpenCode ≥5 điểm phần trăm. |
| E2 | Prompt cache có tái dùng tốt? | Warm-cache ≥80% trên fixture quy định; không kém đối chứng. |
| E3 | Người dùng nhận kết quả nhanh đến đâu? | Latency p50 ≤80% đối chứng, giữ chất lượng. |
| E4 | Tool/data cache có nhanh và đúng? | Stale=0%; overhead p95 ≤100 ms trên local mock. |
| E5 | Mỗi kết quả đúng tốn bao nhiêu tài nguyên? | Input token/success ≤80% đối chứng, giữ chất lượng. |
| E6 | Context/compaction có làm mất dữ kiện? | Giữ đúng 100% facts bắt buộc trong fixture. |
| E7 | Gặp lỗi có dừng/khôi phục đúng? | Đạt 100% kịch bản mock; không vượt trần đã đặt. |

³ **Mục tiêu kỹ thuật tự đặt, không phải chuẩn ngành hoặc kết quả đã đạt.** Hiệu chỉnh bằng pilot rồi khóa trước test. Cache cao hoặc trả lời nhanh không bù cho số liệu tài chính sai.

## 4. Chi tiết từng bài đánh giá

### E1. Chất lượng và bằng chứng tài chính

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Đúng số liệu, kỳ, đơn vị, nguồn và lập luận; biết từ chối khi thiếu dữ liệu. |
| **Đối trọng có số** | FinSkillBench 0,366 → 0,528 là mean score; **chưa có số strict success tài chính tương đương cho OpenCode/DSH/Hermes trong nguồn đã thu thập**. Cần đo mới. |
| **Bài kiểm tra** | Sáu nhóm: tra cứu, tính toán, sàng lọc, doanh nghiệp, ngành/peers, kiểm chứng/thiếu dữ liệu. Ví dụ: phân biệt LNST hợp nhất với LNST cổ đông mẹ, tính tăng trưởng và dẫn đúng trang. |
| **Cách tính** | `Success = lượt đạt / mọi lượt đã bắt đầu`. `Δ = Success_OT − Success_đối_chứng`; cùng task chạy ba lần. |
| **Mục tiêu OT** | Δ≥5 điểm; CI của Δ phải >0 để hỗ trợ kết luận cải thiện. Muốn chứng minh hơn ít nhất 5 điểm, cận dưới CI phải >5. |
| **Điều kiện riêng** | Snapshot theo ngày công bố; gold/rubric giữ kín; chấm số bằng code, lập luận chấm mù. Lỗi trọng yếu làm task trượt. |

**Ví dụ gold giả lập:** doanh thu 1.000 → 1.200 tỷ, tăng trưởng `(1.200/1.000−1)×100=20%`. Sai đơn vị hoặc dùng nhầm kỳ vẫn trượt dù kết quả có số “20”.

### E2. Prompt/KV cache

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Khả năng tái dùng prefix; giảm input phải tính mới và TTFT. |
| **Đối trọng có số** | FrontierHarness cache p50: OpenCode **78,4%**, DSH Creator **84,3%**, Hermes **85,9%**, Pi **79,4%**; khác workload nên chỉ tham khảo. |
| **Bài kiểm tra** | Replay prompt thực của từng harness: prefix khoảng 8.000 token, suffix ≤512, đủ ngưỡng cache model. Mỗi block một call prime, hai call thay suffix; so metadata đầu/cuối prompt. Đây là phép đo request, khác E2E ở E3. |
| **Cách tính** | `Cache_weighted = Σcached_input / Σtotal_input`; báo thêm median tỷ lệ từng trial và TTFT prime/warm. |
| **Mục tiêu OT** | ≥80% ở warm calls của fixture; không kém đối chứng cùng fixture. Ghi cả token/cost của prime. |
| **Điều kiện riêng** | Cùng model, cache mode/TTL, output ngắn; log serialized-prefix hash. Call đầu là **first-observed**, chưa chắc cold. Thiếu cache usage thì N/A. |

Chuẩn hóa: OpenAI Responses dùng tổng `input_tokens`, cache là `input_tokens_details.cached_tokens`; Claude Messages tổng input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. SDK đã chuẩn hóa tổng thì không cộng lần hai. [OpenAI][ocache], [Claude][acache]

### E3. Latency và thời gian ra kết quả hữu ích

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Startup, TTFT, E2E và tỷ lệ trả lời **đúng** trước deadline. |
| **Đối trọng có số** | FrontierHarness latency p50 trên task đạt: OpenCode **387,3 s**, DSH Creator **403,9 s**, Hermes **417,8 s**. Không dùng các số coding này làm ngưỡng trực tiếp. |
| **Bài kiểm tra** | Sáu task có gold: lookup đơn, ba tools phụ thuộc, ba tools độc lập. Server delay 0/250 ms; ba repetitions; hai harness → **72 trial**. |
| **Cách tính** | `TTFT = text đầu − thời điểm gửi`; `T_end = kết thúc − bắt đầu`; `SuccessBy(D) = lượt đúng trước D / mọi lượt bắt đầu`. |
| **Mục tiêu OT** | p50 E2E ≤0,8×đối chứng; CI tỷ số phải <1 để kết luận nhanh hơn. Báo SuccessBy(60/120/300 s); chất lượng không thua quá 2 điểm theo CI đã đăng ký. |
| **Điều kiện riêng** | Cùng output limit, tool delays, máy và budget; chạy luân phiên. Báo toàn bộ lượt và successful-only riêng; timeout không biến thành hoàn thành nhanh. |

Dùng monotonic clock. Với subagent song song, không lấy wall time trừ tổng mọi model/tool time vì các span có thể chồng nhau.

### E4. Công cụ và cache dữ liệu

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Dispatch/RPC overhead, giảm backend calls và tránh trả dữ liệu cũ. |
| **Đối trọng có số** | TraceLab Codex tool residual p50/p90 **130/240 ms**; khác môi trường local nên không so trực tiếp. Chưa có stale-rate chung để dùng thay phép đo mới. |
| **Bài kiểm tra** | Lookup trả 32 byte/64 KiB; 100 calls/kích thước/harness. Thêm đổi ticker, kỳ, as-of, revision, TTL và tám caller cùng key. |
| **Cách tính** | `Residual = T_tool_E2E − T_execution`; `StaleRate = phản hồi cache cũ / phản hồi`; ghi hit/miss và backend counter. |
| **Mục tiêu OT** | Local-mock residual p95≤100 ms; stale=0%. Nếu triển khai single-flight: tám caller cùng key chỉ tạo một computation. |
| **Điều kiện riêng** | Cùng MCP, payload, quyền; fake clock kiểm tra TTL. Ghi cache owner; không có feature thì N/A. Sai as-of/kỳ không được tính là valid hit. |

### E5. Hiệu quả token, request, RAM và CPU

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Tài nguyên cần để tạo một kết quả đúng, gồm cả thất bại và subagent. |
| **Đối trọng có số** | Nghiên cứu nhỏ cùng GPT-5.6 Luna: input/task Codex **505,4k**, Pi **525,4k**, OpenCode stable **1.797,1k**; mỗi hệ thống đạt 3/3. |
| **Bài kiểm tra** | Thu trực tiếp từ E1/E3; thêm OpenTrading tắt delegation để xem chất lượng tăng có đáng lượng call thêm không. |
| **Cách tính** | `Input/success = tổng input mọi lượt / số lượt đạt`; tương tự requests/success. Peak RAM/CPU tính toàn process tree. |
| **Mục tiêu OT** | Input/success≤0,8×đối chứng, chất lượng không thua quá 2 điểm theo CI. Báo peak RAM/CPU, chưa đặt ngưỡng khi chưa có pilot. |
| **Điều kiện riêng** | Đếm leaf provider attempts một lần; gồm retries/children. Thiếu usage ghi coverage/unknown; không ghi 0. Không có success thì ratio không xác định. |

### E6. Giữ dữ kiện qua context và compaction

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Có giữ đúng đơn vị, kỳ, cutoff và thông tin người dùng đã sửa không? |
| **Đối trọng có số** | Chưa thu được điểm retention cùng protocol của OpenCode/DSH/Hermes; **cần đo mới**, không dùng tỷ lệ cache thay thế. |
| **Bài kiểm tra** | Task nhiều lượt: đặt facts bắt buộc → thêm tài liệu gây nhiễu → sửa một fact → hỏi lại. Tái dùng tập nhiều lượt của E1. |
| **Cách tính** | `Retention = facts cuối được dùng đúng / facts bắt buộc`; đếm riêng dùng thông tin cũ và lỗi đơn vị/cutoff. |
| **Mục tiêu OT** | 100% facts bắt buộc trong fixture; không dùng bản cũ sau khi người dùng sửa. |
| **Điều kiện riêng** | Cùng tài liệu/lượt hỏi/context budget. Ghi event compaction; chưa kích hoạt thì chưa kết luận về compaction. Mỗi repetition dùng session mới. |

### E7. Retry, quota, ngắt và khôi phục

| Nội dung | Thiết kế |
|---|---|
| **Đo gì?** | Kết thúc đúng, tiếp tục đúng phần việc và không tiêu request vô hạn. |
| **Đối trọng có số** | Chưa có recovery score thống nhất trong nguồn thu thập; chạy mới OpenCode/DSH/Hermes nếu hỗ trợ injection/resume. |
| **Bài kiểm tra** | Sáu lịch mock: thành công; 429 rồi thành công; hai lỗi tạm; hết quota ngày; tool timeout; kill trước checkpoint. 5 lần/lịch/harness. |
| **Cách tính** | `Conformance = lịch xử lý đúng / lịch đã chạy`; log recovery time, duplicate calls, attempts và budget overshoot. |
| **Mục tiêu OT** | 100% lịch mock đạt; không vượt cap; không lặp phần đã checkpoint. Đây là conformance, không phải accuracy tài chính. |
| **Điều kiện riêng** | Cùng lịch lỗi, retry policy và checkpoint boundary. Không hỗ trợ resume ghi rõ; mock attempts không cộng vào mẫu số E1. |

## 5. Điều kiện chung và cách triển khai gọn

### Quy tắc bắt buộc

| Giữ chung | Quy định |
|---|---|
| **Model** | Cùng provider/endpoint, model version, effort/sampling; kiểm tra cả main, web và subagent. Không làm được thì gọi là so sánh sản phẩm. |
| **Dữ liệu/tools** | Cùng MCP snapshot, schema và cutoff; chặn truy xuất dữ liệu sống ngoài thiết kế. |
| **Skill** | Đo hai chế độ: cấu hình mặc định và cùng gói hướng dẫn tài chính. Tắt skill/delegation riêng để giải thích lợi ích. |
| **Trạng thái** | Session/home sạch từng trial; chỉ giữ history bên trong task nhiều lượt; luân phiên thứ tự harness. |
| **Budget** | Cùng time/request/token cap; tính cả retry và children; hiệu chuẩn bằng pilot rồi khóa. |
| **Chấm** | Gold giữ ngoài workspace; chấm mù phần mở; lỗi/timeout sau started vẫn tính trượt. Pending chưa started ghi riêng. |
| **Log** | Task/config/model IDs, timestamps, tool spans, final answer, lỗi, raw usage và usage coverage; lưu sau mỗi trial. |
| **Thống kê** | Ghép cặp cùng task; bootstrap theo task/nhóm cùng nguồn, giữ repetition trong nhóm. Báo CI 95%; không coi ba lần lặp là ba task độc lập. |

**Quy mô ưu tiên theo quota miễn phí:**

| Bước | Quy mô |
|---|---|
| Pilot chất lượng | 24 task × 2 harness × 2 lần = **96 trial** |
| Test chính | 60 task giữ kín × 2 harness × 3 lần = **360 trial** |
| Cache pilot | 4 prefix blocks × 3 calls × 2 harness = **24 target model calls**; call phụ ghi riêng |
| Mở rộng | DSH/Hermes trên 12 task định trước; E3 và stress tests chỉ chạy khi đủ quota |

Tổng chất lượng là **456 trial**, không phải 456 model requests. Tập 60 task chỉ là nghiên cứu đầu tiên; CI có thể rộng. Không thêm mẫu sau khi xem test chỉ để đạt kết luận thuận lợi.

### Bảng kết quả cuối cùng

| Harness | E1 success / CI | Cache warm / coverage | E2E p50/p90 | Input/success | Stale | Retention | Recovery |
|---|---|---|---|---|---|---|---|
| OpenTrading | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo |
| OpenCode | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo |
| DSH, ghi profile | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo |
| Hermes | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo | chưa đo |

**Cách kết luận:** “Trên bộ tài chính X, cùng model/tools/budget, OpenTrading tăng success Δ điểm, CI […], latency thay đổi …, tài nguyên thay đổi …”. Không suy sang mọi lĩnh vực. Số công bố ở mục 1 và số đo tại chỗ phải nằm ở hai bảng riêng.

[fh]: https://raw.githubusercontent.com/frontier-harness-eval/eval/e837a70bd6beb4e72eeeda62dd06e3bd34f6cb63/results/eval-data.json
[fv]: https://github.com/frontier-harness-eval/eval/blob/e837a70bd6beb4e72eeeda62dd06e3bd34f6cb63/metadata/harness-versions.json
[small]: https://github.com/d1-m4ss/harness-benchmark/blob/main/RESULTS.md
[trace]: https://arxiv.org/html/2606.30560v2
[cursor]: https://cursor.com/cursorbench
[vals]: https://www.vals.ai/benchmarks/fabv2-1
[fin]: https://arxiv.org/html/2610.03564v1
[ocache]: https://developers.openai.com/api/docs/guides/prompt-caching
[acache]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[codex]: https://learn.chatgpt.com/docs/codex/cli

## 6. Đánh giá sơ bộ trước eval — 27/10/2026

*Rà soát mã/tài liệu; OpenTrading main `c278e50`. **+** lợi thế thiết kế, **−** khoảng thiếu, **?** chưa đo; chưa phải kết quả thắng/thua thực nghiệm.*

| Phần | [OpenTrading hiện tại][ot-now] | [OpenCode][oc-now] | [DeepSeek Harness][dsh-now] | [Cline][cline-now] | [Hermes][hermes-now] | Kỳ vọng trong eval |
|---|---|---|---|---|---|---|
| **Tài chính Việt Nam** | **+** Skill, dữ liệu MCP, 4 playbook chuyên ngành | Tổng quát; cần cấu hình tài chính | Tổng quát; tùy plugin/profile | Coding; cần skill/MCP tài chính | Tổng quát; cần skill/MCP tài chính | **E1:** OT có lợi thế sẵn dùng; chia sẻ cùng skill/tools để kiểm tra lợi thế còn lại. |
| **Điều phối nghiên cứu** | **+** Playbook sàng lọc/kiểm chứng/tranh biện/ngành; agent con dùng MCP | Subagent tổng quát | Profiles/plugin; tùy cấu hình | Có subagent nhưng [agent con không nhận MCP][cline-sub] | Có delegation | **E1/E5:** OT có thể tốt hơn trên bài nhiều nguồn, nhưng tăng request/token. |
| **Memory liên phiên** | **− Chưa triển khai memory mới**; [PR #159][ot-memory-plan] chỉ thêm tài liệu thiết kế | Rules lưu file/lịch sử; không đồng nhất memory tự động | Có overlay memory MCP tùy chọn, không mặc định | [Memory Bank][cline-memory] qua Markdown và hướng dẫn | [Persistent memory][hermes-memory] tích hợp | OT bất lợi rõ so Hermes, so workflow Memory Bank của Cline; **E6 chỉ đo context trong phiên**, không coi là test memory liên phiên. |
| **Context/compaction** | Có lưu phiên và nén; không tính là memory | Có compaction | Có compaction/pruning | Có quản lý context/`smol` | Có compression | **E6:** có tính năng tương ứng, chưa biết retention hơn/thua; kiểm tra kỳ/đơn vị/cutoff sau nén. |
| **Mở rộng/tích hợp** | **−** Tập trung TUI tài chính; có MCP/skills | Plugins, CLI/Web/IDE | Kiến trúc plugin/profile/SDK | IDE và CLI | Plugins, tools, gateway | OT hẹp hơn về bề mặt tích hợp; **E1** tập trung nghiệp vụ tài chính, không chấm bằng số tính năng. |
| **Đo đạc/headless** | **−** Events cơ bản; [chưa có raw cache read/write trong AgentEvent][ot-events] | JSON events | SDK JSON-RPC/headless | Headless/JSON | Session logs/tools | **E2/E5:** phải bổ sung telemetry OT và xác minh coverage từng đối chứng trước khi so. |
| **Cache/latency/tài nguyên** | **?** Có thiết kế tiết kiệm quota; chưa có số đo đối chứng | Có số công bố ở mục 1 | Có số theo profile ở mục 1 | Chưa có mốc matched trong nguồn thu thập | Có số công bố ở mục 1 | **E2–E5:** chưa kỳ vọng OT thắng mọi mặt; kiểm tra lợi ích chất lượng có bù chi phí multi-agent không. |
| **Lỗi/quota/khôi phục** | Có trần, retry, journal và desk resume | Lưu/nối phiên | Persisted sessions; tùy profile | Task/checkpoints | Session/resume | **E7:** OT có thiết kế phù hợp quota miễn phí; chưa chứng minh bền hơn. Mock chung để so, không đánh đồng các kiểu resume. |

[ot-now]: https://github.com/FinDaHuman/OpenTrading/blob/c278e50e9a2536417b5d9faa79ec129c3163c4d1/README.md
[ot-events]: https://github.com/FinDaHuman/OpenTrading/blob/c278e50e9a2536417b5d9faa79ec129c3163c4d1/src/core/events.ts
[ot-memory-plan]: https://github.com/FinDaHuman/OpenTrading/pull/159
[oc-now]: https://opencode.ai/docs/agents/
[dsh-now]: https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md
[cline-now]: https://docs.cline.bot/usage/cli-overview
[cline-sub]: https://docs.cline.bot/features/subagents
[cline-memory]: https://docs.cline.bot/best-practices/memory-bank
[hermes-now]: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools
[hermes-memory]: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
