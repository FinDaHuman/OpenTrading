import { countChars, MEMORY_LIMITS, type LimitKey } from "../limits"
import { MemoryStoreError } from "./errors"
import { looksLikeSecret } from "./secrets"

/**
 * Every input a write stores passes through here: texts (NFC, trimmed, not blank, no secret, within
 * their limit), enum values and list sizes. One place, so a new write path cannot forget a check.
 * Error messages name the field and never repeat what was typed: it may be the secret.
 */

function overLimit(label: string, n: number, max: number) {
  return new MemoryStoreError("limit", `«${label}» dài ${n} ký tự, vượt giới hạn ${max}.`)
}

/** A required text field, stored without surrounding whitespace (a pasted trailing newline is not content). */
export function requiredText(label: string, value: string, limit: LimitKey): string {
  const text = value.normalize("NFC").trim()
  if (!text) throw new MemoryStoreError("invalid", `«${label}» không được để trống.`)
  // The message never quotes the text, not even masked: it is the secret.
  if (looksLikeSecret(text)) {
    throw new MemoryStoreError(
      "secret",
      `«${label}» có chuỗi giống khoá bí mật (khoá API). ` +
        "Kho memory không lưu khoá; bỏ chuỗi đó rồi lưu lại.",
    )
  }
  const n = countChars(text)
  const max = MEMORY_LIMITS[limit].max
  if (n > max) throw overLimit(label, n, max)
  return text
}

/** An optional text field: missing or blank is stored as absent. */
export function optionalText(label: string, value: string | undefined, limit: LimitKey): string | undefined {
  if (value === undefined || !value.trim()) return undefined
  return requiredText(label, value, limit)
}

/** A list of short texts (conditions, tags): every item required, the count capped. */
export function textList(label: string, values: readonly string[], count: LimitKey, each: LimitKey): string[] {
  const max = MEMORY_LIMITS[count].max
  if (values.length > max) {
    throw new MemoryStoreError("limit", `«${label}» có ${values.length} mục, vượt giới hạn ${max}.`)
  }
  return values.map((value, i) => requiredText(`${label} ${i + 1}`, value, each))
}

/** An enum value checked at run time: the types stop it at compile time, a caller's cast does not. */
export function oneOf<T extends string>(label: string, value: T, allowed: readonly T[]): T {
  if (!allowed.includes(value)) {
    throw new MemoryStoreError("invalid", `«${label}» không hợp lệ; chỉ nhận: ${allowed.join(", ")}.`)
  }
  return value
}

/** A list size against its limit. */
export function checkCount(label: string, n: number, limit: LimitKey) {
  const max = MEMORY_LIMITS[limit].max
  if (n > max) throw new MemoryStoreError("limit", `«${label}» có ${n} mục, vượt giới hạn ${max}.`)
}

/** The sum over a kind's active entries after this save, checked inside the write transaction. */
export function checkTotal(label: string, current: number, adding: number, limit: LimitKey) {
  const max = MEMORY_LIMITS[limit].max
  if (current + adding > max) {
    throw new MemoryStoreError(
      "limit",
      `Tổng ${label} đang có hiệu lực sẽ là ${current + adding} ký tự, ` +
        `vượt giới hạn ${max} (hiện có ${current}).`,
    )
  }
}
