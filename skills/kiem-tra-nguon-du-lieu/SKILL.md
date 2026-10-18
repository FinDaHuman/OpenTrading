---
name: kiem-tra-nguon-du-lieu
description: "Quét tình trạng các nguồn dữ liệu của server MCP trong một lượt và nói skill nào chạy được. Dùng khi hỏi nguồn còn sống không hoặc nhiều tool báo unavailable."
activation: manual
requires_tools: [mcp__opentrading__doctor]
triggers:
  keywords: [check nguồn, kiểm tra nguồn, server sống không, vietstock chết, data có đủ không, health check, nguồn dữ liệu]
version: 1.3.0
---

# Kiểm tra nguồn dữ liệu

Trả về bảng trạng thái 9 nguồn + 1 dòng khuyến nghị skill nào chạy được. Smoke ở đây là ping (limit/days nhỏ nhất), không lấy dữ liệu thật. Skill này không phân tích thị trường.

## Khi nào dùng

- Dùng khi: user hỏi server còn sống không, Vietstock chết chưa, sáng nay có đủ data không, check nguồn trước phiên, hoặc khi các skill khác báo unavailable hàng loạt.
- Khi KHÔNG dùng (dùng skill khác thay thế): phân tích mã/thị trường (dùng `phan-tich-chuyen-sau-1-ma`, `ky-thuat-chuyen-sau`).

## Các bước

**Bước 0: Doctor.**

Chạy `doctor` (env keys + versions local).

**Bước 1: Tổng quan (song song).**

Chạy `source_status` + `vs_auth_status`: tổng quan upstream + hạn JWT.

**Bước 2: Smoke từng upstream (song song, limit/days nhỏ nhất).**

`vn_quote_history` (VCB, days=5) · `vs_market_index` · `dnse_latest_trade` (VN30F1M) · `yf_market_pins` · `crypto_spot` (BTCUSDT), rồi `news_market` (limit=1) · `fred_series` (DGS10, limit=1) · `world_prediction_odds` (limit=1) · `sbv_rates`. Retry tối đa 1 lần/upstream. Tài khoản Vietstock login Google thì password fallback bị từ chối ("đăng nhập bằng Google!") — phải re-login Google + export HAR/cookie mới.

**Bước 3: Validate trước khi chốt.**

Chính skill này cũng có thể partial (1–2 nguồn chết) — verdict vẫn ra đủ bảng, đánh dấu đỏ nguồn chết.

## Cấu trúc câu trả lời

Trình bày kết luận đúng cấu trúc sau: bảng {Nguồn · Trạng thái · Độ trễ · Skill nào ảnh hưởng nếu nguồn đó chết} cho đủ 9 nguồn: vnstock · Vietstock · DNSE · yfinance · Binance · GDELT · Fireant · Gamma · FRED + 1 dòng khuyến nghị ("sáng nay đủ data chạy ..." hay "chỉ chạy được phần không dùng Vietstock").

Trạng thái viết bằng lời của người dùng hiểu được: "còn dùng được, dữ liệu mới nhất đến 12/10 14:02", "đang chậm, giới hạn số lượt gọi", "hết phiên đăng nhập". Không nói cơ chế bên trong (JWT, phiên đăng nhập HAR, TTL đệm, hạ tầng): hỏi "nguồn nào chậm" thì trả lời về dữ liệu, không về hạ tầng.

## Ví dụ

**Ví dụ 1:**
Hỏi: check nguồn trước phiên
Đạt khi: bảng đủ 9 nguồn + khuyến nghị, ≤12 calls, ≤3 phút.
