/** Source operands are read from this session's raw tool record, never a typed financial literal. */
import { createHash } from "node:crypto"
import { parseResult, recallResult } from "./refs"
import { parseUnit, sameDims } from "./calculate/units"
const hash = (s: string) => createHash("sha256").update(s).digest("hex")
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v)
export interface SourceSpec {from_call:string;field?:string;path?:string;from_symbol?:string;at?:"last"|"first"|number;unit?:string}
export interface FinancialLeaf {name?:string;ref:string;sdk_call_id:string;call_id?:string;path:string;value:number;unit:string;entity?:string;period?:string;scope?:string;metric?:string;period_provenance?:"source"|"sdk_query";scope_provenance?:"source"|"sdk_query";query_context?:unknown;raw_source_sha256?:string;normalized_visible_sha256?:string;source_response_sha256:string;source_payload_sha256?:string;derived_inputs?:FinancialLeaf[];derived_expression?:unknown;receipt?:Record<string,unknown>}
export class DerivationError extends Error { readonly code="invalid_derivation"; readonly retryable_with_corrected_arguments=true }
const escape = (s:string)=>s.replace(/~/g,"~0").replace(/\//g,"~1")
const str=(x:unknown)=>typeof x === "string" && x.trim() ? x.trim() : undefined
const period=(x:unknown):string|undefined=>{
 if(typeof x === "number" && Number.isFinite(x) && x>=1e9){const d=new Date(x<1e12?x*1000:x);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):undefined}
 const text=str(x);if(!text)return undefined
 const net=/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);if(net){const d=new Date(Number(net[1]));return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):undefined}
 if(/^\d{4}-\d{2}-\d{2}/.test(text))return text.slice(0,10)
 return /\d{4}|TTM|YTD|lũy kế/i.test(text)?text:undefined
}
const RECEIPT=["call_id","tool","matched_entry_id","payload_sha256","response_sha256","source","as_of"]
export function financialLeaves(ref:string):FinancialLeaf[] {
 const stored=recallResult(ref);if(!stored)throw new DerivationError(`Unknown source ref ${ref}; use a result from this session.`)
 if(!stored.callId || !stored.rawText || hash(stored.rawText)!==stored.rawSha256)throw new DerivationError(`Source ${ref} lacks an intact SDK/raw record; literal ref is not proof.`)
 const raw=parseResult(stored.rawText);if(!object(raw))throw new DerivationError(`Source ${ref} is not an object.`)
 const receipt=object(raw.benchmark_evidence) && RECEIPT.every(k=>typeof (raw.benchmark_evidence as Record<string,unknown>)[k]==="string") ? Object.fromEntries(RECEIPT.map(k=>[k,(raw.benchmark_evidence as Record<string,unknown>)[k]])) : undefined
 const topUnits=object(raw.units)?raw.units:{};const topProv=object(raw.provenance)?raw.provenance:{}
 const query=object(stored.sourceInput)?stored.sourceInput:{}
 const queryYear=Number(query.year),queryQuarter=Number(query.quarter)
 const queryPeriod=Number.isInteger(queryYear)&&queryYear>=1900&&queryYear<=2200 ? (Number.isInteger(queryQuarter)&&queryQuarter>=1&&queryQuarter<=4 ? `Q${queryQuarter}/${queryYear}` : String(queryYear)) : period(query.period)
 const queryScope=typeof query.consolidated === "boolean" ? (query.consolidated?"consolidated":"separate") : str(query.scope)
 const out:FinancialLeaf[]=[];let visited=0
 const walk=(v:unknown,path:string,anc:Record<string,unknown>[],key:string)=>{
  if(++visited>10000 || anc.length>16)return
  if(typeof v === "number" && Number.isFinite(v)) {
   if(/^(?:count|year|quarter|month|timestamp|time|t|date|index|id)$/i.test(key))return
   const nearest=(names:string[])=>{for(const a of [...anc].reverse())for(const k of names){const x=str(a[k]);if(x)return x}return undefined}
   let unit=str(topUnits[path])??nearest(["unit"])
   if(!unit)for(const [fields,u]of Object.entries(topUnits))if(fields.split(/[,;]/).map(x=>x.trim()).includes(key)&&typeof u==="string")unit=u
   const entity=nearest(["symbol","ticker","entity","index","country","series","sector"])??str(query.symbol)??str(query.ticker)
   const contextPeriod=anc.map(a=>period(a.period)??period(a.date)??period(a.last_t)??period(a.t)??period(a.time)??period(a.timestamp)??(Number.isInteger(a.year)&&Number.isInteger(a.quarter)?`Q${a.quarter}/${a.year}`:undefined)).filter(Boolean).at(-1)
   const columnIndex=/\/values\/(\d+)$/.exec(path)
   const columns=columnIndex?anc.map(a=>a.periods).find(Array.isArray):undefined
   const columnPeriod=columns&&columnIndex?period(columns[Number(columnIndex[1])]):undefined
   const sourcePeriod=period(key)??columnPeriod??contextPeriod??(/^(?:last|close|open|high|low|price|c|o|h|l|v|volume)$/i.test(key)?period(topProv.data_time):undefined)
   const sourceScope=nearest(["scope","consolidation","report_scope","statement_scope"])??anc.map(a=>typeof a.consolidated==="boolean"?(a.consolidated?"consolidated":"separate"):undefined).filter(Boolean).at(-1)
   out.push({ref,sdk_call_id:stored.callId!,call_id:receipt?.call_id as string|undefined,path,value:v,unit:unit??"",entity,period:sourcePeriod??queryPeriod,period_provenance:sourcePeriod?"source":queryPeriod?"sdk_query":undefined,scope:sourceScope??queryScope,scope_provenance:sourceScope?"source":queryScope?"sdk_query":undefined,query_context:stored.sourceInput,metric:nearest(["metric","item"])??((key==="value"||!!period(key)||!!columnIndex)?nearest(["name"]):undefined)??key,raw_source_sha256:stored.rawSha256,normalized_visible_sha256:stored.visibleSha256,source_response_sha256:receipt?.response_sha256 as string??stored.rawSha256!,source_payload_sha256:receipt?.payload_sha256 as string|undefined,receipt})
   return
  }
  if(v && typeof v==="object")for(const[k,x]of Object.entries(v)){if(["benchmark_evidence","provenance","units"].includes(k))continue;walk(x,`${path}/${escape(k)}`,object(v)?[...anc,v]:anc,k)}
 }
 walk(object(raw.data)||Array.isArray(raw.data)?raw.data:raw,raw.data!==undefined?"/data":"",[],"")
 return out
}
export function financialValue(spec:SourceSpec,lenient=false):FinancialLeaf {
 const stored=recallResult(spec.from_call)
 if(stored && ["calculate","compute"].includes(stored.tool)) {
  const parsed=parseResult(stored.text); if(!object(parsed)||!object(parsed.derived_result)||typeof parsed.result!=="number"||!Array.isArray(parsed.derived_result.inputs)||!stored.rawText||hash(stored.rawText)!==stored.rawSha256)throw new DerivationError("Derived ref lacks verified source lineage.")
  const roots=parsed.derived_result.inputs as FinancialLeaf[];for(const root of roots){const live=financialLeaves(root.ref).find(x=>x.path===root.path);if(!live||live.value!==root.value||live.source_response_sha256!==root.source_response_sha256)throw new DerivationError("Derived source changed or missing.")}
  if(spec.field&&spec.field!=="result")throw new DerivationError("Derived scalar field must be result.")
  return {ref:spec.from_call,sdk_call_id:stored.callId!,path:"/result",value:parsed.result,unit:String(parsed.unit??""),entity:[...new Set(roots.map(x=>x.entity).filter(Boolean))].join("|")||undefined,period:[...new Set(roots.map(x=>x.period).filter(Boolean))].join(" → ")||undefined,scope:[...new Set(roots.map(x=>x.scope).filter(Boolean))].join("|")||undefined,metric:`derived:${String(parsed.derived_result.expression)}`,source_response_sha256:stored.rawSha256!,derived_inputs:roots,derived_expression:parsed.derived_result.expression} as FinancialLeaf
 }
 let leaves=financialLeaves(spec.from_call)
 if(spec.from_symbol)leaves=leaves.filter(x=>x.entity?.toUpperCase()===spec.from_symbol!.trim().toUpperCase())
 if(spec.path){const p=spec.path.startsWith("/")?spec.path:"/"+spec.path.replace(/\[(\d+)\]/g,"/$1").replace(/\./g,"/");leaves=leaves.filter(x=>x.path===p || x.path.startsWith(p+"/"))}
 if(spec.field)leaves=leaves.filter(x=>x.metric===spec.field || x.path.split("/").at(-1)===spec.field || x.path.includes("/"+escape(spec.field!)+"/"))
 if(!leaves.length)throw new DerivationError(`No matching numeric leaf in ${spec.from_call}. Actual leaves: ${financialLeaves(spec.from_call).slice(0,24).map(x=>x.path).join(", ")}. Preserve source identity; correct only field/path/at.`)
 if(leaves.length>1 && (spec.at===undefined || new Set(leaves.map(x=>x.metric)).size>1))throw new DerivationError(`Ambiguous source ${spec.from_call}: ${leaves.slice(0,12).map(x=>x.path).join(", ")}. Specify exact leaf path or field plus at.`)
 const timeKey=(x:FinancialLeaf)=>{const s=x.period??"";const y=Number(/\d{4}/.exec(s)?.[0]??0);const q=Number(/Q([1-4])/i.exec(s)?.[1]??0);return y*10+q}
 if(leaves.every(x=>x.period))leaves.sort((a,b)=>timeKey(a)-timeKey(b)||String(a.period).localeCompare(String(b.period)))
 const at=spec.at===undefined||spec.at==="last"?leaves.length-1:spec.at==="first"?0:spec.at<0?leaves.length+spec.at:spec.at
 const result=leaves[at];if(!result)throw new DerivationError(`Index outside source ${spec.from_call}.`)
 // Same scale, differing only by the per-share denominator ("nghìn đồng" vs "nghìn đồng/cổ phiếu" for a price):
 // the label is equivalent, the source unit is kept on the leaf. Any other scale/dimension change still fails.
 const perShareOnly=(a:Record<string,number>,b:Record<string,number>)=>{const x={...a},y={...b};delete x["cổ phiếu"];delete y["cổ phiếu"];return sameDims(x,y)}
 if(spec.unit && result.unit && (parseUnit(spec.unit).factor!==parseUnit(result.unit).factor||!(sameDims(parseUnit(spec.unit).dims,parseUnit(result.unit).dims)||perShareOnly(parseUnit(spec.unit).dims,parseUnit(result.unit).dims))))throw new DerivationError(`Published unit ${result.unit} cannot be overridden as ${spec.unit}. Copy the source unit exactly; request conversion in output unit. A user label is not source metadata.`)
 if(!result.unit){if(lenient)return {...result,unit:spec.unit??""};throw new DerivationError(`Source ${spec.from_call} has no published financial unit; a caller-supplied unit is not proof.`)}
 return result
}
export function validateAlignment(inputs:FinancialLeaf[],alignment:"same_period"|"time_series"|"cross_entity_same_period"="same_period") {
 if(inputs.some(x=>!x.period))throw new DerivationError("Missing financial period; source or verified SDK query metadata is required.")
 if(inputs.length>1 && inputs.some(x=>!x.entity))throw new DerivationError("Missing entity metadata for a financial comparison; source or verified SDK query identity is required.")
 for(const key of ["scope",...(alignment!=="time_series"?["period"]:[]),...(alignment!=="cross_entity_same_period"?["entity"]:[])] as const){const declared=inputs.map(x=>x[key as "scope"|"period"|"entity"]);const values=new Set(declared.filter(Boolean));if(key==="period"&&!values.size)throw new DerivationError("Missing financial period on all sources; capture time is not a statement period.");if(values.size && declared.some(x=>!x))throw new DerivationError(`Missing ${key} on one source; alignment cannot be verified.`);if(values.size>1)throw new DerivationError(`Incompatible ${key}: ${[...values].join(", ")}. Declare intended alignment; do not change sources during repair.`)}
 if(alignment==="cross_entity_same_period"&&new Set(inputs.map(x=>x.metric).filter(Boolean)).size>1)throw new DerivationError("Cross-entity aggregation/comparison requires equivalent source metrics.")
 if(alignment==="time_series"&&new Set(inputs.map(x=>x.metric).filter(Boolean)).size>1)throw new DerivationError("A time-series calculation must retain the same metric.")
}
export function sourceProof(inputs:FinancialLeaf[],expression:string,value:unknown,unit?:string){
 const roots=(xs:FinancialLeaf[]):FinancialLeaf[]=>xs.flatMap(x=>x.derived_inputs?roots(x.derived_inputs):[x]);const source=roots(inputs)
 return {source_evidence:[...new Map(source.filter(x=>x.receipt).map(x=>[x.call_id,x.receipt])).values()],derived_result:{expression,value,unit:unit??"",alignment_verification:Object.fromEntries(["entity","period","scope","unit"].map(k=>[k,source.every(x=>!!x[k as keyof FinancialLeaf])?"verified":"unverified_missing"])),inputs:source,expression_inputs:inputs,source_scopes:source.map(x=>({entity:x.entity,period:x.period,scope:x.scope,metric:x.metric}))}}
}

/** Grounded failures that only say "this lineage cannot be proven" (missing unit/period/entity metadata,
 *  a typed operand, an undeclared alignment). The arithmetic itself is sound, so the tools may still
 *  compute and label the result unverified. Inconsistencies (scale changes, unit/metric/scope mismatch,
 *  unit overrides with another scale, unused variables, ambiguous selectors) are never relaxed: computing
 *  past them would produce a wrong number. */
export function relaxableDerivation(message: string): boolean {
  return [
    /has no published (financial )?unit/i,
    /Missing published financial unit/i,
    /Missing financial period/i,
    /Missing entity metadata/i,
    /Missing (scope|period|entity) on one source/i,
    /typed value\/ref is not source proof/i,
    /Financial figures must be retrieved via source refs/i,
    /requires at least one verified source operand/i,
    /Incompatible entity/i,
    /explicit unambiguous (field )?unit metadata/i,
    /lacks an intact SDK\/raw record/i,
  ].some((re) => re.test(message))
}

/** validateAlignment that, in lenient (unverified) mode, tolerates only missing-metadata failures. */
export function alignOrRelax(inputs:FinancialLeaf[],alignment:"same_period"|"time_series"|"cross_entity_same_period"|undefined,lenient:boolean){
 try{validateAlignment(inputs,alignment)}catch(error){if(!(lenient&&error instanceof DerivationError&&relaxableDerivation(error.message)))throw error}
}
