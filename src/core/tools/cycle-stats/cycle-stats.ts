import { z } from "zod"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * Cycle-stats refresh tools (harness-native, `cycle_stats_*`).
 * Chu kỳ VN: incremental VCI cache + recompute bảng rotation qua worker Python
 * (vnstock/pandas). Benchmark 2026-10: ~0.6s/mã delta → batch 12 mã/call (~10-15s).
 */

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "refresh.py")
const PYTHON = process.env.OT_PYTHON ?? "python3"

async function runWorker(home: string, args: string[], timeoutMs: number): Promise<string> {
  const proc = Bun.spawn([PYTHON, WORKER, "--home", home, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(timeoutMs - 5_000),
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    const tail = `${out}\n${err}`.slice(-600)
    throw new Error(`refresh.py lỗi (exit ${code}): ${tail || "không có output"}. Cần python3 + pip install vnstock pandas.`)
  }
  return out.trim()
}

function parseOut(out: string): string {
  try {
    const data = JSON.parse(out)
    return JSON.stringify(data)
  } catch {
    return out.slice(-4000)
  }
}

export function cycleStatsTools(home: string): ToolDef[] {
  const check: ToolDef<{ as_of?: string }> = {
    name: "cycle_stats_check",
    description:
      "Kiểm tra độ tươi bảng thống kê chu kỳ VN (không fetch). Dùng đầu tiên khi định vị pha thị trường: trả days_stale + needs_refresh (quá 90 ngày) + coverage cache. Quy tắc Tết/sự kiện lớn nằm trong skill.",
    input: z.object({
      as_of: z.string().optional().describe("YYYY-MM-DD trong header references/seasonality-vn.md"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: () => "cycle_stats_check()",
    async execute(input) {
      const args = ["check", ...(input.as_of ? ["--as-of", input.as_of] : [])]
      return parseOut(await runWorker(home, args, 30_000))
    },
  }

  const refresh: ToolDef<{ symbols: string[] }> = {
    name: "cycle_stats_refresh",
    description:
      "Refresh incremental 1 batch mã chu kỳ VN (tối đa 15 mã/call, nên 12 mã): fetch [watermark+1, hôm nay] + validate 10 phiên overlap, lệch close >0.5% thì full re-fetch mã đó. Gọi lặp lại đến hết ~80 mã rồi chốt bằng cycle_stats_finalize.",
    input: z.object({
      symbols: z.array(z.string()).min(1).max(15).describe("Batch mã (khuyến nghị 12 mã): VNINDEX/VN30/VNFIN/VNREAL... + mã mảng"),
    }),
    readOnly: false,
    deferrable: true,
    source: LOCAL_SOURCE,
    timeoutMs: 180_000,
    summarize: (input) => `cycle_stats_refresh +${(input as { symbols: string[] }).symbols.length}`,
    async execute(input) {
      const args = ["refresh_batch", "--symbols", ...input.symbols.map((s) => s.trim().toUpperCase())]
      return parseOut(await runWorker(home, args, 175_000))
    },
  }

  const finalize: ToolDef<{ extra_tet?: string[] }> = {
    name: "cycle_stats_finalize",
    description:
      "Recompute toàn bộ bảng rotation (month mean/hit/relative, Tết, chains, peaks/troughs, trough_events, leadlag_1w, yearly) từ cache sau khi mọi batch xong. Trả JSON để chép vào references/ của skill dinh-vi-chu-ky-vn + bump as_of/version.",
    input: z.object({
      extra_tet: z.array(z.string()).optional().describe("Ngày Tết âm lịch mới (YYYY-MM-DD) nếu bảng chưa có"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    timeoutMs: 120_000,
    maxOutputChars: 60_000,
    summarize: () => "cycle_stats_finalize()",
    async execute(input) {
      const args = ["finalize", ...(input.extra_tet?.length ? ["--extra-tet", ...input.extra_tet] : [])]
      return parseOut(await runWorker(home, args, 115_000))
    },
  }

  return [check, refresh, finalize]
}
