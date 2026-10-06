---
name: danh-gia-vi-mo-quoc-te
description: Đọc chu kỳ kinh tế Mỹ và chế độ rủi ro toàn cầu (soft/hard landing, đường cong lợi suất, RISK-ON/OFF, so VN-vs-global) trong tối đa 10 calls. Luôn dùng skill này khi user hỏi bối cảnh vĩ mô Mỹ/global, việc làm, GDP các nước, risk regime — ví dụ "kinh tế Mỹ soft landing không", "yield curve đảo chưa" — ngay cả khi user không nói rõ muốn "đánh giá vĩ mô".
activation: auto
requires_tools: [mcp__opentrading__fred_series]
tool_budget: 10
triggers:
  keywords: [kinh tế mỹ, recession, suy thoái, đường cong lợi suất, yield curve, risk-on, risk-off, fed bối cảnh, kinh tế toàn cầu]
version: 1.1.0
---

# Reading US and Global Macro Regime

Đi 3 wave tuần tự (mỗi wave song song bên trong): chu kỳ Mỹ → chế độ rủi ro → xác nhận toàn cầu. FRED gọi theo tên chuẩn; thiếu key thì chuyển nhánh không-FRED thay vì bỏ cả verdict.

## When to Use

- Dùng khi: user hỏi chu kỳ Mỹ (soft/hard landing), đường cong lợi suất, việc làm/GDP các nước, chế độ rủi ro toàn cầu, so sánh VN-vs-global.
- Khi KHÔNG dùng (dùng skill khác thay thế):
  - Vĩ mô VN chi tiết (GDP/CPI/XNK/SBV) → dùng `danh-gia-vi-mo-viet-nam`.
  - Xác suất Fed cắt/giữ/tăng thuần odds + lịch FOMC → dùng `du-doan-fed`.

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 1: chu kỳ Mỹ (FRED + curve, song song)
- [ ] Step 2: chế độ rủi ro (song song)
- [ ] Step 3: xác nhận toàn cầu (song song)
- [ ] Step 4: verdict 5 mục
```

**Step 1: Chu kỳ Mỹ (song song).**

Chạy `fred_series` (DGS10) + `fred_series` (CPIAUCSL) + `yf_yield_curve`. FRED thiếu key → trả unavailable → chuyển nhánh không-FRED (dùng `yf_yield_curve` + `yf_global_indices`) + ghi chú trung thực thiếu series nào. Curve flaky thì retry tối đa 1 lần sau backoff rồi bỏ.

**Step 2: Chế độ rủi ro (song song, tuần tự sau Step 1).**

Chạy `yf_regime_assets` + `assets_rotation` + `world_macro_country` (VN/CHINA theo câu hỏi). Nhóm `yf_*` tối đa 3 calls/wave; không gọi chồng chéo `yf_yield_curve` + `fred_series` quá 1 vòng. `world_macro_country` rỗng thì đổi mã nước 1 lần rồi chấp nhận "ít coverage".

**Step 3: Xác nhận toàn cầu (song song, tuần tự sau Step 2).**

Chạy `yf_global_indices` + `yf_commodities` + `world_fear_greed`. Đủ DGS10 + CPI + curve ở Step 1 mới sang Step 2; gọi ≥3 FRED series cùng lúc là dấu hiệu tràn lan → dừng.

## Template

ALWAYS use this exact verdict structure:

1. **Chu kỳ Mỹ:** soft/hard landing, dựa DGS10 + CPI + curve, đơn vị % lợi suất + % CPI + URL.
2. **Đường cong:** inverted hay không, chênh 10Y-2Y (đơn vị bps/%) + URL.
3. **Chế độ toàn cầu:** RISK-ON/OFF từ rotation/regime assets + URL.
4. **So VN-vs-global:** bắt buộc 1 dòng so sánh GDP VN (đơn vị % WorldBank) vs global + URL.
5. **Biến số theo dõi:** liệt kê CPI Mỹ, jobs, lợi suất cần watch tiếp theo.

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: Kinh tế Mỹ hiện tại
Output: US10Y 5.24% / 2Y 4.61%, không đảo chiều · WorldBank GDP VN 8.02% · fear/greed crypto 70-74 (tham lam) → verdict đủ 5 mục, curve + ≥2 series FRED có số.
