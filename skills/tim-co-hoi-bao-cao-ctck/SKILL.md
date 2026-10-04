---
name: tim-co-hoi-bao-cao-ctck
description: Săn cơ hội theo BÁO CÁO PHÂN TÍCH CTCK — rating, giá mục tiêu, upside % đã kiểm chứng.
when_to_use: "CTCK gần đây khuyên mua gì, có target mới cho MSN không, báo cáo VPS/SSI nói gì về HPG. Không dùng khi: tin đồn/crowd (phan-tich-sentiment / tim-kiem-tin-tuc), tự định giá (dinh-gia-chuyen-sau)."
activation: auto
requires_tools: [mcp__opentrading__analyst_consensus]
tool_budget: 8
triggers:
  keywords: [ctck, khuyên mua, giá mục tiêu, target, báo cáo phân tích, khuyến nghị, rating]
version: 1.1.0
---

# Tìm cơ hội từ báo cáo CTCK

## Workflow

| Wave | Tools | Ghi chú |
|---|---|---|
| 1 | `analyst_consensus`(limit=30) | **feed chung không symbol** — parse rating + giá mục tiêu từ titles |
| 1b (báo cáo vĩ mô) | `analyst_consensus`(report_type=macro) | lọc báo cáo vĩ mô CTCK (entry section/report); không có dated reports thì dùng số liệu gốc |
| 2 (mã cụ thể) | `analyst_consensus`(symbol, limit=15) · `vs_documents`(symbol) · `web_fetch`(format=pdf, URL báo cáo) | report cho mã + tài liệu gốc + **đọc nội dung PDF** (stdlib-only, scan báo trung thực; cap 10 trang/20k ký tự) |
| 3 (xác nhận) | `stock_overview`(mã target) 1-2 call | so giá hiện tại vs mục tiêu → upside % |

## Verdict

Bảng {mã · CTCK · rating · giá mục tiêu · ngày · upside % so giá hiện tại} lọc trong `days`
(default 7); top 3 cơ hội (upside lớn + rating MUA + còn hiệu lực); **cột "đã kiểm chứng"**
= leg 3 chạy cho 1-2 mã nổi bật nhất, không kiểm chứng tất cả. Disclaimer: khuyến nghị CTCK
là INPUT, không phải chân lý — không suy diễn thành "nên mua".

## Chống tràn lan

- Feed chung 1 call (symbol-less feed CÓ dữ liệu).
- Hỏi "HPG" mà `analyst_consensus(symbol=HPG)` empty → đọc feed chung và lọc title chứa HPG
  (title-scrape filter có thể sót), không retry đổi limit.
- `vs_documents` chỉ lấy 1 mã đáng giá nhất.

## Lỗi thường gặp

`source/date null` trong reports (đặc trưng parse titles) → suy ngày từ URL/title, ghi chú
nguồn ngày "không chắc chắn". Feed rỗng thật (cuối tuần) → empty hợp lệ, nới days 1 lần.

## Bằng chứng live (02-10-2026)

Feed chung **7 reports** — MBB MUA 28,200 · **MSN MUA 89,200 (30/09)** · VPB KHẢ QUAN
30,500 · MSB GIẢM TỶ TRỌNG 13,200 · FRT THEO DÕI 157,000 · filter symbol=VCB/FPT từng empty đúng hiện tượng.

## Nghiệm thu

"CTCK khuyên mua gì tuần này" → bảng ≥5 dòng có upside %, kiểm chứng 2 mã top, ≤8 calls.
