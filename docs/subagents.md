# Subagent

Subagent là một agent riêng, bắt đầu với ngữ cảnh trống. Agent chính giao cho nó một việc qua tool `spawn_subagent`; nó tự gọi tool nhiều bước rồi trả về một bản báo cáo. Thiết kế theo Agent tool của Claude Code, có tham khảo opencode và Codex. PR #32–#34.

## Dùng thế nào

- **Agent chính tự quyết định khi nào giao việc**: việc nhiều bước, hoặc nhiều việc độc lập chạy song song (ví dụ định giá 3 mã, mỗi mã một subagent). Bạn cũng có thể yêu cầu trực tiếp, ví dụ "dùng subagent tra-cuu lấy giá FPT".
- **Giao diện**:
  - Các subagent spawn trong cùng một bước hiện thành một khối `● Chạy N subagent…` với cây `├─ └─`. Mỗi dòng có tool đang chạy, số tool, token, hoặc "đang chờ slot (r/max)".
  - Xong thì hiện `Xong (N tool · Xk token · Ns)`.
  - **ctrl+o** mở yêu cầu, các tool con đã gọi (kèm quyết định duyệt) và kết quả.
- **Kết quả chỉ agent chính thấy.** Agent chính đọc rồi trình bày lại cho bạn, giữ nguồn.
- **Tool ghi** (watchlist, tool MCP không chỉ đọc):
  - Subagent dùng được, nhưng hộp duyệt hiện ở giao diện chính với tiêu đề `· subagent <loại> (<mô tả>)`.
  - Hộp duyệt của subagent **chỉ nhận Enter**: không chọn nhanh bằng phím 1–4, và bỏ qua Enter trong 400ms đầu để phím đang gõ dở không vô tình duyệt.
- **Không lồng nhau.** Subagent không bao giờ có `spawn_subagent`, `send_message`, `stop_agent`, `ask_user`, `todo_write` hay tool memory.
- **Chạy nền** (`run_in_background`):
  - Tool trả về ngay, bạn tiếp tục chat; thanh trạng thái hiện `⧗ N subagent nền`. Esc trên câu trả lời chính không dừng agent nền.
  - Khi xong, transcript có dòng `◆ Subagent nền … · xong`, và kết quả được gửi cho agent chính trong tin `<thong_bao_subagent>`.
  - Nếu đang rảnh, kết quả được gửi thành một lượt riêng; nếu bạn gửi tin trước, kết quả được ghép vào trước tin của bạn. Sau một lượt bị lỗi thì kết quả được giữ lại tới khi bạn gửi tin.
- **`send_message`**: giao thêm việc cho một agent đã có, theo `agent_id`. Agent đang chạy nhận tin sau lượt hiện tại; agent đã xong chạy tiếp ở chế độ nền với hội thoại cũ.
- **`stop_agent`**: dừng một agent.
- **`/tasks`**: subagent của phiên, gồm cả của phiên cũ sau khi `--continue`. Enter xem chi tiết, **ctrl+x** dừng.
- **`/clear`** và thoát chương trình dừng mọi subagent.

## Cài đặt (`/config`)

| Mục | Mặc định | Ghi chú |
| --- | --- | --- |
| Subagent chạy song song | 10 | Không có trần. Tính chung cả agent nền. Vượt thì xếp hàng theo thứ tự spawn. Với key miễn phí nên đặt 1–2, xem [gemini-limits.md](gemini-limits.md) |
| Model cho subagent | theo model của phiên | Chỉ liệt kê model gọi được tool. Model không dùng được thì tự quay về model của phiên và hiện `△` trên hàng của subagent |
| Dừng khi không tiến triển | 5 phút | Subagent không có tiến triển (không gọi tool, không nhận gì từ model) trong `idleMs` thì bị dừng. Phần **suy luận (reasoning)** của model được tính là tiến triển, nên các pha "nghĩ" dài không còn bị dừng oan. Giá trị `idleMs` dưới 1 giây bị bỏ qua (dùng mặc định) |

Trong `~/.opentrading/config.json`: `"subagents": { "maxConcurrent": 2, "idleMs": 600000, "provider": "groq", "model": "…" }`.

**Tự chọn model lite (`"model": "auto"`)**

Harness tự tìm model nhỏ, rẻ, gọi được tool từ các provider đã kết nối — duyệt từ trên xuống, khớp đầu tiên thắng:

| Ưu tiên | Provider | Model (theo thứ tự pattern) |
| --- | --- | --- |
| 1 | Google | `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, rồi mọi `flash-lite` |
| 2 | OpenCode Go | `claude-haiku-5-5`, `glm-5.3-flash`, rồi mọi `flash` |
| 3 | Alibaba | `qwen3.7-flash`, `qwen-flash`, rồi mọi `flash` |
| 4 | Anthropic | mọi model `haiku` |
| 5 | OpenAI | mọi model `-mini` |
| 6 | Groq | `llama-3.1-8b-instant`, rồi `qwen/…` |
| 7 | OpenRouter | `haiku`, `gemini-3.5-flash-lite` |
| 8 | NVIDIA | `deepseek-v4.1-flash`, rồi mọi `flash` |
| 9 | Ollama Cloud | `deepseek-v4-flash`, rồi mọi `flash` |

Điều kiện: model phải gọi được tool và có context ≥ 64k. Chọn xong, subagent ghi notice `Subagent tự chọn model: …` (xem `/tasks`). Không có ứng viên nào thì quay về model của phiên. Pin trong `agents/*.md` hoặc `subagents.provider/model` luôn thắng `auto`. Danh sách ưu tiên nằm ở `src/core/subagents/model-pick.ts` (`LITE_SHORTLIST`) — sửa một chỗ để đổi chính sách.

`/context` có dòng `Subagent: N lần · X token tính phí`. Đây là tổng token của mọi request subagent đã gửi, không tính vào `ctx %` của agent chính.

## Loại agent

Có 4 loại sẵn trong thư mục `agents/`:

| Loại | Tool | Bước tối đa | Dùng khi |
| --- | --- | --- | --- |
| `nghien-cuu` (mặc định) | tất cả (tool ghi phải duyệt) | 10 | nghiên cứu nhiều bước, trả tổng kết có nguồn |
| `tra-cuu` | chỉ tool đọc | 6 | lấy nhanh vài số liệu cụ thể |
| `phan-bien` | chỉ tool đọc | 8 | phản biện một luận điểm hay một kết quả định giá |
| `tin-tuc` | `web_search`, `web_fetch`, `*news*`, `*sentiment*`, `current_time` | 8 | gom và tóm tắt tin theo khoảng thời gian |

Loại chỉ đọc được bộ lọc tool của harness chặn ở mức tool (`@chi-doc` chỉ đưa tool đọc vào subagent); subagent không có tool shell hay file. Báo cáo cuối của subagent là text trả về cho agent chính (`prompts/subagent.md`).

**Tự định nghĩa loại mới** (theo `.claude/agents/*.md` của Claude Code):
- Dự án: `.opentrading/agents/<tên>.md`.
- Cá nhân: `~/.opentrading/agents/<tên>.md`.
- Thứ tự ưu tiên: dự án > cá nhân > có sẵn. Cùng tên thì bản ưu tiên cao hơn thắng, và `/agents` đánh dấu `ghi đè`.

```markdown
---
name: dinh-gia-nhanh            # trùng tên file
description: Định giá nhanh một mã bằng P/E và P/B so với ngành. Dùng khi cần một con số tham khảo, không cần DCF.
tools: ["@chi-doc"]             # tuỳ chọn; pattern như requires_tools của skill
disallowedTools: ["web_*"]      # tuỳ chọn
provider: groq                  # tuỳ chọn; có provider thì phải có model
model: llama-3.3-70b-versatile
maxSteps: 5                     # 1–30, mặc định 8
---
Chỉ dẫn riêng cho loại này (vào system prompt của subagent, trong <chi_dan_agent>).
```

Cách viết `tools`:
- Bỏ trống hoặc `*`: mọi tool subagent được dùng.
- `@chi-doc`: chỉ tool đọc.
- Pattern dạng `current_time`, `opentrading/vn_*`, `*news*`.
- `disallowedTools` bị trừ sau cùng. Không pattern nào thêm lại được các tool bị loại.

Kiểm tra bằng `/agents`: danh sách, file lỗi, tool thực có và model (có cảnh báo nếu không dùng được). **ctrl+r** nạp lại sau khi sửa file.

## Cho người phát triển

| Thành phần | Vị trí |
| --- | --- |
| Lõi | `src/core/subagents/`: `manager.ts` (start / continue / stop, watchdog im lặng `idleMs`, mặc định 5 phút), `limiter.ts` (slot FIFO), `result.ts` (trailer `<subagent_meta>`), `sidechain.ts`, `notification.ts` |
| Tool | `src/core/tools/subagent/spawn.ts`: `spawn_subagent`, `send_message` và `stop_agent` (hai tool sau là tool hoãn) |
| Loại agent | `src/core/agents/` |
| Prompt | prompt của subagent là `prompts/subagent.md` + `<bat_bien>`/`<thu_tu_uu_tien>` lấy từ `identity.md`, không có hồ sơ nhà đầu tư, memory hay style. Prompt của agent chính không đổi |
| Lưu trữ | transcript của subagent ở `sessions/YYYY/MM/<session>/subagents/agent-<id>.jsonl` + `.meta.json`, không nằm trong `index.jsonl` |
| Giao diện | `src/tui/subagent-row.tsx`, `src/tui/dialogs/agents.tsx`, `src/tui/dialogs/tasks.tsx` |
