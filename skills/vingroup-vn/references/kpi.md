# Chỉ báo tập đoàn Vingroup — tách mảng và đọc dòng tiền

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / `company_events` / `news_market`, with the period stated.
> The real-estate debt-ceiling rule lives in `bat-dong-san-vn`; the rules on the chain and the
> Vin group by cycle live in `dinh-vi-chu-ky-vn` — not repeated here.

## 1. Tách mảng

| Segment | Cycle it tracks | Its own indicators |
|---|---|---|
| Residential real estate | Project handovers + pre-sales | Pre-sales, accumulated work in progress, segment gross margin |
| EVs | Output scale + unit costs | Revenue, accumulated losses, negative margin |
| Retail (shopping malls) | Rental revenue, services and footfall | Rental revenue, area, occupancy |
| Hotels / resorts | Tourism | Room revenue, occupancy |
| Services (education, healthcare) | Independent demand | Revenue, students/patients |

## 2. Nhóm vòng quay BĐS

| Indicator | Read from | How to read |
|---|---|---|
| Period pre-sales | `financial_detail` (if available) | Newly signed contract sales; not the same as buyer advances or recognised revenue |
| Accumulated work in progress | `financial_detail` | Project costs held in inventory; never infer profit from pre-sales minus work in progress |
| Real-estate gross margin | `financial_detail` / company disclosures | Read 4–8 quarters before extrapolating (one handover batch makes it jump) |
| Land bank | Company disclosures via `news_symbol`/`company_events`/`web_search` | The real-estate loop's source of future growth |

## 3. Nhóm dòng tiền và đòn bẩy

| Indicator | Read from | How to read |
|---|---|---|
| Debt and bonds | `financial_detail` | Read with the maturity schedule in `news_market`; concentrated in a few periods = refinancing risk |
| Cash | `financial_detail` | Compare with what falls due in the next 6 months |
| Interest cost and average cost of capital | `financial_detail` / `news_market` | Growing faster than revenue = profit eaten by financial costs |
| EV accumulated losses | The company's statements/notes via `financial_detail`/`news_symbol`/`web_search` | Accounting losses are not the same as cash burned; cross-check operating and investing cash flow |

## 4. Nhóm quản trị và chỉ số

| Source | What to read | How to use it |
|---|---|---|
| `company_events` | Consolidation changes, divesting/spinning off/merging segments, transactions with the founding shareholder | To compare with prior periods, read this before looking at revenue |
| `news_market` | The bond wall, new issuance, views on index impact | State the source + date |
| `breadth_scan` | Exchange-wide breadth | Detect "the index pulled by one group alone" before concluding on the whole market — `market_overview` counts only the bluechip basket, so it is not enough evidence |
| Index releases with weights and dates | Weights, constituent price changes for the same index/period and the start-of-period index level | Compute contribution only with complete compatible data; VN30 quotes carry no exchange market-cap denominator or weights. Share of exchange market cap differs from index weight and point contribution |
| `peer_compare` | The overview keys it really returns (P/B, ROE...) | Segment margin/leverage KPIs must come from each peer's statements/disclosures for the same period; never compare a multi-sector consolidated group with a pure real-estate company |

## 5. Bẫy đọc thường gặp

- Comparing consolidated revenue/profit with a prior period right after spinning off or divesting a segment: the conclusion is
  meaningless; read the entity differences first.
- Seeing profit jump without reading the contribution weights: most of it may come from one
  handover batch or one internal transaction.
- Using the consolidated P/E to compare with a pure real-estate company: different models; SOTP is needed.
