---
name: danh-gia-tinh-hinh-thi-truong
description: Đánh giá phiên/sức khỏe thị trường VN — xu hướng index, độ rộng, phái sinh, khối ngoại, nhóm dẫn dắt.
when_to_use: "Thị trường sao rồi, phiên sáng, độ rộng thị trường, basis VN30. Không dùng khi: hỏi 1 mã (phan-tich-chuyen-sau-1-ma), hỏi ngành (luan-chuyen-nganh-viet-nam), vĩ mô (danh-gia-vi-mo-viet-nam)."
activation: auto
requires_tools: [mcp__opentrading__market_overview]
tool_budget: 12
triggers:
  keywords: [thị trường, phiên hôm nay, độ rộng, breadth, vn-index, vn30, basis, market, khối ngoại phiên]
version: 1.0.0
---

# Đánh giá tình hình thị trường VN

## Workflow

| Wave | Tools |
|---|---|
| 0 | `source_status` |
| 1 | `brief_build` · `market_overview` · `breadth_scan` · `futures_basis` · `money_flow` |
| 2 | `market_movers` · `vs_market_info` · `market_snapshot` (VN30 default) |
| 3 (chỉ khi hỏi sâu) | `dnse_orderbook`(mã lớn) · `vn_trades`(băng) · `vs_selftrading`+`vs_nn_flow` (đào dòng tiền sau money_flow) |

## Verdict — báo cáo phiên 6 mục

Xu hướng index · độ rộng (adv/dec/trần/sàn) · phái sinh (basis ± bps) · khối ngoại
(mua/bán tỷ) · nhóm dẫn – dở · nhận định sức khỏe phiên (1 câu).

## Chống tràn lan

- `signals_scan` full HOSE ~40s — CHỈ khi user hỏi "momentum/breakout", cap `max_symbols=100`.
- Không gọi `dnse_foreign_flow` trực tiếp (unavailable ở remote không worker) — `money_flow` đã tự fallback `vs_nn_flow`.
- `market_overview` partial (session leg chết khi thiếu WS worker) → dùng 3 leg còn + ghi "session từ nguồn khác".

## Lỗi thường gặp

Ngoài giờ: board rows cũ là đúng (đọc as_of), không "làm mới" vô ích. Basis unavailable
(cả DNSE chết) → bỏ mục phái sinh, nói rõ.

## Bằng chứng live (02-10-2026)

Breadth 1 tăng/6 giảm (rổ bluechip) · VCB −0.35% · HPG −0.50% · basis +6.95 (+37bps) ·
NN bán ròng (mua 1,814 vs bán 2,268 tỷ).

## Nghiệm thu

"Thị trường hôm nay" → 6 mục verdict với ≥4 mục có số; ≤10 calls.
