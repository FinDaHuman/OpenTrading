import {afterEach,expect,test} from 'bun:test'
import {clearResults,rememberResult} from '../src/core/tools/refs'
import {computeTool} from '../src/core/tools/compute'
import {calculateTool} from '../src/core/tools/calculate'
const ctx={signal:new AbortController().signal,callId:'synthetic-calculation',groundedFinancial:true}
afterEach(clearResults)
function source(rows:unknown[],entity:string|null='SYN'){
 const raw=JSON.stringify({data:{...(entity?{symbol:entity}:{}),rows},provenance:{source:'synthetic unit-mutation fixture, not live'}})
 return rememberResult('synthetic_series',raw,{callId:'synthetic-source-'+rows.length,rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex'),visibleSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
}
const series=(a:string,b:string)=>[{name:'sales',period:'Q1/2030',unit:a,value:1},{name:'sales',period:'Q2/2030',unit:b,value:2}]
const parse=(x:unknown)=>JSON.parse(String(x).replace(/^\[ref r\d+\]\s*/,''))
test('source growth cannot interpret 1VNDmn→2VNDbn as100%',async()=>{
 const ref=source(series('VNDmn','VNDbn'))
 await expect(computeTool().execute({op:'pct_change',from_call:ref,field:'sales'},ctx)).rejects.toThrow(/unit|đơn vị/i)
 const out=parse(await calculateTool().execute({expression:'b/a-1',alignment:'time_series',values:{a:{from_call:ref,field:'sales',at:'first'},b:{from_call:ref,field:'sales',at:'last'}},unit:'%'},ctx))
 expect(out.result).toBe(199900)
})
test('relative strength rejects scale changes inside either source window',async()=>{
 const a=source(series('VNDmn','VNDbn'),'AAA'),b=source(series('VNDmn','VNDmn'),'BBB')
 await expect(computeTool().execute({op:'relative_strength',from_call:a,field:'sales',other:{from_call:b,field:'sales'}},ctx)).rejects.toThrow(/unit|đơn vị/i)
})
test('equal-unit source growth still works and source scope verification stays explicit',async()=>{
 const ref=source(series('VNDmn','VNDmn'))
 const out=parse(await computeTool().execute({op:'pct_change',from_call:ref,field:'sales'},ctx))
 expect(out.result).toBe(100);expect(out.derived_result.alignment_verification.scope).toBe('unverified_missing')
 expect(out.derived_result.alignment_verification.entity).toBe('verified')
})
test('a financial comparison cannot silently accept all-missing entity metadata',async()=>{
 const ref=source(series('VNDmn','VNDmn'),null)
 await expect(computeTool().execute({op:'pct_change',from_call:ref,field:'sales'},ctx)).rejects.toThrow(/entity/i)
})

test('historical candle t/time rows keep their actual dates instead of latest capture time',async()=>{
 const raw=JSON.stringify({data:{symbol:'SYN',rows:[{t:'2030-01-01',close:10},{time:'2030-01-02',close:12}]},units:{close:'VND'},provenance:{data_time:'2030-01-03'}})
 const r=rememberResult('synthetic_candles',raw,{callId:'sdk-candles',rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
 const out=parse(await computeTool().execute({op:'pct_change',from_call:r,field:'close'},ctx))
 expect(out.result).toBe(20);expect(out.derived_result.inputs.map((x:any)=>x.period)).toEqual(['2030-01-01','2030-01-02'])
})
test('aligned array financial tables join source periods by index and exact pointer units',async()=>{
 const raw=JSON.stringify({data:{symbol:'SYN',periods:['Q1/2030','Q2/2030'],rows:[{name:'sales',values:[100,125]}]},units:{'/data/rows/0/values/0':'VNDbn','/data/rows/0/values/1':'VNDbn'},provenance:{data_time:'2030-09-01'}})
 const r=rememberResult('synthetic_table',raw,{callId:'sdk-table',rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
 const out=parse(await computeTool().execute({op:'pct_change',from_call:r,field:'sales'},ctx))
 expect(out.result).toBe(25);expect(out.derived_result.inputs.map((x:any)=>x.period)).toEqual(['Q1/2030','Q2/2030'])
})

test('unused named variables cannot assert unrelated source proof',async()=>{
 const r=source(series('VNDmn','VNDmn'))
 await expect(calculateTool().execute({expression:'a',values:{a:{from_call:r,field:'sales',at:'first'},unused:{from_call:r,field:'sales',at:'last'}}},ctx)).rejects.toThrow('unused=[unused]')
 await expect(calculateTool().execute({expression:'a+missing',values:{a:{from_call:r,field:'sales',at:'first'}}},ctx)).rejects.toThrow('missing=[missing]')
})

test('statement_scope metadata is authenticated financial scope, not silently omitted',async()=>{
 const raw=JSON.stringify({data:{symbol:'SYN',rows:[{name:'sales',period:'Q1/2030',statement_scope:'consolidated',unit:'VND',value:100},{name:'profit',period:'Q1/2030',statement_scope:'separate',unit:'VND',value:20}]}})
 const r=rememberResult('synthetic_scope',raw,{callId:'sdk-scope',rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
 await expect(calculateTool().execute({expression:'a/b',values:{a:{from_call:r,field:'profit'},b:{from_call:r,field:'sales'}},unit:'%'},ctx)).rejects.toThrow('scope')
})
