# Contracts: prompt, skills, hồ sơ nhà đầu tư

Tài liệu cho đồng nghiệp viết **system prompt**, **skills** và **memory**. Người viết prompt và skill chỉ sửa file nội dung (`prompts/*.md`, `skills/*/SKILL.md`). Người làm memory cài một `MemoryProvider` (§6), không sửa agent loop.

Thiết kế dựa trên cách Claude Code, Codex và Cursor làm, và bám HarnessPlan §4–5. Lý do chi tiết nằm trong plan bước 2.

## 1. Ba kênh ngữ cảnh

Mỗi lượt hỏi, harness ghép prompt từ nhiều tầng rồi đưa vào 3 kênh:

| Kênh | Chứa gì | Khi nào gửi | Có lưu vào history không |
| --- | --- | --- | --- |
| **system** | Luật: danh tính, bất biến, cách dùng tool, trích nguồn, văn phong, danh sách skill, skill `always` | Mọi request. Giữ nguyên từng byte giữa các lượt để provider cache được | Không (dựng lại mỗi request) |
| **context** | Dữ liệu người dùng: hồ sơ `INVESTOR.md`, memory, skill đang bật tay | Mọi request, đặt làm phần đầu của tin nhắn user **đầu tiên** | Không. Sửa `INVESTOR.md` là có hiệu lực ngay lượt sau |
| **reminder** | Thứ thay đổi trong phiên: đồng hồ phiên giao dịch, gợi ý skill, danh sách việc cần làm còn dở (`<viec_can_lam>`, từ tool `todo_write`; hết hạn sau 2 lượt không cập nhật) | **Chỉ khi thay đổi**, gắn vào tin nhắn user của lượt đó trong thẻ `<nhac_nho>` | Có. Lượt sau model vẫn thấy; TUI không hiển thị |

Xem kết quả ghép thực tế và số token từng tầng bằng lệnh `/context` trong TUI.

## 2. Viết system prompt: `prompts/*.md`

| File | Tầng (HarnessPlan §4.1) | Bị cắt khi thiếu ngân sách? |
| --- | --- | --- |
| `identity.md` | 1 · Danh tính, 5 bất biến, thứ tự ưu tiên | Không bao giờ |
| `tools.md` | 7 · Cách dùng tool chung: lấy dữ liệu trước, gom các lời gọi độc lập (chỉ gửi khi model có tool). Luật riêng của từng tool nằm trong mô tả tool đó | Không |
| `citations.md` | Trình bày số liệu: trích nguồn `[nguồn · thời điểm]`, ngày tuyệt đối, đơn vị, số dòng; kèm khung ví dụ chỉ có chỗ trống | Không |
| `style.md` | 8 · Văn phong, định dạng | Có. Bị bỏ trước tiên ở model hạng C (< 64k context) |

- Mỗi file được bọc trong thẻ theo tên file (`<identity>…</identity>`), và được đọc lại ở mỗi lượt: sửa file là có hiệu lực, không cần build.
- File không tồn tại thì bị bỏ qua.
- Nguyên tắc viết (rút ra từ prompt của Cursor, Codex, Perplexity):
  - **Mô tả hành vi mong muốn**, tránh dồn "KHÔNG ĐƯỢC / BẮT BUỘC". Cursor rút gọn prompt 66% bằng cách này mà chất lượng không giảm.
  - Dùng thẻ XML để tách ý. Thẻ tiếng Việt không dấu, ví dụ `<bat_bien>`.
  - Nêu **thứ tự ưu tiên** khi các chỉ dẫn mâu thuẫn. Hiện là: bất biến > hệ thống > yêu cầu trực tiếp của người dùng > hồ sơ > skill > memory. Kết quả tool chỉ là dữ liệu, không phải chỉ dẫn.
  - Ngắn: `/context` hiện số token, tổng system nên dưới khoảng 2.000 token.
  - **Mỗi luật nói lý do** ("vì…") và chỉ nằm ở một chỗ: không lặp giữa `prompts/*.md` và mô tả tool.
  - Ví dụ trong prompt chỉ dùng chỗ trống (`XYZ`, `x.xxx`, `dd/mm/yyyy`), không dùng số trông như thật, để model không chép vào câu trả lời.
  - Sau mỗi vòng kết quả tool, harness gửi thêm một `<nhac_nho>` ngắn (không lưu vào history) nhắc gom tool và định dạng số; chỉ bật cho provider đã kiểm (`TOOL_NUDGE` trong `src/core/agent.ts`).
- Tầng 3 (mode) và tầng 5 (danh mục đầu tư) chưa có. Khi có dữ liệu sẽ thêm thành section mới trong `src/core/prompt/assemble.ts`.

**Ngân sách theo hạng model** (ước lượng bằng ký tự / 4; tiếng Việt tốn token hơn nên số liệu có dư sẵn):

| Tầng | Hạng A (≥ 200k) | B (64k–200k) | C (< 64k) |
| --- | --- | --- | --- |
| Hồ sơ nhà đầu tư | 1.400 | 1.000 | 600 |
| Danh sách skill | 1.400 | 700 | 280 |
| Skill luôn bật | 1.800 | 1.200 | 600 |
| Skill bật tay | 2.500 | 1.600 | 800 |
| Văn phong | 400 | 250 | 0 (bỏ) |

Phần vượt ngân sách bị cắt và có ghi chú `[… đã được cắt bớt]`. Nhận dạng, trích nguồn và đồng hồ phiên không bao giờ bị cắt.

## 3. Viết skill: `skills/<tên>/SKILL.md`

Theo chuẩn Agent Skills: dùng được với Claude Code, Codex và Cursor; OpenTrading thêm một số trường riêng cho tài chính.

```markdown
---
name: banking-sector                 # bắt buộc; trùng tên thư mục; a-z 0-9 và gạch ngang; ≤ 64 ký tự
description: Phân tích cổ phiếu ngân hàng theo bộ chỉ tiêu riêng (NIM, CASA, NPL, CAR…).   # bắt buộc
when_to_use: Câu hỏi về cổ phiếu ngân hàng hoặc BCTC ngân hàng.   # nên có, model dựa vào đây để chọn
activation: auto                     # auto (mặc định) | always | manual
triggers:
  keywords: [ngân hàng, NIM, CASA, nợ xấu, room tín dụng]   # tuỳ chọn, xem mục Kích hoạt
  exclude_keywords: [dẫn sóng, pha nào]         # tuỳ chọn: câu có cụm này thì không gợi ý skill
requires_tools: [opentrading/financial_*, vn_quote_history]  # tuỳ chọn, xem dưới
version: 1.0.0
---

# Nội dung skill: chỉ được nạp khi model gọi load_skill

1. Lấy BCTC 8 quý gần nhất…
2. Xem bảng chỉ tiêu trong kpi.md (model đọc bằng load_skill với file: "kpi.md").
```

**`requires_tools`** là danh sách tool mà skill dùng. Mỗi mục có thể viết theo một trong bốn cách:

| Cách viết | Ví dụ | Khớp với |
| --- | --- | --- |
| Tên đầy đủ | `mcp__opentrading__vn_quote_history` | đúng tool đó |
| `server/tool` | `opentrading/vn_quote_history` | tool của đúng server đó |
| Tên ngắn | `vn_quote_history` | tool có sẵn, hoặc tool cùng tên của bất kỳ server nào |
| Có `*` | `opentrading/financial_*` | mọi tool khớp mẫu |

- Mục nào không khớp tool nào thì skill bị ẩn.
- Khi model nạp skill (`load_skill`), các tool khớp mà đang bị hoãn (tool search) được **nạp luôn**, nên model dùng được ngay mà không phải `tool_search`.
- Vì vậy hãy ghi đủ các tool skill cần, nhưng đừng dùng `*` quá rộng: mỗi tool nạp vào sẽ ở lại trong cả phiên.

**Nơi đặt skill.** Nếu trùng tên, nơi đứng trước thắng:
1. Project: `./.opentrading/skills/<tên>/SKILL.md`
2. Cá nhân: `~/.opentrading/skills/<tên>/SKILL.md`
3. Có sẵn trong repo: `skills/<tên>/SKILL.md`

Skill (và agent) riêng của một thư mục (`.opentrading/skills`, `.opentrading/agents`) trở thành chỉ dẫn cho model, nên lần đầu mở thư mục có chúng OpenTrading hỏi **"Thư mục này có skill/agent riêng"**: *Tin cậy và nạp* (lưu ở `~/.opentrading/folder-trust.json`; với thư mục home hay gốc ổ đĩa thì chỉ cho lần chạy này) hoặc *Bỏ qua* (không lưu, lần sau hỏi lại). `.mcp.json` của thư mục vẫn hỏi riêng từng server như trước.

**Kích hoạt** (theo cách phân loại rule của Cursor):

| `activation` | Model thấy gì | Dùng cho |
| --- | --- | --- |
| `auto` | Tên, mô tả và khi nào dùng trong `<skill_catalog>`. Model tự gọi `load_skill` khi cần | Hầu hết skill |
| `always` | Toàn bộ nội dung trong system prompt, ở mọi lượt | Chính sách ngắn, luôn đúng. Nên ít và ngắn |
| `manual` | Không có trong danh sách; chỉ người dùng bật bằng `/skill <tên>` (giữ cho cả phiên) | Quy trình nặng hoặc cần người dùng chủ động |

- **`triggers.keywords`** (tầng L1 preroute trong HarnessPlan §5.3): nếu câu hỏi chứa từ khoá (không phân biệt hoa thường, bỏ dấu, khớp theo từ), harness nhắc model "có thể liên quan tới skill X". Đây chỉ là gợi ý; model vẫn quyết định có gọi hay không. Tầng thứ hai khớp mềm: so từ và cặp từ (trọng số IDF) giữa câu hỏi với tên, `description`, `when_to_use` và từ khoá; chỉ gợi ý thêm một skill khi điểm đủ cao và gấp 1,5 lần skill đứng sau. Vì vậy `description`/`when_to_use` viết bằng chữ người dùng hay nói cũng giúp định tuyến. Đo bằng `test/routing-eval.test.ts`.
- **`triggers.exclude_keywords`**: câu hỏi chứa một cụm trong danh sách này (khớp như từ khoá) thì skill bị loại khỏi **cả hai** tầng gợi ý cho lượt đó. Dùng khi skill có từ khoá đúng nhưng một loại câu hỏi thuộc skill khác: 13 skill ngành loại các câu hỏi về pha/sóng (`dinh-vi-chu-ky-vn`), tin tức, so sánh, khuyến nghị mua bán. Đừng dùng thay cho việc viết từ khoá hẹp hơn.
- **Tránh từ chung trong `description` của skill hẹp** ("doanh thu", "tăng trưởng", "lợi nhuận"): tầng khớp mềm chỉ gợi ý khi skill đứng đầu hơn skill thứ hai 1,5 lần, nên một skill hẹp mang từ chung sẽ làm skill tổng quát mất gợi ý.
- **Viết `description` và `when_to_use` cụ thể.** Kinh nghiệm của Cursor: mô tả mơ hồ thì model không bao giờ chọn. Trong danh sách, mỗi skill tối đa 250 ký tự.
- **File phụ** (bảng chỉ tiêu, checklist) để cùng thư mục. Model đọc bằng `load_skill` với tham số `file`; không đọc được file nằm ngoài thư mục skill. Mỗi file phụ tốn thêm một lượt gọi tool, nên chỉ tách khi nội dung dài và chỉ dùng ở nhánh hiếm; vài dòng mà bước chính luôn cần thì để thẳng trong SKILL.md. Bảng tra cứu (mã, id) mà tool tự hiểu được thì sửa ở tool, không chép vào skill. Khi tách: bảng tra cứu để `assets/`, file diễn giải cách đọc để `references/`.
- Frontmatter sai: skill không được nạp và lỗi hiện trong `/skills`. App không crash.
- Không viết số liệu thị trường cụ thể vào skill (giá, P/E hiện tại), vì chúng sẽ cũ. Skill mô tả **cách** phân tích; số liệu lấy từ tool.
- **`references/` cùng luật, theo 2 tầng:**

  | Tầng | Được giữ | Bị cấm |
  | --- | --- | --- |
  | **Luật** | Luật, ngưỡng, cơ chế, hạn chế, provenance | — |
  | **Kết quả** | — | Kết quả bảng: thứ hạng, xếp hạng, so sánh nhất, năm/số mẫu, danh sách "ai dẫn" |

- Vì sao: kết quả đo sẽ cũ sau **mỗi lần refresh** và model sẽ trích từ file thay vì tra tool → trả lời sai mà vẫn tự tin. Nêu **tên ứng viên** để tra (search space) thì được; nêu **kết luận so sánh** trong search space thì không.
- Khi số mới phủ định một quy tắc trong `references/`: sửa **quy tắc** thành điều kiện tra được (tra X, đọc cột Y, áp ngưỡng Z), **không** chép bảng kết quả vào file. Muốn giữ một nhận định định tính thì ghi rõ là prior + điều kiện để nó thành tín hiệu.
- Skill có bảng thống kê dài hạn nên có **mục "Giới hạn"** (mẫu nhỏ, ô partial, tìm max trên nhiều ô) để kết luận nào cũng phải kèm độ tin cậy.
- `test/helpers/skill-lint.ts` có rule `copiedResults` chặn pattern kết quả bảng trong `references/**` (thoát bằng `<!-- lint:allow-result -->` cho ca hợp lệ, VD provenance của framework).
- **Cây quyết định** (mục `## Cây quyết định …`, nút `Qn.`, nhánh `├─`/`└─`, kết luận `★`): mỗi nút kết thúc bằng nhánh `└─` (mọi câu trả lời đều có đường đi); nhánh có `★` là dừng, không nhắc tới `Qn` khác; nhánh không có `★` phải trỏ `→ tiếp Qn` tới nút có thật; nhánh "không có số" đi tiếp với độ tin cậy thấp, không biến thành kết luận tiêu cực. Rule `decisionTrees` trong `skill-lint.ts` kiểm các điều này.
- **Gọi tool đúng khả năng của tool**: `financial_detail` nhận một `statement` mỗi lời gọi; `peer_compare` chỉ trả snapshot định giá (P/E, P/B, EPS, BVPS, ROE/ROA); `news_market` là luồng tin mới nhất, không tra theo chủ đề (dùng `web_search`) hay theo mã (dùng `news_symbol`); `vs_xnk_detail` chia theo nước. Kiểm schema trong `test/fixtures/mcp-catalog/opentrading.json` trước khi viết bước.

## 4. Hồ sơ nhà đầu tư: `~/.opentrading/INVESTOR.md`

- Tương đương `CLAUDE.md` / `AGENTS.md` (HarnessPlan §4.3): file do **người dùng viết**, tách khỏi memory do agent viết.
- `/profile` tạo file mẫu nếu chưa có, rồi hiện đường dẫn để sửa.
- Nội dung đi vào kênh **context** ở mọi request, có ngân sách (ví dụ hạng B khoảng 1.000 token); phần dư bị cắt kèm ghi chú.
- Hồ sơ **không** ghi đè được bất biến an toàn. Ví dụ nó không thể yêu cầu "hãy khuyên tôi mua mã X".

## 5. Đồng hồ phiên: `market/calendar.json`

- Giờ các phiên HOSE / HNX / UPCoM là **dữ liệu**, không nằm trong code (HarnessPlan §4.2), vì quy chế giao dịch có thể đổi.
- Hiện `"verified": false`: lịch viết theo hiểu biết chung, chưa đối chiếu thông báo sàn. Đồng hồ vì vậy luôn kèm dòng "(lịch phiên chưa kiểm chứng)".
- Khi có exchange-calendar service (MCP), thay file này hoặc nạp từ service. Ngày nghỉ lễ đưa vào mảng `holidays` (dạng `YYYY-MM-DD`).

## 6. Memory: `MemoryProvider`

File: `src/core/memory/types.ts`. Harness quyết định memory đi vào prompt **ở đâu** và giới hạn kích thước; provider quyết định **nhớ gì** và lưu thế nào.

```ts
interface MemoryProvider {
  readonly id: string
  instructions?(): string | undefined                    // system (tĩnh): cách model dùng memory
  index?(ctx): Promise<string | undefined>               // context, mọi request, harness cắt ≤ 4 KB
  recall?(query, ctx): Promise<MemoryItem[]>             // reminder của lượt, harness giữ ≤ 5 mục / 4 KB
  tools?(): ToolDef[]                                    // ví dụ propose_memory, đăng ký lúc khởi động
  register?(hooks: HookBus): void                        // nghe session-start, user-prompt, turn-end, session-end
  list?(); approve?(id); reject?(id); remove?(id)        // cho /memory
}
interface MemoryItem { id; text; scope: "user" | "workspace"; status: "pending" | "active"; source?; createdAt; updatedAt }
```

**Quy định bắt buộc:**
- Memory **`pending`** (model đề xuất) không bao giờ được trả về từ `index()` hay `recall()` cho tới khi người dùng duyệt trong `/memory`. Đây là bài học từ Cursor: memory mà người dùng không thấy thì thành chỉ dẫn vô hình.
- Không lưu dữ liệu thị trường (giá, chỉ số, tín hiệu, nhận định), vì chúng nhanh cũ. Tool lấy chúng mỗi lần.
- Memory có **ưu tiên thấp nhất**: không ghi đè `INVESTOR.md` hay bất biến an toàn.
- Mỗi lượt có dùng memory, TUI hiện dòng "Dùng N memory: …" để người dùng biết.

**Bản mẫu `FileMemory`** (`src/core/memory/file-memory.ts`) để tham khảo và thay thế:
- Mỗi memory là một file markdown trong `~/.opentrading/memory/`.
- Tool `propose_memory` tạo memory `pending`. Người dùng gõ "Ghi nhớ: …" thì lưu thẳng `active`, qua hook `user-prompt`.
- `recall` khớp theo từ khoá.

**Bật memory:** dùng `/config` trong TUI (có hiệu lực ngay, không cần mở lại), hoặc sửa `~/.opentrading/config.json`. Mặc định là `"none"` (tắt):
```json
{ "memory": { "provider": "file" } }
```
Khi đổi provider, harness gỡ tool và hook của provider cũ; `register()` nên trả về hàm huỷ đăng ký.
Đăng ký provider mới: thêm lựa chọn trong `createMemory()` (`src/core/runtime.ts`).

## 7. Hook: `HookBus`

File: `src/core/hooks.ts`. Chạy trong process, dùng tên sự kiện giống Claude Code và Codex; chưa hỗ trợ hook bằng shell.

| Sự kiện | Khi nào | Hook có thể trả về |
| --- | --- | --- |
| `session-start` | Mở app, `/new`, `/clear`, mở lại phiên (`source`: `startup` \| `clear` \| `resume`) | — |
| `user-prompt` | Trước khi gửi câu hỏi | `block` (chặn lượt, không gọi model) hoặc `additionalContext` (thêm vào reminder, tối đa khoảng 2.500 token) |
| `turn-end` | Sau khi lượt hỏi–đáp xong (không chờ hook chạy xong) | — |
| `session-end` | Trước khi đổi phiên hoặc thoát | — |

Hook ném lỗi hoặc chạy quá 5 giây sẽ bị bỏ qua và báo thành một dòng thông báo; lượt hỏi–đáp vẫn tiếp tục.

## 7b. Loại subagent: `agents/<tên>.md`

Frontmatter gồm `name` (trùng tên file), `description`, `tools`, `disallowedTools`, `provider`/`model`, `maxSteps` và `effort`. Phần thân file là chỉ dẫn riêng của loại đó. Thứ tự ưu tiên: dự án `.opentrading/agents/` > cá nhân `~/.opentrading/agents/` > có sẵn `agents/`. Chi tiết: [subagents.md](subagents.md).

## 8. Session: `~/.opentrading/sessions/`

- Mỗi phiên là **một file JSONL ghi nối** `YYYY/MM/<id>.jsonl`, chỉ được tạo khi có lượt hỏi–đáp đầu tiên. Ghi nối nên nếu app crash thì chỉ mất dòng cuối, và dòng hỏng đó được bỏ qua khi đọc.
- Các loại dòng:
  - `meta`: format, id, cwd, `promptVersion` (hash của `prompts/*.md`), danh sách skill và version.
  - `message`: một `ModelMessage` của AI SDK.
  - `turn_end`: provider và model của lượt, `contextTokens` (kích thước context sau lượt, theo usage của provider).
  - `compact`: hội thoại vừa được nén (`trigger` auto/manual, `before`/`after` token, `messages` là history mới). Khi mở lại, model chỉ nhận history từ entry `compact` cuối cùng trở đi; transcript vẫn hiện các lượt cũ cùng một dòng "Đã nén hội thoại".
- `index.jsonl` có một dòng cho mỗi lần cập nhật phiên; dòng sau cùng của cùng một id thắng.
- Subagent ghi transcript riêng ở `YYYY/MM/<id>/subagents/agent-<agentId>.jsonl` (các dòng `agent_meta`, `message`, `notice`, `agent_end`) và `.meta.json`. File phiên chính chỉ chứa lời gọi `spawn_subagent` và kết quả (có trailer `<subagent_meta>`). Kết quả của subagent nền vào history dưới dạng tin user `<thong_bao_subagent>`.
- **Mở lại phiên:**
  - Dùng `/sessions`, `opentrading -c` / `--continue` (phiên mới nhất **của thư mục đang mở**) hoặc `-r` / `--resume <id>` (chỉ cần phần đầu của id, mở được phiên của thư mục khác).
  - Phiên thuộc thư mục OpenTrading được mở (`cwd` trong `meta`, và trong dòng `index.jsonl` từ khi có lệnh `opentrading`; dòng cũ đọc `cwd` từ `meta`). `/sessions` liệt kê phiên của thư mục này, `tab` chuyển sang mọi thư mục. Tool `session_history` vẫn thấy mọi phiên.
  - History được dựng lại; tool-call thiếu kết quả được đóng bằng lỗi "bị ngắt"; đồng hồ phiên được gửi lại ở lượt đầu.
  - Nếu model đang dùng khác model lúc lưu, TUI cảnh báo.
- **Nén hội thoại** (`src/core/compact.ts`, lệnh `/compact [hướng dẫn]`, tắt hoặc chỉnh ngưỡng trong `/config`):
  - Cửa sổ là toàn bộ cửa sổ của model: `limit.input` của models.dev, không có thì `limit.context`. Config `compactWindow` (số token) hạ trần nếu cần; Gemini gói miễn phí chỉ nhận 250K token/phút nên nên đặt khoảng 200000.
  - Tự nén khi context tới `autoCompactPercent` (50–95, mặc định 95) của (cửa sổ − phần chừa cho câu trả lời, min(output, 20k)). Ví dụ model 1M nén ở khoảng 977k, model 200k ở 171k.
  - Giữa các bước gọi tool của một lượt: nếu request tiếp theo sẽ chạm ngưỡng, các bước còn lại gửi kèm kết quả tool cũ đã dọn (không tốn request, history không đổi); lượt sau mới nén thật.
  - Provider báo request quá dài: harness nén (kể cả khi ước lượng còn dưới ngưỡng) rồi thử lại một lần. Lượt hỏng trước khi có tool chạy thì gửi lại đúng câu hỏi; lượt đã chạy tool thì giữ lại và nhắn model làm tiếp, để không tool nào chạy hai lần.
  - Gemini báo 429 vì quota token/phút mà riêng request đã lớn hơn quota đó: báo ngay (đặt trần token trong `/config`), không chờ thử lại.
  1. Kết quả tool cũ (ngoài 2 lượt cuối, dài hơn 500 ký tự) được thay bằng một dòng "đã dọn"; không tốn request.
  2. Nếu vẫn cần, model tóm tắt phần đầu theo mẫu có mục "Số liệu đã xác minh" (giá trị, đơn vị, nguồn, thời điểm chép nguyên văn); 2 lượt cuối giữ nguyên.
  - History mới mở đầu bằng một `<nhac_nho><tom_tat_hoi_thoai>` do harness ghi: danh sách tool đã nạp, skill đã nạp, danh sách việc cần làm còn dở.
- Reminder `<nhac_nho>` được lưu trong history (để model luôn biết phiên giao dịch) nhưng TUI không hiển thị. Hồ sơ nhà đầu tư và memory index **không** được lưu vào phiên, vì chúng được dựng lại ở mỗi request.

## 9. File, shell và chế độ quyền (PR #91–#96)

Phần khung, đồng nghiệp chỉ cần biết để viết prompt và skill:

- Model có `read_file`, `glob_files`, `grep_files`, `write_file`, `edit_file`, `shell`. Luật dùng tool nằm trong mô tả của từng tool, không cần lặp lại trong `prompts/*.md`.
- Model nhận khối nhắc `<quyen_tep>` (workspace và chế độ quyền hiện tại: `‖ chỉ đọc` / `▸ sửa có hỏi` / `▸▸ tự động`) ở lượt đầu, và gửi lại chỉ khi workspace hoặc chế độ đổi. Prompt không nên giả định model ghi file được mà không hỏi.
- **Việc cho đồng nghiệp (chưa làm):** một skill "tạo tài liệu/báo cáo" hướng dẫn cách trình bày artifact. Ví dụ: kế hoạch theo dõi mã `.md`, bảng so sánh `.csv`, trang `.html` tự chứa có biểu đồ (SVG/JS nội tuyến, không tải script ngoài), đặt tên file không dấu, ghi nguồn và thời điểm số liệu. Mô tả `write_file` hiện chỉ có phần tối thiểu.
- Luật của model duyệt auto mode ở `src/core/permission/auto/rules.ts`, người dùng tuỳ biến trong `config.json → autoMode`. Muốn thêm luật mặc định liên quan nghiệp vụ chứng khoán (ví dụ thêm tên công ty chứng khoán vào luật "Real Trading") thì sửa file đó qua PR, rồi chạy `bun scripts/dev/auto-mode-eval.ts`.
- Chi tiết: [permissions.md](permissions.md).
