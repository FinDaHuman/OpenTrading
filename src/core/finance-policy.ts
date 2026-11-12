import { createHash } from "node:crypto"
import { parseResult, recallResult } from "./tools/refs"
import { financialValue } from "./tools/financial-source"
/** Opt-in native read-only finance safeguards. No task IDs, oracle or financial gold. */
import Ajv from "ajv"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { ToolDef } from "./tools/types"

export interface FinanceAuditOrigin {
  origin_provider_request_index?: number; origin_sdk_call_id: string
  origin_memory_session?: string; origin_memory_turn?: number; origin_native_session_id?: string
}
export interface FinancePolicyOptions { enabled: true; machineResponse?: boolean; auditContext?: () => {provider_request_index?:number;memory_session?:string;memory_turn?:number;native_session_id?:string} }
const ajv = new Ajv({ strict: false, strictSchema: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: false })
for (const keyword of ["x-opentrading-schema-profile", "x-repair-fields", "x-finite-request-variants", "x-scope-aliases"]) ajv.addKeyword({ keyword, valid: true })
const schemaValidators = new WeakMap<object, ReturnType<typeof ajv.compile>>()
/** The same authoritative request validation applies to both financial benchmark arms. */
export function validateAuthoritativeInput(schema: unknown, value: unknown) {
  if (!obj(schema)) return {success:false as const,error:new Error("invalid_tool_schema: MCP input contract must be an object; arguments were not executed.")}
  let validate = schemaValidators.get(schema)
  try { if (!validate) { validate=ajv.compile(schema as JSONSchema7); schemaValidators.set(schema,validate) } }
  catch(error) { return {success:false as const,error:new Error(`invalid_tool_schema: ${error instanceof Error ? error.message : String(error)}; arguments were not executed.`)} }
  return validate(value) ? {success:true as const,value} : {success:false as const,error:new Error(`invalid_argument: ${ajv.errorsText(validate.errors)}. Correct arguments to the declared schema; rejected input is not evidence of missing data.`)}
}
const key = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))) : x)
const comparisonValue = (v:unknown):unknown => Array.isArray(v) ? v.map(comparisonValue).sort((a,b)=>key(a).localeCompare(key(b))) : typeof v === "string" ? v.trim().toUpperCase() : obj(v) ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,comparisonValue(x)])) : v
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const path = (v: unknown, p: string): unknown => p.split(".").reduce<unknown>((x,k)=>obj(x) ? x[k] : undefined,v)
const immutableClone = (value: unknown): unknown => {
  const copy: unknown = structuredClone(value)
  const freeze = (v: unknown): unknown => { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v) }; return v }
  return freeze(copy)
}
export interface FinanceIntentAudit extends FinanceAuditOrigin {
  intent_id: string; original_sdk_call_id: string; sdk_call_id: string
  phase: "initial" | "correction" | "bounded_finance_correction" | "bounded_finance_acquisition"
  correction_budget: number; correction_used: number; reason: string
}
interface Intent {
  id: string; tool: string; canonical: string; scope: string; original: unknown; originalCallId: string
  args: Set<string>; eligible: boolean; attempts: number; correctionUsed: number
  status: "pending" | "failed" | "succeeded"; message: string
}
/** Structured error fields are authoritative. Bare legacy errors use only an anchored code. */
function correctionEligible(def: ToolDef, error: unknown): boolean {
  if (!def.readOnly) return false
  const raw = obj(error) ? error.structuredError ?? error : undefined
  const details = obj(raw) && obj(raw.error) ? raw.error : raw
  const code = obj(details) && typeof details.code === "string" ? details.code : undefined
  const allowed = new Set(["invalid_argument", "invalid_request", "invalid_tool_input", "unsupported_snapshot_query", "not_recorded", "schema_validation", "invalid_derivation", "parse"])
  if (code !== undefined) {
    const retry = obj(details) ? details.retryable_with_corrected_arguments ?? details.retryable : undefined
    return allowed.has(code) && retry !== false
  }
  const message = (error instanceof Error ? error.message : String(error)).trim()
  // Some legacy tools prefix a second machine failure with invalid_argument. Only
  // that immediate code position is considered, never auth/no-data words in prose.
  if (/^(?:invalid[_. ]argument|invalid[_. ]request)[:\s]+(?:unauthorized|forbidden|permission_denied|no_data|not_found|unavailable)(?:\b|:)/i.test(message)) return false
  return /^(?:invalid[_. ]argument|invalid[_. ]request|invalid_tool_input|unsupported_snapshot_query|not[_. ]recorded|invalid_derivation|schema(?:[_. ]validation)?|parse)(?:\b|:)/i.test(message.trim())
}
export class FinancePolicyState {
  readonly localRejections = new Map<string, {code:"invalid_tool_input"|"policy_guard_rejected";tool:string;rawInput:string;reason?:string;phase?:"bounded_finance_correction"|"bounded_finance_acquisition";allowedTools?:readonly string[]} & FinanceAuditOrigin>()
  readonly callAudit = new Map<string, FinanceIntentAudit>()
  repairAllowedTools?: ReadonlySet<string>
  private repairIntentIds?: ReadonlySet<string>
  acquisitionActive = false
  acquisitionUsed = false
  private acquisitionAllowedTools?: ReadonlySet<string>
  get acquisitionTools(): readonly string[] | undefined { return this.acquisitionAllowedTools ? [...this.acquisitionAllowedTools] : undefined }
  readonly successes: { tool: string; canonical: string; value: unknown }[] = []
  /** Retained for the complete turn, including successful corrections: no identity reset. */
  readonly failures = new Map<string, Intent>()
  private activeCalls = new Map<string, Intent>()
  private serial = 0
  constructor(readonly options: FinancePolicyOptions, readonly input: string) {}
  private scope(def: ToolDef, input: unknown): string {
    if (!obj(input)) return key(input)
    const schema = obj(def.input) ? def.input : {}
    const repairFields = new Set(Array.isArray(schema["x-repair-fields"]) ? (schema["x-repair-fields"] as string[]).filter(name=>!/symbol|ticker|currency|entity|peers|metric|statement|year|quarter|month|date|period|periods|count|limit|window|lookback|scope|consolidated|^(start|end|from|to)$/i.test(name)) : [])
    const properties = obj(schema.properties) ? schema.properties : {}
    const withDefaults = {...Object.fromEntries(Object.entries(properties).filter(([,v])=>obj(v) && "default" in v).map(([name,v])=>[name,(v as Record<string,unknown>).default])),...input}
    if (["calculate","compute"].includes(def.name) || def.canonicalName?.endsWith("analytics_compute")) {
      const stable = (v: unknown): unknown => {
        if(Array.isArray(v))return v.map(stable)
        if(!obj(v))return v
        if(typeof v.from_call === "string") {
          try {const leaf=financialValue({...v,from_call:v.from_call,path:typeof v.path==="string"?v.path.replace(/\/+$/, ""):v.path} as {from_call:string});return {...v,path:leaf.path,field:leaf.metric,at:undefined,entity:leaf.entity,period:leaf.period,scope:leaf.scope,unit:leaf.unit}}catch{}
        }
        // An ambiguous/invalid selector retains every byte; no broad operands relaxation.
        return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,stable(x)]))
      }
      return key(stable(withDefaults))
    }
    const entries = Object.entries(withDefaults).filter(([name])=>!repairFields.has(name)).map(([name,value])=> {
      // Equivalent scalar/list forms are compared only for public entity selectors.
      if (/symbol|ticker|currency|entity|peers/i.test(name)) {
        const normalized = (Array.isArray(value) ? value : [value]).map(x=>typeof x === "string" ? x.trim().toUpperCase() : x)
        return [name, [...new Set(normalized)].sort()] as const
      }
      const declared = properties[name]
      let compared:unknown=value
      // Lossless representation equivalence only; never discard an invalid financial
      // selector or collapse different invalid values into a single intent.
      if(obj(declared)) {
        const branches=[declared,...(Array.isArray(declared.anyOf) ? declared.anyOf.filter(obj) : []),...(Array.isArray(declared.oneOf) ? declared.oneOf.filter(obj) : [])]
        const types=branches.flatMap(branch=>Array.isArray(branch.type) ? branch.type : [branch.type])
        if((types.includes("integer") || types.includes("number")) && typeof value === "string" && /^[-+]?\d+$/.test(value.trim())) {
          const numeric=Number(value);if(Number.isSafeInteger(numeric)) compared=numeric
        }
        if(types.includes("array") && /^(columns|metrics|statements)$/i.test(name) && typeof value === "string") compared=[value]
      }
      // Domain aliases must be declared publicly by the tool contract, never guessed
      // from a failed value, task ID, answer or golden request.
      const aliases=obj(schema["x-scope-aliases"]) ? schema["x-scope-aliases"][name] : undefined
      if(obj(aliases) && typeof compared === "string" && Object.prototype.hasOwnProperty.call(aliases,compared)) compared=aliases[compared]
      return [name, schema["x-opentrading-schema-profile"] === "finite-replay-c2" ? comparisonValue(compared) : compared] as const
    })
    return key(Object.fromEntries(entries))
  }
  private requestKey(def:ToolDef,input:unknown): string {
    if(!obj(input) || !obj(def.input)) return key(input)
    const properties=obj(def.input.properties) ? def.input.properties : {}
    const value={...Object.fromEntries(Object.entries(properties).filter(([,v])=>obj(v) && "default" in v).map(([name,v])=>[name,(v as Record<string,unknown>).default])),...input}
    return key(def.input["x-opentrading-schema-profile"] === "finite-replay-c2" ? comparisonValue(value) : value)
  }
  private find(def: ToolDef, input: unknown): Intent | undefined {
    const canonical = def.canonicalName ?? def.name, scope = this.scope(def,input)
    return [...this.failures.values()].find(f=>f.canonical === canonical && f.scope === scope)
  }
  private create(def:ToolDef,input:unknown,callId:string): Intent {
    const f:Intent={id:`finance-intent-${++this.serial}`,tool:def.name,canonical:def.canonicalName ?? def.name,scope:this.scope(def,input),original:immutableClone(input),originalCallId:callId,args:new Set(),eligible:false,attempts:0,correctionUsed:0,status:"pending",message:""}
    this.failures.set(f.id,f);return f
  }
  private origin(callId:string):FinanceAuditOrigin {
    const context=this.options.auditContext?.() ?? {}
    return {origin_sdk_call_id:callId,origin_provider_request_index:context.provider_request_index,origin_memory_session:context.memory_session,origin_memory_turn:context.memory_turn,origin_native_session_id:context.native_session_id}
  }
  private occurrence(origin:FinanceAuditOrigin):string {
    // Older non-instrumented callers have no generation metadata. Benchmark
    // callbacks always supply it; SDK identifiers alone never scope those calls.
    return origin.origin_provider_request_index === undefined && origin.origin_memory_session === undefined && origin.origin_native_session_id === undefined ? origin.origin_sdk_call_id : key({origin_sdk_call_id:origin.origin_sdk_call_id,origin_provider_request_index:origin.origin_provider_request_index,origin_memory_session:origin.origin_memory_session,origin_memory_turn:origin.origin_memory_turn,origin_native_session_id:origin.origin_native_session_id})
  }
  noteLocalRejection(callId:string,row:Omit<FinancePolicyState["localRejections"] extends Map<string,infer V> ? V : never,keyof FinanceAuditOrigin>) {
    const origin=this.origin(callId), occurrence=this.occurrence(origin)
    this.localRejections.set(occurrence,{...row,...origin})
  }
  private record(f:Intent,callId:string,phase:FinanceIntentAudit["phase"],reason:string,origin=this.origin(callId)) {
    const occurrence=this.occurrence(origin)
    this.callAudit.set(occurrence,{...origin,intent_id:f.id,original_sdk_call_id:f.originalCallId,sdk_call_id:callId,phase,correction_budget:1,correction_used:f.correctionUsed,reason})
  }
  beginCorrection() {
    this.endAcquisition()
    this.repairIntentIds = new Set([...this.failures.values()].filter(f=>f.status === "failed" && f.eligible && f.correctionUsed < 1).map(f=>f.id))
    this.repairAllowedTools = new Set([...this.failures.values()].filter(f=>this.repairIntentIds!.has(f.id)).map(f=>f.tool))
    return this.repairIntentIds.size
  }
  beginOutputCorrection() {
    this.endAcquisition();this.repairIntentIds=new Set();this.repairAllowedTools=new Set()
  }
  /** A stop decision uses only the public response contract, candidate and actual calls.
   * It cannot establish evaluator coverage or whether a refusal is financially correct.
   */
  beginAcquisition(tools: readonly string[]) {
    this.acquisitionUsed=true;this.acquisitionActive=true
    this.acquisitionAllowedTools=new Set(tools)
    this.repairIntentIds=undefined;this.repairAllowedTools=undefined
  }
  endAcquisition() { this.acquisitionActive=false;this.acquisitionAllowedTools=undefined }
  validate(def: ToolDef, value: unknown) { return validateAuthoritativeInput(def.input,value) }

  before(def: ToolDef, input: unknown, callId = `direct-${++this.serial}`) {
    let f = this.find(def,input)
    const reject = (message:string): never => {
      if (!f) f=this.create(def,input,callId)
      this.record(f,callId,this.repairIntentIds ? "bounded_finance_correction" : this.acquisitionActive ? "bounded_finance_acquisition" : "initial",message)
      throw new Error(message)
    }
    if (this.acquisitionActive && (!def.readOnly || !this.acquisitionAllowedTools?.has(def.name))) reject("Bounded finance acquisition permits only declared read-only tools; side effects are not authorized.")
    if (this.repairIntentIds && (!f || !this.repairIntentIds.has(f.id))) reject("Bounded finance correction changed original entity/currency or temporal/financial scope, or targeted an unrelated intent; rejected without execution.")
    if (f) {
      if (f.args.has(this.requestKey(def,input)) || f.status === "pending" || f.status === "succeeded") reject("Repeated or already pending/successful intent; do not replay this request.")
      if (!f.eligible || f.correctionUsed >= 1) reject("Tool correction exhausted or ineligible; do not replay this request.")
      f.correctionUsed++
    } else f=this.create(def,input,callId)
    f.args.add(this.requestKey(def,input));f.status="pending";this.activeCalls.set(this.occurrence(this.origin(callId)),f)
    this.record(f,callId,this.repairIntentIds ? "bounded_finance_correction" : this.acquisitionActive ? "bounded_finance_acquisition" : f.correctionUsed ? "correction" : "initial","execution_reserved")
    return this.callAudit.get(this.occurrence(this.origin(callId)))!
  }
  failed(def: ToolDef, input: unknown, error: unknown, callId?: string, reservedOrigin?:FinanceAuditOrigin) {
    const origin=reservedOrigin ?? this.origin(callId ?? "")
    let f = callId ? this.activeCalls.get(this.occurrence(origin)) : undefined
    f ??= this.find(def,input)
    if (!f) f=this.create(def,input,callId ?? `validation-${++this.serial}`)
    // Validation happens before execute. Reserve its correction once, with actual SDK ID.
    const id=callId ?? f.originalCallId
    if(f.status === "succeeded") {this.record(f,id,this.repairIntentIds ? "bounded_finance_correction" : this.acquisitionActive ? "bounded_finance_acquisition" : "initial","invalid_duplicate_after_success; successful intent retained",origin);return}
    if (!this.activeCalls.has(this.occurrence(origin)) && f.status === "failed" && !f.args.has(this.requestKey(def,input))) {
      if (f.correctionUsed >= 1) return
      f.correctionUsed++
    }
    f.args.add(this.requestKey(def,input));f.attempts++;f.status="failed";f.eligible=correctionEligible(def,error)
    f.message=error instanceof Error ? error.message : String(error)
    this.activeCalls.delete(this.occurrence(origin))
    this.record(f,id,this.repairIntentIds ? "bounded_finance_correction" : this.acquisitionActive ? "bounded_finance_acquisition" : f.correctionUsed ? "correction" : "initial",f.message,origin)
  }
  succeeded(def: ToolDef, value: unknown, input?: unknown, callId?:string, reservedOrigin?:FinanceAuditOrigin) {
    const origin=reservedOrigin ?? this.origin(callId ?? "")
    const f=callId ? this.activeCalls.get(this.occurrence(origin)) : input === undefined ? undefined : this.find(def,input)
    if(f){f.status="succeeded";f.eligible=false;this.activeCalls.delete(this.occurrence(origin));this.record(f,callId!,this.repairIntentIds ? "bounded_finance_correction" : this.acquisitionActive ? "bounded_finance_acquisition" : f.correctionUsed ? "correction" : "initial","execution_succeeded",origin)}
    const text = typeof value === "string" ? value : obj(value) && typeof value.output === "string" ? value.output : undefined
    let parsed: unknown = value
    // runTool adds a local [ref rN] prefix and may cap the visible body. Read the
    // intact original only when this exact SDK call and registered tool own it.
    const ref = text && /^\[ref (r\d+)\]\s*/.exec(text)?.[1]
    const stored = ref ? recallResult(ref) : undefined
    const raw = stored && callId && stored.callId === callId && stored.tool === def.name && stored.rawText && createHash("sha256").update(stored.rawText).digest("hex") === stored.rawSha256 ? stored.rawText : undefined
    try { if (text !== undefined && (!ref || raw !== undefined)) parsed = parseResult(raw ?? text) ?? value } catch {}
    this.successes.push({tool:def.name, canonical:def.canonicalName ?? def.name, value:immutableClone(parsed)})
  }
  correctionTools() { return [...new Set([...this.failures.values()].filter(f=>f.status === "failed" && f.eligible && f.correctionUsed < 1 && (!this.repairIntentIds || this.repairIntentIds.has(f.id))).map(f=>f.tool))] }
  /** Contract keys come from user-provided JSON examples, including appended evidence mapping. */
  issues(text: string, defs: ToolDef[]): string[] {
    if (!this.options.machineResponse) return []
    let value: unknown
    try { value = JSON.parse(text) } catch {
      // v4.6-update: a SOLE fenced JSON with whitespace outside is equivalent
      // to the bare object — matches the grounded metric's fence acceptance
      // (the endpoint previously enforced the strict bare-object form, killing
      // grounded-acceptable fenced answers from fence-style models).
      const fence = /^\s*```(?:json)?\s*([\s\S]+?)\s*```\s*$/.exec(text)
      const inner = fence ? fence[1]! : text
      try { value = JSON.parse(inner) } catch { return ["Final response must be exactly one JSON object, without markdown or surrounding prose."] }
    }
    if (!obj(value)) return ["Final response must be a JSON object."]
    const issues: string[] = []
    let refusal = false
    const publicContract = /^PUBLIC_RESPONSE_CONTRACT_V\d+=(.+)$/m.exec(this.input)
    if (publicContract) {
      try {
        const contract = JSON.parse(publicContract[1]!)
        if (obj(contract) && typeof contract.version === "string" && obj(contract.refusalSchema) && value.value === null) {
          const valid = ajv.compile(contract.refusalSchema)
          refusal = !!valid(value)
          if (!refusal) issues.push("Refusal must satisfy the public refusal schema: value:null, nonempty reason, evidence array.")
          if (["values","ranking","items"].some(k=>value[k] !== undefined && (Array.isArray(value[k]) ? value[k].length > 0 : obj(value[k]) ? Object.keys(value[k]).length > 0 : value[k] !== null))) issues.push("Refusal cannot contain incompatible nonempty success fields.")
        }
      } catch { issues.push("Public response contract is malformed; cannot validate refusal.") }
    }
    if (publicContract && value.value !== null && ["values","ranking","items"].some(k=>obj(value[k]) ? Object.values(value[k]).some(x=>x === null) : Array.isArray(value[k]) && value[k].some(x=>x === null))) issues.push('A null success map is not the refusal branch. For refusal return {"value":null,"reason":"specific honest reason","evidence":[]} and omit nonempty values/ranking/items; otherwise acquire actual evidence and fill the requested success fields.')
    const nullable = new Set([...this.input.matchAll(/["`]?([A-Za-z_]\w*)["`]?\s*(?::|=|(?:với|là|as)\s+(?:JSON\s+)?)\s*["`]?null\b/gu)].map(m=>m[1]))
    let sourceContract = /source[^\n]{0,160}(?:tên tool|tool name|catalog|namespace tool)/i.test(this.input)
    const examples = [...this.input.matchAll(/```json\s*([\s\S]*?)```/g)]
    for (const example of refusal ? [] : examples) {
      try {
        const e = JSON.parse(example[1]!)
        if (obj(e)) for (const k of Object.keys(e)) {
          const optional = typeof e[k] === "string" && /tuỳ chọn|tùy chọn|optional/i.test(e[k])
          if (!(k in value)) { if (!optional) issues.push(`Missing requested field: ${k}`); continue }
          // JSON examples declare public field shapes; null refusal remains permitted
          // only when the user explicitly discusses null in the requested contract.
          if (k === "source" && typeof e[k] === "string" && defs.some(d=>e[k] === (d.canonicalName ?? d.name))) sourceContract = true
          if (value[k] === null && nullable.has(k)) continue
          const shape = (v: unknown) => Array.isArray(v) ? "array" : v === null ? "null" : typeof v
          if (shape(e[k]) !== shape(value[k])) issues.push(`Requested field has wrong JSON type: ${k}; expected ${shape(e[k])}`)
        }
      } catch {}
    }
    const names = new Set(defs.map(d=>d.canonicalName ?? d.name))
    const sourceNames = typeof value.source === "string" ? value.source.split(/[,;+|]+/).map(s=>s.trim()) : Array.isArray(value.source) ? value.source : []
    if (!refusal && sourceContract && !(value.source === null && nullable.has("source")) && (!sourceNames.length || !sourceNames.every(s=>typeof s === "string" && names.has(s)))) issues.push("source must use exact registered tool names, not provider names or invented aliases.")
    // Parse public evidence field mapping supplied by caller/user, never a hidden grader schema.
    const mappings = [...this.input.matchAll(/\{[^{}]*"tool"\s*:[^{}]*\}/g)].map(m=>{try{return JSON.parse(m[0])}catch{return undefined}}).filter(obj)
    const mapping = mappings.find(m=>Object.values(m).some(v=>typeof v === "string" && v.includes(".")))
    if (mapping) {
      if (!Array.isArray(value.evidence)) issues.push("Required evidence must be an array copied from actual successful tool results.")
      else for (const row of value.evidence) {
        const matched = obj(row) && this.successes.some(s=>Object.entries(mapping).every(([k,p])=> {
          const expected = k === "tool" ? s.canonical : typeof p === "string" ? path(s.value,p) : undefined
          return expected !== undefined && key(row[k]) === key(expected)
        }))
        if (!matched) issues.push("Evidence row does not exactly match any actual successful tool response; copy public mapped fields unchanged.")
      }
      if (value.value !== null && Array.isArray(value.evidence) && value.evidence.length === 0) issues.push("Non-null answer requires actual successful tool evidence.")
    }
    return [...new Set(issues)]
  }
}
