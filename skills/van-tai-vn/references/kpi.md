# Chỉ báo ngành vận tải & logistics — phân khúc và cách đọc

> This file keeps **the segmentation** and how to read each indicator, not any period's
> numbers. Every value comes from the latest `financial_detail` / `news_market`, with the period
> stated. The rules on the rate-locking share and how to read freight rates live only in the SKILL.md §Trụ cột driver —
> not repeated here.

## 1. Phân khúc

| Segment | Cycle it tracks | Compare with |
|---|---|---|
| Ports / berths | Service tariffs + capacity + port throughput | The same port group |
| Intra-Asia container shipping | Intra-Asia route rates + routes + rate locking | The same container group |
| Tankers / dry bulk | Tanker rates by route + supply shocks | The same tanker group |
| Airlines (passenger/cargo) | Fuel costs rising with oil prices (margins move **opposite** to oil) + seasonal travel demand + fares | The same airline group — noted separately in SKILL.md: tankers depend on tonne-miles and ship supply, airlines on fuel |
| Forwarding / delivery | Parcel volumes + fuel costs | The same delivery group |

## 2. Nhóm giá và khối lượng

| Indicator | Read from | How to read |
|---|---|---|
| Revenue | `financial_detail` | Up from prices or volume: compare with published throughput |
| Average realised rate / volume | Computed with `shell` (one arithmetic-only command on figures from tool results): revenue / volume; label it "tính từ" | Compare QoQ/YoY. Prices up + volume down is unsustainable growth |
| Route rates (external) | `news_market` | State the route and check date; rates are a short cycle |
| Berth utilisation | `news_market` | New berths not yet filled = fixed costs running ahead of revenue |
| Passengers, seat load factor, aircraft in service | `news_symbol`/`web_search` | Airlines: read with fares; more seats with a lower load factor is not growth |
| Warehouse area, forwarded volume | `news_symbol`/`web_search` | Logistics: follows export + import volume |

## 3. Nhóm chi phí

| Indicator | Read from | How to read |
|---|---|---|
| Fuel costs | `financial_detail` (if available) / `yf_commodities` | Squeeze shipping margins before rates adjust |
| Financial costs | `financial_detail` | New ships/berths bought with borrowings: interest costs run ahead of capacity |
| Assets under construction, depreciation | `financial_detail` (`CDKT`, `LCTT`) | Ships and berths coming into use raise depreciation before volume; needed for EBITDA |
| FX loss, USD debt | `financial_detail` / company disclosures | Airlines, shipowners: a weaker dong hits costs and debt at once |
| Gross margin | `financial_detail` | Read by segment; the consolidated figure hides the port–ship gap |

## 4. Nhóm tín hiệu cầu

| Source | What to read | How to use it |
|---|---|---|
| `vs_xnk_detail` | Exports/imports by period | Context of total exports + imports for the same period; separate price and volume moves. Confirm demand with published TEU/tonnes; never infer demand from machinery imports growing faster than exports |
| `news_market` | Route rates, port throughput, new routes, tariffs | Sector figures; state the source date |
| `planned_targets` | Revenue/profit/throughput plans | Expectation anchor |
| `peer_compare` | The overview keys it really returns, such as P/E, P/B, ROE | Compare within the segment; operating KPIs come from each peer's `financial_detail` for the same period and company disclosures; `metrics` creates no keys |

## 5. Bẫy đọc thường gặp

- Revenue up while throughput stalls: growth comes from prices/rates; lower confidence
  when rates reverse.
- Record-high tanker rates do not mean containers benefit: two different cycles
  under one sector label.
- A one-quarter margin rebound from fuel inventory timing: mark it as one-off; never
  extrapolate.
