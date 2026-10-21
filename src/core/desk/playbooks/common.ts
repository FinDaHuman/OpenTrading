import { z } from "zod"
import type { DeskContext, DeskSize } from "../types"

/** A VN ticker as users type it ("fpt", " HPG "): trimmed, upper case, 3–5 letters or digits. */
export const Ticker = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{3,5}$/, "mã chứng khoán 3–5 ký tự, ví dụ FPT"))

/** Typed playbooks treat "unrestricted" as their largest tier. */
export const tierOf = (size: DeskSize): "small" | "medium" | "large" => (size === "unrestricted" ? "large" : size)

/** Keeps the first `max` items and says what was left out (no silent caps). */
export function capList<T>(ctx: Pick<DeskContext, "log">, items: readonly T[], max: number, what: string, name: (item: T) => string = String): T[] {
  if (items.length <= max) return [...items]
  const dropped = items.slice(max)
  ctx.log(`Quy mô ${what}: chỉ xét ${max}, bỏ ${dropped.length}: ${dropped.map(name).join(", ")}`)
  return items.slice(0, max)
}

/** "8 mã: FPT, MWG, HPG, … (+5)". */
export function listSummary(items: readonly string[], unit: string, shown = 3) {
  const head = items.slice(0, shown).join(", ")
  return `${items.length} ${unit}: ${head}${items.length > shown ? `, … (+${items.length - shown})` : ""}`
}

/** A markdown table; cells are flattened to one line and pipes escaped. */
export function table(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : String(v).replace(/\s+/g, " ").replace(/\|/g, "\\|"))
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n")
}

/** A number for a table: up to 2 decimals, comma as the decimal mark (Vietnamese). */
export const num = (v: number | null | undefined, digits = 2) =>
  typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(digits)).toString().replace(".", ",") : undefined
