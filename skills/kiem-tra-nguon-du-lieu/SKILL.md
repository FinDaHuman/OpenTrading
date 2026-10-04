---
name: kiem-tra-nguon-du-lieu
description: Kiểm tra toàn bộ nguồn dữ liệu trong 1 lượt — bảng trạng thái từng upstream + khuyến nghị skill nào chạy được.
when_to_use: "Server còn sống không, Vietstock chết chưa, sáng nay data có đủ không, check nguồn trước phiên. Không dùng để phân tích thị trường."
activation: manual
requires_tools: [mcp__opentrading__doctor]
tool_budget: 12
triggers:
  keywords: [check nguồn, kiểm tra nguồn, server sống không, vietstock chết, data có đủ không, health check, nguồn dữ liệu]
version: 1.0.0
---

# Kiểm tra nguồn dữ liệu (1 lượt duy nhất)

Chạy định kỳ mỗi phiên hoặc khi skills khác báo unavailable hàng loạt.

## Workflow

| Wave | Tools | Nguồn kiểm tra |
|---|---|---|
| 0 | `doctor` | env keys + versions local |
| 1 (song song 5) | `source_status` · `vs_auth_status` | tổng quan upstream + hạn JWT |
| 2 (smoke mỗi upstream, song song 5) | `vn_quote_history`(VCB, days=5) · `vs_market_index` · `dnse_latest_trade`(VN30F1M) · `yf_market_pins` · `crypto_spot`(BTCUSDT) | vnstock · Vietstock · DNSE · yfinance · Binance |
| 3 (smoke tiếp, song song 4) | `news_market`(limit=1) · `fred_series`(DGS10, limit=1) · `world_prediction_odds`(limit=1) · `sbv_rates` | Fireant/GDELT · FRED · Gamma · SBV scrape |

## Verdict (bảng bắt buộc)

| Nguồn | Trạng thái | Độ trễ | Skills ảnh hưởng nếu chết |
|---|---|---|---|
| vnstock | ok/throttle/down | giây | kỹ thuật/cơ bản/so sánh/backtest... |
| Vietstock JWT | còn hạn tới.../HẾT | — | cơ bản/CTCK/macro (chuyển mirror/HAR) |
| Vietstock HAR-session | sống/chết | — | macro VN, CTKH |
| DNSE | ok/lạnh | — | intraday (WS trio cần worker) |
| yfinance/Binance/GDELT/Fireant/Gamma/FRED/SBV | ... | ... | ... |

+ 1 dòng khuyến nghị ("sáng nay đủ data chạy dossier/backtest/ky-thuat" hay "chỉ chạy legs không-Vietstock").

## Chống tràn lan

Smoke dùng limit/days NHỎ NHẤT (limit=1, days=5) — mục đích là ping, không lấy dữ liệu; không retry quá 1 lần/upstream.

## Lỗi thường gặp

Chính skill này cũng có thể partial (1–2 nguồn chết) — verdict vẫn ra đủ bảng, đánh dấu đỏ nguồn chết.
Tài khoản Vietstock login Google → password fallback bị từ chối ("đăng nhập bằng Google!") — phải re-login Google + export HAR/cookie mới (sự cố 02-10-2026).

## Bằng chứng live (02-10-2026)

Sự cố JWT hết hạn 19:15 → skill này bắt được ở wave 1 (`vs_auth_status` false) trước khi skills khác fail hàng loạt; HAR-session sống độc lập (macro vẫn available khi JWT chết).

## Nghiệm thu

Chạy 1 lượt → bảng đủ 9 nguồn + khuyến nghị, ≤12 calls, ≤3 phút.
