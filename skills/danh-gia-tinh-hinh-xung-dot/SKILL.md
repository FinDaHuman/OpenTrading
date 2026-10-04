---
name: danh-gia-tinh-hinh-xung-dot
description: Đánh giá xung đột/chiến sự cụ thể — cường độ, giá đã phản ánh, kênh truyền dẫn, xác suất leo thang.
when_to_use: "Trung Đông, Biển Đông, chiến sự X ảnh hưởng gì thị trường. Không dùng khi: chính trị bầu cử (danh-gia-tinh-hinh-chinh-tri-toan-cau), bất ổn 1 nước (bat-on-quoc-gia), odds thuần (du-doan-polymarket)."
activation: auto
requires_tools: [mcp__opentrading__event_stats]
tool_budget: 9
triggers:
  keywords: [xung đột, chiến tranh, biển đông, trung đông, leo thang, dầu hay vàng lên, chiến sự]
version: 1.0.0
---

# Đánh giá tình hình xung đột

## Workflow

| Wave | Tools |
|---|---|
| 1 | `geo_intel`(topic xung đột) · `event_stats`(query) |
| 2 | `yf_commodities`(dầu + vàng) · `assets_rotation` |
| 3 | `world_prediction_odds`(từ khóa cuộc chiến) · `web_search`/`web_fetch` |

## Verdict — 5 mục

Cường độ (event counts GDELT trend) · giá đã phản ánh chưa (dầu/vàng move vs baseline) ·
kênh truyền dẫn (energy→inflation→rates) · xác suất leo thang (odds) · hàm ý vị thế
(đánh giá cushion/size trong danh-gia-truoc-bctc leg 6 trước khi hành động).

## Chống tràn lan

- 1 topic/call; từ khóa THỬ cả tiếng Việt lẫn Anh ("biển đông" → "south china sea") — tối đa 2 lần thử rồi chấp nhận "ít coverage".

## Lỗi thường gặp

GDELT rỗng với từ khóa VN → chuyển English query là ĐẶC TRƯNG data, không phải lỗi, ghi chú.

## Bằng chứng live (02-10-2026)

geo_intel("Vietnam") trả articles · event_stats("vietnam") articles >0 · gold 4,195 USD/oz cùng phiên.

## Nghiệm thu

"Xung đột X ảnh hưởng gì" → 5 mục verdict, có số dầu/vàng phiên gần nhất.

## Ghi chú review

ỔN, giữ nguyên. Hàm ý vị thế final: đánh giá cushion/size trong danh-gia-truoc-bctc leg 6 trước khi hành động.
