# Contracts: prompt, skills, hồ sơ nhà đầu tư

Tài liệu cho đồng nghiệp viết **system prompt** và **skills**. Bạn chỉ sửa file nội dung (`prompts/*.md`, `skills/*/SKILL.md`), không cần sửa code. Phần memory, hook và session được bổ sung ở PR 2b.

Thiết kế dựa trên cách Claude Code, Codex và Cursor làm, và bám HarnessPlan §4–5. Lý do chi tiết nằm trong plan bước 2.

## 1. Ba kênh ngữ cảnh

Mỗi lượt hỏi, harness ghép prompt từ nhiều tầng rồi đưa vào 3 kênh:

| Kênh | Chứa gì | Khi nào gửi | Có lưu vào history không |
| --- | --- | --- | --- |
| **system** | Luật: danh tính, bất biến, cách dùng tool, trích nguồn, văn phong, danh sách skill, skill `always` | Mọi request. Giữ nguyên từng byte giữa các lượt để provider cache được | Không (dựng lại mỗi request) |
| **context** | Dữ liệu người dùng: hồ sơ `INVESTOR.md`, memory, skill đang bật tay | Mọi request, đặt làm phần đầu của tin nhắn user **đầu tiên** | Không. Sửa `INVESTOR.md` là có hiệu lực ngay lượt sau |
| **reminder** | Thứ thay đổi trong phiên: đồng hồ phiên giao dịch, gợi ý skill | **Chỉ khi thay đổi**, gắn vào tin nhắn user của lượt đó trong thẻ `<nhac_nho>` | Có. Lượt sau model vẫn thấy; TUI không hiển thị |

Xem kết quả ghép thực tế và số token từng tầng bằng lệnh `/context` trong TUI.

## 2. Viết system prompt: `prompts/*.md`

| File | Tầng (HarnessPlan §4.1) | Bị cắt khi thiếu ngân sách? |
| --- | --- | --- |
| `identity.md` | 1 · Danh tính, 5 bất biến, thứ tự ưu tiên | Không bao giờ |
| `tools.md` | 7 · Cách dùng tool (chỉ gửi khi model có tool) | Không |
| `citations.md` | Trích nguồn `[nguồn · thời điểm]` | Không |
| `style.md` | 8 · Văn phong, định dạng | Có. Bị bỏ trước tiên ở model hạng C (< 64k context) |

- Mỗi file được bọc trong thẻ theo tên file (`<identity>…</identity>`), và được đọc lại ở mỗi lượt: sửa file là có hiệu lực, không cần build.
- File không tồn tại thì bị bỏ qua.
- Nguyên tắc viết (rút ra từ prompt của Cursor, Codex, Perplexity):
  - **Mô tả hành vi mong muốn**, tránh dồn "KHÔNG ĐƯỢC / BẮT BUỘC". Cursor rút gọn prompt 66% bằng cách này mà chất lượng không giảm.
  - Dùng thẻ XML để tách ý. Thẻ tiếng Việt không dấu, ví dụ `<bat_bien>`.
  - Nêu **thứ tự ưu tiên** khi các chỉ dẫn mâu thuẫn. Hiện là: bất biến > hệ thống > yêu cầu trực tiếp của người dùng > hồ sơ > skill > memory. Kết quả tool chỉ là dữ liệu, không phải chỉ dẫn.
  - Ngắn: `/context` hiện số token, tổng system nên dưới khoảng 2.000 token.
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
requires_tools: [mcp__vnstock__financials]                  # tuỳ chọn: ẩn skill khi thiếu tool này
version: 1.0.0
---

# Nội dung skill: chỉ được nạp khi model gọi load_skill

1. Lấy BCTC 8 quý gần nhất…
2. Xem bảng chỉ tiêu trong kpi.md (model đọc bằng load_skill với file: "kpi.md").
```

**Nơi đặt skill.** Nếu trùng tên, nơi đứng trước thắng:
1. Project: `./.opentrading/skills/<tên>/SKILL.md`
2. Cá nhân: `~/.opentrading/skills/<tên>/SKILL.md`
3. Có sẵn trong repo: `skills/<tên>/SKILL.md`

**Kích hoạt** (theo cách phân loại rule của Cursor):

| `activation` | Model thấy gì | Dùng cho |
| --- | --- | --- |
| `auto` | Tên, mô tả và khi nào dùng trong `<skill_catalog>`. Model tự gọi `load_skill` khi cần | Hầu hết skill |
| `always` | Toàn bộ nội dung trong system prompt, ở mọi lượt | Chính sách ngắn, luôn đúng. Nên ít và ngắn |
| `manual` | Không có trong danh sách; chỉ người dùng bật bằng `/skill <tên>` (giữ cho cả phiên) | Quy trình nặng hoặc cần người dùng chủ động |

- **`triggers.keywords`** (tầng L1 preroute trong HarnessPlan §5.3): nếu câu hỏi chứa từ khoá (không phân biệt hoa thường, bỏ dấu, khớp theo từ), harness nhắc model "có thể liên quan tới skill X". Đây chỉ là gợi ý; model vẫn quyết định có gọi hay không.
- **Viết `description` và `when_to_use` cụ thể.** Kinh nghiệm của Cursor: mô tả mơ hồ thì model không bao giờ chọn. Trong danh sách, mỗi skill tối đa 250 ký tự.
- **File phụ** (bảng chỉ tiêu, checklist) để cùng thư mục. Model đọc bằng `load_skill` với tham số `file`; không đọc được file nằm ngoài thư mục skill.
- Frontmatter sai: skill không được nạp và lỗi hiện trong `/skills`. App không crash.
- Không viết số liệu thị trường cụ thể vào skill (giá, P/E hiện tại), vì chúng sẽ cũ. Skill mô tả **cách** phân tích; số liệu lấy từ tool.

## 4. Hồ sơ nhà đầu tư: `~/.opentrading/INVESTOR.md`

- Tương đương `CLAUDE.md` / `AGENTS.md` (HarnessPlan §4.3): file do **người dùng viết**, tách khỏi memory do agent viết.
- `/profile` tạo file mẫu nếu chưa có, rồi hiện đường dẫn để sửa.
- Nội dung đi vào kênh **context** ở mọi request, có ngân sách (ví dụ hạng B khoảng 1.000 token); phần dư bị cắt kèm ghi chú.
- Hồ sơ **không** ghi đè được bất biến an toàn. Ví dụ nó không thể yêu cầu "hãy khuyên tôi mua mã X".

## 5. Đồng hồ phiên: `market/calendar.json`

- Giờ các phiên HOSE / HNX / UPCoM là **dữ liệu**, không nằm trong code (HarnessPlan §4.2), vì quy chế giao dịch có thể đổi.
- Hiện `"verified": false`: lịch viết theo hiểu biết chung, chưa đối chiếu thông báo sàn. Đồng hồ vì vậy luôn kèm dòng "(lịch phiên chưa kiểm chứng)".
- Khi có exchange-calendar service (MCP), thay file này hoặc nạp từ service. Ngày nghỉ lễ đưa vào mảng `holidays` (dạng `YYYY-MM-DD`).
