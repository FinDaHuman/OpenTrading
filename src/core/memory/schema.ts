import { z } from "zod"
import { MAX_ITEM_BYTES_LIMIT } from "./config"

export const SCHEMA_VERSION = 1

export const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf8")

const IsoTimestamp = z.iso.datetime()

/**
 * The V0 subset of the PA3 memory item: one explicit, user-created global profile.
 * Every field outside that subset is rejected here even though the table CHECKs accept the final PA3 enums.
 */
export const MemoryItemV0 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  kind: z.literal("profile"),
  scope: z.literal("global"),
  body: z
    .string()
    .min(1)
    .refine((s) => utf8Bytes(s) <= MAX_ITEM_BYTES_LIMIT, { message: `at most ${MAX_ITEM_BYTES_LIMIT} UTF-8 bytes` }),
  status: z.literal("active"),
  visibility: z.literal("model"),
  createdBy: z.literal("user"),
  origin: z.literal("remember_command"),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
})
export type MemoryItemV0 = z.infer<typeof MemoryItemV0>

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
