import path from "node:path"
import { z } from "zod"
import { requestApproval } from "./approvals"
import { HookBus } from "./hooks"
import { McpManager } from "./mcp/manager"
import { PRESETS, PRESET_LABEL, type PresetName } from "./mcp/presets"
import { FileMemory } from "./memory/file-memory"
import { NoopMemory, type MemoryProvider } from "./memory/types"
import { dataDir } from "./paths"
import type { Skill } from "./skills/schema"
import { currentTimeTool } from "./tools/builtin/current-time"
import { loadSkillTool } from "./tools/builtin/load-skill"
import { chartDepthTool, chartRenderTool } from "./tools/chart/render"
import { chartCompareTool } from "./tools/chart/compare"
import { doctorLocalTool, sessionHistoryTools } from "./tools/session/history"
import { spawnSubagentTool } from "./tools/subagent/spawn"
import { webFetchTool } from "./tools/web/fetch"
import { webSearchTool } from "./tools/web/search"
import { localWatchlistTools } from "./tools/watchlist/local"
import { ToolRegistry } from "./tools/registry"

export interface Runtime {
  registry: ToolRegistry
  mcp: McpManager
  hooks: HookBus
  /** Current memory provider; replaced in place by switchMemory (callers read it per turn). */
  memory: MemoryProvider
  /** Undo the current provider's hook subscriptions. */
  detachMemory?: () => void
}

export type MemoryChoice = "none" | "file"

/** Pick the memory implementation named in config (`memory.provider`). Default: off. */
export function createMemory(choice: MemoryChoice | undefined, home = dataDir()): MemoryProvider {
  return choice === "file" ? new FileMemory(path.join(home, "memory")) : new NoopMemory()
}

/**
 * The one tool that can change what the model sees: asks the user (approval dialog),
 * then re-registers the chosen preset's tools. Its description doubles as the live
 * preset overview, so the model always knows which toolsets it can request.
 */
export function switchPresetTool(registry: ToolRegistry, mcp: McpManager) {
  const overview = (statuses = mcp.status()) => {
    const lines = statuses.map((s) => {
      const c = s.presetCounts
      const have = c ? PRESETS.filter((p) => p !== "all" && c[p] > 0).map((p) => `${p}(${c[p]})`).join(", ") : ""
      return `- ${s.name}: đang dùng ${s.preset} (${s.tools.length} tool)${c ? `; có sẵn ${have}, all(${c.all})` : ""}`
    })
    return [
      "Đổi preset tool của một MCP server (cần người dùng phê duyệt). Gọi khi câu hỏi cần dữ liệu mà preset hiện tại không có.",
      "Preset hiện tại:",
      ...(lines.length > 0 ? lines : ["- chưa có MCP server nào"]),
      "Ý nghĩa: market = giá/chỉ số/OHLCV/BCTC theo quý (vs_*); scan = sàng lọc/định giá/forensic từng mã; quant = backtest/rủi ro; brief = tin tức/lịch/vĩ mô; intel = odds/so sánh/bằng chứng.",
    ].join("\n")
  }

  const register = () =>
    registry.register({
      name: "switch_preset",
      description: overview(),
      input: z.object({ preset: z.enum(PRESETS), server: z.string().optional() }),
      readOnly: true,
      summarize: (input) => `switch_preset(${(input as { preset?: string }).preset ?? ""})`,
      execute: async (input) => {
        const { preset, server } = input as { preset: PresetName; server?: string }
        const statuses = mcp.status().filter((s) => s.state !== "disabled" && s.state !== "untrusted")
        if (statuses.length === 0) return "Chưa có MCP server nào đang hoạt động để đổi preset."
        const target = server ? statuses.find((s) => s.name === server) : statuses[0]
        if (!target) return `Không tìm thấy MCP server "${server}". Server hiện có: ${statuses.map((s) => s.name).join(", ")}.`
        const decision = await requestApproval({
          kind: "preset-switch",
          key: `preset-switch:${target.name}`,
          title: `Đổi preset của "${target.name}" sang ${preset}?`,
          detail: `${PRESET_LABEL[preset]} — hiện tại đang dùng ${target.preset} (${target.tools.length} tool).`,
        })
        if (decision === "deny")
          return "Người dùng không cho phép đổi preset. Hãy trả lời bằng dữ liệu đã có và nói rõ phần nào thiếu nguồn."
        await mcp.setPreset(target.name, preset)
        registry.activePreset = preset
        const visible = registry
          .list()
          .filter((t) => !t.presets || t.presets.length === 0 || t.presets.includes(preset))
        return `Đã đổi preset sang ${preset} (${visible.length} tool đang thấy): ${visible
          .filter((t) => t.presets?.length)
          .map((t) => t.name.replace(/^mcp__[^_]+__/, ""))
          .slice(0, 12)
          .join(", ")}.`
      },
    })

  return { register, refresh: register }
}

/**
 * Build the tool registry, hooks, memory and MCP manager. Called explicitly by the entry point
 * (never on import), so tests can build their own runtime against temporary directories. This
 * is the seam where a daemon would later live.
 */
export function initRuntime(opts: { cwd?: string; home?: string; skills: () => Skill[]; memory?: MemoryProvider }): Runtime {
  const home = opts.home ?? dataDir()
  const registry = new ToolRegistry()
  registry.register(currentTimeTool())
  registry.register(loadSkillTool(opts.skills))
  registry.register(chartRenderTool())
  registry.register(chartCompareTool())
  registry.register(chartDepthTool())
  for (const tool of sessionHistoryTools()) registry.register(tool)
  for (const tool of localWatchlistTools()) registry.register(tool)
  registry.register(webFetchTool())
  registry.register(webSearchTool())
  registry.register(spawnSubagentTool(registry))

  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  const switcher = switchPresetTool(registry, mcp)
  switcher.register()
  registry.register(
    doctorLocalTool({
      mcpStatus: () => mcp.status().map((s) => ({ name: s.name, state: s.state, tools: s.tools })),
      modelInfo: () => "xem /model (chưa resolve ở đây để tránh đọc key)",
    }),
  )
  // Statuses arrive after start(); sync the initial preset and keep the overview true.
  mcp.onChange((statuses) => {
    switcher.refresh()
    const first = statuses[0]
    if (first && registry.activePreset === undefined) registry.activePreset = first.preset
  })
  const runtime: Runtime = { registry, mcp, hooks: new HookBus(), memory: new NoopMemory() }
  switchMemory(runtime, opts.memory ?? new NoopMemory())
  return runtime
}

/** Swap the memory provider live: its tools and hooks are replaced, nothing else restarts. */
export function switchMemory(runtime: Runtime, memory: MemoryProvider) {
  runtime.detachMemory?.()
  runtime.registry.unregisterSource(`memory:${runtime.memory.id}`)
  runtime.memory = memory
  for (const tool of memory.tools?.() ?? []) runtime.registry.register({ ...tool, source: `memory:${memory.id}` })
  const detach = memory.register?.(runtime.hooks)
  runtime.detachMemory = typeof detach === "function" ? detach : undefined
}
