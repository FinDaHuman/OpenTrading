# Chỉ báo ngành bất động sản — dòng báo cáo và cách đọc

> This file keeps **how to read**, not any period's numbers. Every value comes from the latest
> `financial_detail` / `news_market`, with the period stated. The rules on the debt ceiling
> by project size and how to compute leverage live only in the SKILL.md §Trụ cột driver —
> not repeated here.

## 1. Nhóm dòng vốn

| Indicator | Read from | How to read |
|---|---|---|
| Borrowings | `financial_detail` | The 4–8 quarter trend. Growing faster than equity = leverage widening |
| Issued bonds | `financial_detail` | Read with the (external) issuance coupon: fast growth in **expensive** debt is a leading signal, not a lagging one |
| Equity | `financial_detail` | The denominator for leverage against the regulatory ceiling |
| Net interest cost | `financial_detail` | Growing faster than total debt = the average rate is rising; part of the interest may be capitalised into projects, so it can look lower than it is |
| Cash received from customers | `financial_detail` | Cheap long-term advances: steady growth is support; a fall signals slow sales before recognised revenue is affected |
| Cash vs debt due in 4 quarters | `financial_detail` (`CDKT`) + bond schedule from disclosures | Debt due above cash and confirmed sources = refinancing pressure |

## 2. Nhóm chất lượng bán hàng

| Indicator | Read from | How to read |
|---|---|---|
| Pre-sales (contracted in the period) | Company disclosures; `planned_targets` is only the plan | Read with gross margin: pre-sales up + margin down = growth through price cuts |
| Unrecognised contract backlog | Company disclosures/notes | Not the same as buyer advances or accounting unearned revenue; track handovers and cancellations |
| Accumulated work in progress | `financial_detail` | The basis for profit at handover. Compare with unrecognised revenue to see whether the stage is long or short |
| Completed unsold stock | Company disclosures (`CDKT` gives only total inventory) | Rising = slow sales |
| Operating cash flow | `financial_detail` (`LCTT`) | Compare with revenue: sales that do not turn into cash |
| Real-estate gross margin | `financial_detail` | The sector's quality metric. Margin falling while revenue rises = competing supply or discounts |

## 3. Nhóm phân khúc

| Segment | What to read | Compare with |
|---|---|---|
| Commercial housing | Pre-sales, margin, accumulated work in progress, borrowing costs | The same housing-segment group |
| Industrial | New leased area, leased area, average rent, occupancy, clean land bank, unearned revenue from prepaid land leases | Industrial-park peers in the same region (north / south) |
| Retail – services | Service revenue, occupancy, operating costs | The retail group; also read `tieu-dung-ban-le-vn` |

## 4. Nhóm đối chiếu bên ngoài

| Source | What to read | When |
|---|---|---|
| `news_market` | Sector credit growth, bond issuance + coupons, the maturity wall, new supply by period | Whenever sector figures are needed; state the source and period |
| `company_events` | Project approvals, capital raises, bond offerings | Before concluding on progress or capital plans |
| `event_calendar_vn` | AGMs, record dates, disclosure schedules | To anchor the timing of expectations |
| `planned_targets` | Revenue/profit/pre-sales plans | Expectation anchor and cross-check against published results |

## 5. Bẫy đọc thường gặp

- Comparing leverage across the two segments: housing and industrial have different debt ceilings and capital
  turnover.
- Real-estate revenue jumps between quarters because handovers are uneven — read 4 quarters and the backlog; never
  read one quarter.
- Sector credit tightening while the company still grows: the source may be customer
  advances or bonds — tell them apart before concluding on quality.
