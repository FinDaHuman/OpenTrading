# Chỉ báo ngành hoá chất & phân bón — cách đọc theo cửa sổ giá

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / `news_market` / `yf_commodities`, with the period
> stated. The rules on the price window and inventory at original cost live only in the "Trụ cột driver" section
> of SKILL.md — not repeated here.

## 1. Phân biệt nội địa và quốc tế

| Criterion | Domestic sales | Exports |
|---|---|---|
| Price tracks | The domestic price frame + domestic demand | International prices at the time of the deal |
| Deciding variable | Farm demand + crop prices | Supply shocks + export policy |
| Cycle | Slower, smoother | Fast and volatile |
| What to read | Domestic sales volume + domestic selling prices | Export share + international prices + inventory |

## 2. Nhóm giá và biên

| Indicator | Read from | How to read |
|---|---|---|
| Revenue | `financial_detail` | Separate price and volume if disclosures allow; growth from prices is less durable than growth from volume |
| Average selling price | Computed yourself (state it) or company disclosures | Compare with international/domestic prices to see whether the company captures the full window |
| Gross margin | `financial_detail` | Read **2 consecutive quarters**: one widened quarter may be low-cost inventory |
| Cost of goods | `financial_detail` | Where gas/raw-material costs sit; read with inventory |

## 3. Nhóm cửa sổ giá

| Indicator | Read from | How to read |
|---|---|---|
| Inventory | `financial_detail` | Read under the rule in the SKILL.md §Trụ cột driver (inventory at original cost decides how long margins stay supported): low-cost inventory keeps supporting margins; high-cost inventory compresses margins when prices fall |
| Gas/raw-material costs | `financial_detail` + `yf_commodities` | When they catch up with selling prices, the window closes |
| Period exports | Customs/industry bodies via `web_search`, with clear product group and period | Separate volume and value to tell price rises from demand rises; never take `vs_xnk_detail`'s by-country series as a product group |
| China's policy | `news_market` | A global supply variable; state the source and date |

## 4. Nhóm đối chiếu

| Source | What to read | How to use it |
|---|---|---|
| `news_market` | International/domestic fertiliser prices, export policy, supply status | State the price index and check date |
| `vs_categories` → `vs_indicator_data` | Look up the agricultural production category codes that really exist | Only for the domestic branch; without a series, use the statistics office's releases with a period |
| `planned_targets` | Output/revenue/profit plans | Expectation anchor |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |

## 5. Bẫy đọc thường gặp

- One quarter's profit jumping sharply: check inventory at original cost before extrapolating it into capability.
- International prices up but the company sells domestically: the domestic price frame caps the part
  it can raise — a different verdict from an exporter.
- China easing its policy: the whole group's price cycle is pulled down even if the company does not
  export to China.
