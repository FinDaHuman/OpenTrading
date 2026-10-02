import { z } from "zod"
import { MAX_ITEM_BYTES_LIMIT } from "./config"

export const SCHEMA_VERSION = 1

export const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf8")

export const KINDS = ["profile", "lesson", "note"] as const
export const STATUSES = ["proposed", "active", "disabled", "archived", "rejected", "purged"] as const
export const VISIBILITIES = ["model", "restricted"] as const
export const ORIGINS = [
  "profile_form",
  "remember_command",
  "note_command",
  "review_ui",
  "feedback",
  "validator",
  "tool_error",
] as const

export type Kind = (typeof KINDS)[number]
export type Status = (typeof STATUSES)[number]
export type Visibility = (typeof VISIBILITIES)[number]
export type Origin = (typeof ORIGINS)[number]

export const SCOPE_PATTERN =
  /^(global|sector:[a-z_]+|ticker:[A-Z0-9]{3,10}|index:[A-Z0-9]{2,12}|future:[A-Z0-9]{4,12}|agent:[a-z_]+)$/
export const Scope = z.string().regex(SCOPE_PATTERN)

/** Calendar date in Asia/Ho_Chi_Minh, YYYY-MM-DD. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const IsoTimestamp = z.iso.datetime()
const utf8Max = (n: number) => z.string().refine((s) => utf8Bytes(s) <= n, { message: `at most ${n} UTF-8 bytes` })

export const SourceEvent = z.strictObject({ sessionId: z.string(), turn: z.number().int().nonnegative() })
export type SourceEvent = z.infer<typeof SourceEvent>

/**
 * A memory item as read back: the row plus its current version. Body and title are null once the item is
 * rejected or purged; only the id, kind, scope and fingerprint remain.
 */
export const MemoryItem = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    version: z.number().int().positive(),
    kind: z.enum(KINDS),
    scope: Scope,
    title: utf8Max(240).nullable(),
    body: utf8Max(MAX_ITEM_BYTES_LIMIT).nullable(),
    status: z.enum(STATUSES),
    visibility: z.enum(VISIBILITIES),
    createdBy: z.enum(["user", "system"]),
    origin: z.enum(ORIGINS),
    asOf: IsoDate,
    expiresAt: IsoDate.nullable(),
    sourceEvents: z.array(SourceEvent),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .refine((m) => m.kind !== "profile" || m.createdBy === "user", { message: "profile is user-created only" })
  .refine((m) => m.kind !== "lesson" || m.createdBy === "system", { message: "lesson is system-proposed only" })
  .refine((m) => m.kind !== "note" || m.expiresAt !== null, { message: "note needs expiresAt" })
  .refine((m) => m.kind !== "note" || m.scope !== "global", { message: "note must be tied to an instrument" })
  .refine((m) => (m.status === "rejected" || m.status === "purged") === (m.body === null), {
    message: "body is null exactly when rejected or purged",
  })
export type MemoryItem = z.infer<typeof MemoryItem>

/** Line endings first, then NFC, so the byte limit and later rendering see exactly what is stored. */
export function normalizeBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").normalize("NFC").trim()
}

// C0 controls and DEL, except TAB (0x09) and LF (0x0A). CR is already gone after normalization.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/

export type BodyError = { ok: false; code: "invalid_input" | "too_large"; reasons: string[] }

/** Normalize and check a body before it is classified or stored. Reasons never contain the body itself. */
export function prepareBody(raw: unknown, maxItemBytes: number): { ok: true; body: string } | BodyError {
  if (typeof raw !== "string") return { ok: false, code: "invalid_input", reasons: ["not_string"] }
  const body = normalizeBody(raw)
  if (CONTROL.test(body)) return { ok: false, code: "invalid_input", reasons: ["control_char"] }
  if (body.length === 0) return { ok: false, code: "invalid_input", reasons: ["empty"] }
  if (utf8Bytes(body) > Math.min(maxItemBytes, MAX_ITEM_BYTES_LIMIT))
    return { ok: false, code: "too_large", reasons: ["max_item_bytes"] }
  return { ok: true, body }
}

/** Fold Vietnamese for search and fingerprints: FTS5 remove_diacritics does not fold đ/Đ. */
export function foldVietnamese(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
}
