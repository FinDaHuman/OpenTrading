import { createMemo, createResource, createSignal, Match, Show, Switch } from "solid-js"
import { loadConfig, saveConfig, type Config } from "../../core/config"
import { MODE_LABEL, type PermissionMode } from "../../core/permission/mode"
import type { Workspace } from "../../core/fs/workspace"
import { closeDialog, pushLine, state } from "../state"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { truncate } from "../ui/text"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/**
 * /permissions: the mode, the workspace, and every stored rule — "always allow" answers and
 * the deny/ask rules written in config — with `d` to remove one (Claude Code /permissions,
 * Rules tab). Approvals given "for this session" are not stored and not listed.
 */

type Kind = "allow" | "deny" | "ask"
interface Row {
  kind: Kind
  index: number
  tool: string
  scope?: string
  pattern?: string
}

const KIND: Record<Kind, string> = { allow: "luôn cho phép", deny: "chặn", ask: "luôn hỏi" }

function rowsOf(config: Config): Row[] {
  const p = config.permissions ?? {}
  return [
    ...(p.deny ?? []).map((r, index) => ({ kind: "deny" as const, index, tool: r.tool, pattern: r.pattern })),
    ...(p.ask ?? []).map((r, index) => ({ kind: "ask" as const, index, tool: r.tool, pattern: r.pattern })),
    ...(p.allow ?? []).map((r, index) => ({ kind: "allow" as const, index, tool: r.tool, scope: r.scope, pattern: r.pattern })),
  ]
}

const keyOf = (r: Row) => `${r.kind}:${r.index}`

/** What a rule covers, in words: the server identity or domain of an "always" answer, a pattern. */
function coverage(r: Row) {
  const parts: string[] = []
  if (r.pattern) parts.push(`mẫu ${r.pattern}`)
  if (r.scope) {
    const [identity, part] = r.scope.split("#")
    if (part?.startsWith("domain:")) parts.push(`domain ${part.slice("domain:".length)}`)
    else if (identity && identity !== "native") parts.push(`server ${truncate(identity, 40)}`)
    else if (part) parts.push(part)
  }
  return parts.join(" · ")
}

export function PermissionsDialog(props: { mode: PermissionMode; workspace: Workspace; onChanged?: () => Promise<void> }) {
  const [config, { refetch }] = createResource(loadConfig)
  const [open, setOpen] = createSignal<string>()
  const rows = createMemo(() => (config() ? rowsOf(config()!) : []))
  const selected = createMemo(() => rows().find((r) => keyOf(r) === open()))

  async function remove(row: Row) {
    const current = await loadConfig()
    const p = { ...current.permissions }
    if (row.kind === "allow") p.allow = (p.allow ?? []).filter((_, i) => i !== row.index)
    if (row.kind === "deny") p.deny = (p.deny ?? []).filter((_, i) => i !== row.index)
    if (row.kind === "ask") p.ask = (p.ask ?? []).filter((_, i) => i !== row.index)
    await saveConfig({ permissions: p })
    await props.onChanged?.()
    pushLine({ kind: "info", text: `Đã xoá quy tắc ${KIND[row.kind]}: ${row.tool}${coverage(row) ? ` (${coverage(row)})` : ""}` })
    setOpen(undefined)
    await refetch()
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return open() ? setOpen(undefined) : closeDialog()
    const row = selected()
    if (row && evt.name === "d") void remove(row)
  })

  const header = () => [
    `Chế độ: ${MODE_LABEL[state.permissionMode ?? props.mode]} (shift+tab để đổi)`,
    `Workspace: ${props.workspace.roots().join(" · ")}`,
  ]

  return (
    <Switch>
      <Match when={selected()}>
        {(row) => (
          <DialogFrame title={`Quy tắc · ${KIND[row().kind]}`} hint="d xoá · esc quay lại">
            <text fg={color.tx}>{row().tool}</text>
            <Show when={coverage(row())}>
              <text fg={color.tx2}>{coverage(row())}</text>
            </Show>
            <text fg={color.tx3} marginTop={1} wrapMode="word">
              {row().kind === "allow"
                ? "Tool này chạy không hỏi (trừ ở chế độ ‖ chỉ đọc với ghi file/chạy lệnh). Xoá thì lần sau sẽ hỏi lại."
                : row().kind === "deny"
                  ? "Lời gọi khớp quy tắc này luôn bị chặn, kể cả khi bạn đã cho phép trước đó."
                  : "Lời gọi khớp quy tắc này luôn hỏi bạn, kể cả khi đã có quy tắc cho phép."}
            </text>
          </DialogFrame>
        )}
      </Match>
      <Match when={true}>
        <DialogFrame title={`Quyền · ${rows().length} quy tắc`} hint="enter xem · esc đóng">
          {header().map((line) => (
            <text fg={color.tx2} wrapMode="none">
              {truncate(line, 100)}
            </text>
          ))}
          <box marginTop={1} flexDirection="column">
            <Show
              when={rows().length > 0}
              fallback={
                <text fg={color.tx3} wrapMode="word">
                  {`Chưa có quy tắc nào. "Luôn cho phép" trong hộp thoại xác nhận sẽ lưu ở đây; quy tắc chặn/luôn hỏi viết trong ~/.opentrading/config.json (permissions.deny, permissions.ask: {"tool": "read_file", "pattern": "*rieng*"}); sửa tay xong thì mở lại /permissions để áp dụng.`}
                </text>
              }
            >
              <Picker
                items={rows().map((r) => ({
                  label: truncate(r.tool, 50),
                  hint: [KIND[r.kind], coverage(r)].filter(Boolean).join(" · "),
                  mark: r.kind === "deny" ? "✘" : r.kind === "ask" ? "?" : "✓",
                  value: keyOf(r),
                }))}
                onPick={setOpen}
                rows={10}
              />
            </Show>
          </box>
        </DialogFrame>
      </Match>
    </Switch>
  )
}
