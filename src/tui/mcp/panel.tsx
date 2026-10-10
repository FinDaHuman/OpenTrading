import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useKeys, usePasteWhenFree } from "../ui/keys"
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { availableCatalog, MCP_CATALOG, missingRequirement } from "../../core/mcp/catalog"
import { isRemote, type ServerConfig } from "../../core/mcp/config"
import { cleanErrorText, type McpManager, type McpServerStatus, type McpState } from "../../core/mcp/manager"
import type { ToolDef } from "../../core/tools/types"
import { blocked, closeDialog, pushLine, state } from "../state"
import { color } from "../theme"
import { pad, truncate, width as cells } from "../ui/text"
import { BADGE, BADGE_LEGEND, toolBadge, toolMark } from "../ui/badges"
import { Field, ToolDetail } from "../ui/tool-detail"

/**
 * /mcp — modelled on Claude Code's MCP settings (components/mcp/*): a full-width pane in
 * place of the prompt, servers grouped by where they are configured, one row per server
 * (`name · ✓ connected`), then a server menu → its tools → one tool's details. Built-in
 * catalog servers sit in their own group and stay off until enabled.
 */

type Screen =
  | { kind: "list" }
  | { kind: "server"; name: string }
  | { kind: "tools"; name: string }
  | { kind: "tool"; name: string; tool: string }
  | { kind: "auth"; name: string; url?: string }
  | { kind: "catalog"; id: string }
  | { kind: "custom" }
  | { kind: "remove"; name: string }

export const STATUS: Record<McpState, { glyph: string; fg: string; text: string }> = {
  connected: { glyph: "✓", fg: color.tang, text: "đã kết nối" },
  connecting: { glyph: "◌", fg: color.tham, text: "đang kết nối…" },
  failed: { glyph: "✘", fg: color.giam, text: "lỗi" },
  "needs-auth": { glyph: "△", fg: color.tham, text: "cần đăng nhập" },
  disabled: { glyph: "○", fg: color.tx3, text: "đã tắt" },
  untrusted: { glyph: "?", fg: color.tham, text: "chờ cho phép" },
}

const home = (file: string) => file.replace(/\\/g, "/").replace(/^.*\/\.opentrading\//, "~/.opentrading/")

function statusText(s: McpServerStatus) {
  if (s.state === "connecting" && s.error) return s.error // "Mất kết nối — đang thử lại lần 2…"
  if (s.state === "connected") return `${STATUS.connected.text} · ${s.tools.length} tool${s.hiddenTools ? ` (ẩn ${s.hiddenTools})` : ""}`
  return STATUS[s.state].text
}

function catalogNeeds(id: string) {
  const entry = MCP_CATALOG.find((e) => e.id === id)!
  const missing = missingRequirement(entry)
  if (missing) return missing.split(":")[0]!
  return entry.auth === "oauth" ? "đăng nhập OAuth" : entry.auth === "token" ? "cần token" : entry.folder ? "chọn thư mục" : "không cần đăng nhập"
}

interface MenuItem {
  label: string
  run: () => unknown
  danger?: boolean
}


function Menu(props: { items: MenuItem[]; selected: number }) {
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <For each={props.items}>
        {(item, i) => {
          const active = () => i() === props.selected
          return (
            <text fg={active() ? color.tang : item.danger ? color.giam : color.tx} flexShrink={0}>
              {`${active() ? "❯" : " "} ${i() + 1}. ${item.label}`}
            </text>
          )
        }}
      </For>
    </box>
  )
}

type Row = { kind: "heading"; text: string } | { kind: "server"; name: string } | { kind: "catalog"; id: string } | { kind: "custom" }

export function McpPanel(props: { mcp: McpManager; cwd: string }) {
  const dims = useTerminalDimensions()
  const renderer = useRenderer()
  const [screen, setScreen] = createSignal<Screen>({ kind: "list" })
  const [index, setIndex] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [copied, setCopied] = createSignal(false)
  let login: AbortController | undefined
  let input = { secret: "", folder: props.cwd, name: "", target: "" }

  const go = (next: Screen, at = 0) => {
    setScreen(next)
    setIndex(at)
    setError(undefined)
    setCopied(false)
    input = { secret: "", folder: props.cwd, name: "", target: "" }
  }
  const server = (name: string) => state.mcp.find((s) => s.name === name)

  /** Run one action at a time; resolves true when it succeeded. */
  async function act(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    if (busy()) return false
    setBusy(label)
    setError(undefined)
    try {
      await fn()
      return true
    } catch (e) {
      setError(cleanErrorText(e instanceof Error ? e.message : String(e)))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  // ── list ──────────────────────────────────────────────────────────────
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = []
    const project = state.mcp.filter((s) => s.scope === "project")
    const global = state.mcp.filter((s) => s.scope === "global")
    if (project.length > 0) {
      out.push({ kind: "heading", text: `Project (${project[0]!.file.replace(/\\/g, "/")})` })
      for (const s of [...project].sort((a, b) => a.name.localeCompare(b.name))) out.push({ kind: "server", name: s.name })
    }
    if (global.length > 0) {
      out.push({ kind: "heading", text: `Của bạn (${home(global[0]!.file)})` })
      for (const s of [...global].sort((a, b) => a.name.localeCompare(b.name))) out.push({ kind: "server", name: s.name })
    }
    const catalog = availableCatalog(state.mcp.map((s) => s.name))
    if (catalog.length > 0) {
      out.push({ kind: "heading", text: "Có sẵn (đang tắt — enter để bật)" })
      for (const entry of catalog) out.push({ kind: "catalog", id: entry.id })
    }
    out.push({ kind: "custom" })
    return out
  })
  const selectable = createMemo(() => rows().filter((r) => r.kind !== "heading"))
  const listMax = () => Math.max(6, dims().height - 16)
  const listWindow = createMemo(() => {
    const all = rows()
    const selectedRow = selectable()[index()]
    const at = Math.max(0, all.indexOf(selectedRow!))
    const start = Math.max(0, Math.min(at - Math.floor(listMax() / 2), all.length - listMax()))
    return { start, rows: all.slice(start, start + listMax()) }
  })

  function openRow(row: Row | undefined) {
    if (!row) return
    if (row.kind === "server") go({ kind: "server", name: row.name })
    else if (row.kind === "catalog") go({ kind: "catalog", id: row.id })
    else if (row.kind === "custom") go({ kind: "custom" })
  }

  function toggle(row: Row | undefined) {
    if (row?.kind === "catalog") return go({ kind: "catalog", id: row.id })
    if (row?.kind !== "server") return
    const s = server(row.name)
    if (!s || s.state === "untrusted") return
    const on = s.state === "disabled"
    void act(on ? "đang bật…" : "đang tắt…", () => props.mcp.setEnabled(row.name, on))
  }

  // ── server menu ───────────────────────────────────────────────────────
  const [auth, { refetch: refetchAuth }] = createResource(
    () => {
      const s = screen()
      return s.kind === "server" ? `${s.name}|${server(s.name)?.state}` : undefined
    },
    (key) => props.mcp.authStatus(key.split("|")[0]!),
  )

  function startLogin(name: string) {
    if (login) return
    login = new AbortController()
    go({ kind: "auth", name })
    void act("đang đăng nhập…", async () => {
      try {
        await props.mcp.login(name, {
          onUrl: (url) => setScreen({ kind: "auth", name, url }),
          signal: login!.signal,
        })
        pushLine({ kind: "info", text: `Đã đăng nhập MCP server "${name}".` })
        go({ kind: "server", name })
      } catch (e) {
        go({ kind: "server", name })
        throw e
      } finally {
        login = undefined
      }
    })
  }

  const serverMenu = createMemo<MenuItem[]>(() => {
    const sc = screen()
    if (sc.kind !== "server") return []
    const s = server(sc.name)
    if (!s) return []
    const items: MenuItem[] = []
    const name = s.name
    if (s.state === "untrusted") {
      items.push({
        label: "Cho phép chạy server này",
        run: () =>
          act("đang kết nối…", async () => {
            await props.mcp.trust(name)
            pushLine({ kind: "info", text: `Đã cho phép MCP server "${name}" (${s.target}).` })
          }),
      })
    }
    if (s.state === "disabled") items.push({ label: "Bật", run: () => act("đang bật…", () => props.mcp.setEnabled(name, true)) })
    if (s.state === "connected" && s.tools.length > 0) items.push({ label: "Xem tool", run: () => go({ kind: "tools", name }) })
    if (s.oauth && s.state !== "disabled" && s.state !== "untrusted") {
      if (auth() === "authenticated") {
        items.push({ label: "Đăng nhập lại", run: () => startLogin(name) })
        items.push({ label: "Đăng xuất", run: () => act("đang đăng xuất…", () => props.mcp.logout(name).then(() => refetchAuth())) })
      } else items.push({ label: "Đăng nhập", run: () => startLogin(name) })
    }
    if (s.state !== "disabled" && s.state !== "untrusted") {
      items.push({ label: "Kết nối lại", run: () => act("đang kết nối lại…", () => props.mcp.restart(name)) })
      items.push({ label: "Tắt", run: () => act("đang tắt…", () => props.mcp.setEnabled(name, false)) })
    }
    // Project servers live in the repo's .mcp.json (shared, often tracked): edit it by hand.
    if (s.scope === "global") items.push({ label: "Xoá khỏi cấu hình…", danger: true, run: () => go({ kind: "remove", name }) })
    return items
  })

  // ── tools ─────────────────────────────────────────────────────────────
  const tools = createMemo<ToolDef[]>(() => {
    const sc = screen()
    void state.mcp // re-read when tool lists change
    return sc.kind === "tools" || sc.kind === "tool" ? props.mcp.toolsOf(sc.name) : []
  })

  const toolRows = () => Math.max(4, Math.min(14, dims().height - 14))
  const toolStart = () => Math.max(0, Math.min(index() - Math.floor(toolRows() / 2), tools().length - toolRows()))
  const shortName = (t: ToolDef) => (t.displayName ?? t.name).split(" · ").pop()!
  /** Names padded to one column so the [label] column lines up. */
  const toolNameWidth = createMemo(() => Math.min(Math.max(8, ...tools().map((t) => cells(shortName(t)))), Math.floor(dims().width * 0.45)))

  // ── keys ──────────────────────────────────────────────────────────────
  const count = () => {
    const sc = screen()
    if (sc.kind === "list") return selectable().length
    if (sc.kind === "server") return serverMenu().length
    if (sc.kind === "tools") return tools().length
    if (sc.kind === "remove") return 2
    return 0
  }

  function back() {
    const sc = screen()
    if (sc.kind === "list") return closeDialog()
    if (sc.kind === "auth") {
      // Cancel a login in flight (its handler returns to the server screen); otherwise just go back.
      if (login) login.abort()
      else go({ kind: "server", name: sc.name })
      return
    }
    if (sc.kind === "tool") {
      const i = tools().findIndex((t) => t.name === sc.tool)
      return go({ kind: "tools", name: sc.name }, Math.max(0, i))
    }
    if (sc.kind === "tools" || sc.kind === "remove") return go({ kind: "server", name: sc.name })
    // Back to the list, keeping the server highlighted.
    const name = sc.kind === "server" ? sc.name : sc.kind === "catalog" ? sc.id : undefined
    const at = selectable().findIndex((r) => (r.kind === "server" && r.name === name) || (r.kind === "catalog" && r.id === name))
    go({ kind: "list" }, Math.max(0, at))
  }

  function enter() {
    const sc = screen()
    if (sc.kind === "list") return openRow(selectable()[index()])
    if (sc.kind === "server") return void serverMenu()[index()]?.run()
    if (sc.kind === "tools") {
      const t = tools()[index()]
      if (t) go({ kind: "tool", name: sc.name, tool: t.name })
      return
    }
    if (sc.kind === "remove") {
      if (index() === 1) return go({ kind: "server", name: sc.name })
      void act("đang xoá…", async () => {
        await props.mcp.remove(sc.name)
        pushLine({ kind: "info", text: `Đã xoá MCP server "${sc.name}" khỏi cấu hình.` })
        go({ kind: "list" })
      })
    }
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    const sc = screen()
    const typing = sc.kind === "catalog" || sc.kind === "custom"
    if (evt.name === "escape") {
      evt.preventDefault()
      return back()
    }
    if (busy() && sc.kind !== "auth") return
    if (sc.kind === "auth") {
      if (evt.name === "c" && sc.url) setCopied(renderer.copyToClipboardOSC52(sc.url))
      return
    }
    if (typing) return // inputs own the keys; enter submits through onSubmit
    const n = count()
    if (evt.name === "up" && n > 0) setIndex((i) => (i + n - 1) % n)
    else if (evt.name === "down" && n > 0) setIndex((i) => (i + 1) % n)
    else if (evt.name === "return") enter()
    else if (evt.name === "space" && sc.kind === "list") toggle(selectable()[index()])
    else if (evt.name === "r" && sc.kind === "list") {
      const row = selectable()[index()]
      if (row?.kind === "server") void act("đang kết nối lại…", () => props.mcp.restart(row.name))
    } else if (/^[1-9]$/.test(evt.name ?? "") && (sc.kind === "server" || sc.kind === "remove")) {
      const i = Number(evt.name) - 1
      if (i < n) {
        setIndex(i)
        enter()
      }
    }
  })
  onCleanup(() => login?.abort())

  // ── catalog / custom submit ───────────────────────────────────────────
  function enableCatalog(id: string) {
    const entry = MCP_CATALOG.find((e) => e.id === id)!
    const missing = missingRequirement(entry)
    if (missing) return setError(missing)
    if (entry.secret && !input.secret.trim()) return setError(`Dán ${entry.secret.label} trước.`)
    void (async () => {
      const ok = await act("đang bật và kết nối…", async () => {
        const secrets = entry.secret ? { [entry.secret.env]: input.secret.trim() } : {}
        await props.mcp.add(entry.id, entry.build({ folder: input.folder.trim() || props.cwd }), secrets)
        pushLine({ kind: "info", text: `Đã bật MCP server "${entry.name}".` })
      })
      if (!ok) return
      // Log in only after the enable action finished: one action at a time.
      if (entry.auth === "oauth" && server(entry.id)?.state === "needs-auth") startLogin(entry.id)
      else go({ kind: "server", name: entry.id })
    })()
  }

  function addCustom() {
    const name = input.name.trim()
    const target = input.target.trim()
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) return setError('Tên chỉ dùng chữ, số, "_" và "-".')
    if (!target) return setError("Nhập URL (https://…) hoặc lệnh chạy server.")
    if (state.mcp.some((s) => s.name === name)) return setError(`Đã có server "${name}".`)
    const config: ServerConfig = /^https?:\/\//i.test(target)
      ? { type: "http", url: target }
      : (() => {
          const [command, ...args] = target.split(/\s+/)
          return { command: command!, args }
        })()
    void act("đang thêm và kết nối…", async () => {
      await props.mcp.add(name, config)
      pushLine({ kind: "info", text: `Đã thêm MCP server "${name}".` })
      go({ kind: "server", name })
    })
  }

  // ── view ──────────────────────────────────────────────────────────────
  const footer = () => {
    const sc = screen()
    switch (sc.kind) {
      case "list":
        return "↑↓ chọn · enter chọn · space bật/tắt · r kết nối lại · esc đóng"
      case "server":
      case "remove":
        return "↑↓ chọn · enter chọn · 1-9 chọn nhanh · esc quay lại"
      case "tools":
        return "↑↓ chọn · enter xem chi tiết · esc quay lại"
      case "auth":
        return "c copy link · esc huỷ đăng nhập"
      case "catalog":
      case "custom":
        return "enter xác nhận · esc quay lại"
      default:
        return "esc quay lại"
    }
  }

  /**
   * Cut a long error to what fits the pane: the server screen's other rows are fixed, so a
   * page-long error (an HTML 502 body, a stderr dump) must give way, never push them over.
   */
  const clampError = (text: string, reserved: number) => {
    const cols = Math.max(20, dims().width - 8)
    const lines = Math.max(2, dims().height - 4 - reserved)
    return truncate(text, cols * lines)
  }

  /**
   * Prompts packed into the lines the pane can spare (the menu must stay on screen), with
   * "… +N" for the rest; the full list is in the / menu.
   */
  const promptLines = (s: McpServerStatus) => {
    const cols = Math.max(20, dims().width - 22)
    const budget = Math.max(1, Math.min(4, dims().height - 19 - serverMenu().length - (s.oauth ? 1 : 0)))
    const names = s.prompts.map((p) => `/${s.name}:${p.name}`)
    const fits = (line: string[]) => cells(line.join("  ")) <= cols
    const lines: string[][] = [[]]
    for (const name of names) {
      const last = lines[lines.length - 1]!
      if (last.length === 0 || fits([...last, name])) last.push(name)
      else lines.push([name])
    }
    const kept = lines.slice(0, budget)
    if (lines.length > budget) {
      const last = kept[kept.length - 1]!
      let shown = kept.flat().length
      // Make room for "… +N" at the end of the last line.
      while (last.length > 1 && !fits([...last, `… +${names.length - shown}`])) {
        last.pop()
        shown--
      }
      last.push(`… +${names.length - shown}`)
    }
    return kept.map((line) => truncate(line.join("  "), cols)).join("\n")
  }

  const total = () => state.mcp.length
  const live = () => state.mcp.filter((s) => s.state === "connected").length

  return (
    <box
      flexShrink={0}
      maxHeight={Math.max(8, dims().height - 4)}
      overflow="hidden"
      border={["top"]}
      borderColor={color.tang}
      backgroundColor={color.panel}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
    >
      <Switch>
        <Match when={screen().kind === "list"}>
          <text fg={color.tang} marginTop={1}>
            <span style={{ bold: true }}>Quản lý MCP server</span>
          </text>
          <text fg={color.tx3}>{total() === 0 ? "Chưa cấu hình server nào" : `${total()} server · ${live()} đang kết nối`}</text>
          <box flexDirection="column" marginTop={1}>
            <For each={listWindow().rows}>
              {(row) => {
                const active = () => selectable()[index()] === row
                return (
                  <Switch>
                    <Match when={row.kind === "heading" && row}>
                      {(h) => (
                        <text fg={color.tx2} marginTop={listWindow().rows[0] === row ? 0 : 1} wrapMode="none">
                          <span style={{ bold: true }}>{`  ${truncate(h().text, dims().width - 8)}`}</span>
                        </text>
                      )}
                    </Match>
                    <Match when={row.kind === "server" && server(row.name)}>
                      {(s) => (
                        <text wrapMode="none">
                          <span style={{ fg: active() ? color.tang : color.tx }}>{`${active() ? "❯" : " "} ${s().name}`}</span>
                          <span style={{ fg: color.tx3 }}>{" · "}</span>
                          <span style={{ fg: STATUS[s().state].fg }}>{STATUS[s().state].glyph}</span>
                          <span style={{ fg: active() ? color.tx2 : color.tx3 }}>{truncate(` ${statusText(s())}`, dims().width - 14 - s().name.length)}</span>
                        </text>
                      )}
                    </Match>
                    <Match when={row.kind === "catalog" && MCP_CATALOG.find((e) => e.id === (row as { id: string }).id)}>
                      {(entry) => (
                        <text wrapMode="none">
                          <span style={{ fg: active() ? color.tang : color.tx2 }}>{`${active() ? "❯" : " "} ${entry().id}`}</span>
                          <span style={{ fg: color.tx3 }}>{truncate(` · ○ ${catalogNeeds(entry().id)} · ${entry().description}`, dims().width - 10 - entry().id.length)}</span>
                        </text>
                      )}
                    </Match>
                    <Match when={row.kind === "custom"}>
                      <text fg={active() ? color.tang : color.tx2} marginTop={1}>
                        {`${active() ? "❯" : " "} + Thêm server tuỳ chỉnh (URL hoặc lệnh)…`}
                      </text>
                    </Match>
                  </Switch>
                )
              }}
            </For>
          </box>
          <Show when={state.mcp.some((s) => s.state === "failed")}>
            <text fg={color.tx3} marginTop={1}>
              ※ Server lỗi: chọn để xem chi tiết, hoặc chạy opentrading mcp debug &lt;tên&gt;
            </text>
          </Show>
          <text fg={color.tx3}>Hướng dẫn: docs/mcp.md · thêm từ dòng lệnh: opentrading mcp add</text>
        </Match>

        <Match when={screen().kind === "server" && server((screen() as { name: string }).name)}>
          {(s) => (
            <box border borderStyle="rounded" borderColor={color.rule} paddingLeft={1} paddingRight={1} flexDirection="column" marginTop={1} overflow="hidden">
              <text fg={color.tx} flexShrink={0}>
                <span style={{ bold: true }}>{`${s().name} · MCP server`}</span>
              </text>
              <box flexDirection="column" marginTop={1} flexShrink={0}>
                <Field label="Trạng thái">
                  <span style={{ fg: STATUS[s().state].fg }}>{`${STATUS[s().state].glyph} ${statusText(s())}`}</span>
                </Field>
                <Show when={s().oauth}>
                  <Field label="Đăng nhập">
                    {auth() === "authenticated" ? (
                      <span style={{ fg: color.tang }}>✓ đã đăng nhập</span>
                    ) : auth() === "expired" ? (
                      <span style={{ fg: color.tham }}>△ hết hạn</span>
                    ) : (
                      <span style={{ fg: color.tx3 }}>✘ chưa đăng nhập</span>
                    )}
                  </Field>
                </Show>
                <Field label={s().transport === "stdio" ? "Lệnh" : "URL"}>{`${s().target}${s().transport !== "stdio" ? ` (${s().transport})` : ""}`}</Field>
                <Field label="Cấu hình">{home(s().file)}</Field>
                <Show when={s().state === "connected"}>
                  <Field label="Khả năng">
                    {["tools", s().resources ? "resources" : "", s().prompts.length ? "prompts" : ""].filter(Boolean).join(" · ")}
                  </Field>
                  <Field label="Tool">{`${s().tools.length}${s().hiddenTools ? ` (ẩn ${s().hiddenTools} bằng enabledTools/disabledTools)` : ""}`}</Field>
                  <Show when={s().prompts.length > 0}>
                    <Field label="Prompt" wrap>{promptLines(s())}</Field>
                  </Show>
                </Show>
              </box>
              <Show when={s().error && s().state !== "connecting"}>
                {/* The one elastic row: it clips instead of overlapping the fields and menu. */}
                <text fg={color.giam} marginTop={1} wrapMode="char" overflow="hidden">
                  {clampError(`Lỗi: ${cleanErrorText(s().error!)}`, 16 + serverMenu().length)}
                </text>
              </Show>
              <Show when={s().state === "untrusted"}>
                <text fg={color.tham} marginTop={1} wrapMode="word">
                  Server này khai báo trong .mcp.json của project. Chỉ cho phép nếu bạn tin lệnh/URL ở trên.
                </text>
                <Show when={s().exposure.vars.length > 0}>
                  <text fg={color.giam} wrapMode="word">
                    {`Sẽ gửi giá trị của ${s().exposure.vars.join(", ")} (biến môi trường hoặc secret đã lưu) tới server này.`}
                  </text>
                </Show>
              </Show>
              <Menu items={serverMenu()} selected={index()} />
            </box>
          )}
        </Match>

        <Match when={screen().kind === "tools"}>
          <text fg={color.tang} marginTop={1}>
            <span style={{ bold: true }}>{`Tool của ${(screen() as { name: string }).name}`}</span>
          </text>
          <text fg={color.tx3} wrapMode="none">{`${tools().length} tool · ${BADGE_LEGEND}`}</text>
          <box flexDirection="column" marginTop={1}>
            <For each={tools().slice(toolStart(), toolStart() + toolRows())}>
              {(t) => {
                const active = () => tools()[index()] === t
                const mark = toolMark(t)
                const badge = toolBadge(t)
                return (
                  <text wrapMode="none">
                    <span style={{ fg: active() ? color.tang : color.tx3 }}>{active() ? "❯ " : "  "}</span>
                    <span style={{ fg: mark.fg }}>{`${mark.mark} `}</span>
                    <span style={{ fg: active() ? color.tang : color.tx }}>{pad(shortName(t), toolNameWidth())}</span>
                    <span style={{ fg: badge.fg }}>{`  ${badge.text}`}</span>
                    <span style={{ fg: BADGE.openWorld.fg }}>{t.annotations?.openWorld ? ` ${BADGE.openWorld.text}` : ""}</span>
                  </text>
                )
              }}
            </For>
            <Show when={tools().length > toolRows()}>
              <text fg={color.tx3}>{`  ${index() + 1}/${tools().length}`}</text>
            </Show>
          </box>
        </Match>

        <Match when={screen().kind === "tool" && tools().find((t) => t.name === (screen() as { tool: string }).tool)}>
          {(t) => <ToolDetail tool={t()} server={(screen() as { name: string }).name} />}
        </Match>

        <Match when={screen().kind === "auth"}>
          <box flexDirection="column" marginTop={1}>
            <text fg={color.tang}>
              <span style={{ bold: true }}>{`Đang đăng nhập ${(screen() as { name: string }).name}…`}</span>
            </text>
            <Show
              when={(screen() as { url?: string }).url}
              fallback={<text fg={color.tx2}>◌ Đang tìm máy chủ đăng nhập và đăng ký ứng dụng…</text>}
            >
              {(url) => (
                <>
                  <text fg={color.tx2}>◌ Trình duyệt sẽ mở trang đăng nhập.</text>
                  <text fg={color.tx3} marginTop={1}>
                    {`Nếu trình duyệt không tự mở, mở link này${copied() ? " (đã copy)" : " (c để copy)"}:`}
                  </text>
                  <text fg={color.san} wrapMode="char">
                    {url()}
                  </text>
                  <text fg={color.tx3} marginTop={1}>
                    Quay lại đây sau khi đăng nhập xong; OpenTrading tự nhận kết quả (tối đa 5 phút).
                  </text>
                </>
              )}
            </Show>
          </box>
        </Match>

        <Match when={screen().kind === "catalog" && MCP_CATALOG.find((e) => e.id === (screen() as { id: string }).id)}>
          {(entry) => (
            <box border borderStyle="rounded" borderColor={color.rule} paddingLeft={1} paddingRight={1} flexDirection="column" marginTop={1}>
              <text fg={color.tx}>
                <span style={{ bold: true }}>{`${entry().name} · có sẵn, đang tắt`}</span>
              </text>
              <text fg={color.tx2} marginTop={1} wrapMode="word">
                {entry().description}
              </text>
              <box flexDirection="column" marginTop={1}>
                <Field label="Kết nối">
                  {(() => {
                    const c = entry().build({ folder: props.cwd })
                    return isRemote(c) ? `${c.url} (${c.type})` : [c.command, ...(c.args ?? [])].join(" ")
                  })()}
                </Field>
                <Field label="Đăng nhập">
                  {entry().auth === "oauth" ? "OAuth — mở trình duyệt sau khi bật" : entry().auth === "token" ? "token (lưu vào mcp-auth.json)" : "không cần"}
                </Field>
                <Field label="Lưu vào">~/.opentrading/mcp.json</Field>
              </box>
              <Show when={missingRequirement(entry())}>
                {(hint) => (
                  <text fg={color.giam} marginTop={1}>
                    {`Chưa cài: ${hint()}`}
                  </text>
                )}
              </Show>
              <Show when={entry().secret}>
                {(secret) => (
                  <box flexDirection="column" marginTop={1}>
                    <Show when={secret().url}>
                      <text fg={color.tx3}>{`Lấy token: ${secret().url}`}</text>
                    </Show>
                    <SecretField
                      label={secret().label}
                      onChange={(v) => (input.secret = v)}
                      onSubmit={() => enableCatalog(entry().id)}
                    />
                  </box>
                )}
              </Show>
              <Show when={entry().folder && !entry().secret}>
                <box flexDirection="row" marginTop={1}>
                  <text fg={color.tham}>{`${entry().folder!.label}: `}</text>
                  <input
                    flexGrow={1}
                    focused={!blocked()}
                    value={props.cwd}
                    textColor={color.tx}
                    focusedTextColor={color.tx}
                    backgroundColor={color.panel2}
                    focusedBackgroundColor={color.panel2}
                    onInput={(v: string) => (input.folder = v)}
                    onSubmit={() => enableCatalog(entry().id)}
                  />
                </box>
              </Show>
              <Show when={!entry().secret && !entry().folder}>
                <EnterToConfirm label="enter để bật" onEnter={() => enableCatalog(entry().id)} />
              </Show>
            </box>
          )}
        </Match>

        <Match when={screen().kind === "custom"}>
          <box border borderStyle="rounded" borderColor={color.rule} paddingLeft={1} paddingRight={1} flexDirection="column" marginTop={1}>
            <text fg={color.tx}>
              <span style={{ bold: true }}>Thêm server tuỳ chỉnh</span>
            </text>
            <text fg={color.tx3} marginTop={1} wrapMode="word">
              URL (https://…/mcp) cho server remote, hoặc lệnh cho server chạy trên máy (ví dụ: npx -y @scope/server). Server có header/token: dùng opentrading mcp add.
            </text>
            <CustomForm
              onName={(v) => (input.name = v)}
              onTarget={(v) => (input.target = v)}
              onSubmit={addCustom}
            />
          </box>
        </Match>

        <Match when={screen().kind === "remove"}>
          <box border borderStyle="rounded" borderColor={color.giam} paddingLeft={1} paddingRight={1} flexDirection="column" marginTop={1}>
            <text fg={color.giam}>
              <span style={{ bold: true }}>{`Xoá "${(screen() as { name: string }).name}" khỏi ${home(server((screen() as { name: string }).name)?.file ?? "")}?`}</span>
            </text>
            <text fg={color.tx3}>Thông tin đăng nhập OAuth của server này cũng bị xoá.</text>
            <Menu
              items={[
                { label: "Xoá", danger: true, run: () => {} },
                { label: "Huỷ", run: () => {} },
              ]}
              selected={index()}
            />
          </box>
        </Match>
      </Switch>

      <Show when={busy()}>
        <text fg={color.tham} marginTop={1} flexShrink={0}>{`◌ ${busy()}`}</text>
      </Show>
      <Show when={error()}>
        <text fg={color.giam} marginTop={1} wrapMode="char" flexShrink={0}>
          {truncate(error()!, Math.max(20, dims().width - 4) * 3)}
        </text>
      </Show>
      <text fg={color.tx3} marginTop={1} wrapMode="none" flexShrink={0}>
        {footer()}
      </text>
    </box>
  )
}

/**
 * Token entry that never shows the token: only `••••  N ký tự`, like /connect — users send
 * screenshots, and a pasted PAT must not be in them.
 */
function SecretField(props: { label: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const [value, setValue] = createSignal("")
  const set = (next: string) => {
    setValue(next)
    props.onChange(next)
  }
  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "return") return props.onSubmit()
    if (evt.name === "backspace") set(value().slice(0, -1))
    else if (evt.ctrl && evt.name === "u") set("")
    else if (!evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence > " ") set(value() + evt.sequence)
  })
  usePasteWhenFree((evt) => set(value() + new TextDecoder().decode(evt.bytes).replace(/\s+/g, "")))
  return (
    <box flexDirection="row">
      <text fg={color.tham}>{`${props.label}: `}</text>
      <text fg={value() ? color.tx : color.tx3}>
        {value() ? `${"•".repeat(Math.min(value().length, 40))}  ${value().length} ký tự` : "dán token rồi enter (ctrl+u xoá)"}
      </text>
    </box>
  )
}

/** Without an input on screen, enter would otherwise be swallowed: a tiny keyboard hook. */
function EnterToConfirm(props: { label: string; onEnter: () => void }) {
  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "return") props.onEnter()
  })
  return (
    <text fg={color.tang} marginTop={1}>
      {`❯ ${props.label}`}
    </text>
  )
}

function CustomForm(props: { onName: (v: string) => void; onTarget: (v: string) => void; onSubmit: () => void }) {
  const [field, setField] = createSignal<"name" | "target">("name")
  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "tab" || evt.name === "down" || evt.name === "up") {
      evt.preventDefault()
      setField((f) => (f === "name" ? "target" : "name"))
    }
  })
  const field_ = (label: string, key: "name" | "target", placeholder: string, onInput: (v: string) => void) => (
    <box flexDirection="row">
      <text fg={field() === key ? color.tham : color.tx3} width={18} flexShrink={0}>
        {label}
      </text>
      <input
        flexGrow={1}
        focused={field() === key && !blocked()}
        placeholder={placeholder}
        textColor={color.tx}
        focusedTextColor={color.tx}
        backgroundColor={color.panel2}
        focusedBackgroundColor={color.panel2}
        onInput={onInput}
        onSubmit={() => (key === "name" ? setField("target") : props.onSubmit())}
      />
    </box>
  )
  return (
    <box flexDirection="column" marginTop={1}>
      {field_("Tên server:", "name", "ví dụ: my-data", props.onName)}
      {field_("URL hoặc lệnh:", "target", "https://example.com/mcp", props.onTarget)}
      <text fg={color.tx3}>tab đổi ô · enter ở ô cuối để thêm</text>
    </box>
  )
}
