# Chỉ báo ngân hàng — nguồn, công thức và kỳ so sánh

Look up `vs_financial_norms(btype=3)` before choosing bank lines. Each
`financial_detail` call takes one `statement`: `KQKD`, `CDKT` or `TM`. The actual line names
must match the lookup result; ratios that are not available must be computed from the notes or the bank's disclosures.
Never pass `btype` to `financial_detail`. State the unit, period and formula; compute derived numbers with `shell` (a command made only of arithmetic).

## Thu nhập và hiệu quả

| Indicator | Source/formula | Notes |
|---|---|---|
| Interest income, interest expense, net interest income | `KQKD`; net interest income = interest income − interest expense | Never use the line name "chi phí thu nhập lãi thuần" |
| NIM | Annualised net interest income / average earning assets | Standalone quarter ×4; YTD n months ×12/n; TTM not multiplied. If KQKD is cumulative, subtract the prior period to get the standalone quarter. Average the opening/closing balances of the same income period, or quarterly averages if the data is complete; state the method. Never divide by total assets or the closing balance. Without opening/closing earning assets, do not compute it |
| Earning-asset yield | Annualised interest income / average earning assets of the same period | Keep the same scope of earning items; read it with the funding cost |
| Funding cost | Annualised interest expense / average interest-bearing funding of the same period | A different denominator from NIM; the yield–funding cost gap is not the same as NIM |
| Non-interest income | The sum of the non-interest lines in KQKD | Separate fees, FX trading, securities, one-offs |

## Chất lượng tài sản

| Indicator | Source/formula | Notes |
|---|---|---|
| Non-performing loans (NPL) | `TM`: group 3–5 loans / total loans of the same scope | Compare both the absolute amount and the ratio |
| Group 2 loans | `TM`: group 2 loans / total loans of the same scope | An early indicator; never infer migration rates from two closing balances |
| NPL coverage | Provisions for customer loans / group 3–5 loans, same scope and period | Never call it loan coverage; state general/specific provisions as disclosed |
| Credit risk provisioning expense | `KQKD` | Compare with pre-provision profit; credit cost needs the annualised expense / average loans |
| Off-balance-sheet | `TM` or the bank's disclosures | Guarantees/commitments are not the same as NPLs; use credit equivalents only with suitable conversion factors |

## Tăng trưởng, vốn và thanh khoản

| Indicator | Source/formula | Notes |
|---|---|---|
| YTD credit growth | `CDKT` vs the previous year end; the published quota if any | Still describe observed growth when the quota is missing, but never infer administrative headroom |
| YTD deposit growth | `CDKT` vs the previous year end | Credit growing faster than deposits is a positive gap that can pressure funding; consider interbank funding/valuable papers |
| CASA | Customer demand deposits / total customer deposits, `TM`, same scope | Never mix in interbank deposits; never compare different bases |
| LDR | The bank's disclosure, or computed under the exact definition in the applicable text | An accounting loan/deposit ratio is not by itself the legal LDR |
| CAR | The bank's capital adequacy disclosure, with a clear source and period | Qualifying own capital / risk-weighted assets under the applicable method; never infer from equity/total assets |
| Equity | `CDKT` | An accounting metric; it does not replace legal own capital or prove CAR compliance |

## So sánh

Compare QoQ/YoY and 4–8 quarters on the same basis before comparing same-segment banks.
`peer_compare` provides only the overview keys it really returns, such as P/B, ROE; its `metrics` parameter
does not create NIM/CASA/NPL. Take these KPIs from each peer's `financial_detail`/disclosures for the same period.
With missing data or a changed denominator, state the limitation; never fill in numbers or infer loan migration rates.
