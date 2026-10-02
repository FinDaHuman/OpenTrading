import { readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

export type InstrumentType = "ticker" | "index" | "future"

const Instrument = z.strictObject({
  code: z.string().regex(/^[A-Z0-9]{2,12}$/),
  type: z.enum(["ticker", "index", "future"]),
  sector: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  /** Code that is also an ordinary word or currency (CEO, VND, GAS): only taken with @ or a cue word. */
  ambiguous: z.boolean().optional(),
})
export type Instrument = z.infer<typeof Instrument>

const InstrumentFile = z.object({ verified: z.boolean().optional(), instruments: z.array(Instrument) })

export const INSTRUMENTS_FILE = path.resolve(import.meta.dir, "../../../market/instruments.json")

/** Listed instruments are data, not code: read from market/instruments.json until an MCP source replaces it. */
export function loadInstruments(file = INSTRUMENTS_FILE): Instrument[] {
  return InstrumentFile.parse(JSON.parse(readFileSync(file, "utf8"))).instruments
}

export interface Mention {
  code: string
  type: InstrumentType
  sector?: string
}

// Unicode-aware boundaries: JavaScript `\b` only knows ASCII letters.
const TOKEN = /(?<![\p{L}\p{N}@])(@?)([A-Za-z0-9]{2,12})(?![\p{L}\p{N}])/gu
const CUE = /(?:^|[^\p{L}\p{N}])(?:mã|cổ phiếu|cp|ticker|chỉ số|hợp đồng)\s+$/iu

/**
 * Finds instrument codes the user is talking about. Only codes in the listing count, so "CEO", "USD" or "GDP" in a
 * sentence are not taken for tickers. Upper-case codes are taken as written; lower-case ones only right after a cue
 * word ("mã", "cổ phiếu", "cp", "ticker") or with @. Ambiguous codes always need @ or a cue word.
 */
export class TickerIndex {
  private readonly byCode: Map<string, Instrument>

  constructor(instruments: readonly Instrument[]) {
    this.byCode = new Map(instruments.map((i) => [i.code, i]))
  }

  get(code: string): Instrument | undefined {
    return this.byCode.get(code.toUpperCase())
  }

  /** Mentions in order of first appearance, without duplicates. `mentions` are explicit @-codes from the UI. */
  extract(text: string, mentions: readonly string[] = []): Mention[] {
    const found = new Map<string, Mention>()
    const take = (inst: Instrument) => {
      if (!found.has(inst.code)) found.set(inst.code, { code: inst.code, type: inst.type, sector: inst.sector })
    }
    for (const m of mentions) {
      const inst = this.get(m.replace(/^@/, ""))
      if (inst) take(inst)
    }
    const normalized = text.normalize("NFC")
    for (const match of normalized.matchAll(TOKEN)) {
      const [, at, raw] = match
      const inst = this.get(raw!)
      if (!inst) continue
      const explicit = at === "@"
      const cued = CUE.test(normalized.slice(0, match.index))
      const upper = raw === raw!.toUpperCase()
      if (inst.ambiguous ? explicit || cued : explicit || cued || upper) take(inst)
    }
    return [...found.values()]
  }

  /** Memory scopes touched by these mentions: the instrument itself and, for stocks, its sector. */
  scopesOf(mentions: readonly { code: string; type: InstrumentType }[]): string[] {
    const scopes = new Set<string>()
    for (const m of mentions) {
      scopes.add(`${m.type}:${m.code}`)
      const sector = this.get(m.code)?.sector
      if (sector) scopes.add(`sector:${sector}`)
    }
    return [...scopes].sort()
  }

  sectorsOf(codes: readonly string[]): string[] {
    return [...new Set(codes.flatMap((c) => (this.get(c)?.sector ? [this.get(c)!.sector!] : [])))].sort()
  }
}
