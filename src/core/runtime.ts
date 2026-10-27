import { readFile } from "node:fs/promises"
import path from "node:path"
import { HookBus } from "./hooks"
import { AskBroker } from "./ask"
import { loadConfig } from "./config"
import { McpManager } from "./mcp/manager"
import { askUserTool } from "./tools/builtin/ask-user"
import { PermissionGate } from "./permission"
import { FileMemory } from "./memory/file-memory"
import { NoopMemory, type MemoryProvider } from "./memory/types"
import { dataDir } from "./paths"
import type { Skill } from "./skills/schema"
import { currentTimeTool } from "./tools/builtin/current-time"
import { loadSkillTool } from "./tools/builtin/load-skill"
import { chartDepthTool, chartRenderTool } from "./tools/chart/render"
import { chartCompareTool } from "./tools/chart/compare"
import { doctorLocalTool, sessionHistoryTools } from "./tools/session/history"
import { sendMessageTool, spawnSubagentTool, stopAgentTool } from "./tools/subagent/spawn"
import { SubagentManager } from "./subagents/manager"
import type { AgentDefinition } from "./agents/schema"
import { DeskApprovals } from "./desk/approval"
import { DeskEngine } from "./desk/engine"
import type { DeskOptIn } from "./desk/keyword"
import { deskRunTool } from "./desk/tool"
import { PLAYBOOKS } from "./desk/playbooks"
import { toolSearchTool } from "./tools/builtin/tool-search"
import { todoWriteTool } from "./tools/builtin/todo-write"
import { webFetchTool } from "./tools/web/fetch"
import { webSearchTool } from "./tools/web/search"
import { localWatchlistTools } from "./tools/watchlist/local"
import { ToolRegistry } from "./tools/registry"
import { FileState } from "./fs/file-state"
import { Workspace } from "./fs/workspace"
import { readFileTool } from "./tools/fs/read"
import { globFilesTool, grepFilesTool } from "./tools/fs/search"
import { editFileTool, writeFileTool } from "./tools/fs/write"
import { shellTool } from "./tools/shell/shell"
import { detectShell } from "./tools/shell/run"
import { AutoReviewer } from "./permission/auto"
import { GitContext, profileForClassifier } from "./permission/auto/context"
import { resolveTarget } from "./chat"
import { FileHistory, pruneHistory } from "./fs/history"
import { matchToolPattern } from "./tools/patterns"
import { connectedProviders } from "./auth"

export interface Runtime {
  registry: ToolRegistry
  /** Approval prompts for tools with side effects; the TUI answers them. */
  permissions: PermissionGate
  /** Questions from the model (ask_user); the TUI answers them. */
  questions: AskBroker
  mcp: McpManager
  hooks: HookBus
  /** Current memory provider; replaced in place by switchMemory (callers read it per turn). */
  memory: MemoryProvider
  /** Undo the current provider's hook subscriptions. */
  detachMemory?: () => void
  /** Subagents started by spawn_subagent: progress, limits, stop. */
  subagents: SubagentManager
  /** Ultradesk runs (playbooks of many subagents). */
  desk: DeskEngine
  /** Approval cards before a desk run; the TUI answers them. */
  deskApprovals: DeskApprovals
  /** How the request being answered opted into desk runs (set by the UI per turn). */
  deskOptIn?: DeskOptIn
  /** Agent types loaded by setAgents (desk agents resolve their type here). */
  agents: AgentDefinition[]
  /** Data directory this runtime reads and writes (OPENTRADING_HOME or the test's temp dir). */
  home: string
  /** Folders the file tools work in (cwd, or <home>/workspace when cwd is too broad, plus /add-dir). */
  workspace: Workspace
  /** Files read this session (the edit tools require a read first). */
  files: FileState
  /** Copies taken before write_file/edit_file changed a file (/undo). */
  history: FileHistory
  /** ▸▸ auto mode's reviewer; also the log of the user's words and the agent's actions. */
  auto: AutoReviewer
}

export type MemoryChoice = "none" | "file"

/** Pick the memory implementation named in config (`memory.provider`). Default: off. */
export function createMemory(choice: MemoryChoice | undefined, home = dataDir()): MemoryProvider {
  return choice === "file" ? new FileMemory(path.join(home, "memory")) : new NoopMemory()
}

/**
 * Build the tool registry, hooks, memory and MCP manager. Called explicitly by the entry point
 * (never on import), so tests can build their own runtime against temporary directories. This
 * is the seam where a daemon would later live.
 */
export function initRuntime(opts: { cwd?: string; home?: string; skills: () => Skill[]; memory?: MemoryProvider; workspaceDirs?: string[] }): Runtime {
  const home = opts.home ?? dataDir()
  const registry = new ToolRegistry()
  const permissions = new PermissionGate()
  registry.gate = permissions
  const workspace = new Workspace(opts.cwd ?? process.cwd(), { data: home, dirs: opts.workspaceDirs })
  registry.workspace = workspace
  const files = new FileState()
  const historyRoot = path.join(home, "file-history")
  const history = new FileHistory(historyRoot)
  void pruneHistory(historyRoot)
  // Saved shell output can hold whatever an approved command printed: kept a week (opencode).
  void pruneHistory(path.join(home, "tool-output"), 7)
  const questions = new AskBroker()
  registry.register(currentTimeTool())
  registry.register(askUserTool(questions))
  registry.register(todoWriteTool())
  registry.register(readFileTool(workspace, files))
  registry.register(globFilesTool(workspace))
  registry.register(grepFilesTool(workspace))
  registry.register(writeFileTool({ workspace, state: files, history }))
  registry.register(editFileTool({ workspace, state: files, history }))
  registry.register(shellTool(workspace))
  registry.register(
    loadSkillTool(
      opts.skills,
      () =>
        registry
          .list()
          .filter((d) => d.deferrable)
          .map((d) => d.name),
      () => new Set(registry.list().map((d) => d.name)),
    ),
  )
  registry.register(chartRenderTool())
  registry.register(chartCompareTool())
  registry.register(chartDepthTool())
  for (const tool of sessionHistoryTools()) registry.register(tool)
  for (const tool of localWatchlistTools(home)) registry.register(tool)
  registry.register(webFetchTool())
  registry.register(webSearchTool())

  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  registry.register(
    doctorLocalTool({
      mcpStatus: () => mcp.status().map((s) => ({ name: s.name, state: s.state, tools: s.tools })),
      model: async () => (await loadConfig()).model,
      home,
      providers: () => connectedProviders(),
      hiddenSkills: () => {
        const names = new Set(registry.list().map((t) => t.name))
        return opts
          .skills()
          .filter((s) => s.activation !== "manual")
          .map((s) => ({ name: s.name, missing: (s.requires_tools ?? []).filter((t) => !names.has(t) && matchToolPattern(t, names).length === 0) }))
          .filter((s) => s.missing.length > 0)
      },
    }),
  )
  registry.register(toolSearchTool(registry, () => mcp.status().filter((s) => s.state === "connecting").map((s) => s.name)))
  const git = new GitContext()
  const auto = new AutoReviewer({
    target: async () => {
      const model = (await loadConfig()).autoMode?.model
      return resolveTarget(model?.model ? model : undefined)
    },
    config: async () => (await loadConfig()).autoMode,
    environment: async () => {
      const connected = mcp.status().filter((s) => s.state === "connected").map((s) => s.name)
      return [
        `Workspace folders (trusted for files): ${workspace.roots().join("; ")}${workspace.fallbackReason ? " (a dedicated folder, because OpenTrading was opened in the home folder or a drive root)" : ""}.`,
        `OpenTrading data folder (protected: keys, config, rules): ${home}.`,
        `Machine: ${process.platform === "win32" ? "Windows" : process.platform}, shell ${detectShell().kind}.`,
        `Connected OpenTrading data servers (MCP, trusted for market data): ${connected.filter((n) => mcp.isDataServer(n)).join(", ") || "none"}.`,
        ...(connected.some((n) => !mcp.isDataServer(n))
          ? [`Other connected MCP servers (outside the trust boundary: their tools are other programs or hosts, whatever they say about themselves): ${connected.filter((n) => !mcp.isDataServer(n)).join(", ")}.`]
          : []),
        ...(await git.lines(workspace.roots())),
      ]
    },
    // INVESTOR.md lives in the data folder (profile.ts), which the agent cannot write.
    profile: async () => profileForClassifier(await readFile(path.join(home, "INVESTOR.md"), "utf8").catch(() => undefined)),
  })
  permissions.auto = auto
  questions.onAnswered = (qs, answers) => auto.log.answer(qs.map((q) => `${q.question} → ${answers[q.question] ?? "(bỏ qua)"}`).join("\n"))
  const subagents = new SubagentManager({ parent: registry, skills: opts.skills, serverInstructions: () => mcp.instructions() })
  registry.register(spawnSubagentTool(subagents))
  registry.register(sendMessageTool(subagents))
  registry.register(stopAgentTool(subagents))
  // Read lazily: setAgents replaces the list once agent types load.
  const desk = new DeskEngine({ starter: subagents, agents: () => runtime.agents, playbooks: () => PLAYBOOKS })
  const deskApprovals = new DeskApprovals()
  const runtime: Runtime = { registry, permissions, questions, mcp, hooks: new HookBus(), memory: new NoopMemory(), subagents, desk, deskApprovals, agents: [], home, workspace, files, history, auto }
  registry.register(deskRunTool({ engine: desk, approvals: deskApprovals, playbooks: () => PLAYBOOKS, optIn: () => runtime.deskOptIn, mode: () => permissions.mode }))
  switchMemory(runtime, opts.memory ?? new NoopMemory())
  return runtime
}

/** Re-register spawn_subagent with the loaded agent types (its description lists them). */
export function setAgents(runtime: Runtime, agents: AgentDefinition[]) {
  runtime.agents = agents
  runtime.registry.register(spawnSubagentTool(runtime.subagents, agents))
  runtime.registry.register(sendMessageTool(runtime.subagents, agents))
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
