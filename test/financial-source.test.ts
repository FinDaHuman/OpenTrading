import {afterEach,expect,test} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {RwLock,runTool} from '../src/core/tools/wrap'
import {clearResults,recallResult,useResultSession} from '../src/core/tools/refs'
import {financialLeaves,financialValue} from '../src/core/tools/financial-source'
import {calculateTool} from '../src/core/tools/calculate'
import {computeTool} from '../src/core/tools/compute'
import {FinancePolicyState} from '../src/core/finance-policy'
import {withRetries} from '../src/core/retry'
const ctx={signal:new AbortController().signal,callId:'calc-fixture',groundedFinancial:true}
let paths:string[]=[]
afterEach(()=>{clearResults();for(const p of paths)rmSync(p,{recursive:true,force:true});paths=[]})
const dir=()=>{const p=mkdtempSync(join(tmpdir(),'ot-finance-'));paths.push(p);return p}
const receipt=(id:string)=>({call_id:id,tool:'fixture.quote',matched_entry_id:'synthetic-not-live',payload_sha256:'p'.repeat(64),response_sha256:'r'.repeat(64),source:'synthetic-fixture',as_of:'2030-01-02'})
async function source(data:unknown,unit='VND',id='one',input:unknown={}){
 const body=JSON.stringify({data,units:{'last,price,eps,value':unit},provenance:{source:'synthetic-fixture',data_time:'2030-01-02'},benchmark_evidence:receipt(id)})
 const result=await runTool({name:'fixture_quote',description:'synthetic source fixture',canonicalName:'fixture.quote',source:'mcp:fixture',readOnly:true,input:{type:'object'},execute:async()=>body},input,{...ctx,callId:'sdk-'+id},new RwLock())
 return /^\[ref (r\d+)\]/.exec(result.output)![1]!
}
const calc=async(input:any)=>JSON.parse(String(await calculateTool().execute(input,ctx)).replace(/^\[ref r\d+\]\s*/,''))
test('scalar bridge keeps real SDK ID, original receipt, numeric leaf and separate raw/visible hashes',async()=>{
 const ref=await source({symbol:'AAA',last:20,last_t:'2030-01-02'})
 expect(recallResult(ref)?.callId).toBe('sdk-one')
 expect(financialValue({from_call:ref,field:'last'})).toMatchObject({value:20,path:'/data/last',entity:'AAA',period:'2030-01-02',call_id:'one',sdk_call_id:'sdk-one'})
 expect(recallResult(ref)?.rawSha256).toHaveLength(64)
})
test('scalar price scaling and published VNDbn alias use units, not typed operands',async()=>{
 const r=await source({symbol:'AAA',last:1.25},'VNDbn')
 const out=await calc({expression:'x',values:{x:{from_call:r,field:'last'}},unit:'VND'})
 expect(out.result).toBe(1250000000);expect(out.source_evidence).toEqual([receipt('one')]);expect(out.derived_result.inputs[0].path).toBe('/data/last')
})
test('source unit override is rejected instead of multiplying a financial value silently',async()=>{
 const r=await source({symbol:'AAA',last:12},'VNDbn')
 await expect(calc({expression:'x',values:{x:{from_call:r,field:'last',unit:'VND'}}})).rejects.toThrow('cannot be overridden')
})
test('literal ref and embedded data constants are not lineage',async()=>{
 await expect(calc({expression:'x',values:{x:{value:20,unit:'VND',ref:'r99'}}})).rejects.toThrow('typed value/ref')
 const r=await source({symbol:'AAA',last:12})
 await expect(calc({expression:'x+12345',values:{x:{from_call:r,field:'last'}}})).rejects.toThrow('embedded')
})
test('period-aligned growth needs explicit time_series and unit-aware percent expression',async()=>{
 const r=await source({symbol:'AAA',statements:[{name:'revenue',unit:'VNDbn',values:{'Q1/2030':100,'Q2/2030':125}}]})
 const input={expression:'b/a-1',values:{a:{from_call:r,field:'revenue',at:'first'},b:{from_call:r,field:'revenue',at:'last'}},unit:'%'}
 await expect(calc(input)).rejects.toThrow('period')
 const out=await calc({...input,alignment:'time_series'});expect(out.result).toBe(25);expect(out.derived_result.inputs).toHaveLength(2)
})
test('different metrics cannot hide inside time-series alignment',async()=>{
 const r=await source({symbol:'AAA',rows:[{name:'revenue',unit:'VND',value:100,period:'Q1/2030'},{name:'profit',unit:'VND',value:30,period:'Q2/2030'}]})
 await expect(calc({expression:'a/b',alignment:'time_series',values:{a:{from_call:r,path:'/data/rows/0/value'},b:{from_call:r,path:'/data/rows/1/value'}}})).rejects.toThrow('same metric')
})
test('margin on aligned same-entity source figures is computed and periods remain in proof',async()=>{
 const r=await source({symbol:'AAA',period:'Q1/2030',scope:'consolidated',rows:[{name:'revenue',unit:'VNDbn',value:200},{name:'profit',unit:'VNDbn',value:25}]})
 const out=await calc({expression:'profit/revenue',values:{profit:{from_call:r,field:'profit'},revenue:{from_call:r,field:'revenue'}},unit:'%'})
 expect(out.result).toBe(12.5);expect(out.derived_result.expression_inputs.map((x:any)=>x.name)).toEqual(['profit','revenue'])
})
test('cross-entity aggregation requires explicit alignment; no source metadata is discarded',async()=>{
 const a=await source({symbol:'AAA',last:12},'VND','a'),b=await source({symbol:'BBB',last:18},'VND','b')
 const input={expression:'avg(a,b)',values:{a:{from_call:a,field:'last'},b:{from_call:b,field:'last'}},unit:'VND'}
 await expect(calc(input)).rejects.toThrow('entity');expect((await calc({...input,alignment:'cross_entity_same_period'})).result).toBe(15)
})
test('scope mismatch is not repaired by changing the numeric selector',async()=>{
 const a=await source({symbol:'AAA',scope:'consolidated',last:12},'VND','a'),b=await source({symbol:'AAA',scope:'separate',last:18},'VND','b')
 await expect(calc({expression:'a/b',values:{a:{from_call:a,field:'last'},b:{from_call:b,field:'last'}}})).rejects.toThrow('scope')
})
test('invalid parent pointer exposes real leaves; at cannot select between different metrics',async()=>{
 const r=await source({symbol:'AAA',last:12,high:14})
 expect(()=>financialValue({from_call:r,path:'/data/',at:'last'})).toThrow('No matching')
 expect(()=>financialValue({from_call:r,path:'/data',at:'last'})).toThrow('Ambiguous')
 expect(financialLeaves(r).map(x=>x.path)).toContain('/data/last')
})
test('raw source tampering invalidates arithmetic even if a typed ref still exists',async()=>{
 const r=await source({symbol:'AAA',last:12});recallResult(r)!.rawText+=' '
 expect(()=>financialValue({from_call:r,field:'last'})).toThrow('intact')
})
test('source and two-step derived refs survive process restart without crossing sessions',async()=>{
 const d=dir();useResultSession('s',undefined,d)
 const r=await source({symbol:'AAA',last:12})
 const text=String(await calculateTool().execute({expression:'x*2',values:{x:{from_call:r,field:'last'}},unit:'VND'},ctx));const derived=/^\[ref (r\d+)\]/.exec(text)![1]!
 clearResults();useResultSession('s',undefined,d)
 const out=await calc({expression:'a/2',values:{a:{from_call:derived,field:'result'}},unit:'VND'});expect(out.result).toBe(12);expect(out.derived_result.inputs[0].call_id).toBe('one')
 useResultSession('different',undefined,dir());expect(()=>financialValue({from_call:r,field:'last'})).toThrow('Unknown')
})
test('native compute actual mean and growth preserve all numeric leaves',async()=>{
 const r=await source({symbol:'AAA',rows:[{name:'revenue',unit:'VND',values:{'Q1/2030':100,'Q2/2030':125}}]})
 const mean=JSON.parse(String(await computeTool().execute({op:'mean',from_call:r,field:'revenue'},ctx)).replace(/^\[ref r\d+\]\s*/,''));expect(mean.result).toBe(112.5);expect(mean.derived_result.inputs).toHaveLength(2)
 const growth=JSON.parse(String(await computeTool().execute({op:'pct_change',from_call:r,field:'revenue'},ctx)).replace(/^\[ref r\d+\]\s*/,''));expect(growth.result).toBe(25)
})
test('finance guard rejects an identical successful call with original SDK identity',()=>{
 const policy=new FinancePolicyState({enabled:true},'generic finance question')
 const def={name:'quote',description:'synthetic fixture',input:{type:'object' as const,properties:{symbol:{type:'string' as const}}},readOnly:true,execute:async()=>''}
 policy.before(def,{symbol:'AAA'},'sdk1');policy.succeeded(def,'{}',{symbol:'AAA'},'sdk1')
 expect(()=>policy.before(def,{symbol:'AAA'},'sdk2')).toThrow('Repeated')
 expect(policy.callAudit.get('sdk2')?.original_sdk_call_id).toBe('sdk1')
})
test('gateway-owned retry setting sends one native request for transient503 and terminal424',async()=>{
 for(const statusCode of [503,424]){let calls=0;await expect(withRetries(async()=>{calls++;throw Object.assign(new Error('fixture'),{statusCode})},undefined,{maxRetries:0,sleep:async()=>{}})).rejects.toThrow();expect(calls).toBe(1)}
})

test('caller supplied units cannot fill missing published financial metadata',async()=>{
 const r=await source({symbol:'AAA',custom_numeric:12},'VND')
 expect(()=>financialValue({from_call:r,path:'/data/custom_numeric',unit:'VND'})).toThrow('caller-supplied unit is not proof')
})

test('statement capture data_time cannot substitute for an absent financial period',async()=>{
 const r=await source({symbol:'AAA',rows:[{name:'revenue',unit:'VND',value:120}]})
 await expect(calc({expression:'x*2',values:{x:{from_call:r,field:'revenue'}}})).rejects.toThrow('Missing financial period')
})
test('actual SDK year/quarter/scope metadata is explicit fallback, not rewritten source evidence',async()=>{
 const r=await source({symbol:'AAA',rows:[{name:'revenue',unit:'VND',value:120}]},'VND','query',{symbol:'AAA',year:2030,quarter:2,consolidated:true})
 const out=await calc({expression:'x*2',values:{x:{from_call:r,field:'revenue'}}})
 expect(out.derived_result.inputs[0]).toMatchObject({period:'Q2/2030',period_provenance:'sdk_query',scope:'consolidated',scope_provenance:'sdk_query',query_context:{year:2030,quarter:2,consolidated:true}})
 expect(out.source_evidence[0]).toEqual(receipt('query'))
})
test('explicit source period wins over requested SDK period and remains visible for independent audit',async()=>{
 const r=await source({symbol:'AAA',period:'Q1/2030',rows:[{name:'revenue',unit:'VND',value:120}]},'VND','query',{year:2030,quarter:2})
 expect(financialValue({from_call:r,field:'revenue'})).toMatchObject({period:'Q1/2030',period_provenance:'source',query_context:{year:2030,quarter:2}})
})
