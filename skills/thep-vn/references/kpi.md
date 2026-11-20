# Chỉ báo ngành thép — dòng báo cáo và cách đọc

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / mill, exchange or industry-body releases, with the period
> stated. The rule on reading the spread with the inventory lag lives only in the SKILL.md §Trụ cột driver —
> not repeated here.

## 1. Nhóm đầu ra

| Indicator | Read from | How to read |
|---|---|---|
| Revenue | `financial_detail` | Separate the price and volume contributions if disclosures allow; the same revenue can come from higher prices or higher volume |
| Cost of goods sold | `financial_detail` | Where raw-material prices sit. Growing faster than revenue = margins compressing |
| Gross margin | `financial_detail` (or computed with `shell`, stated) | Read over consecutive quarters; one compressed quarter may be inventory timing, not deterioration |
| Financial costs carrying inventory | `financial_detail` | Large inventory + high rates = heavy carrying costs, especially for imported raw materials |

## 2. Nhóm đầu vào

| Indicator | Read from | How to read |
|---|---|---|
| Iron ore price | `web_search` (published sources with date, unit, grade) | An international reference price by cycle — state the period and that it is a reference, not a contract price |
| Coking coal price | `web_search` (published sources with date, unit, grade) | More volatile than ore; often the main margin squeeze within half a year |
| International reference steel price | `web_search` (dated exchange/mill releases) | For internationally traded products; it does **not** replace domestic selling prices |

## 3. Nhóm khối lượng và công suất

| Indicator | Read from | How to read |
|---|---|---|
| Sales volume by group | `news_market` / mill reports | Separate domestic products from internationally traded ones — two price logics |
| Capacity utilisation | `news_market` / mill reports | A new mill below capacity has low margins even with high revenue |
| Raw-material inventory | `financial_detail` | Decides the cost lag: while high-priced inventory is unused, margins stay compressed |

## 4. Nhóm thương mại

| Source | What to read | When |
|---|---|---|
| `news_market` | Trade-defence texts (duties, scope, terms), imports, groundbreakings/new projects | Whenever concluding on selling prices or market share |
| `web_search` | Steel-group exports/imports from Customs/industry bodies, with a clear period and unit | To measure export share by product group; never use `vs_xnk_detail`'s by-country series as a product group |
| `planned_targets` | Revenue/profit/output plans | The company's expectation anchor |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |

## 5. Bẫy đọc thường gặp

- Revenue up but profit down: check the spread before concluding "quản trị kém".
- International finished-product prices rising while domestic selling prices fall: that signals
  weakening trade defence, not an opportunity.
- One quarter's margin rebounding strongly: check whether it is cheap inventory being used before
  extrapolating it into a trend.
