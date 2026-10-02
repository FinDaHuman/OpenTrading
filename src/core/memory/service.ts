import type { Database } from "bun:sqlite"
import { TickerIndex } from "../market/tickers"
import type { RuleSet } from "../rules/load"
import { manualRuleNames, matchRules } from "../rules/match"
import { classifyContent } from "./content"
import { parseMemoryConfig, type MemoryConfig } from "./config"
import { addDays, calendarDate, type Clock, daysBetween, type IdFactory, systemClock, uuidV7Ids } from "./deps"
import { type EntityState, sameEntities, updateEntities } from "./entities"
import { isPromotionCandidate, shouldAutoDisable } from "./feedback"
import { coveredBy, fingerprint } from "./fingerprint"
import { MigrationBusyError, migrateMemory } from "./migrate"
import type {
  ContextBudget,
  ContextContribution,
  FeedbackResult,
  InjectionRef,
  MemoryHit,
  MemoryPort,
  MemoryWarning,
  ProposeResult,
  RememberResult,
  SystemMemory,
  TransitionResult,
  TurnContext,
  UserMemoryCommands,
  WriteOptions,
} from "./port"
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  fitsAlone,
  renderBlock,
  renderItem,
  renderRule,
  renderRuleCatalog,
  SCOPED_CLOSE,
  SCOPED_OPEN,
  SCOPED_WRAPPER_BYTES,
  WRAPPER_BYTES,
} from "./render"
import { MemoryRepo, type RowResult, rowToItem, StorageError } from "./repo"
import {
  foldVietnamese,
  IsoDate,
  type Kind,
  type MemoryItem,
  normalizeBody,
  prepareBody,
  SCHEMA_VERSION,
  SCOPE_PATTERN,
  type Status,
  utf8Bytes,
  type Visibility,
} from "./schema"
import { pack, scopedOrder, t1Order } from "./select"
import { pickWithT3, type T3Selector } from "./t3"

export interface MemoryServiceDeps {
  /** Raw `memory` section of the config file; parsed here. Invalid values throw at creation. */
  config?: unknown
  clock?: Clock
  ids?: IdFactory
  /**
   * Per-installation secret for fingerprints, kept outside the database by the composition root.
   * Tests may omit it; production must pass the installation's salt.
   */
  salt?: string
  /** Listed instruments for T2. Without it no ticker is recognised and only global memory applies. */
  tickers?: TickerIndex
  /** Rule source, called once per turn so edited rule files apply on the next turn. */
  rules?: () => RuleSet
  /** T3 selector (a small model owned by the core). Used only when config.t3 is "llm". */
  t3?: T3Selector
}

export interface MemoryService {
  port: MemoryPort
  commands: UserMemoryCommands
  system: SystemMemory
}

interface SessionState {
  turn: number
  entities: EntityState
  last?: { turn: number; ids: string[]; applied: boolean }
}

const SEPARATOR_BYTES = 2 // "\n\n" between the stable and the per-turn block

// User-facing (shown on the TUI), so Vietnamese. Never includes a memory body.
const warn = {
  dbUnavailable: (): MemoryWarning => ({
    code: "db_unavailable",
    message: "Không đọc được memory; lượt này chạy không có memory.",
  }),
  selectionFailed: (): MemoryWarning => ({
    code: "selection_failed",
    message: "Lỗi khi chọn memory; lượt này chạy không có memory.",
  }),
  invalidRecord: (n: number): MemoryWarning => ({
    code: "invalid_record",
    message: `${n} bản ghi memory không hợp lệ đã bị bỏ qua.`,
  }),
  overflow: (n: number, max: number): MemoryWarning => ({
    code: "t1_overflow",
    message: `${n} mục (memory/rule luôn nạp) không được nạp vì vượt giới hạn ${max} byte. Hãy gộp hoặc xoá bớt.`,
  }),
  projectionOverflow: (n: number, max: number): MemoryWarning => ({
    code: "projection_overflow",
    message: `${n} mục theo mã không được nạp vì vượt giới hạn ${max} byte.`,
  }),
  entityLimit: (codes: string[]): MemoryWarning => ({
    code: "entity_limit",
    message: `Đang theo dõi quá nhiều mã; bỏ ${codes.join(", ")} khỏi ngữ cảnh.`,
  }),
  ruleError: (n: number): MemoryWarning => ({
    code: "rule_error",
    message: `${n} file rule bị lỗi và không được nạp.`,
  }),
  t3Timeout: (): MemoryWarning => ({
    code: "t3_timeout",
    message: "Bộ chọn memory (T3) quá thời gian; bỏ qua lượt này.",
  }),
  t3Failed: (): MemoryWarning => ({ code: "t3_failed", message: "Bộ chọn memory (T3) lỗi; bỏ qua lượt này." }),
}

const storageCode = (error: unknown): "storage_busy" | "storage_failed" =>
  error instanceof MigrationBusyError || (error instanceof StorageError && error.code === "storage_busy")
    ? "storage_busy"
    : "storage_failed"

const empty = (warnings: MemoryWarning[] = []): ContextContribution => ({
  stableBlocks: [],
  projection: null,
  injection: null,
  entities: null,
  used: { memories: [], rules: [] },
  warnings,
})

/**
 * Composition point for memory. Returns three separate objects:
 * - `port`: read side for the agent loop and model-facing code;
 * - `commands`: the user's write capability, handed only to the TUI adapter;
 * - `system`: proposals from feedback, validator and tool errors, which are never active until approved.
 * The Database is always passed in explicitly; this never opens or locates a database file itself.
 */
export function createMemoryService(db: Database, deps: MemoryServiceDeps = {}): MemoryService {
  const config: MemoryConfig = parseMemoryConfig(deps.config)
  const clock = deps.clock ?? systemClock
  const ids = deps.ids ?? uuidV7Ids
  const salt = deps.salt ?? "opentrading-memory-default-salt"
  const tickers = deps.tickers ?? new TickerIndex([])
  const ruleSet = (): RuleSet => deps.rules?.() ?? { rules: [], errors: [] }
  const repo = new MemoryRepo(db)
  const sessions = new Map<string, SessionState>()

  const nowIso = () => clock.now().toISOString()
  const today = () => calendarDate(clock.now(), config.timezone)
  const session = (id: string) => {
    let s = sessions.get(id)
    if (!s) sessions.set(id, (s = { turn: 0, entities: { items: [] } }))
    return s
  }

  // Migrate lazily so a disabled memory never touches the database, and a failed attempt is retried next time.
  let ready = false
  const ensureReady = () => {
    if (ready) return
    migrateMemory(db, clock)
    ready = true
  }

  const parseRows = (rows: ReturnType<MemoryRepo["query"]>) => {
    const items: MemoryItem[] = []
    let invalid = 0
    for (const row of rows) {
      const r: RowResult = rowToItem(row)
      if (r.ok) items.push(r.item)
      else invalid++
    }
    return { items, invalid }
  }

  /** Normalize, check and classify. Title and body are classified together. */
  function screen(raw: { body: unknown; title?: unknown }, opts: WriteOptions | undefined) {
    const body = prepareBody(raw.body, config.maxItemBytes)
    if (!body.ok) return body
    let title: string | null = null
    if (raw.title !== undefined && raw.title !== null) {
      if (typeof raw.title !== "string")
        return { ok: false as const, code: "invalid_input" as const, reasons: ["title"] }
      title = normalizeBody(raw.title) || null
      if (title && utf8Bytes(title) > 240) return { ok: false as const, code: "too_large" as const, reasons: ["title"] }
    }
    const verdict = classifyContent(title ? `${title}\n${body.body}` : body.body)
    if (verdict.verdict === "rejected")
      return { ok: false as const, code: "content_rejected" as const, reasons: verdict.reasons }
    // Nothing is written until the user confirms; confirmation never overrides a rejection.
    if (verdict.verdict === "ambiguous" && opts?.confirmAmbiguous !== true)
      return { ok: false as const, code: "needs_confirmation" as const, reasons: verdict.reasons }
    return { ok: true as const, body: body.body, title }
  }

  const visibilityOf = (v: unknown): Visibility | null =>
    v === undefined ? "model" : v === "model" || v === "restricted" ? v : null

  /** Restricted and scoped items land in the per-turn block; everything else in the stable block. */
  const fits = (item: MemoryItem) =>
    item.visibility === "restricted" || item.scope !== "global"
      ? fitsAlone(item, config.projectionMaxBytes, SCOPED_WRAPPER_BYTES)
      : fitsAlone(item, config.t1MaxBytes, WRAPPER_BYTES)

  function store(item: MemoryItem, text: string): RememberResult {
    if (!fits(item)) return { ok: false, code: "t1_unfit", reasons: ["max_block_bytes"] }
    try {
      ensureReady()
      const fp = fingerprint(salt, item.kind, item.scope, text)
      // Saying the same thing twice keeps one memory.
      const same = repo.findByFingerprint(fp).find((r) => r.status === "active")
      if (same) {
        const existing = rowToItem(repo.get(same.id)!)
        if (existing.ok) return { ok: true, item: existing.item }
      }
      repo.insert(item, fp)
    } catch (error) {
      return { ok: false, code: storageCode(error), reasons: [] }
    }
    return { ok: true, item }
  }

  function newItem(
    fields: Pick<
      MemoryItem,
      | "kind"
      | "scope"
      | "title"
      | "body"
      | "status"
      | "visibility"
      | "createdBy"
      | "origin"
      | "expiresAt"
      | "sourceEvents"
    >,
  ): MemoryItem {
    const now = nowIso()
    return {
      schemaVersion: SCHEMA_VERSION,
      id: ids.next(),
      version: 1,
      asOf: today(),
      createdAt: now,
      updatedAt: now,
      ...fields,
    }
  }

  async function transition(id: string, from: readonly Status[], to: Status): Promise<TransitionResult> {
    try {
      ensureReady()
      const row = repo.get(id)
      if (!row) return { ok: false, code: "not_found" }
      if (to === "purged" || to === "rejected") {
        if (!repo.eraseContent(id, from, to, nowIso())) return { ok: false, code: "invalid_state" }
        if (to === "purged") repo.checkpoint()
        return { ok: true }
      }
      return repo.setStatus(id, from, to, nowIso()) ? { ok: true } : { ok: false, code: "invalid_state" }
    } catch (error) {
      return { ok: false, code: storageCode(error) }
    }
  }

  /** Builds the memory text for one request. `advance` is false for previews: no T3, no state change. */
  async function build(
    s: SessionState,
    entities: EntityState,
    ctx: { userText: string; allowed: ReadonlySet<string> },
    budget: ContextBudget | undefined,
    useT3: boolean,
  ): Promise<ContextContribution> {
    const warnings: MemoryWarning[] = []
    const day = today()

    let items: MemoryItem[] = []
    try {
      ensureReady()
      const parsed = parseRows(repo.query({ statuses: ["active"], validOn: day }))
      items = parsed.items
      if (parsed.invalid > 0) warnings.push(warn.invalidRecord(parsed.invalid))
    } catch {
      // Rules do not need the database, so they still apply; the warning says memory is missing.
      warnings.push(warn.dbUnavailable())
    }

    try {
      const rules = ruleSet()
      if (rules.errors.length > 0) warnings.push(warn.ruleError(rules.errors.length))
      const codes = entities.items.map((e) => e.code)
      const scopes = new Set(tickers.scopesOf(entities.items))
      const matched = matchRules(
        rules.rules,
        { tickers: codes, sectors: tickers.sectorsOf(codes) },
        manualRuleNames(ctx.userText),
      )

      const requested = budget?.maxBytes
      const total =
        requested === undefined
          ? Number.POSITIVE_INFINITY
          : Number.isFinite(requested)
            ? Math.max(0, Math.floor(requested))
            : 0

      // Stable block: always-on rules, the agent-rule catalog, then T1 memories.
      type Entry = { text: string; memory?: MemoryItem; rule?: string }
      const t1 = items
        .filter((i) => i.visibility === "model" && i.scope === "global" && i.kind !== "note")
        .sort(t1Order)
      const stableEntries: Entry[] = [
        ...matched.always.map((r) => ({ text: renderRule(r), rule: r.name })),
        ...(matched.catalog.length ? [{ text: renderRuleCatalog(matched.catalog) }] : []),
        ...t1.map((m) => ({ text: renderItem(m), memory: m })),
      ]
      const stableCap = Math.min(config.t1MaxBytes, total)
      const stable = pack(stableEntries, (e) => e.text, stableCap, WRAPPER_BYTES)
      if (stable.overflow > 0) warnings.push(warn.overflow(stable.overflow, stableCap))

      // Per-turn block: scoped rules, then scoped memories, then restricted items switched on for this turn.
      const inStable = new Set(stable.taken.flatMap((e) => (e.memory ? [e.memory.id] : [])))
      const scoped = items
        .filter(
          (i) =>
            !inStable.has(i.id) &&
            ((i.visibility === "model" && i.scope !== "global" && scopes.has(i.scope)) ||
              (i.visibility === "restricted" && ctx.allowed.has(i.id))),
        )
        .sort(scopedOrder)

      let picked: MemoryItem[] = []
      if (useT3 && config.t3 === "llm" && deps.t3) {
        const chosen = new Set([...inStable, ...scoped.map((i) => i.id)])
        const candidates = items.filter((i) => i.visibility === "model" && !chosen.has(i.id))
        if (candidates.length > 0) {
          const outcome = await pickWithT3(deps.t3, candidates, ctx.userText, config.t3TimeoutMs)
          if ("timedOut" in outcome) warnings.push(warn.t3Timeout())
          else if ("failed" in outcome) warnings.push(warn.t3Failed())
          const want = new Set(outcome.ids)
          picked = candidates.filter((c) => want.has(c.id))
        }
      }

      const age = (m: MemoryItem) => Math.max(0, daysBetween(m.asOf, day))
      // The user's own notes and lessons first: they are short and specific to this user; generic rules follow.
      const scopedEntries: Entry[] = [
        ...[...scoped, ...picked].map((m) => ({ text: renderItem(m, { ageDays: age(m) }), memory: m })),
        ...matched.scoped.map((r) => ({ text: renderRule(r), rule: r.name })),
      ]
      const remaining = Math.max(0, total - (stable.bytes ? stable.bytes + SEPARATOR_BYTES : 0))
      const projectionCap = Math.min(config.projectionMaxBytes, remaining)
      const projection = pack(scopedEntries, (e) => e.text, projectionCap, SCOPED_WRAPPER_BYTES)
      if (projection.overflow > 0) warnings.push(warn.projectionOverflow(projection.overflow, projectionCap))

      const stableBlock = renderBlock(stable.pieces, BLOCK_OPEN, BLOCK_CLOSE)
      const projectionBlock = renderBlock(projection.pieces, SCOPED_OPEN, SCOPED_CLOSE)
      const refs: InjectionRef[] = projection.taken.map((e) =>
        e.memory
          ? {
              type: "memory",
              id: e.memory.id,
              version: e.memory.version,
              ageDays: age(e.memory),
              restricted: e.memory.visibility === "restricted",
            }
          : { type: "rule", name: e.rule!, hash: rules.rules.find((r) => r.name === e.rule)!.hash },
      )
      const all = [...stable.taken, ...projection.taken]
      return {
        stableBlocks: stableBlock ? [stableBlock] : [],
        projection: projectionBlock,
        injection: refs.length > 0 ? { refs } : null,
        entities: sameEntities(entities, s.entities) ? null : entities,
        used: {
          memories: all.flatMap((e) => (e.memory ? [e.memory.id] : [])),
          rules: all.flatMap((e) => (e.rule ? [e.rule] : [])),
        },
        warnings,
      }
    } catch {
      return empty([...warnings, warn.selectionFailed()])
    }
  }

  const port: MemoryPort = {
    async beforeTurn(ctx: TurnContext, budget?: ContextBudget) {
      if (!config.enabled) return empty()
      const s = session(ctx.sessionId ?? "")
      const turn = s.turn + 1
      let update: ReturnType<typeof updateEntities>
      try {
        update = updateEntities(s.entities, tickers.extract(ctx.userText ?? "", ctx.mentions ?? []), turn, {
          ttlTurns: config.entityTtlTurns,
          max: config.maxEntities,
        })
      } catch {
        update = { state: s.entities, evicted: [] }
      }
      const result = await build(
        s,
        update.state,
        { userText: ctx.userText ?? "", allowed: new Set(ctx.allowedRestrictedIds ?? []) },
        budget,
        true,
      )
      if (update.evicted.length > 0) result.warnings.push(warn.entityLimit(update.evicted))
      s.turn = turn
      s.entities = update.state
      s.last = { turn, ids: result.used.memories, applied: false }
      return result
    },

    async peek(ctx, budget) {
      if (!config.enabled) return empty()
      const s = sessions.get(ctx.sessionId ?? "") ?? { turn: 0, entities: { items: [] } }
      return build(s, s.entities, { userText: ctx.userText ?? "", allowed: new Set() }, budget, false)
    },

    async afterTurn({ sessionId }) {
      const s = sessions.get(sessionId ?? "")
      if (!s?.last || s.last.applied || s.last.ids.length === 0) return
      ensureReady()
      repo.recordUsage(
        s.last.ids.map((id) => ({ memoryId: id, sessionId: sessionId ?? "", turn: s.last!.turn, verdict: "applied" })),
        nowIso(),
      )
      s.last.applied = true
    },

    async search(query, opts = {}) {
      const limit = Math.max(1, Math.min(20, opts.limit ?? 5))
      const words = foldVietnamese(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 2)
        .slice(0, 12)
      if (words.length === 0) return []
      ensureReady()
      const hits = repo.search(words.map((w) => `"${w}"`).join(" "), limit * 4)
      const allowed = new Set(opts.allowedRestrictedIds ?? [])
      const live = new Map(
        parseRows(repo.query({ ids: hits.map((h) => h.memory_id), statuses: ["active"], validOn: today() })).items.map(
          (i) => [i.id, i],
        ),
      )
      const out: MemoryHit[] = []
      for (const h of hits) {
        const item = live.get(h.memory_id)
        if (!item) continue
        if (item.visibility === "restricted" && !allowed.has(item.id)) continue
        if (opts.scope && item.scope !== opts.scope) continue
        const body = (item.body ?? "").replace(/\s+/g, " ")
        out.push({
          id: item.id,
          kind: item.kind,
          scope: item.scope,
          title: item.title,
          snippet: body.length > 160 ? `${body.slice(0, 157)}…` : body,
        })
        if (out.length >= limit) break
      }
      return out
    },

    loadRule(name) {
      return ruleSet().rules.find((r) => r.name === name)?.body ?? null
    },

    endSession(sessionId) {
      sessions.delete(sessionId)
    },
  }

  const system: SystemMemory = {
    async propose(input) {
      const body = prepareBody(input.body, config.maxItemBytes)
      if (!body.ok) return { ok: false, code: body.code, reasons: body.reasons }
      const title = typeof input.title === "string" ? normalizeBody(input.title) || null : null
      const text = title ? `${title}\n${body.body}` : body.body
      // Proposals are reviewed by the user anyway, so ambiguous text may be proposed; market data may not.
      const verdict = classifyContent(text)
      if (verdict.verdict === "rejected") return { ok: false, code: "content_rejected", reasons: verdict.reasons }
      const scope = input.scope ?? "global"
      if (!SCOPE_PATTERN.test(scope)) return { ok: false, code: "invalid_input", reasons: ["scope"] }
      if (ruleSet().rules.some((r) => coveredBy(text, r.body)))
        return { ok: false, code: "covered_by_rule", reasons: [] }
      const item = newItem({
        kind: "lesson",
        scope,
        title,
        body: body.body,
        status: "proposed",
        visibility: "model",
        createdBy: "system",
        origin: input.origin,
        expiresAt: null,
        sourceEvents: input.sourceEvents ?? [],
      })
      if (!fits(item)) return { ok: false, code: "too_large", reasons: ["max_block_bytes"] }
      try {
        ensureReady()
        const fp = fingerprint(salt, "lesson", scope, text)
        const seen = repo.findByFingerprint(fp)
        if (seen.length > 0) return { ok: false, code: "duplicate", reasons: seen.map((r) => r.status) }
        const since = new Date(clock.now().getTime() - 86_400_000).toISOString()
        if (repo.countSystemProposalsSince(since) >= config.maxProposalsPerDay)
          return { ok: false, code: "daily_cap", reasons: [] }
        repo.insert(item, fp)
      } catch (error) {
        return { ok: false, code: storageCode(error), reasons: [] }
      }
      return { ok: true, item }
    },
  }

  const commands: UserMemoryCommands = {
    async remember(input, opts) {
      const visibility = visibilityOf((input as { visibility?: unknown } | null | undefined)?.visibility)
      if (!visibility) return { ok: false, code: "invalid_input", reasons: ["visibility"] }
      const screened = screen(
        { body: (input as { body?: unknown } | null | undefined)?.body, title: input?.title },
        opts,
      )
      if (!screened.ok) return screened
      const item = newItem({
        kind: "profile",
        scope: "global",
        title: screened.title,
        body: screened.body,
        status: "active",
        visibility,
        createdBy: "user",
        origin: "remember_command",
        expiresAt: null,
        sourceEvents: [],
      })
      return store(item, screened.title ? `${screened.title}\n${screened.body}` : screened.body)
    },

    async note(input, opts) {
      const visibility = visibilityOf(input?.visibility)
      if (!visibility) return { ok: false, code: "invalid_input", reasons: ["visibility"] }
      const inst = typeof input?.code === "string" ? tickers.get(input.code.replace(/^@/, "")) : undefined
      if (!inst) return { ok: false, code: "unknown_instrument", reasons: [] }
      const day = today()
      let expiresAt = input.expiresAt ?? addDays(day, config.suggestedNoteTtlDays.market)
      if (
        !IsoDate.safeParse(expiresAt).success ||
        Number.isNaN(Date.parse(`${expiresAt}T00:00:00Z`)) ||
        expiresAt < day
      )
        return { ok: false, code: "invalid_date", reasons: [] }
      const screened = screen({ body: input.body }, opts)
      if (!screened.ok) return screened
      const item = newItem({
        kind: "note",
        scope: `${inst.type}:${inst.code}`,
        title: null,
        body: screened.body,
        status: "active",
        visibility,
        createdBy: "user",
        origin: "note_command",
        expiresAt,
        sourceEvents: [],
      })
      return store(item, screened.body)
    },

    async edit(id, input, opts) {
      const screened = screen({ body: input?.body, title: input?.title }, opts)
      if (!screened.ok) return screened
      try {
        ensureReady()
        const row = repo.get(id)
        if (!row) return { ok: false, code: "not_found", reasons: [] }
        const current = rowToItem(row)
        if (!current.ok || !["active", "disabled", "archived"].includes(current.item.status))
          return { ok: false, code: "invalid_state", reasons: [] }
        const next = { ...current.item, title: screened.title, body: screened.body, asOf: today() }
        if (!fits(next)) return { ok: false, code: "t1_unfit", reasons: ["max_block_bytes"] }
        const text = screened.title ? `${screened.title}\n${screened.body}` : screened.body
        const now = nowIso()
        const version = repo.addVersion(
          id,
          {
            title: screened.title,
            body: screened.body,
            asOf: next.asOf,
            expiresAt: next.expiresAt,
            sourceEvents: next.sourceEvents,
          },
          now,
          fingerprint(salt, next.kind, next.scope, text),
        )
        return { ok: true, item: { ...next, version, updatedAt: now } }
      } catch (error) {
        return { ok: false, code: storageCode(error), reasons: [] }
      }
    },

    /** Storage failures reject rather than returning an empty list that would look like "no memory". */
    async list(filter = {}) {
      try {
        ensureReady()
        const statuses =
          filter.status === undefined ? undefined : Array.isArray(filter.status) ? filter.status : [filter.status]
        const rows = repo.query({
          statuses: statuses ?? ["proposed", "active", "disabled", "archived"],
          kinds: filter.kind ? [filter.kind as Kind] : undefined,
        })
        return parseRows(rows).items
      } catch (error) {
        throw error instanceof StorageError ? error : new StorageError(storageCode(error), { cause: error })
      }
    },

    approve: (id) => transition(id, ["proposed"], "active"),
    reject: (id) => transition(id, ["proposed"], "rejected"),
    disable: (id) => transition(id, ["active"], "disabled"),
    enable: (id) => transition(id, ["disabled", "archived"], "active"),
    archive: (id) => transition(id, ["active", "disabled"], "archived"),
    purge: (id) =>
      typeof id === "string" && id.length > 0
        ? transition(id, ["proposed", "active", "disabled", "archived", "rejected"], "purged")
        : Promise.resolve({ ok: false, code: "not_found" }),

    async exportAll() {
      try {
        ensureReady()
        return parseRows(repo.query()).items
      } catch (error) {
        throw error instanceof StorageError ? error : new StorageError(storageCode(error), { cause: error })
      }
    },

    async focus(sessionId, codes) {
      const s = session(sessionId)
      if (codes === undefined) return s.entities
      const known = codes.flatMap((c) => {
        const inst = tickers.get(c.replace(/^@/, ""))
        return inst ? [{ code: inst.code, type: inst.type }] : []
      })
      // Focus counts as a mention in the current turn, so the codes survive the usual turn TTL from now on.
      s.entities = updateEntities({ items: [] }, known, s.turn, {
        ttlTurns: config.entityTtlTurns,
        max: config.maxEntities,
      }).state
      return s.entities
    },

    async feedback({ sessionId, verdict, correction }) {
      const result: FeedbackResult = { rated: [], proposal: null, disabled: [] }
      const s = sessions.get(sessionId)
      if (s?.last && s.last.ids.length > 0) {
        if (!s.last.applied) await port.afterTurn({ sessionId })
        ensureReady()
        repo.recordUsage(
          s.last.ids.map((id) => ({ memoryId: id, sessionId, turn: s.last!.turn, verdict })),
          nowIso(),
        )
        result.rated = [...s.last.ids]
        if (verdict === "harmful") {
          for (const id of s.last.ids) {
            const row = repo.get(id)
            if (row?.kind !== "lesson" || row.status !== "active") continue
            if (
              shouldAutoDisable(repo.recentApplications(id, config.autoDisable.window), config.autoDisable) &&
              repo.setStatus(id, ["active"], "disabled", nowIso())
            )
              result.disabled.push(id)
          }
        }
      }
      if (verdict === "harmful" && correction?.trim()) {
        const proposed = await system.propose({
          body: correction,
          origin: "feedback",
          sourceEvents: s?.last ? [{ sessionId, turn: s.last.turn }] : [],
        })
        if (proposed.ok) result.proposal = proposed.item
        else result.proposalSkipped = proposed.code
      }
      return result
    },

    async promotionCandidates() {
      ensureReady()
      return parseRows(repo.query({ statuses: ["active"], kinds: ["lesson"] })).items.filter((i) =>
        isPromotionCandidate(repo.usageCounts(i.id)),
      )
    },
  }

  return { port, commands, system }
}
