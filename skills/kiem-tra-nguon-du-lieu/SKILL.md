---
name: kiem-tra-nguon-du-lieu
description: Sweep the health of all upstreams in one pass (status table per source + recommendation of which skills can run). Always use this skill when the user asks whether sources are alive, wants a pre-session check, or when other skills report mass unavailability — e.g. "Vietstock chết chưa", "sáng nay data có đủ không" — even when the user doesn't explicitly say they want a "check nguồn" (source check).
activation: manual
requires_tools: [mcp__opentrading__doctor]
tool_budget: 12
triggers:
  keywords: [check nguồn, kiểm tra nguồn, server sống không, vietstock chết, data có đủ không, health check, nguồn dữ liệu]
version: 1.2.0
---

# Checking Data-Source Health

Return a status table for 9 sources + 1 recommendation line on which skills can run. Smoke here means ping (smallest limit/days), not real data pulls. This skill does no market analysis. Verdict labels, units and output formatting stay in Vietnamese (user-visible); answer in the user's language (Vietnamese by default).

## When to Use

- Use when: the user asks whether the server is alive, whether Vietstock is down, whether there is enough data this morning, wants a pre-session source check, or when other skills report mass unavailability.
- When NOT to use (use another skill instead): stock/market analysis (use `phan-tich-chuyen-sau-1-ma`, `ky-thuat-chuyen-sau`).

## Workflow

Copy the checklist and tick off as you progress:

```
Task Progress:
- [ ] Step 0: doctor local
- [ ] Step 1: upstream overview + JWT (parallel)
- [ ] Step 2: smoke each upstream (smallest limit/days)
- [ ] Step 3: verdict table + recommendation
```

**Step 0: Doctor.**

Run `doctor` (env keys + local versions).

**Step 1: Overview (parallel).**

Run `source_status` + `vs_auth_status`: upstream overview + JWT expiry.

**Step 2: Smoke each upstream (parallel, smallest limit/days).**

`vn_quote_history` (VCB, days=5) · `vs_market_index` · `dnse_latest_trade` (VN30F1M) · `yf_market_pins` · `crypto_spot` (BTCUSDT), then `news_market` (limit=1) · `fred_series` (DGS10, limit=1) · `world_prediction_odds` (limit=1) · `sbv_rates`. Retry at most once per upstream. For Vietstock accounts logged in via Google, the password fallback is rejected ("đăng nhập bằng Google!") — must re-login via Google + export a fresh HAR/cookie.

**Step 3: Validate before finalizing.**

This skill itself can be partial (1–2 sources down) — still produce the full table, mark dead sources in red.

## Template

ALWAYS use this exact verdict structure — table {Nguồn · Trạng thái · Độ trễ · Skills ảnh hưởng nếu chết} covering all 9 sources: vnstock (ok/throttle/down) · Vietstock JWT (còn hạn tới.../HẾT) · Vietstock HAR-session (sống/chết) · DNSE (ok/lạnh) · yfinance/Binance/GDELT/Fireant/Gamma/FRED/SBV + 1 recommendation line ("sáng nay đủ data chạy ..." or "chỉ chạy legs không-Vietstock").

## Examples

**Example 1 (live 02-10-2026, no fabricated numbers):**
Input: check nguồn trước phiên
Output: JWT expiry incident at 19:15 caught in Step 1 (`vs_auth_status` false) before other skills fail en masse; HAR-session alive independently (macro still available while JWT is dead) → full 9-source table + recommendation, ≤12 calls, ≤3 minutes.
