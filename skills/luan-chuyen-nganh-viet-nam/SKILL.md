---
name: luan-chuyen-nganh-viet-nam
description: Rotation ngành VN — ngành nào đang hút/ra tiền, leaders, cảnh báo supply.
when_to_use: "Ngành nào mạnh, rotation ngành, cổ phiếu ngành ngân hàng ra sao. Không dùng khi: phân bổ toàn cầu (luan-chuyen-tai-san-toan-cau), 1 mã (phan-tich-chuyen-sau-1-ma)."
activation: auto
requires_tools: [mcp__opentrading__sector_performance]
tool_budget: 10
triggers:
  keywords: [luân chuyển, rotation, ngành nào, ngành ngân hàng, ngành bất động sản, sector, dẫn dắt ngành]
version: 1.0.0
---

# Luân chuyển ngành Việt Nam

## Workflow

| Wave | Tools |
|---|---|
| 1 | `sector_performance`(level 1) · `vs_industry_heatmap` |
| 2 | `money_flow` · `futures_basis` · `vs_gics_index`(group của ngành nóng) |
| 3 | `compare_equities`(≤4 leaders ngành top) · `ipo_calendar_vn`(áp lực supply) |
| 4 (đào sâu) | `vs_industry_tree` → `stock_screener`(universe ngành, filters hẹp) |

## Verdict

Tên rotation ("ngân hàng → vật liệu") bằng số PerChange phiên + YTD · xác nhận dòng tiền
(NN, basis) · leaders so sánh · cảnh báo supply (IPO/thỏa thuận lớn).

## Chống tràn lan

- Top 2 ngành tăng + top 1 giảm, MỖI ngành 1 call `vs_gics_index`; `compare_equities` cap 4 — không liệt kê cả 11 ngành.

## Lỗi thường gặp

`ipo_calendar_vn` auctions rỗng = bình thường (HNX ít lịch) — ghi "không có đấu giá sắp tới",
đừng diễn giải thành tín hiệu.

## Bằng chứng live (02-10-2026)

Vật liệu **+1.12%** (YTD +8.9) hút tiền; Tài chính −0.8%, BĐS −1.33% bị bán; YTD leader
Năng lượng +48.2%, Dịch vụ truyền thông +39.8%; HPG 19,950 −0.50% vol 9.6tr.

## Nghiệm thu

"Ngành nào rotation" → tên rotation + ≥6 con số chứng minh, ≤10 calls.
