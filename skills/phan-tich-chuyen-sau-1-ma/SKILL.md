---
name: phan-tich-chuyen-sau-1-ma
description: Phân tích TOÀN DIỆN một mã cụ thể theo 8 bước (mã → ngành → kỹ thuật → định giá → lợi nhuận quý → tin → sự kiện → tổng hợp tích cực/tiêu cực/động lực).
when_to_use: "Người dùng yêu cầu phân tích toàn diện một mã (phân tích FPT, VCB thế nào). Không dùng khi: user chỉ hỏi 1 chiều (RSI → ky-thuat-chuyen-sau; BCTC → co-ban-chuyen-sau; fair value → dinh-gia-chuyen-sau)."
activation: auto
requires_tools: [mcp__opentrading__stock_overview]
tool_budget: 8
triggers:
  keywords: [phân tích, phân tích cổ phiếu, phân tích mã, toàn diện, chi tiết mã, mã này sao]
version: 1.1.0
---

# Phân tích chuyên sâu 1 mã

Skill điều phối: tự làm nhận diện + ngành + tin + sự kiện, dispatch kỹ thuật/định giá
sang sub-skills rồi gộp verdict. CẤM gọi trực tiếp `signals_technical`/`financial_detail`/
`valuation_run`/`stock_forensic`… — ai cần chiều nào kích sub-skill chiều đó.

## Workflow

| Bước | Việc | Tools |
|---|---|---|
| 1. Xác định mã | Chuẩn hóa mã CK (VCB, BID...). Mã nhập nhằng (vàng/BTC/USD) → `symbol_resolve` trước | `symbol_lookup` (tên Cty) · `symbol_resolve` (mã đa loại, có fallback xếp hạng) |
| 2. Ngành + kiếm tiền nhờ đâu | Ngành (GICS), mô hình kinh doanh, nguồn thu chính | `vn_company` · `vs_company_info` · `vs_industry_tree` |
| 3. Trạng thái kỹ thuật | Dispatch S22 | reuse `ky-thuat-chuyen-sau` |
| 4. Định giá | Dispatch S24 | reuse `dinh-gia-chuyen-sau` |
| 5. Lợi nhuận các quý gần đây | KQKD 4 quý + so QoQ/YoY, biên | `financial_detail` (cross-ref S23, chỉ lấy số nhanh) |
| 6. Tin tức doanh nghiệp | Tin + công bố | `news_symbol` (cross-ref S26) · `company_events` |
| 7. Sự kiện tương lai | Lịch 30–90 ngày (BCTC/ĐHĐCĐ/cổ tức) | `event_calendar_vn` |
| 8. Tổng hợp | **Điểm tích cực + tiêu cực + động lực tương lai của mã** | `evidence_bundle` (khóa verdict) |

## Verdict

1 câu nhận định · ngành + cách kiếm tiền (2 dòng) · kỹ thuật (từ S22) · định giá (từ S24) ·
lợi nhuận quý (số + trend) · tin + sự kiện sắp tới · **bảng Tích cực / Tiêu cực / Động lực tương lai**.

## Chống tràn lan

- Budget 8 chỉ đếm tool nhà của skill; tool của sub-skill nằm trong budget sub-skill.
- User hỏi 1 chiều ("RSI FPT") → trả lời bằng sub-skill tương ứng, không chạy skill này.

## Lỗi thường gặp

Sub-skill chết 1 chân → vẫn ra verdict với leg còn sống + ghi leg thiếu, không bù số.
Mã mới chưa phân loại ngành → ghi "chưa phân loại", vẫn chạy các bước còn.

## Nghiệm thu

"Phân tích FPT" → đủ 8 bước, bảng 3 cột tích cực/tiêu cực/động lực, ≤8 calls nhà.
