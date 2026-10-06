---
name: du-doan-fed
description: Đọc xác suất và kịch bản lãi suất Fed kỳ tới (cắt/giữ/tăng) kèm đường cong lợi suất, lịch FOMC và hàm ý cho VN. Luôn dùng skill này khi user hỏi Fed, FOMC, dot plot hay xác suất lãi suất Mỹ — ví dụ "Fed tháng tới cắt hay giữ", "dot plot mới nhất" — ngay cả khi user không nói rõ muốn "dự đoán Fed".
activation: auto
requires_tools: [mcp__opentrading__world_prediction_odds]
tool_budget: 8
triggers:
  keywords: [fed, fomc, cắt giảm lãi suất, dot plot, xác suất fed, lãi suất mỹ]
version: 1.1.0
---

# Reading the Next Fed Decision

Trả về đúng 5 mục: xác suất từng kịch bản → đường cong → lịch FOMC → biến số theo dõi → hàm ý VN. Chỉ drill 1 event Fed chính (slug mới nhất, đã sort vol24h) — không bắn 5 query biến thể.

## When to Use

- Dùng khi: user hỏi Fed kỳ tới (cắt/giữ/tăng), FOMC, dot plot, xác suất odds + đường cong + hàm ý VN.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Bối cảnh vĩ mô Mỹ chung (chu kỳ, việc làm, risk regime) không cần odds → dùng `danh-gia-vi-mo-quoc-te`.
  - Odds chủ đề ngoài Fed (bầu cử, BTC...) → dùng `du-doan-polymarket`.
  - Bản đồ rủi ro chính trị rộng → dùng `danh-gia-tinh-hinh-chinh-tri-toan-cau`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: odds Fed (1 call, lấy event top)
- [ ] Step 2: drill-down + macro (song song)
- [ ] Step 3: curve + xác minh nguồn chính thức
- [ ] Step 4: verdict 5 mục
```

**Step 1: Odds Fed (bắt buộc).**

Chạy `world_prediction_odds` (query=fed). Có prob ≥2 kịch bản + lịch họp là đủ verdict; Step 3 sau đó chỉ để xác minh.

**Step 2: Drill-down + macro (song song, tuần tự sau Step 1).**

Chạy `polymarket_event` (slug fed-decision-*) + `fred_series` (DGS10, thêm EFFR/DFII nếu cần). Không drill quá 1 slug Fed/run.

**Step 3: Curve + xác minh (song song, tuần tự sau Step 2).**

Chạy `yf_yield_curve` + `web_fetch` (chỉ statement/nguồn chính thức fed.gov trong odds).

**Step 4: Validate trước khi chốt.**

Odds stale (end-date qua) → lọc `end > today`, bỏ event hết hạn, retry 1 lần query fed mới. Gamma chết cả proxy + direct thì ghi rõ "không có odds", không thay bằng nhận định riêng. Curve flaky → retry tối đa 1 lần sau backoff rồi bỏ, ghi chú thiếu curve. `fred_series` tối đa 3 series ngoài Fed thì dừng.

## Template

ALWAYS use this exact verdict structure:

1. **Xác suất từng kịch bản:** cắt/giữ/tăng, mỗi kịch bản prob_pct (đơn vị %) + volume (USD) + end-date + URL event.
2. **Đường cong ám chỉ:** US10Y/2Y (đơn vị %) + inverted hay không + URL.
3. **Lịch FOMC kế tiếp:** ngày họp (đơn vị ngày/tháng) + nguồn fed.gov URL.
4. **Biến số theo dõi:** CPI Mỹ, jobs, đơn vị %/K jobs + URL.
5. **Hàm ý cho VN:** tỷ giá/lãi suất, 1–2 dòng + URL.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Fed tháng tới
Output: "Fed Decision in October 2026": Yes(no change) 74.5% / No 25.5%, volume24h 2.6M · curve US10Y 5.24% không đảo → prob ≥2 kịch bản + lịch họp + 1 dòng hàm ý VN.
