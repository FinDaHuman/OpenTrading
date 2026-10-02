import { describe, expect, test } from "bun:test"
import path from "node:path"

/*
 * Demo regression: every scenario must keep running and keep producing the same output.
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
  g2: [
    "migrate tiếp (rebuild) → [2]",
    `"body":"Tôi không sử dụng margin"`,
    "purge a lần nữa → false",
    "migration_busy",
  ],
  g3: ["cùng byte? true", "có <system> thô? false", `["t1_overflow"]`, "tự vừa? false"],
  g4: [`system: ["propose"]`, `"code":"needs_confirmation"`, `["db_unavailable"]; rule vẫn nạp? true`],
  g5: [
    `còn "margin"? false`,
    "có <system> thô? false",
    `warnings ["t1_overflow"]`,
    "số item 8 → 8",
    `xác nhận → {"ok":true`,
  ],
  v1: [
    `"giá 25.000 VND" → []`,
    `"VN30F1M hôm nay" → ["future:VN30F1M"]`,
    "note VCB? true; note HPG? false",
    "02/10 (giờ VN) → còn note VCB? false",
  ],
  v2: [
    "vẫn có note VCB? true; stable giống lượt trước? true",
    "focus clear → projection null",
    `"HPG thì sao" → rule ngan-hang? false`,
  ],
  v3: [
    "versions trong DB: 2",
    "lượt thường có? false; search thấy? false",
    "lượt user bật id → có? true",
    `[["purged",null]]`,
  ],
  v4: ["có nội dung memory? false; có tham chiếu? true", "repaired=true, hợp lệ? true", `"ids":["t1","t2"]`],
  v5: ["trước khi duyệt: bài học có trong prompt? false", "phiên mới: có? true", `"code":"duplicate"`, `tắt ["02"]`],
  v6: [`nạp ["01"]; có note HPG? true`, `selector chậm → ["t3_timeout"]`],
  provider: [
    "chặn: Không lưu",
    "chặn: Cần xác nhận",
    "có note VCB? true",
    `"search_memory (chỉ đọc)","load_rule (chỉ đọc)"`,
    "pending: [bài học]",
  ],
}

describe("memory preview demos", () => {
  test.each(Object.keys(MARKERS))("%s runs and shows its key results", (scenario) => {
    const { code, out, err } = run(scenario)
    expect(err).toBe("")
    expect(code).toBe(0)
    for (const marker of MARKERS[scenario]!) expect(out).toContain(marker)
  })

  test("the cumulative V0A demo is deterministic and is the default", () => {
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
