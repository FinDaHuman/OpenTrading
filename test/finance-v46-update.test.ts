import {afterEach,expect,test} from 'bun:test'
import {FinancePolicyState,validateAuthoritativeInput} from '../src/core/finance-policy'
import {clearResults,useResultSession} from '../src/core/tools/refs'
import {RwLock,runTool} from '../src/core/tools/wrap'
import {parseUnit,sameDims} from '../src/core/tools/calculate/units'
import type {ToolDef} from '../src/core/tools/types'
const evidence={tool:'quote',source:'fixture',as_of:'2031-03-04',call_id:'public-one',payload_sha256:'a'.repeat(64),matched_entry_id:'entity-one',response_sha256:'b'.repeat(64)}
const envelope={data:{symbol:'ABC',last:27.4,last_t:'2031-03-04'},units:{last:'nghìn đồng'},provenance:{source:'fixture',as_of:'2031-03-04'},benchmark_evidence:evidence}
const mapping={tool:'tool name',source:'provenance.source',as_of:'provenance.as_of',call_id:'benchmark_evidence.call_id',payload_sha256:'benchmark_evidence.payload_sha256',matched_entry_id:'benchmark_evidence.matched_entry_id',response_sha256:'benchmark_evidence.response_sha256'}
const input='source must use tool name in catalog. evidence '+JSON.stringify(mapping)
const def:ToolDef={name:'mcp__fixture__quote',canonicalName:'quote',source:'mcp:fixture',readOnly:true,description:'Synthetic source',input:{type:'object',additionalProperties:false,properties:{}},execute:async()=>JSON.stringify(envelope)}
afterEach(()=>clearResults())
test('actual runTool ref-prefixed source validates exact mapped seven-field receipt',async()=>{
 clearResults();useResultSession('v46-fixture')
 const result=await runTool(def,{}, {signal:new AbortController().signal,callId:'sdk-one',groundedFinancial:true},new RwLock())
 expect(result.output).toMatch(/^\[ref r\d+\]/)
 const p=new FinancePolicyState({enabled:true,machineResponse:true},input)
 p.succeeded(def,result,{},'sdk-one')
 expect(p.issues(JSON.stringify({value:27.4,source:'quote',evidence:[evidence]}),[def])).toEqual([])
 for(const field of Object.keys(evidence)) {
  expect(p.issues(JSON.stringify({value:27.4,source:'quote',evidence:[{...evidence,[field]:'other'}]}),[def]).some(x=>x.includes('Evidence row'))).toBe(true)
 }
 const mismatch=new FinancePolicyState({enabled:true,machineResponse:true},input)
 mismatch.succeeded(def,result,{},'sdk-other')
 expect(mismatch.issues(JSON.stringify({value:27.4,source:'quote',evidence:[evidence]}),[def]).some(x=>x.includes('Evidence row'))).toBe(true)
 const fresh=new FinancePolicyState({enabled:true,machineResponse:true},input)
 expect(fresh.issues(JSON.stringify({value:27.4,source:'quote',evidence:[evidence]}),[def]).some(x=>x.includes('Evidence row'))).toBe(true)
})
test('schema validation preserves finite alternatives, closed objects and Unicode patterns',()=>{
 const schema={type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',pattern:'^(?:Nhà Khang Điền|X-Y)$'}},oneOf:[{properties:{name:{const:'Nhà Khang Điền'}}},{properties:{name:{const:'X-Y'}}}]}
 expect(validateAuthoritativeInput(schema,{name:'Nhà Khang Điền'}).success).toBe(true)
 expect(validateAuthoritativeInput(schema,{name:'X-Y'}).success).toBe(true)
 expect(validateAuthoritativeInput(schema,{name:'other'}).success).toBe(false)
 expect(validateAuthoritativeInput(schema,{name:'X-Y',extra:true}).success).toBe(false)
 expect(validateAuthoritativeInput({type:'string',pattern:'\\-'},'X-Y')).toMatchObject({success:false})
})
test('origin generation is recorded at execution and cannot be restamped by later recovery',()=>{
 let generation=4
 const p=new FinancePolicyState({enabled:true,auditContext:()=>({provider_request_index:generation,memory_session:'A',memory_turn:2,native_session_id:'native-A'})},'generic')
 const reserved=p.before(def,{},'sdk-one');generation=9;p.failed(def,{},new Error('invalid_argument: bad selector'),'sdk-one',reserved)
 expect(p.callAudit.size).toBe(1)
 expect([...p.callAudit.values()][0]?.reason).toContain('bad selector')
 expect([...p.callAudit.values()].find(x=>x.origin_sdk_call_id==='sdk-one')).toMatchObject({origin_sdk_call_id:'sdk-one',origin_provider_request_index:4,origin_memory_session:'A',origin_memory_turn:2,origin_native_session_id:'native-A'})
 p.noteLocalRejection('sdk-error',{code:'invalid_tool_input',tool:def.name,rawInput:'{}'})
 generation=10;p.noteLocalRejection('sdk-error',{code:'invalid_tool_input',tool:def.name,rawInput:'{}',reason:'updated'})
 expect([...p.localRejections.values()].filter(x=>x.origin_sdk_call_id==='sdk-error')).toHaveLength(2)
 expect([...p.localRejections.values()].find(x=>x.origin_provider_request_index===9)).not.toHaveProperty('reason')
 expect([...p.localRejections.values()].find(x=>x.origin_provider_request_index===10)).toMatchObject({reason:'updated'})
})
test('dimensionless aliases do not acquire currency or percentage dimensions',()=>{
 for(const label of ['tỷ lệ','dimensionless','unitless','ratio','fraction','lần']) {
  expect(parseUnit(label)).toEqual({factor:1,dims:{}})
  expect(sameDims(parseUnit(label).dims,parseUnit('tỷ đồng').dims)).toBe(false)
  expect(parseUnit(label).factor).not.toBe(parseUnit('%').factor)
 }
})


test('SDK reuse across provider generations and memory namespaces retains distinct occurrences',()=>{
 let generation=1,session='A'
 const p=new FinancePolicyState({enabled:true,auditContext:()=>({provider_request_index:generation,memory_session:session,memory_turn:1,native_session_id:'native-'+session})},'generic')
 const rejection=(rawInput:string)=>p.noteLocalRejection('same-sdk',{code:'invalid_tool_input',tool:def.name,rawInput})
 rejection('{"name":"first"}');generation=2;rejection('{"name":"second"}');session='B';rejection('{"name":"third"}')
 expect([...p.localRejections.values()].map(x=>[x.origin_provider_request_index,x.origin_memory_session,x.rawInput])).toEqual([[1,'A','{"name":"first"}'],[2,'A','{"name":"second"}'],[2,'B','{"name":"third"}']])
 generation=3;session='A';p.failed(def,{value:1},new Error('invalid_argument: first'),'same-sdk')
 generation=4;p.failed(def,{value:2},new Error('invalid_argument: second'),'same-sdk')
 expect([...p.callAudit.values()].map(x=>x.origin_provider_request_index)).toEqual([3,4])
})
