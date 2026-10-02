import { describe, expect, test } from "bun:test"
import path from "node:path"

/*
 * Demo regression: every gate's technical demo must keep running and keep producing the same output.
 * The script only uses temporary databases, so running it here touches neither the network nor ~/.opentrading.
 */
const SCRIPT = path.resolve(import.meta.dir, "../../scripts/memory-preview.ts")
const run = (scenario?: string) => {
  const args = scenario === undefined ? [process.execPath, SCRIPT] : [process.execPath, SCRIPT, scenario]
  const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", timeout: 30_000 })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

const MARKERS: Record<string, string[]> = {
  g1: ["→ accepted", `→ rejected ["money_amount","valuation_value"]`, `→ ambiguous ["number_present"]`],
  g2: ["migrate lần 2 → áp dụng []", "purge A lần nữa → not_found", "migration_busy"],
  g3: ["đảo thứ tự row → cùng byte? true", "&lt;/memory&gt;", "tự vừa T1? false"],
  g4: [`port chỉ có: ["beforeTurn"]`, `"code":"needs_confirmation"`, `"code":"db_unavailable"`],
  g5: [
    `còn "margin"? false`,
    "có <system> thô? false",
    `warnings ["t1_overflow"]`,
    `"code":"content_rejected"`,
    "số item 8 → 8",
    `xác nhận → {"ok":true`,
  ],
}

describe("memory preview demos", () => {
  test.each(Object.keys(MARKERS))("%s runs and shows its key results", (scenario) => {
    const { code, out, err } = run(scenario)
    expect(err).toBe("")
    expect(code).toBe(0)
    for (const marker of MARKERS[scenario]!) expect(out).toContain(marker)
  })

  test("the cumulative demo is deterministic and is the default", () => {
    const a = run("g5")
    expect(a.out.length).toBeGreaterThan(0)
    expect(run("g5").out).toBe(a.out)
    expect(run().out).toBe(a.out)
  })

  test("an unknown scenario fails loudly", () => {
    const { code, err } = run("nope")
    expect(code).toBe(1)
    expect(err).toContain("Không có kịch bản")
  })
})
