# Chỉ báo ngành dầu khí — tách vòng kinh doanh và cách đọc

> This file keeps **five different business loops** and how to read each, not any
> period's numbers. Every value comes from the latest `financial_detail` / `yf_commodities` /
> `news_market`, with the period stated. The rule against placing the sector in the rotation
> chain lives only in the SKILL.md §Ranh giới — not repeated here.

## 1. Tách vòng kinh doanh

| Loop | Identifying features | Cycle it tracks | Compare with |
|---|---|---|---|
| Upstream (production) | Output, reserves, exploration costs | Oil prices + reserves | The same upstream loop |
| Refining/petrochemicals | Refined product sales − input crude price | The refining spread | The same refining loop |
| Shipping | Freight rates, charter contracts | Freight rates + voyage distance | The same shipping loop |
| Technical services | Contract revenue, backlog | The group's capital spending | The same services loop |
| Gas/petroleum distribution | Gas, LPG and fuel sales volume | Volume + the pricing mechanism or contracts | The same distribution loop |

A required step before comparing: identify which loop feeds the ticker's profit from the segments in
`financial_detail` + the segment table in `vn_company`. Unclear → treat it as several loops
and read all the branches; never pick one representative loop.

## 2. Nhóm biên theo vòng

| Indicator | Read from | How to read |
|---|---|---|
| Consolidated revenue | `financial_detail` | Read with the segment mix: revenue up without knowing which loop drove it is meaningless |
| Gross margin by segment (if disclosed) | `financial_detail` | The core indicator. The consolidated margin hides shifts between loops |
| Exploration costs | `financial_detail` | The 4-quarter trend: rising spending signals future output; cuts signal later decline |
| Inventory | `financial_detail` (`CDKT`) | Refining, distribution: large stock in a fast price move = a one-off gain or loss |
| Trade receivables | `financial_detail` (`CDKT`) | Services: growing faster than revenue = field operators paying late |
| Cost ratio | `financial_detail` (computed with `shell`, stated) | A low ratio when oil is high is not capability — measure it again in a low-price zone |

## 3. Nhóm khối lượng và trữ lượng

| Indicator | Read from | How to read |
|---|---|---|
| Period output | `news_market` (sector/company releases) | Reserve replacement only means something next to output |
| Reserve replacement | `news_market` | Below output repeatedly = output drawing down old reserves |
| Project order / groundbreakings | `company_events` · `news_market` | Decides output 2–5 years out; a delayed order pushes revenue back |
| Long-term contracts | `news_market` | Smooth income through the cycle; a high share lowers short-term price sensitivity |
| Rig utilisation, day rates | `news_symbol`/`web_search` | Services: day rates follow upstream budgets with a lag |
| Distribution volume and margin | `news_symbol`/`web_search` | Read with the pricing mechanism in force; volume up with a thinner margin is not support |

## 4. Nhóm giá và tuyến

| Source | What to read | How to use it |
|---|---|---|
| `yf_commodities` | Oil prices by the cycle available | As a reference mark; it does **not** replace realised contract prices |
| `news_market` | Shipping-route status, tanker rates, geopolitical developments | The shipping loop's driver; state the source date |
| `planned_targets` | The company's yearly plan | Anchor for output/revenue expectations |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |

## 5. Bẫy đọc thường gặp

- Oil price news means "the whole sector benefits": wrong — refining can move the other way, services
  follow 6–12 months later.
- Revenue up because of an unusual transaction in the period: mark it as one-off; never
  extrapolate.
- Refining or distribution profit jumping in one quarter: check inventory gains first.
- Natural gas in `yf_commodities` is Henry Hub: context only, never the VN contract price.
- Current output looks good: check reserve replacement before concluding it is sustainable.
