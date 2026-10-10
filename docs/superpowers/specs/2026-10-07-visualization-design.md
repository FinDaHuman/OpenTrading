# Visualization — chart nâng cao trên TUI (design)

> **Lịch sử, đã thay đổi (11/10/2026):** chart giờ vẽ màu trong TUI (ChartBox), model chỉ nhận
> một dòng tóm tắt và vẽ bằng `from_call` (tham chiếu `[ref rN]` của kết quả tool); một skill
> `ve-bieu-do` thay cho hai skill dưới đây, và model không chép hình vào câu trả lời.

Ngày: 2026-10-07 · Nhánh: `visualization` · Cơ sở: `main` (f5d62cb)

## Mục tiêu

Mở rộng khả năng vẽ biểu đồ dạng text trên TUI của OpenTrading: 8 kinds mới cho
`chart_render` (5 renderer tự viết + 3 expose từ `@crafter/charts`), nâng cấp skill
`ve-bieu-do-ky-thuat` và thêm skill `ve-bieu-do-nang-cao`. Data luôn lấy từ MCP
(OpenTrading MCP), renderer chỉ vẽ, không fetch.

## Bối cảnh (khảo sát 2026-10-07)

- TUI: SolidJS + `@opentui/solid` (cùng họ với opencode); câu trả lời render dạng
  markdown → chart là text thuần trong khối code ``` (ANSI vỡ giao diện).
- Hiện có: `chart_render` (10 kinds: candlestick, line, sparkline, area, bar,
  histogram, heatmap, gauge, donut, winloss), `chart_compare`, `chart_depth`;
  skill `ve-bieu-do-ky-thuat` v1.3.0.
- Lib `@crafter/charts` 0.2.5 đã có sẵn nhưng chưa expose: `scatter`, `sparkColumn`,
  `lineBox`, charset box; lib không có pie nhiều lát, waterfall, multi-line một trục,
  stacked bar, boxplot → tự viết trên primitives (grid, scale, charset block).
- Ràng buộc: bề rộng ≤120 ký tự; tool output thu gọn mặc định → model phải chép
  hình nguyên văn vào khối code trong câu trả lời (skill giữ nguyên quy tắc này).

## Thiết kế

### 1. Renderer mới (mỗi file một mục đích, `src/core/tools/chart/`)

| File | Kind | Input | Cách vẽ |
|---|---|---|---|
| `pie.ts` | `pie` | series + labels | Mỗi lát 1 dòng: `██████ Ngân hàng 35%` — bar tỷ lệ + legend %, sort giảm dần; lát ≤0 bị bỏ và báo trong tiêu đề phụ |
| `waterfall.ts` | `waterfall` | start + deltas + labels | Cột cộng dồn từng bước: `├████┤ +2.3 → 57.6`, connector │ giữa các bước, ghi running total |
| `multiline.ts` | `multiline` | nhiều series (2–5) + labels | Nhiều đường trên CÙNG 1 trục (grid + linearScale + autoExtent của lib), mỗi series một ký tự riêng `─ ◆ ▲ ●`, legend cuối mỗi dòng |
| `stacked.ts` | `stacked` | matrix + labels (hàng = nhóm, cột = thành phần) | Bar xếp lớp bằng `░▒▓█` theo thành phần, giá trị từng phần ở cuối |
| `boxplot.ts` | `boxplot` | nhiều series (mỗi series 1 nhóm) | `[--◆--]` min/Q1/median/Q3/max trên trục giá trị chung |

### 2. Expose từ lib

`scatter` (points x/y hoặc 2 mảng x, y), `sparkcolumn` (sparkline cột dọc),
`linebox` (line ký tự box) — bọc qua `chart_render`, cùng kỷ luật stripAnsi/width.

### 3. Mở rộng `chart_render`

- `KINDS` thêm: `pie`, `waterfall`, `multiline`, `stacked`, `boxplot`, `scatter`,
  `sparkcolumn`, `linebox` (tổng 18 kinds).
- Schema tái dùng `series`/`labels`/`matrix`; thêm `start` (waterfall), `points`
  (scatter: `{x, y}[]`).
- Validation tiếng Việt kèm ngưỡng tối thiểu; stripAnsi mọi kết quả; clamp
  width 20–120, height 3–40. `readOnly`, `deferrable`, `source: LOCAL_SOURCE` giữ nguyên.

### 4. Skill

- `ve-bieu-do-ky-thuat` → v1.4.0: bổ sung kind mới vào bảng tra cứu MCP tool → kind.
- Skill mới `ve-bieu-do-nang-cao` (auto): pie, waterfall, multiline, stacked, boxplot,
  scatter — khi nào dùng (tỷ trọng/BCTC/P&L/tương quan/biến động), ngưỡng data,
  cấu trúc câu trả lời (hình trong ``` + verdict ≤3 câu), `requires_tools: [chart_render]`.

### 5. Demo duyệt trong chat

`scripts/demo-chart.ts`: bun script đọc token từ `~/.opentrading/auth.json`, kết nối
OpenTrading MCP qua HTTP, fetch data thật theo kind, chạy qua `chart_render`, in stdout.
Demo từng kind trong chat opencode (khối ```) để duyệt trước khi commit; MCP cold-start
(Render free tier 20–40s) thì dùng fixture tĩnh trước, data thật sau.

### 6. Testing

- `test/chart.test.ts`: mỗi kind mới — validation (thiếu data → throw tiếng Việt),
  không ANSI, đúng shape (legend, cột, running total, trục).
- `test/chart-ui.test.tsx`: thêm một kind mới vào frame test (chart nguyên vẹn trong
  code block, không màu lạ).
- `test/skills.test.ts`: skill mới hiện trong catalog, `requires_tools` khớp.
- `bun run typecheck` + full test suite.

## Luồng dữ liệu

MCP (model fetch qua tool dữ liệu) → `chart_render kind=<mới>` → renderer (text thuần) →
TUI code block trong câu trả lời.

## Không làm

- Không thêm tool mới (giữ `chart_render` duy nhất cho kinds tĩnh).
- Không thêm dependency; không sửa TUI/registry (tool đã đăng ký).
- Không vẽ cung giả cho pie; bar tỷ lệ là trung thực nhất trong text.
