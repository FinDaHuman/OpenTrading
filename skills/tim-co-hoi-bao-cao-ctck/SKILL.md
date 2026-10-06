---
name: tim-co-hoi-bao-cao-ctck
description: "Săn cơ hội theo báo cáo phân tích CTCK: bảng rating + giá mục tiêu + upside % đã kiểm chứng giá hiện tại. Luôn dùng skill này khi user hỏi CTCK khuyên mua gì, target mới cho mã nào, hay báo cáo của CTCK nói gì — ví dụ 'CTCK gần đây khuyên mua gì', 'có target mới cho MSN không' — ngay cả khi user không nói rõ muốn 'tìm báo cáo CTCK'."
activation: auto
requires_tools: [mcp__opentrading__analyst_consensus]
tool_budget: 8
triggers:
  keywords: [ctck, khuyên mua, giá mục tiêu, target, báo cáo phân tích, khuyến nghị, rating]
version: 1.2.0
---

# Hunting Broker-Report Opportunities

Khuyến nghị CTCK là INPUT, không phải chân lý — bắt buộc kiểm chứng upside bằng giá hiện tại và kèm disclaimer. Không bao giờ suy diễn khuyến nghị thành "nên mua", không bịa giá mục tiêu khi feed không có.

## When to Use

- Dùng khi: hỏi rating/target/báo cáo CTCK theo feed chung hoặc theo mã cụ thể, cần bảng upside %.
- Khi KHÔNG dùng (dùng skill khác thay thế): rumor/crowd → `phan-tich-sentiment` / `tim-kiem-tin-tuc`; tự định giá → `dinh-gia-chuyen-sau`; backtest → `kiem-chien-luoc-backtest`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: feed chung (1 call duy nhất)
- [ ] Step 2: mã cụ thể + tài liệu gốc + đọc PDF
- [ ] Step 3: kiểm chứng upside 1-2 mã top
- [ ] Step 4: bảng + disclaimer
```

**Step 1: Feed chung (1 call duy nhất).**

Chạy `analyst_consensus` (limit=30) — feed chung không symbol, parse rating + giá mục tiêu từ titles. Báo cáo vĩ mô thì thêm `analyst_consensus` (report_type=macro): lọc báo cáo vĩ mô CTCK (entry section/report); không có dated reports thì dùng số liệu gốc. Feed rỗng thật (cuối tuần) → empty hợp lệ, nới `days` 1 lần duy nhất rồi kết luận.

**Step 2: Mã cụ thể + tài liệu gốc (tuần tự sau Step 1).**

Chạy `analyst_consensus` (symbol, limit=15) + `vs_documents` (symbol, chỉ lấy 1 mã đáng giá nhất) + `web_fetch` (format=pdf, URL báo cáo — đọc nội dung PDF stdlib-only, scan báo trung thực, cap 10 trang/20k ký tự). Hỏi mã cụ thể mà `analyst_consensus` (symbol) empty → đọc feed chung và lọc title chứa mã (title-scrape filter có thể sót), không retry đổi limit.

**Step 3: Kiểm chứng upside (tuần tự, 1–2 mã nổi bật nhất).**

Chạy `stock_overview` (1–2 call) so giá hiện tại vs mục tiêu → upside %. Chỉ kiểm chứng top, không kiểm chứng tất cả.

## Template

ALWAYS use this exact verdict structure:

- Bảng {mã · CTCK · rating · giá mục tiêu · ngày · upside % so giá hiện tại}, lọc trong `days` (default 7).
- Top 3 cơ hội (upside lớn + rating MUA + còn hiệu lực).
- Cột **"đã kiểm chứng"** bắt buộc = Step 3 chạy cho 1–2 mã nổi bật nhất (có `stock_overview`); mã chưa kiểm chứng ghi rõ "chưa kiểm chứng giá hiện tại".
- Disclaimer bắt buộc: khuyến nghị CTCK là INPUT, không phải chân lý — không suy diễn thành "nên mua".
- Provenance: nguồn ngày từ URL/title; nếu `source/date null` (đặc trưng parse titles) → suy ngày từ URL/title + ghi rõ nguồn ngày "không chắc chắn". Đủ bảng ≥5 dòng + kiểm chứng 2 mã top thì dừng, không đào thêm mã ngoài top.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: CTCK khuyên mua gì tuần này
Output: Feed chung **7 reports** — MBB MUA 28,200 · **MSN MUA 89,200 (30/09)** · VPB KHẢ QUAN 30,500 · MSB GIẢM TỶ TRỌNG 13,200 · FRT THEO DÕI 157,000 · filter symbol=VCB/FPT từng empty đúng hiện tượng → bảng ≥5 dòng có upside %, kiểm chứng 2 mã top, ≤8 calls. Thiếu cột "đã kiểm chứng" hoặc thiếu disclaimer thì chưa đạt; bịa target khi feed rỗng thì chưa đạt.
