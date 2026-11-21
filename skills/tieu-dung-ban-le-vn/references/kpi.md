# Chỉ báo ngành tiêu dùng & bán lẻ — cách đọc sức mua thật

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / `vs_indicator_data`, with the period stated. The rule on
> separating nominal from real lives only in the SKILL.md §Trụ cột driver — not repeated
> here.

## 1. Phân khúc

| Segment | Cycle it tracks | Reading notes |
|---|---|---|
| Food – staples | Income + market prices | A smooth cycle; margins depend on food raw-material prices |
| Consumer electronics retail | The device replacement cycle | Its own cycle — **never** use the food drivers |
| Consumer services (food service, travel) | Income + tourism | Seasonal growth; read with tourism in `vs_indicator_data` |

## 2. Nhóm sức mua

| Indicator | Read from | How to read |
|---|---|---|
| Nominal total retail sales | `vs_indicator_data(category_id from vs_categories)` | Only a starting point — conclude nothing yet. No preset; look up the category first |
| Consumer price index | `vs_indicator_data(indicator="CPI")` | The denominator for real growth — CPI has a preset |
| Core price index | `vs_indicator_data(category_id from vs_categories)` | Core above target = pressure on purchasing power — no preset |
| Real retail sales | Computed with `shell` (one arithmetic-only command on figures from tool results): nominal growth adjusted for CPI; show the formula, label it "tính từ" | Negative real growth = the nominal growth came from prices |

## 3. Nhóm chất lượng tăng trưởng

| Indicator | Read from | How to read |
|---|---|---|
| Revenue | `financial_detail` | Read with store count and margins, not alone |
| Same-store growth | Computed with `shell` (one arithmetic-only command on figures from tool results), only if disclosures give the figures; label it "tính từ" | Weighs more than growth from new stores when judging market share |
| Gross margin | `financial_detail` | Falling for 2 consecutive quarters alongside strong growth = a sign of buying growth with promotions |
| Inventory | `financial_detail` | Inventory growing faster than revenue = selling slower than expected |
| Receivables | `financial_detail` | Customer receivables growing fast = selling on credit, especially in traditional channels |

## 4. Nhóm đối chiếu bên ngoài

| Source | What to read | How to use it |
|---|---|---|
| `news_market` | Tax policy and effective dates, income/wages; for each company's store openings/closures and market share use `news_symbol`/`company_events` or `web_search` on company sources | State the text + date |
| `vs_indicator_data` | Income, consumption, inflation | Real purchasing power; read both nominal and real |
| `planned_targets` | Revenue/profit/store-opening plans | Expectation anchor |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |

## 5. Bẫy đọc thường gặp

- Reporting "double-digit retail growth" without asking about inflation: that is price
  growth, not purchasing power.
- Fast store openings while same-store sales stall: growth comes from expansion and reverses easily
  when expansion slows.
- One quarter of lower margins after a big promotion: read 2 consecutive quarters before concluding margins are squeezed.
