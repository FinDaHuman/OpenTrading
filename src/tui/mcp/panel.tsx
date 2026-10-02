import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { availableCatalog, MCP_CATALOG, missingRequirement } from "../../core/mcp/catalog"
import { isRemote, type ServerConfig } from "../../core/mcp/config"
import type { McpManager, McpServerStatus, McpState } from "../../core/mcp/manager"
import type { ToolDef } from "../../core/tools/types"
import { closeDialog, pushLine, state } from "../state"
import { color } from "../theme"

/**
 * /mcp — modelled on Claude Code's MCP settings (components/mcp/*): a full-width pane in
 * place of the prompt, servers grouped by where they are configured, one row per server
 * (`name · ✔ connected`), then a server menu → its tools → one tool's details. Built-in
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
  connected: { glyph: "✔", fg: color.tang, text: "đã kết nối" },
  connecting: { glyph: "◌", fg: color.tham, text: "đang kết nối…" },
  failed: { glyph: "✘", fg: color.giam, text: "lỗi" },
  "needs-auth": { glyph: "△", fg: color.tham, text: "cần đăng nhập" },
  disabled: { glyph: "◯", fg: color.tx3, text: "đã tắt" },
  untrusted: { glyph: "?", fg: color.tham, text: "chờ cho phép" },
}

const home = (file: string) => file.replace(/\\/g, "/").replace(/^.*\/\.opentrading\//, "~/.opentrading/")

function statusText(s: McpServerStatus) {
  if (s.state === "connecting" && s.error) return s.error // "Mất kết nối — thử lại lần 2/5…"
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
  run: () => void | Promise<void>
  danger?: boolean
}

/** A titled field row: bold label, value (status coloured). */
function Field(props: { label: string; children: JSX.Element }) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={color.tx} width={14} flexShrink={0}>
        <span style={{ bold: true }}>{props.label}</span>
      </text>
      <text fg={color.tx2} wrapMode="none">
        {props.children}
      </text>
    </box>
  )
}

function Menu(props: { items: MenuItem[]; selected: number }) {
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={props.items}>
        {(item, i) => {
          const active = () => i() === props.selected
          return (
            <text fg={active() ? color.tang : item.danger ? color.giam : color.tx}>
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

  async function act(label: string, fn: () => Promise<unknown>) {
    if (busy()) return
    setBusy(label)
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
    items.push({ label: "Xoá khỏi cấu hình…", danger: true, run: () => go({ kind: "remove", name }) })
    return items
  })

  // ── tools ─────────────────────────────────────────────────────────────
  const tools = createMemo<ToolDef[]>(() => {
    const sc = screen()
    void state.mcp // re-read when tool lists change
    return sc.kind === "tools" || sc.kind === "tool" ? props.mcp.toolsOf(sc.name) : []
  })

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
      login?.abort()
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

  useKeyboard((evt) => {
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
    void act("đang bật và kết nối…", async () => {
      const secrets = entry.secret ? { [entry.secret.env]: input.secret.trim() } : {}
      await props.mcp.add(entry.id, entry.build({ folder: input.folder.trim() || props.cwd }), secrets)
      pushLine({ kind: "info", text: `Đã bật MCP server "${entry.name}".` })
      const s = server(entry.id)
      if (entry.auth === "oauth" && s?.state === "needs-auth") startLogin(entry.id)
      else go({ kind: "server", name: entry.id })
    })
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
        return "↑↓ di chuyển · enter chọn · space bật/tắt · r kết nối lại · esc đóng"
      case "server":
      case "remove":
        return "↑↓ di chuyển · enter chọn · 1-9 chọn nhanh · esc quay lại"
      case "tools":
        return "↑↓ di chuyển · enter xem chi tiết · esc quay lại"
      case "auth":
        return "c copy link · esc huỷ đăng nhập"
      case "catalog":
      case "custom":
        return "enter xác nhận · esc quay lại"
      default:
        return "esc quay lại"
    }
  }

  const total = () => state.mcp.length
  const live = () => state.mcp.filter((s) => s.state === "connected").length

  return (
    <box
      flexShrink={0}
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
                        <text fg={color.tx2} marginTop={listWindow().rows[0] === row ? 0 : 1}>
                          <span style={{ bold: true }}>{`  ${h().text}`}</span>
                        </text>
                      )}
                    </Match>
                    <Match when={row.kind === "server" && server(row.name)}>
                      {(s) => (
                        <text wrapMode="none">
                          <span style={{ fg: active() ? color.tang : color.tx }}>{`${active() ? "❯" : " "} ${s().name}`}</span>
                          <span style={{ fg: color.tx3 }}>{" · "}</span>
                          <span style={{ fg: STATUS[s().state].fg }}>{STATUS[s().state].glyph}</span>
                          <span style={{ fg: active() ? color.tx2 : color.tx3 }}>{` ${statusText(s())}`}</span>
                        </text>
                      )}
                    </Match>
                    <Match when={row.kind === "catalog" && MCP_CATALOG.find((e) => e.id === (row as { id: string }).id)}>
                      {(entry) => (
                        <text wrapMode="none">
                          <span style={{ fg: active() ? color.tang : color.tx2 }}>{`${active() ? "❯" : " "} ${entry().id}`}</span>
                          <span style={{ fg: color.tx3 }}>{` · ◯ ${catalogNeeds(entry().id)} · ${entry().description}`}</span>
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
            <box border borderStyle="rounded" borderColor={color.rule} paddingLeft={1} paddingRight={1} flexDirection="column" marginTop={1}>
              <text fg={color.tx}>
                <span style={{ bold: true }}>{`${s().name} · MCP server`}</span>
              </text>
              <box flexDirection="column" marginTop={1}>
                <Field label="Trạng thái">
                  <span style={{ fg: STATUS[s().state].fg }}>{`${STATUS[s().state].glyph} ${statusText(s())}`}</span>
                </Field>
                <Show when={s().oauth}>
                  <Field label="Đăng nhập">
                    {auth() === "authenticated" ? (
                      <span style={{ fg: color.tang }}>✔ đã đăng nhập</span>
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
                    <Field label="Prompt">{s().prompts.map((p) => `/${s().name}:${p.name}`).join("  ")}</Field>
                  </Show>
                </Show>
              </box>
              <Show when={s().error && s().state !== "connecting"}>
                <text fg={color.giam} marginTop={1} wrapMode="word">{`Lỗi: ${s().error}`}</text>
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
          <text fg={color.tx3}>{`${tools().length} tool · ◇ chỉ đọc · ⚠ phá huỷ · ◆ ghi (sẽ hỏi trước khi chạy)`}</text>
          <box flexDirection="column" marginTop={1}>
            <For each={tools().slice(Math.max(0, Math.min(index() - 6, tools().length - 12)), Math.max(0, Math.min(index() - 6, tools().length - 12)) + 12)}>
              {(t) => {
                const active = () => tools()[index()] === t
                const mark = t.readOnly ? "◇" : t.annotations?.destructive ? "⚠" : "◆"
                const tags = [t.readOnly ? "chỉ đọc" : "", t.annotations?.destructive ? "phá huỷ" : "", t.annotations?.openWorld ? "ra ngoài" : ""].filter(Boolean)
                return (
                  <text wrapMode="none">
                    <span style={{ fg: active() ? color.tang : color.tx3 }}>{active() ? "❯ " : "  "}</span>
                    <span style={{ fg: t.annotations?.destructive ? color.giam : t.readOnly ? color.san : color.tham }}>{`${mark} `}</span>
                    <span style={{ fg: active() ? color.tang : color.tx }}>{(t.displayName ?? t.name).split(" · ").pop()}</span>
                    <span style={{ fg: color.tx3 }}>{tags.length ? `  ${tags.join(", ")}` : ""}</span>
                  </text>
                )
              }}
            </For>
            <Show when={tools().length > 12}>
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
                    <box flexDirection="row">
                      <text fg={color.tham}>{`${secret().label}: `}</text>
                      <input
                        flexGrow={1}
                        focused
                        placeholder="dán token rồi enter"
                        textColor={color.tx}
                        focusedTextColor={color.tx}
                        backgroundColor={color.panel2}
                        focusedBackgroundColor={color.panel2}
                        onInput={(v: string) => (input.secret = v)}
                        onSubmit={() => enableCatalog(entry().id)}
                      />
                    </box>
                  </box>
                )}
              </Show>
              <Show when={entry().folder && !entry().secret}>
                <box flexDirection="row" marginTop={1}>
                  <text fg={color.tham}>{`${entry().folder!.label}: `}</text>
                  <input
                    flexGrow={1}
                    focused
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
        <text fg={color.tham} marginTop={1}>{`◌ ${busy()}`}</text>
      </Show>
      <Show when={error()}>
        <text fg={color.giam} marginTop={1} wrapMode="word">
          {error()}
        </text>
      </Show>
      <text fg={color.tx3} marginTop={1}>
        {footer()}
      </text>
    </box>
  )
}

/** Without an input on screen, enter would otherwise be swallowed: a tiny keyboard hook. */
function EnterToConfirm(props: { label: string; onEnter: () => void }) {
  useKeyboard((evt) => {
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
  useKeyboard((evt) => {
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
        focused={field() === key}
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

/** Claude Code's tool detail: badges, names, description, parameters. */
function ToolDetail(props: { tool: ToolDef; server: string }) {
  const t = () => props.tool
  const schema = () => (t().input && typeof t().input === "object" && !("_def" in (t().input as object)) ? (t().input as Record<string, any>) : {})
  const params = () => {
    const s = schema()
    const required = new Set<string>(Array.isArray(s.required) ? s.required : [])
    return Object.entries((s.properties ?? {}) as Record<string, any>).map(([key, p]) => ({
      key,
      required: required.has(key),
      type: p?.type ? (Array.isArray(p.type) ? p.type.join("|") : String(p.type)) : p?.anyOf ? "nhiều kiểu" : p?.enum ? "enum" : "bất kỳ",
      description: typeof p?.description === "string" ? p.description.replace(/\s+/g, " ") : "",
    }))
  }
  const short = () => (t().displayName ?? t().name).split(" · ").pop()!
  return (
    <box flexDirection="column" marginTop={1}>
      <text>
        <span style={{ fg: color.tang, bold: true }}>{short()}</span>
        {t().readOnly ? <span style={{ fg: color.tang }}>{" [chỉ đọc]"}</span> : ""}
        {t().annotations?.destructive ? <span style={{ fg: color.giam }}>{" [phá huỷ]"}</span> : ""}
        {t().annotations?.openWorld ? <span style={{ fg: color.tx3 }}>{" [ra ngoài]"}</span> : ""}
        {!t().readOnly ? <span style={{ fg: color.tham }}>{" [hỏi trước khi chạy]"}</span> : ""}
      </text>
      <text fg={color.tx3}>{props.server}</text>
      <Field label="Tên tool">{short()}</Field>
      <Field label="Tên đầy đủ">{t().name}</Field>
      <text fg={color.tx} marginTop={1}>
        <span style={{ bold: true }}>Mô tả</span>
      </text>
      <text fg={color.tx2} wrapMode="word">
        {t().description.split("\n").slice(0, 8).join("\n")}
      </text>
      <text fg={color.tx} marginTop={1}>
        <span style={{ bold: true }}>{`Tham số${params().length === 0 ? ": không có" : ""}`}</span>
      </text>
      <For each={params().slice(0, 12)}>
        {(p) => (
          <text wrapMode="none">
            <span style={{ fg: color.tx }}>{`  • ${p.key}`}</span>
            <span style={{ fg: color.tx3 }}>{`${p.required ? " (bắt buộc)" : ""}: ${p.type}${p.description ? ` - ${p.description}` : ""}`}</span>
          </text>
        )}
      </For>
      <Show when={params().length > 12}>
        <text fg={color.tx3}>{`  … và ${params().length - 12} tham số khác`}</text>
      </Show>
    </box>
  )
}
