---
name: kiem-tra-nguon-du-lieu
description: Quét sức khỏe toàn bộ upstream trong 1 lượt (bảng trạng thái từng nguồn + khuyến nghị skill nào chạy được). Luôn dùng skill này khi user hỏi nguồn sống không, check trước phiên, hoặc khi các skill khác báo unavailable hàng loạt — ví dụ "Vietstock chết chưa", "sáng nay data có đủ không" — ngay cả khi user không nói rõ muốn "check nguồn".
activation: manual
requires_tools: [mcp__opentrading__doctor]
tool_budget: 12
triggers:
  keywords: [check nguồn, kiểm tra nguồn, server sống không, vietstock chết, data có đủ không, health check, nguồn dữ liệu]
version: 1.1.0
---

# Checking Data-Source Health

Trả về bảng trạng thái 9 nguồn + 1 dòng khuyến nghị skill nào chạy được. Smoke ở đây là ping (limit/days nhỏ nhất), không lấy dữ liệu thật. Skill này không phân tích thị trường.

## When to Use

- Dùng khi: user hỏi server còn sống không, Vietstock chết chưa, sáng nay có đủ data không, check nguồn trước phiên, hoặc khi các skill khác báo unavailable hàng loạt.
- Khi KHÔNG dùng (dùng skill khác thay thế): phân tích mã/thị trường (dùng `phan-tich-chuyen-sau-1-ma`, `ky-thuat-chuyen-sau`).

## Workflow

Copy checklist và tick theo tiến độ:

```
Task Progress:
- [ ] Step 0: doctor local
- [ ] Step 1: tổng quan upstream + JWT (song song)
- [ ] Step 2: smoke từng upstream (limit/days nhỏ nhất)
- [ ] Step 3: bảng verdict + khuyến nghị
```

**Step 0: Doctor.**

Chạy `doctor` (env keys + versions local).

**Step 1: Tổng quan (song song).**

Chạy `source_status` + `vs_auth_status`: tổng quan upstream + hạn JWT.

**Step 2: Smoke từng upstream (song song, limit/days nhỏ nhất).**

`vn_quote_history` (VCB, days=5) · `vs_market_index` · `dnse_latest_trade` (VN30F1M) · `yf_market_pins` · `crypto_spot` (BTCUSDT), rồi `news_market` (limit=1) · `fred_series` (DGS10, limit=1) · `world_prediction_odds` (limit=1) · `sbv_rates`. Retry tối đa 1 lần/upstream. Tài khoản Vietstock login Google thì password fallback bị từ chối ("đăng nhập bằng Google!") — phải re-login Google + export HAR/cookie mới.

**Step 3: Validate trước khi chốt.**

Chính skill này cũng có thể partial (1–2 nguồn chết) — verdict vẫn ra đủ bảng, đánh dấu đỏ nguồn chết.

## Template

ALWAYS use this exact verdict structure — bảng {Nguồn · Trạng thái · Độ trễ · Skills ảnh hưởng nếu chết} cho đủ 9 nguồn: vnstock (ok/throttle/down) · Vietstock JWT (còn hạn tới.../HẾT) · Vietstock HAR-session (sống/chết) · DNSE (ok/lạnh) · yfinance/Binance/GDELT/Fireant/Gamma/FRED/SBV + 1 dòng khuyến nghị ("sáng nay đủ data chạy ..." hay "chỉ chạy legs không-Vietstock").

## Examples

**Example 1 (live 02-10-2026, không bịa số mới):**
Input: check nguồn trước phiên
Output: sự cố JWT hết hạn 19:15 bắt được ở Step 1 (`vs_auth_status` false) trước khi skills khác fail hàng loạt; HAR-session sống độc lập (macro vẫn available khi JWT chết) → bảng đủ 9 nguồn + khuyến nghị, ≤12 calls, ≤3 phút.
