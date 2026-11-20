---
name: kiem-tra-nguon-du-lieu
description: "Scans the MCP server's data sources in one pass and says which skills can run. Use when asked whether sources are up or many tools report unavailable."
match_text: "Quét tình trạng các nguồn dữ liệu của server MCP trong một lượt và nói skill nào chạy được. Dùng khi hỏi nguồn còn sống không hoặc nhiều tool báo unavailable."
activation: manual
requires_tools: [mcp__opentrading__doctor]
triggers:
  keywords: [check nguồn, kiểm tra nguồn, server sống không, vietstock chết, data có đủ không, health check, nguồn dữ liệu]
version: 1.3.0
---

# Kiểm tra nguồn dữ liệu

Return a status table of the 9 sources + 1 line recommending which skills can run. The smoke tests here are pings (smallest limit/days), not real data pulls. This skill does no market analysis.

## Khi nào dùng

- Use when: the user asks whether the server is up, whether Vietstock is down, whether there is enough data this morning, a source check before the session, or when other skills report unavailable in bulk.
- Do NOT use (use another skill instead): ticker/market analysis (use `phan-tich-chuyen-sau-1-ma`, `ky-thuat-chuyen-sau`).

## Các bước

**Bước 0: Doctor.**

Run `doctor` (local env keys + versions).

**Bước 1: Overview (in parallel).**

Run `source_status` + `vs_auth_status`: upstream overview + JWT expiry.

**Bước 2: Smoke each upstream (in parallel, smallest limit/days).**

`vn_quote_history` (VCB, days=5) · `vs_market_index` · `dnse_latest_trade` (VN30F1M) · `yf_market_pins` · `crypto_spot` (BTCUSDT), then `news_market` (limit=1) · `fred_series` (DGS10, limit=1) · `world_prediction_odds` (limit=1) · `sbv_rates`. At most 1 retry per upstream. For a Vietstock account that logs in with Google, the password fallback is refused ("đăng nhập bằng Google!") — a new Google login + HAR/cookie export is needed.

**Bước 3: Validate before concluding.**

This skill itself may be partial (1–2 sources down) — the verdict still gives the full table, marking dead sources in red.

## Cấu trúc câu trả lời

Present the conclusion in exactly this structure: a table {Nguồn · Trạng thái · Độ trễ · Skill nào ảnh hưởng nếu nguồn đó chết} covering all 9 sources: vnstock · Vietstock · DNSE · yfinance · Binance · GDELT · Fireant · Gamma · FRED + 1 recommendation line ("sáng nay đủ data chạy ..." or "chỉ chạy được phần không dùng Vietstock").

Write statuses in words the user understands: "còn dùng được, dữ liệu mới nhất đến 12/10 14:02", "đang chậm, giới hạn số lượt gọi", "hết phiên đăng nhập". Never describe internals (JWT, HAR login sessions, cache TTL, infrastructure): asked "nguồn nào chậm", answer about the data, not the infrastructure.

## Ví dụ

**Ví dụ 1:**
Hỏi: check nguồn trước phiên
Đạt khi: a table of all 9 sources + a recommendation, ≤12 calls, ≤3 minutes.
