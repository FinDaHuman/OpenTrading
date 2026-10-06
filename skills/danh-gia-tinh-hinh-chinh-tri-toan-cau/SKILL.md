---
name: danh-gia-tinh-hinh-chinh-tri-toan-cau
description: Vẽ bản đồ rủi ro chính trị toàn cầu (bầu cử, chính sách, căng thẳng quốc tế) 4-6 mục, mỗi mục có xác suất odds + tin GDELT xác nhận + URL. Luôn dùng skill này khi user hỏi rủi ro chính trị/bầu cử/chính sách ở quy mô nhiều nước — ngay cả khi user không nói rõ muốn "bản đồ rủi ro".
activation: auto
tool_budget: 8
triggers:
  keywords: [địa chính trị, bầu cử, chính trị, chính sách mỹ, căng thẳng quốc tế, rủi ro chính trị]
version: 1.1.0
---

# Mapping Global Political Risk

Skill tổ chức cross-ref (không có home tool riêng — ghép odds + tin từ nhiều nguồn). Mỗi mục verdict bắt buộc có event URL + tin URL, thiếu một trong hai thì ghi rõ.

## When to Use

- Dùng khi: user hỏi bản đồ rủi ro chính trị toàn cầu, bầu cử, chính sách, căng thẳng quốc tế (nhiều sự kiện, cần ghép odds + tin).
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Xung đột vũ trang cụ thể → dùng `danh-gia-tinh-hinh-xung-dot`.
  - Bất ổn 1 nước → dùng `bat-on-quoc-gia`.
  - Chỉ xin odds/bảng Polymarket thuần → dùng `du-doan-polymarket`.
  - Fed cắt/giữ thuần → dùng `du-doan-fed`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: odds + intel song song
- [ ] Step 2: drill-down event liên quan (tối đa 2 slugs)
- [ ] Step 3: xác minh tin (1-2 nguồn chính thức)
- [ ] Step 4: verdict 4-6 mục + provenance
```

**Step 1: Odds + intel (song song, bắt buộc).**

Chạy `world_prediction_odds` (tag=fed/politics/elections theo câu hỏi) + `geo_intel` (topic). Odds đã sort vol24h nên chỉ lấy top 5 — kéo cả 20 events là tràn lan.

**Step 2: Drill-down (song song, tuần tự sau Step 1).**

Chạy `polymarket_event` (slug top 1-2) + `event_stats` (query). Chỉ drill event thật sự liên quan câu hỏi, tối đa 2 slugs/run. Không gọi chồng chéo `geo_intel` + `event_stats` + `news_market` cùng query quá 1 vòng.

**Step 3: Xác minh tin (tuần tự sau Step 2).**

Chạy `news_market` (sources=gdelt) + `web_fetch` 1-2 URL nguồn chính thức trong tin. Đủ 4 mục có prob + tin xác nhận thì dừng.

**Step 4: Validate trước khi chốt.**

GDELT rate-limit → backoff 20s, retry tối đa 1 lần → vẫn lỗi thì ghi trung thực "thiếu tin GDELT, verdict chỉ dựa trên odds". Gamma chậm thì tool tự fallback direct, chờ 1 lần. Odds stale (end-date qua) → lọc `end > today`, loại event hết hạn. Hai đường chết hết thì ghi "không có odds", không bịa xác suất.

## Template

ALWAYS use this exact verdict structure:

1. **Sự kiện:** tên + bối cảnh 1 dòng.
2. **Xác suất:** prob_pct từng outcome (đơn vị %) + end-date.
3. **Độ tin odds:** volume 24h + liquidity (đơn vị USD; <50k thì cờ "odds kém tin").
4. **Tin GDELT xác nhận:** 1 dòng + URL.
5. **Market-impact nếu có:** kênh truyền dẫn + URL.
6. **Provenance:** mỗi mục bắt buộc event URL + tin URL.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Rủi ro chính trị toàn cầu
Output: Fed October 2026 "no change" 74.5% (volume 24h ~2.6M USD) · Brazil presidential event OK · mỗi mục đủ prob_pct + provenance event URL.
