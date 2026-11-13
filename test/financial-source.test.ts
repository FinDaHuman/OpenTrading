import {afterEach,expect,test} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {RwLock,runTool} from '../src/core/tools/wrap'
import {clearResults,recallResult,useResultSession} from '../src/core/tools/refs'
import {financialLeaves,financialValue} from '../src/core/tools/financial-source'
import {FinancePolicyState} from '../src/core/finance-policy'
import {withRetries} from '../src/core/retry'
const ctx={signal:new AbortController().signal,callId:'calc-fixture'}
let paths:string[]=[]
afterEach(()=>{clearResults();for(const p of paths)rmSync(p,{recursive:true,force:true});paths=[]})
const dir=()=>{const p=mkdtempSync(join(tmpdir(),'ot-finance-'));paths.push(p);return p}
const receipt=(id:string)=>({call_id:id,tool:'fixture.quote',matched_entry_id:'synthetic-not-live',payload_sha256:'p'.repeat(64),response_sha256:'r'.repeat(64),source:'synthetic-fixture',as_of:'2030-01-02'})
async function source(data:unknown,unit='VND',id='one',input:unknown={}){
 const body=JSON.stringify({data,units:{'last,price,eps,value':unit},provenance:{source:'synthetic-fixture',data_time:'2030-01-02'},benchmark_evidence:receipt(id)})
 const result=await runTool({name:'fixture_quote',description:'synthetic source fixture',canonicalName:'fixture.quote',source:'mcp:fixture',readOnly:true,input:{type:'object'},execute:async()=>body},input,{...ctx,callId:'sdk-'+id},new RwLock())
 return /^\[ref (r\d+)\]/.exec(result.output)![1]!
}
test('scalar bridge keeps real SDK ID, original receipt, numeric leaf and separate raw/visible hashes',async()=>{
 const ref=await source({symbol:'AAA',last:20,last_t:'2030-01-02'})
 expect(recallResult(ref)?.callId).toBe('sdk-one')
 expect(financialValue({from_call:ref,field:'last'})).toMatchObject({value:20,path:'/data/last',entity:'AAA',period:'2030-01-02',call_id:'one',sdk_call_id:'sdk-one'})
 expect(recallResult(ref)?.rawSha256).toHaveLength(64)
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

test('explicit source period wins over requested SDK period and remains visible for independent audit',async()=>{
 const r=await source({symbol:'AAA',period:'Q1/2030',rows:[{name:'revenue',unit:'VND',value:120}]},'VND','query',{year:2030,quarter:2})
 expect(financialValue({from_call:r,field:'revenue'})).toMatchObject({period:'Q1/2030',period_provenance:'source',query_context:{year:2030,quarter:2}})
})
test('per-share label is equivalent at the same scale, other overrides still fail (2026-11-10 OT fix)',async()=>{
 const r=await source({symbol:'AAA',last:56.3},'nghìn đồng/cổ phiếu')
 expect(financialValue({from_call:r,field:'last',unit:'nghìn đồng'})).toMatchObject({value:56.3,unit:'nghìn đồng/cổ phiếu'})
 expect(()=>financialValue({from_call:r,field:'last',unit:'đồng'})).toThrow('cannot be overridden')
 expect(()=>financialValue({from_call:r,field:'last',unit:'tỷ đồng'})).toThrow('cannot be overridden')
})
