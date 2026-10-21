# Ultradesk

Ultradesk điều phối nhiều subagent nghiên cứu theo một **playbook**: code của playbook giữ vòng lặp, rẽ nhánh và kết quả trung gian, còn agent chính chỉ nhận kết quả cuối. Ý tưởng lấy từ dynamic workflows / ultracode của Claude Code, chỉnh lại cho OpenTrading:

- Gói miễn phí tính quota theo **request mỗi ngày**, nên mặc định nhỏ và có trần theo request.
- Server MCP chạy gói free (0,1 CPU), nên mỗi run có cap đồng thời riêng.
- Kết luận ở dạng kịch bản, không đưa khuyến nghị Mua/Bán.

Trạng thái: engine (PR3), giao diện (PR4) và 2 playbook `sang-loc`, `kiem-chung` (PR5) đã có; `tranh-bien` và `nganh` đến ở PR6.

## Playbook có sẵn

Cột là số agent / số request tối đa (tổng `maxSteps`; thực tế thường khoảng 60%). Bậc `unrestricted` = `large`. Trường hợp xấu nhất, agent nào trả kết quả sai schema cần thêm lượt nhắc: tối đa +4 request mỗi agent (`sang-loc` large: ~456 thay vì 276).

| Playbook | Cách chạy | small | medium | large |
| --- | --- | --- | --- | --- |
| `sang-loc {tickers, tieu_chi?}` | Mỗi mã một thẻ điểm cơ bản (agent `co-ban`, 6 bước, effort low, schema: P/E, P/B, ROE, tăng trưởng LNST, biên gộp, nợ vay/vốn chủ, OCF/LNST, điểm 0–10 bốn chiều) chạy theo pipeline → code xếp hạng (≤ 10 mã: điểm thẻ có trọng số theo `tieu_chi`; > 10 mã: trộn thêm z-score các chỉ số) → các mã dẫn đầu bị `phan-bien` bác bỏ (effort high, mỗi phiếu một góc nhìn; đa số bác bỏ thì gắn cờ và trừ điểm) → `tong-hop` viết bảng xếp hạng, nhóm dẫn đầu/cuối, kịch bản tích cực/cơ sở/tiêu cực (không khuyến nghị Mua/Bán). Bảng điểm do code tính luôn đi kèm để đối chiếu | 5 mã, không phản biện: **6 / 36** | 10 mã, top 3 × 1 phiếu: 14 / 84 | 30 mã, top 5 × 3 phiếu: 46 / 276 |
| `kiem-chung {noi_dung, boi_canh?}` | Một agent trích các khẳng định định lượng (2 bước, không cần tool) → xếp theo mức quan trọng → mỗi khẳng định được 1 hoặc 3 phiếu `tra-cuu` (4 bước) đối chiếu dữ liệu, mỗi phiếu một góc nhìn: số liệu gốc / kỳ và đơn vị / bối cảnh → đa số quyết định ✓ đúng / ✘ sai; không đủ phiếu hợp lệ là ? chưa kiểm chứng (lỗi hay hết quota không bao giờ thành "sai"). Báo cáo do code dựng, không tốn thêm agent | 5 khẳng định × 1 phiếu: **6 / 22** | 10 × 3: 31 / 122 | 20 × 3: 61 / 242 |

- Danh sách vượt bậc (mã, khẳng định) bị cắt kèm một dòng log nói rõ bỏ những gì.
- Lệnh tắt: `/sang-loc FPT MWG HPG VNM` hoặc `/kiem-chung <dán văn bản>` (văn bản nhiều dòng được giữ nguyên). Với `kiem-chung`, model phải chép văn bản vào lời gọi tool: văn bản rất dài tốn token đầu ra, và model lite có thể chép không nguyên văn.
- `desk_run` chỉ hiện với model khi yêu cầu đã opt-in (keyword, `/desk on`, lệnh playbook): nó không nằm trong danh sách tool hoãn hay kết quả `tool_search`, nên không chen chỗ các tool dữ liệu khi tìm tool.

## Dùng thế nào

| Cách | Ý nghĩa |
| --- | --- |
| Gõ `ultradesk` trong câu hỏi | Yêu cầu đó được chạy playbook (giống `ultracode` của Claude Code). Chữ được tô màu trong ô nhập và dòng chế độ ghi "ultradesk: yêu cầu này được chạy playbook". Chỉ tính chữ bạn gõ, không tính text dán, nội dung @file, prompt MCP hay thông báo của harness. Tắt bằng `"desk": { "keyword": false }` |
| `/desk on` / `/desk off` | Bật/tắt cho cả phiên: yêu cầu nghiên cứu lớn có thể chạy playbook. Dòng chế độ hiện `desk ●`. `"desk": { "alwaysOn": true }` để phiên mới tự bật |
| `/<playbook> <yêu cầu>` | Nhờ model chạy đúng playbook đó cho yêu cầu (vd. `/sang-loc FPT MWG HPG`) |
| `/desk` | Danh sách run → các phase (đếm xong/tổng) → agent của phase → chi tiết. `p` tạm dừng/chạy tiếp, `x` hai lần (hoặc `ctrl+x`) dừng, `r` chạy tiếp run bị cắt |
| `/desk resume <run>` | Chạy tiếp run bị cắt (hết quota, chạm trần, bị dừng), kể cả sau khi mở lại phiên |

**Thẻ duyệt** hiện trước khi chạy: mô tả, các phase, `◂ quy mô ▸` và `◂ effort ▸` (←→ để đổi, số agent/request cập nhật theo), cảnh báo △ khi vượt `warnRequests`/`maxRequests`. Lựa chọn: Chạy / Chạy, không hỏi lại `<playbook>` / Xem tham số / Không.
- **Không có opt-in** (chỉ xảy ra khi lịch sử hội thoại đã từng gọi `desk_run`, nên tool còn được khai báo): thẻ **luôn** hiện, kể cả ở ▸▸ tự động và với playbook đã "không hỏi lại".
- **Có opt-in** (keyword, `/desk on`, `/<playbook>`): playbook đã "không hỏi lại" thì chạy luôn; lần đầu thì hiện thẻ. Ở ▸▸ tự động, "Chạy" lần đầu tự ghi nhớ playbook (`desk.approved`).

**Khi đang chạy**: agent panel có **một dòng cho cả run** (`ultradesk  sang-loc · Thu thập 3/5 · 21 req`), không liệt kê từng agent; enter mở `/desk`, `x` hai lần dừng run. `/tasks` không hiện agent của desk. Khi xong, transcript có một dòng và agent chính nhận **một** `<thong_bao_desk>`.

## Playbook

Một playbook gồm `meta` và một hàm `run(ctx)` (`src/core/desk/types.ts`):

| `meta` | Ý nghĩa |
| --- | --- |
| `name`, `version` | Đổi prompt hay luồng chạy thì tăng `version`: resume không bao giờ dùng lại kết quả của phiên bản khác |
| `description`, `whenToUse` | Cho agent chính chọn playbook |
| `args` | zod schema của tham số; sai thì từ chối trước khi chạy |
| `agentTypes` | Các loại agent playbook được dùng; gọi loại khác là lỗi |
| `phases` | Tên các phase theo thứ tự, cho màn hình tiến độ |
| `estimate(args, size)` | Số agent và số request dự kiến (tổng `maxSteps`), cho thẻ duyệt |

### `ctx`

| Hàm | Việc làm |
| --- | --- |
| `agent(prompt, opts)` | Một subagent. Có `schema` thì trả object (qua `tra_ket_qua`), không thì trả văn bản báo cáo. Lỗi, bị dừng hoặc chạm trần thì **throw** |
| `parallel(thunks)` | Chạy song song, chờ tất cả (barrier). Việc nào throw thì thành `null` |
| `pipeline(items, ...stages)` | Từng mục đi qua các stage, **không có barrier**: mục A có thể ở stage 3 khi mục B còn ở stage 1. Stage throw thì mục đó thành `null` và bỏ các stage sau. Mỗi stage nhận `(kết quả trước, mục gốc, chỉ số)` |
| `phase(title)`, `log(message)` | Nhóm agent và ghi dòng tiến độ |
| `args`, `size` | Tham số đã kiểm; quy mô của run |
| `budget` | `maxAgents`, `maxRequests`, `agents()`, `requests()` |
| `playbook(name, args)` | Chạy playbook khác ngay trong run (chỉ 1 cấp), dùng chung trần và journal |
| `stopping()` | Run đang bị cắt (hết quota, chạm trần, bị dừng): vòng lặp dài nên dừng sớm |

`opts` của `agent()`: `label`, `phase`, `type` (mặc định `tra-cuu`), `schema`, `effort`, `model`, `maxSteps`.

Agent của desk:
- **Chỉ có tool đọc**, dù loại agent cho phép nhiều hơn. Playbook không nới được quyền người dùng đã cho (ADR 0005).
- Chạy foreground trong run, có tag `deskRunId`, và dùng chung gate duyệt với phiên.
- Có `schema` thì gửi tối đa `maxSteps + 4` request (xem [subagents.md](subagents.md)).

## Cài đặt (`config.json` → `"desk"`)

| Key | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `size` | `small` | `small` / `medium` / `large` / `unrestricted`. Playbook có kiểu tự chọn bậc riêng theo giá trị này |
| `maxAgents` | 100 | **Trần cứng** số agent mỗi run. Chạm trần thì các agent còn lại không chạy, run thành `partial` |
| `maxConcurrent` | 3 | Số agent của một run chạy cùng lúc. Nằm trong `subagents.maxConcurrent` chung, và ≤ 4 slot MCP để server free không sập |
| `maxRequests` | không đặt | **Trần cứng** số request model mỗi run. Kiểm khi agent sắp bắt đầu: các agent đang chạy được làm nốt, nên có thể vượt thêm khoảng `maxConcurrent × (maxSteps + 4)` |
| `warnRequests` | 150 | Thẻ duyệt cảnh báo khi số request dự kiến vượt mức này |
| `effort`, `provider` + `model` | như subagent | Effort và model cho agent của desk; từng `agent()` có thể đặt riêng |
| `staggerMs` | 3000 | Agent cùng tiền tố prompt (cùng loại, schema, effort, model) chờ agent đầu có kết quả, tối đa chừng này ms, để đọc chung cache prompt. `0` = tắt |
| `keyword`, `alwaysOn` | `true`, `false` | Dùng ở PR giao diện |

## Hết quota, dừng, chạy tiếp

- Một agent hết **quota ngày** → run bị cắt (`cut: "quota"`): không agent mới nào chạy, agent đang chạy được làm nốt, kết quả là `partial`.
- Một agent bị **giới hạn tốc độ** (429 theo phút) sau khi đã hết lượt thử lại của request → run giảm còn 1 agent mỗi lúc và chạy lại agent đó một lần. Lần 429 thứ hai → run bị cắt (`cut: "rate"`), chạy tiếp sau bằng `/desk resume`.
- Lỗi trong chính code của playbook (không phải agent lỗi) được ghi vào log của run, không bị nuốt thành `null` một cách im lặng.
- Agent không chạy được được ghi là **chưa kiểm chứng**, không phải "sai" (bài học từ deep-research của Claude Code).
- Mỗi run ghi `sessions/…/<phiên>/desk/<run>/journal.jsonl` (mỗi agent đã trả lời một dòng) và `meta.json`.
- `/desk resume <run>` (kể cả sau khi tắt mở lại TUI) chạy lại playbook. Agent nào đã có trong journal thì lấy lại kết quả, không tốn request.
- Khoá của mỗi lời gọi là hash của (phiên bản playbook, prompt, loại, schema, và effort/model/maxSteps **do playbook đặt**) cộng số lần xuất hiện của lời gọi giống hệt. Đổi `desk.model` hay `desk.effort` (ví dụ chuyển model khi hết quota) không làm mất kết quả đã có; các agent còn lại chạy bằng cài đặt mới.
  - Không khớp theo thứ tự khởi động như Claude Code, vì pipeline chạy đồng thời làm thứ tự đó thay đổi theo agent nào xong trước.
  - Kết quả phía trước đổi thì prompt phía sau (có trích kết quả đó) cũng đổi, nên các agent phía sau tự chạy lại.
- Mỗi run gửi **một** thông báo `<thong_bao_desk>` cho agent chính, không có thông báo riêng cho từng agent. Kết quả trong thông báo được cắt ở 20.000 ký tự.

## Viết playbook an toàn

- Text từ web, MCP hoặc agent khác đưa sang prompt của agent sau phải đi qua `evidence(text, nguồn)` (`src/core/desk/sanitize.ts`). Hàm này bỏ ký tự điều khiển/ẩn, đóng khung `<bang_chung>` và kèm `EVIDENCE_NOTE`.
- Không dùng thời gian hay số ngẫu nhiên để rẽ nhánh: resume cần cùng một chuỗi lời gọi `agent()`. Có test chạy mỗi playbook 2 lần để so.
