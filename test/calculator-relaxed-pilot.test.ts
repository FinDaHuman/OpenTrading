/** Regression for the or11 OpenTrading tool-blocked DNFs (2026-11-11): each pilot call shape now returns a number. */
import {afterEach,expect,test} from 'bun:test'
import {clearResults,rememberResult} from '../src/core/tools/refs'
import {computeTool} from '../src/core/tools/compute'
import {calculateTool} from '../src/core/tools/calculate'
const ctx={signal:new AbortController().signal,callId:'pilot-shape',groundedFinancial:true}
afterEach(clearResults)
const parse=(x:unknown)=>JSON.parse(String(x).replace(/^\[ref r\d+\]\s*/,''))
let n=0
function remember(tool:string,body:unknown){
 const raw=JSON.stringify(body);n++
 return rememberResult(tool,raw,{callId:'sdk-'+n,rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex'),visibleSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
}
test('agg-01: mean of five bank closes with "nghìn đồng" label over published "nghìn đồng/cổ phiếu" keeps lineage',async()=>{
 const closes={VCB:56.3,BID:33.4,CTG:30.3,TCB:21.6,MBB:19.3}
 const refs=Object.fromEntries(Object.entries(closes).map(([s,v])=>[s.toLowerCase(),remember('vn_quote_history',{data:{symbol:s,last:v,last_t:'2026-10-30'},units:{last:'nghìn đồng/cổ phiếu'}})]))
 const values=Object.fromEntries(Object.entries(refs).map(([k,r])=>[k,{from_call:r,field:'last',unit:'nghìn đồng'}]))
 const base=parse(await calculateTool().execute({expression:'(vcb + bid + ctg + tcb + mbb) / 5',values,decimals:6},ctx))
 expect(base.result).toBeCloseTo(32180,6);expect(base.unit).toBe('đồng/cổ phiếu');expect(base.lineage).toBeUndefined();expect(base.derived_result.inputs).toHaveLength(5)
 const out=parse(await calculateTool().execute({expression:'(vcb + bid + ctg + tcb + mbb) / 5',values,unit:'nghìn đồng',decimals:6},ctx))
 expect(out.result).toBeCloseTo(32.18,6);expect(out.unit).toBe('nghìn đồng/cổ phiếu');expect(out.lineage).toBeUndefined()
})
test('crypto-01: BTC × USDVND with a unit-less crypto source returns the number, unverified',async()=>{
 const btc=remember('crypto_spot',{data:{tickers:[{symbol:'BTCUSDT',last:78109}]}})
 const fx=remember('vn_msn_fx_gold',{data:{series:[{symbol:'USDVND',closes:[{t:'2026-10-30',c:25802}]}]}})
 const out=parse(await calculateTool().execute({expression:'btc * fx / 1000000',values:{btc:{from_call:btc,field:'last',unit:'USD'},fx:{from_call:fx,field:'c',unit:'VND'}}},ctx))
 expect(out.result).toBeCloseTo(2015.368418,6);expect(out.lineage).toBe('unverified');expect(out.derived_result).toBeUndefined()
})
test('index-01: pct_change over unit-less index bars returns the number, unverified; typed literals too',async()=>{
 const bars=remember('vn_index_ohlcv',{data:{symbol:'VNINDEX',bars:[{time:'2026-10-19',close:1689.84},{time:'2026-10-30',close:1741.62}]}})
 const out=parse(await computeTool().execute({op:'pct_change',from_call:bars,field:'close'},ctx))
 expect(out.result).toBeCloseTo(3.064195,4);expect(out.lineage).toBe('unverified');expect(out.derived_result).toBeUndefined()
 const typed=parse(await calculateTool().execute({expression:'(close_end / close_start - 1) * 100',values:{close_end:{value:1741.62,unit:'điểm'},close_start:{value:1689.84,unit:'điểm'}}},ctx))
 expect(typed.result).toBeCloseTo(3.064195,5);expect(typed.lineage).toBe('unverified')
 const literal=parse(await calculateTool().execute({expression:'(1741.62 / 1689.84 - 1) * 100'},ctx))
 expect(literal.result).toBeCloseTo(3.064195,5);expect(literal.lineage).toBe('unverified')
})
