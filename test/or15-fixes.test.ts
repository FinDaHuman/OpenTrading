/** Regression for the or15 pilot OpenTrading findings (2026-11-11): double unit scaling, unrecoverable empty
 * answers after a tool loop, and step-by-step compute requests. */
import {afterEach,expect,test} from 'bun:test'
import {clearResults,rememberResult} from '../src/core/tools/refs'
import {computeTool} from '../src/core/tools/compute'
import {calculateTool,scaleLiterals} from '../src/core/tools/calculate'
import {judgeStop,MAX_RECOVERIES,RESCUE_ANSWER_NOW,type LastStep} from '../src/core/loop/stop-gate'
const ctx={signal:new AbortController().signal,callId:'or15',groundedFinancial:true}
afterEach(clearResults)
const parse=(x:unknown)=>JSON.parse(String(x).replace(/^\[ref r\d+\]\s*/,''))
let n=0
function remember(tool:string,body:unknown){
 const raw=JSON.stringify(body);n++
 return rememberResult(tool,raw,{callId:'sdk-'+n,rawText:raw,rawSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex'),visibleSha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex')})
}

test('profile-01: "cap / 1000000000" with unit "tỷ đồng" is converted once, labelled unverified',async()=>{
 const out=parse(await calculateTool().execute({expression:'cap / 1000000000',values:{cap:{value:109201362364000,unit:'đồng'}},unit:'tỷ đồng',decimals:6},ctx))
 expect(out.result).toBeCloseTo(109201.362364,6);expect(out.unit).toBe('tỷ đồng');expect(out.scale_fixed).toBe(true)
 expect(out.lineage).toBe('unverified');expect(out.derived_result).toBeUndefined();expect(out.warnings.join(' ')).toContain('chỉ áp một lần')
 // the single conversion is unchanged
 const once=parse(await calculateTool().execute({expression:'cap',values:{cap:{value:109201362364000,unit:'đồng'}},unit:'tỷ đồng',decimals:6},ctx))
 expect(once.result).toBeCloseTo(109201.362364,6);expect(once.scale_fixed).toBeUndefined()
})

test('ratio × 100 with unit "%" is a percentage, not 100× too large',async()=>{
 const out=parse(await calculateTool().execute({expression:'(a / b - 1) * 100',values:{a:{value:110,unit:'điểm'},b:{value:100,unit:'điểm'}},unit:'%'},ctx))
 expect(out.result).toBeCloseTo(10,6);expect(out.scale_fixed).toBe(true)
 const plain=parse(await calculateTool().execute({expression:'a / b - 1',values:{a:{value:110,unit:'điểm'},b:{value:100,unit:'điểm'}},unit:'%'},ctx))
 expect(plain.result).toBeCloseTo(10,6);expect(plain.scale_fixed).toBeUndefined()
})

test('scale literals are powers of ten that multiply or divide',()=>{
 expect(scaleLiterals('cap / 1000000000')).toEqual([1e9])
 expect(scaleLiterals('x*1e6 + y')).toEqual([1e6])
 expect(scaleLiterals('100 * r')).toEqual([100])
 expect(scaleLiterals('x / 10^9')).toEqual([1e9])
 expect(scaleLiterals('(a + 250) / 119')).toEqual([])
 expect(scaleLiterals('x ^ (250 / 119)')).toEqual([])
})

test('a missing variable error shows how to bind it',async()=>{
 await expect(calculateTool().execute({expression:'cap',unit:'tỷ đồng'} as any,ctx)).rejects.toThrow(/"values".*"cap"/)
})

test('after both empty rescues, one answer-only rescue when the turn has data, then give up',()=>{
 const empty:LastStep={text:'',toolNames:[],finish:'stop',afterTools:true,dataInTurn:true,reasoned:true}
 const done=Array(MAX_RECOVERIES).fill('empty')
 expect(judgeStop(empty,done)).toEqual({action:'continue',kind:'empty',nudge:RESCUE_ANSWER_NOW,toolChoice:'none'})
 expect(judgeStop(empty,[...done,'empty'])).toEqual({action:'give-up',kind:'empty'})
 expect(judgeStop({...empty,dataInTurn:false},done)).toEqual({action:'give-up',kind:'empty'})
})

test('compute batch: several ops in one call, each with its own ref; a bad item does not sink the rest',async()=>{
 const closes=Array.from({length:120},(_,i)=>({t:'2026-'+String(5+Math.floor(i/22)).padStart(2,'0')+'-'+String(1+i%22).padStart(2,'0'),c:20+i/10}))
 const h=remember('vn_quote_history',{data:{symbol:'HPG',closes},units:{c:'nghìn đồng/cổ phiếu'}})
 const text=String(await computeTool().execute({batch:[{op:'mean',from_call:h,field:'c',periods:20},{op:'mean',from_call:h,field:'c',periods:120},{op:'pct_change',from_call:'r999'}]} as any,ctx))
 const lines=text.split('\n');expect(lines).toHaveLength(3)
 const a=parse(lines[0]!.replace(/^#1 /,'')),b=parse(lines[1]!.replace(/^#2 /,''))
 expect(a.result).toBeCloseTo(closes.slice(-20).reduce((s,x)=>s+x.c,0)/20,6);expect(b.result).toBeCloseTo(closes.reduce((s,x)=>s+x.c,0)/120,6)
 expect(lines[0]).toMatch(/^#1 \[ref r\d+\]/);expect(lines[1]).toMatch(/^#2 \[ref r\d+\]/);expect(lines[2]).toMatch(/^#3 lỗi:/)
 // single op unchanged
 const one=parse(await computeTool().execute({op:'mean',from_call:h,field:'c',periods:20},ctx));expect(one.result).toBeCloseTo(a.result,6)
})

test('or15r: ref names bind to earlier compute/calculate results without a values object',async()=>{
 const closes=Array.from({length:30},(_,i)=>({t:'2026-10-'+String(1+i).padStart(2,'0'),c:10+i}))
 const h=remember('vn_quote_history',{data:{symbol:'MSN',closes},units:{c:'nghìn đồng/cổ phiếu'}})
 const a=String(await computeTool().execute({op:'pct_change',from_call:h,field:'c',periods:20},ctx)).match(/\[ref (r\d+)\]/)![1]
 const b=String(await computeTool().execute({op:'pct_change',from_call:h,field:'c',periods:10},ctx)).match(/\[ref (r\d+)\]/)![1]
 const out=parse(await calculateTool().execute({expression:`(${a} + ${b}) / 2`,unit:'%'} as any,ctx))
 const pa=(39/19-1)*100,pb=(39/29-1)*100
 expect(out.result).toBeCloseTo((pa+pb)/2,4)
 // an unknown name still fails with the binding hint
 await expect(calculateTool().execute({expression:'x + 1'} as any,ctx)).rejects.toThrow(/tên ref/)
})
