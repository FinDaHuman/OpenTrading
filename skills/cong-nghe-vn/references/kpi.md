# Chỉ báo ngành công nghệ — đơn ký, backlog và chất lượng nhân công

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / `news_market`, with the period stated. The rule on signed orders
> leading revenue lives only in the SKILL.md §Trụ cột driver — not repeated here.

## 1. Nhóm đơn hàng

| Indicator | Read from | How to read |
|---|---|---|
| Signed revenue | Company disclosures (`news_symbol`/`company_events`) | A **leading** signal; a strong signing period does not reach revenue at once. State the signing period |
| Contract duration | Company disclosures | 2–3-year contracts give more durable revenue than short-term orders |
| Share of large orders | Company disclosures | Large orders create unusual profit: mark them as one-off; never extrapolate |
| Backlog | Company disclosures | The stock of signed, undelivered work; falling = it is being used up |
| Unearned revenue | `financial_detail` (`CDKT`) | Only what clients prepaid: never read it as the whole backlog |

## 2. Nhóm mảng

| Indicator | Read from | How to read |
|---|---|---|
| Foreign revenue | `financial_detail` / company disclosures | The international client cycle; FX-sensitive |
| Domestic revenue | `financial_detail` / company disclosures | Depends on e-government and public budgets |
| Own-product revenue | `financial_detail` | Higher-margin than services; read product revenue expectations |

## 3. Nhóm chất lượng vận hành

| Indicator | Read from | How to read |
|---|---|---|
| Revenue per employee | Computed with `shell` (one arithmetic-only command on figures from tool results): revenue / average headcount; label it "tính từ" | Rising while revenue rises = efficiency improving |
| Headcount | `financial_detail` / company disclosures | Growing faster than revenue = expanding by headcount |
| Gross margin | `financial_detail` | Falling for 2 consecutive quarters during expansion = labour costs squeezing margins |
| Pre-tax margin | `financial_detail` | Read with the segment split: domestic and foreign margins differ |
| Trade receivables | `financial_detail` (`CDKT`) | Growing faster than revenue = clients paying late, often in the domestic segment |
| Capital spending, depreciation | `financial_detail` (`LCTT`) | Telecom, data centres: spending runs ahead of revenue |

## 4. Nhóm đối chiếu

| Source | What to read | How to use it |
|---|---|---|
| `news_symbol` / `company_events` | Signed-order disclosures and client markets; `news_market` only for policy/context | A leading signal; state the source + date |
| `planned_targets` | Revenue/profit plans | Expectation anchor |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |
| `yf_commodities` | The metals cycle (cost context) | Only when considering infrastructure/components |

## 5. Bẫy đọc thường gặp

- Recognised revenue stalling while signings are strong: read the backlog; do not conclude a stall.
- One quarter's margin from one large order: mark it as one-off.
- Income per head falling because of hiring ahead of revenue: this is investment, not loss —
  but read 2 consecutive quarters to see whether it turns into revenue.
