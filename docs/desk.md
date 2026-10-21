# Ultradesk

Ultradesk điều phối nhiều subagent nghiên cứu theo một **playbook**: code của playbook giữ vòng lặp, rẽ nhánh và kết quả trung gian, còn agent chính chỉ nhận kết quả cuối. Ý tưởng lấy từ dynamic workflows / ultracode của Claude Code, chỉnh lại cho OpenTrading:

- Gói miễn phí tính quota theo **request mỗi ngày**, nên mặc định nhỏ và có trần theo request.
- Server MCP chạy gói free (0,1 CPU), nên mỗi run có cap đồng thời riêng.
- Kết luận ở dạng kịch bản, không đưa khuyến nghị Mua/Bán.

Trạng thái: chặng 1 xong — engine, giao diện, 4 playbook và bộ đo đạc. Theo [ADR 0006](../handbook/architecture/adr/0006-measured-multi-agent-playbooks.md) (đang ở trạng thái *proposed*), ultradesk chỉ chạy khi bạn bật; chặng 2 (model tự viết playbook, chạy trong sandbox) chỉ làm khi đo đạc cho thấy desk tốt hơn rõ.

## Playbook có sẵn

Cột là số agent / số request tối đa (tổng `maxSteps`; thực tế thường khoảng 60%). Bậc `unrestricted` = `large`. Trường hợp xấu nhất, agent nào trả kết quả sai schema cần thêm lượt nhắc: tối đa +4 request mỗi agent (`sang-loc` large: ~456 thay vì 276).

| Playbook | Cách chạy | small | medium | large |
| --- | --- | --- | --- | --- |
| `sang-loc {tickers, tieu_chi?}` | Mỗi mã một thẻ điểm cơ bản (agent `co-ban`, 6 bước, effort low, schema: P/E, P/B, ROE, tăng trưởng LNST, biên gộp, nợ vay/vốn chủ, OCF/LNST, điểm 0–10 bốn chiều) chạy theo pipeline → code xếp hạng (≤ 10 mã: điểm thẻ có trọng số theo `tieu_chi`; > 10 mã: trộn thêm z-score các chỉ số) → các mã dẫn đầu bị `phan-bien` bác bỏ (effort high, mỗi phiếu một góc nhìn; đa số bác bỏ thì gắn cờ và trừ điểm) → `tong-hop` viết bảng xếp hạng, nhóm dẫn đầu/cuối, kịch bản tích cực/cơ sở/tiêu cực (không khuyến nghị Mua/Bán). Bảng điểm do code tính luôn đi kèm để đối chiếu | 5 mã, không phản biện: **6 / 36** | 10 mã, top 3 × 1 phiếu: 14 / 84 | 30 mã, top 5 × 3 phiếu: 46 / 276 |
| `kiem-chung {noi_dung, boi_canh?}` | Một agent trích các khẳng định định lượng (2 bước, không cần tool) → xếp theo mức quan trọng → mỗi khẳng định được 1 hoặc 3 phiếu `tra-cuu` (4 bước) đối chiếu dữ liệu, mỗi phiếu một góc nhìn: số liệu gốc / kỳ và đơn vị / bối cảnh → đa số quyết định ✓ đúng / ✘ sai; không đủ phiếu hợp lệ là ? chưa kiểm chứng (lỗi hay hết quota không bao giờ thành "sai"). Báo cáo do code dựng, không tốn thêm agent | 5 khẳng định × 1 phiếu: **6 / 22** | 10 × 3: 31 / 122 | 20 × 3: 61 / 242 |
| `tranh-bien {ticker, cau_hoi?}` | Các analyst báo cáo song song (`co-ban`, `dinh-gia`, `tin-tuc`; thêm `ky-thuat`, `vi-mo` từ medium) → `bull` ∥ `bear` mở màn (4 bước) → 0/1/2 vòng phản bác, mỗi phe nhận lập luận gần nhất của phe kia làm bằng chứng → ở large, số liệu của hai phe qua `kiem-chung` **bậc small** ngay trong run → trọng tài `tong-hop`: kịch bản chính và mức tin cậy, ba kịch bản kèm điều kiện kích hoạt, luận điểm còn đứng vững (không khuyến nghị Mua/Bán/Giữ) | 3 analyst, không phản bác: **6 / 30** | 5 analyst, 1 vòng: 10 / 50 | 5 analyst (8 bước), 2 vòng, có kiểm chứng: 18 / 92 |
| `nganh {nganh, tickers?, cau_hoi?}` | `nganh` xác định phạm vi (doanh nghiệp đầu ngành, động lực; giữ đúng mã người dùng đưa) và nạp skill ngành của #116 **một lần** để chọn 2–4 chỉ tiêu riêng của ngành (skill ngành nặng 3–4k token, không nạp lại ở từng doanh nghiệp; có skill cho ngân hàng, thép, BĐS, chứng khoán, bảo hiểm, dầu khí, điện, hóa chất, bán lẻ, vận tải, công nghệ, xuất nhập khẩu, Vingroup) → **song song** các chủ đề (`chu-ky-nganh`, `vi-mo`, thêm `tai-san-toan-cau` từ medium) và thẻ điểm từng doanh nghiệp có lấy thêm các chỉ tiêu ngành đó → từ medium: `phan-bien` chỉ ra chỗ còn thiếu, một vòng `tra-cuu` bổ sung → `tong-hop` viết báo cáo ngành, bảng doanh nghiệp, kịch bản | 3 DN, 2 chủ đề: **7 / 40** | 6 DN, 3 chủ đề, phê bình + 2 bổ sung: 14 / 79 | 12 DN (8 bước), 4 bổ sung: 22 / 157 |

- Danh sách vượt bậc (mã, khẳng định) bị cắt kèm một dòng log nói rõ bỏ những gì.
- `tin-tuc` (trong `tranh-bien`) dùng `web_search`/`web_fetch`: các lời gọi model phụ bên trong tool không được tính vào `requests`/`maxRequests`, và `web_fetch` hỏi duyệt từng domain ở chế độ mặc định, nên run có thể chờ bạn duyệt giữa chừng.
- Lệnh tắt: `/sang-loc FPT MWG HPG VNM`, `/kiem-chung <dán văn bản>`, `/tranh-bien FPT có nên giữ qua quý 3`, `/nganh thép` (văn bản nhiều dòng được giữ nguyên). Với `kiem-chung`, model phải chép văn bản vào lời gọi tool: văn bản rất dài tốn token đầu ra, và model lite có thể chép không nguyên văn.
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

## Đo đạc: desk có đáng không

`scripts/dev/desk-eval.ts` trả lời 20 câu hỏi thật (`test/fixtures/desk-eval/cases.json`, 5 câu mỗi playbook) bằng hai cách. **Mặc định**: agent chính trả lời câu hỏi như người dùng gõ, với mọi tool, kể cả subagent do skill gọi (request của chúng được tính). **Desk**: playbook tương ứng chạy cùng yêu cầu. Trước khi chấm, câu trả lời của cả hai nhánh đều được xoá những chi tiết làm lộ desk (tiêu đề bảng "tính bằng code", ghi chú `/desk resume`…). Câu nào có nhánh lỗi hoặc bị cắt thì không chấm. Một model chấm (LLM-judge) chấm cả hai câu trả lời **mù**: không biết câu nào của desk, vị trí A/B đổi theo từng câu. Có 4 tiêu chí, mỗi tiêu chí 0–1: chính xác, trích dẫn, đầy đủ, có cơ sở dữ liệu. Cách làm theo bài "How we built our multi-agent research system" của Anthropic.

```
bun scripts/dev/desk-eval.ts --playbook sang-loc            # chỉ in ước tính
bun scripts/dev/desk-eval.ts --playbook sang-loc --yes      # chạy thật, tốn quota của bạn
bun scripts/dev/desk-eval.ts --only 1,6,11,16 --judge google/gemini-3.1-pro --yes
```

- **Không có `--yes` thì không gọi model nào**: script chỉ in số ca và số request dự kiến.
- Cả bộ ở quy mô small tốn hơn 500 request. Hãy chạy từng playbook, mỗi ngày một phần.
- Duyệt quyền khi không có người: các lời hỏi chỉ đọc (domain của `web_fetch`) được cho phép một lần, mọi thứ khác bị từ chối, để run không bị treo.
- Model chấm nên mạnh hơn model trả lời (`--judge`). Kết quả JSON ghi ở `~/.opentrading/exports/desk-eval-<thời điểm>.json`.
- Model chấm không có tool: các câu `kiem-chung` có `tham_chieu` (số liệu đúng kèm nguồn, người dùng điền ngày 22/10/2026) để chấm tiêu chí "chính xác"; test sẽ đỏ nếu một câu `kiem-chung` thiếu tham chiếu. P/E của FPT và P/B của VCB được ghim ở ngày 21/10/2026 theo nguồn tham chiếu.
- **Ngưỡng của ADR 0006**: điểm trung bình của desk cao hơn đường mặc định ít nhất 0,10 **và** desk thắng ít nhất 60% số câu được chấm. Script in kết luận theo từng playbook kèm số request của mỗi nhánh. Điểm của LLM chỉ là thước đo gần đúng: trước khi chuyển ADR sang *accepted*, cần đọc tay vài câu mỗi playbook.

## Viết playbook an toàn

- Text từ web, MCP hoặc agent khác đưa sang prompt của agent sau phải đi qua `evidence(text, nguồn)` (`src/core/desk/sanitize.ts`). Hàm này bỏ ký tự điều khiển/ẩn, đóng khung `<bang_chung>` và kèm `EVIDENCE_NOTE`.
- Không dùng thời gian hay số ngẫu nhiên để rẽ nhánh: resume cần cùng một chuỗi lời gọi `agent()`. Có test chạy mỗi playbook 2 lần để so.
