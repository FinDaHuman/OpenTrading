---
name: tin-tuc-nong-quoc-te
description: Digest tin thế giới tác động thị trường (5 headline + market reaction xác nhận bằng số). Luôn dùng skill này khi user hỏi tin quốc tế/Mỹ/Trung hôm nay — ngay cả khi user không nói rõ muốn "digest tin nóng".
activation: auto
requires_tools: [mcp__opentrading__news_market]
tool_budget: 8
triggers:
  keywords: [tin quốc tế, tin thế giới, thị trường mỹ, fed tin, wall street, nasdaq]
version: 1.1.0
---

# Digesting Global Hot News With Market Reaction

Tin thế giới + market reaction xác nhận bằng SỐ — không đưa tin suông. Tin chưa có reaction thì bắt buộc ghi "thị trường chưa phản ánh", không bịa reaction. Tin đồn quốc tế bắt buộc nhãn `CHƯA XÁC NHẬN`.

## When to Use

- Dùng khi: tin quốc tế/Mỹ/Trung, Fed, Wall Street, cần headline + số liệu thị trường xác nhận.
- Khi KHÔNG dùng (dùng skill khác thay thế): tin VN → `tin-tuc-nong-viet-nam`; từ khóa riêng/rumor → `tim-kiem-tin-tuc` chế độ C; vĩ mô chuyên sâu (curve, flows, fear/greed riêng lẻ) → `danh-gia-vi-mo-quoc-te`; crypto → `nhip-dap-crypto`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: tin global (song song)
- [ ] Step 2: reaction bằng số (song song, sau Step 1)
- [ ] Step 3: xác minh 1 tin nổi bật nhất
- [ ] Step 4: verdict 5 headline + reaction
```

**Step 1: Tin global (song song).**

Chạy `news_market` (sources=gdelt) + `geo_intel` (không topic = global coverage). Không tự thêm topic hẹp nếu user hỏi chung. GDELT rỗng → thử từ khóa English 1 lần rồi kết luận "ít coverage".

**Step 2: Reaction bằng số (song song, tuần tự sau Step 1 để soi đúng tin).**

Chạy `yf_mega_flows` + `world_fear_greed`.

**Step 3: Xác minh 1 tin nổi bật nhất (tuần tự).**

Chạy `event_stats` cho đúng 1 từ khóa nổi bật nhất, không chạy cho mọi headline. Cả 2 nguồn news chết → đọc `snapshot_history` (kind=news_feed), bắt buộc ghi rõ "cache <ngày>". Feed rỗng cuối tuần → empty hợp lệ, ghi rõ phiên nghỉ.

## Template

ALWAYS use this exact verdict structure: 5 headline, mỗi tin gồm **tiêu đề + tuổi tin + provenance** (GDELT/`geo_intel`) + **market reaction bằng SỐ** (mega-cap flows, fear/greed, curve nếu liên quan rates).

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Tin thế giới
Output: mega_flows AAPL/MSFT/NVDA OK · fear/greed 70-74 Greed 7 ngày → ≥5 headline + ≥2 mục reaction định lượng, ≤8 calls. Thiếu reaction số mà không ghi "thị trường chưa phản ánh" → chưa đạt.
