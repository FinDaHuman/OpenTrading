# Chỉ báo ngành chứng khoán — dòng BCTC và cách đọc

> Look up `vs_financial_norms(btype=2)` for the exact brokerage statement line names; this file
> keeps **how to read them**, not any period's numbers. Every value comes from the latest `financial_detail`,
> with the reporting period stated. The rules on the margin cap and how to compute
> leverage live only in the SKILL.md §Trụ cột driver — not repeated here.

## 1. Nhóm đòn bẩy

| Indicator | Read from | How to read |
|---|---|---|
| Margin loans outstanding | `financial_detail` | The 4–8 quarter trend. Steady growth shows rising margin demand but does not prove credit quality; a sudden drop = the market just sold off or the brokerage tightened margin calls |
| Equity | `financial_detail` | The denominator for leverage. Stock dividends usually reclassify within equity and do not by themselves cut total equity; check actual equity movements |
| Leverage | Computed with `shell` (a command made only of arithmetic): loans / equity (state that it is derived) | Compare with the regulatory cap in force. This indicates **remaining room for growth**, not quality |
| Receivables | `financial_detail` | Receivables from margin trades growing faster than loans = receivables piling up |
| Impairment of loans and collateral | `financial_detail` (`CDKT`) | Rising fast = margin loans hard to recover |
| Short-term borrowings, issued bonds | `financial_detail` (`CDKT`) | The funding behind margin loans; growing faster than equity = leverage rising |
| Average margin yield | Computed with `shell`: interest on loans / average loans; label it "tính từ" | An estimate; compare its direction with interest expense |

## 2. Nhóm doanh thu

| Indicator | Read from | How to read |
|---|---|---|
| Brokerage revenue | `financial_detail` | Fees are structurally compressed by zero-fee competition. Falling brokerage revenue does **not** mean the sector is worse |
| Margin lending revenue | `financial_detail` | Read with loans and the average rate: revenue up while loans fall = higher rates, not volume |
| Investment revenue | `financial_detail` | The most volatile business. Read 4 quarters and separate the realised recurring part |
| FVTPL / AFS / HTM assets | `financial_detail` (`CDKT`) | Size and mix of the book: more shares = market-sensitive, more bonds/deposits = rate and credit risk |
| Advisory revenue | `financial_detail` | Small but the most stable; grows with the IPO/ECM pipeline |
| Weights of the 4 businesses | Computed with `shell` (one arithmetic-only command on figures from tool results): each business's revenue / total revenue; label it "tính từ" | The mix decides which group suffers in a falling market. Read 4 consecutive quarters before grouping |

## 3. Nhóm vốn và hiệu quả

| Indicator | Read from | How to read |
|---|---|---|
| ROE | `financial_ratios` | Used to anchor P/B quality. If ROE jumps unusually from proprietary trading, down-weight that period |
| Operating expenses | `financial_detail` | Against revenue: costs growing faster than revenue squeeze margins long-term |
| Liquid capital ratio | The financial safety report published by the brokerage | Use the definition and thresholds of the text in force; never infer it from equity or replace it with an undefined metric |

## 4. Nhóm đối chiếu

| Source | What to read | When |
|---|---|---|
| `news_market` | Sector margin debt, average margin rates, brokerages' funding costs | Whenever sector figures are needed; state which disclosure the sector figure comes from |
| `market_overview` | Bluechip prices, movers, breadth | For session context before reading brokerage results |
| `breadth_scan` | Advance/decline breadth | To check whether the liquidity story is broad or only a few large tickers |
| `planned_targets` | The yearly plan (revenue, profit, capital) | Expectation anchor; especially when considering capital raising for expansion |

## 5. Bẫy đọc thường gặp

- Brokerage revenue falling while the sector still makes money: do not conclude "ngành xấu" —
  fee competition is structural, not cyclical.
- Margin loans rising together with the market are only a consequence; they do not bring
  brokerage profit from new equity.
- An unusually profitable quarter from proprietary trading: treat it as one-off; never extrapolate it into capability.

Compare operating KPIs with each peer's `financial_detail`/disclosures for the same period; `peer_compare` gives only the overview keys it really returns and does not create loans/equity or the revenue mix through `metrics`.
