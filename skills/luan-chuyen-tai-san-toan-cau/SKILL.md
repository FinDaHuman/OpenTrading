---
name: luan-chuyen-tai-san-toan-cau
description: Phân bổ tài sản toàn cầu — xếp hạng momentum, regime RISK-ON/OFF, khung allocation.
when_to_use: "Allocation, rủi ro hay trú ẩn, asset nào mạnh, regime. Không dùng khi: ngành VN (luan-chuyen-nganh-viet-nam), crypto riêng (nhip-dap-crypto)."
activation: auto
requires_tools: [mcp__opentrading__assets_rotation]
tool_budget: 10
triggers:
  keywords: [phân bổ tài sản, allocation, regime, risk off, risk on, vàng hay cổ phiếu, phân bổ danh mục toàn cầu]
version: 1.0.0
---

# Luân chuyển tài sản toàn cầu

## Workflow

| Wave | Tools |
|---|---|
| 1 | `assets_rotation` · `yf_oracle_markets` |
| 2 | `yf_global_indices` · `yf_commodities` · `crypto_derivs`(funding = risk appetite) |
| 3 | `yf_alloc_history`(2-3 asset xếp hạng cao/thấp) · `compare_assets` · `yf_market_pins` |

## Verdict

Xếp hạng 1y momentum các nhóm (kết luận RISK-ON/OFF 1 câu) · đường allocation history của
3 asset trọng yếu · dòng mega-cap + funding xác nhận · đề xuất khung phân bổ (KHÔNG số dư
tài khoản cá nhân — disclaimer).

## Chống tràn lan

- `yf_alloc_history` 1 asset/call → cap 3 asset, chọn theo verdict wave 1.

## Lỗi thường gặp

yfinance flaky (curve từng fail→hồi) → retry 1 lần/wave rồi degrade. DNSE/Binance geo-block
(SG worker) — funding có thể rỗng → ghi chú, dùng fear/greed bù.

## Bằng chứng live (02-10-2026)

S&P 7,651 (1y +14.4%), VIX 16.3 · vàng 4,195 · BTC 83,476 (+0.33%) funding 2.8e-05 ·
oracle BTC +7.8%/30d, ETH +11% · rotation: Neutral/mixed.

## Nghiệm thu

"Phân bổ tài sản toàn cầu" → bảng xếp hạng + kết luận RISK + 3 asset path.
