import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { loadConfig, saveConfig, type Config } from "../../core/config"
import { MODE_LABEL, type PermissionMode } from "../../core/permission/mode"
import type { Workspace } from "../../core/fs/workspace"
import type { AutoReviewer, Denial } from "../../core/permission/auto"
import { closeDialog, state } from "../state"
import { say } from "../notify"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { truncate } from "../ui/text"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"
import { AUTO_EXPLAIN } from "./auto-optin"

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

export function PermissionsDialog(props: { mode: PermissionMode; workspace: Workspace; auto?: AutoReviewer; onChanged?: () => Promise<void> }) {
  const [config, { refetch }] = createResource(loadConfig)
  const [open, setOpen] = createSignal<string>()
  const rows = createMemo(() => (config() ? rowsOf(config()!) : []))
  const selected = createMemo(() => rows().find((r) => keyOf(r) === open()))
  /** ▸▸ auto mode's recent blocks, newest first (a snapshot: the dialog is reopened to refresh). */
  const denials: Denial[] = [...(props.auto?.recent ?? [])]
  const denial = createMemo(() => (open()?.startsWith("blocked:") ? denials[Number(open()!.slice("blocked:".length))] : undefined))

  function retry(d: Denial) {
    props.auto?.grantRetry(d)
    say(`Đã cho phép thử lại một lần: ${d.tool} ${truncate(d.summary, 60)}. Nhắn model gọi lại (ví dụ "thử lại đi").`, "success", 10_000)
    setOpen(undefined)
  }

  async function remove(row: Row) {
    const current = await loadConfig()
    const p = { ...current.permissions }
    if (row.kind === "allow") p.allow = (p.allow ?? []).filter((_, i) => i !== row.index)
    if (row.kind === "deny") p.deny = (p.deny ?? []).filter((_, i) => i !== row.index)
    if (row.kind === "ask") p.ask = (p.ask ?? []).filter((_, i) => i !== row.index)
    await saveConfig({ permissions: p })
    await props.onChanged?.()
    say(`Đã xoá quy tắc ${KIND[row.kind]}: ${row.tool}${coverage(row) ? ` (${coverage(row)})` : ""}`, "success")
    setOpen(undefined)
    await refetch()
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return open() ? setOpen(undefined) : closeDialog()
    const row = selected()
    if (row && evt.name === "d") void remove(row)
    const d = denial()
    if (d && evt.name === "r") retry(d)
  })

  const autoLine = () => {
    const model = config()?.autoMode?.model
    const a = props.auto
    return `Auto mode: model duyệt ${model?.model ? `${model.provider ?? "?"} · ${model.model}` : "theo model của phiên"} · ${a?.requests ?? 0} request duyệt · chặn ${a?.recent.length ?? 0} lần gần đây (/config để đổi model; luật trong config.json → autoMode)`
  }
  const header = () => [`Chế độ: ${MODE_LABEL[state.permissionMode ?? props.mode]} (shift+tab để đổi)`, `Workspace: ${props.workspace.roots().join(" · ")}`, autoLine()]

  return (
    <Switch>
      <Match when={denial()}>
        {(d) => (
          <DialogFrame title={`Auto mode đã chặn${d().label ? ` · ${d().label}` : ""}`} hint="r cho thử lại một lần · esc quay lại">
            <text fg={color.tx}>{`${d().tool}  ${truncate(d().summary, 90)}`}</text>
            <text fg={color.tx2} wrapMode="word" marginTop={1}>
              {d().reason}
            </text>
            <text fg={color.tx3} marginTop={1} wrapMode="word">
              {"r: lần sau model gọi đúng lời gọi này thì chạy luôn (một lần). Muốn cho phép lâu dài: nói rõ trong tin nhắn, hoặc thêm luật autoMode.allow trong config.json."}
            </text>
          </DialogFrame>
        )}
      </Match>
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
        <DialogFrame title={`Quyền · ${rows().length} quy tắc${denials.length > 0 ? ` · ${denials.length} lần auto mode chặn` : ""}`} hint="enter xem · esc đóng">
          {header().map((line) => (
            <text fg={color.tx2} wrapMode="none">
              {truncate(line, 100)}
            </text>
          ))}
          {/* The explanation the first switch to ▸▸ showed, for when it is on. */}
          <Show when={(state.permissionMode ?? props.mode) === "auto"}>
            <box marginTop={1} flexDirection="column" flexShrink={0}>
              <For each={AUTO_EXPLAIN}>
                {(line) => (
                  <text fg={color.tx3} wrapMode="word">
                    {line}
                  </text>
                )}
              </For>
            </box>
          </Show>
          <box marginTop={1} flexDirection="column">
            <Show
              when={rows().length > 0 || denials.length > 0}
              fallback={
                <text fg={color.tx3} wrapMode="word">
                  {`Chưa có quy tắc nào. "Luôn cho phép" trong hộp thoại xác nhận sẽ lưu ở đây; quy tắc chặn/luôn hỏi viết trong ~/.opentrading/config.json (permissions.deny, permissions.ask: {"tool": "read_file", "pattern": "*rieng*"}); sửa tay xong thì mở lại /permissions để áp dụng.`}
                </text>
              }
            >
              <Picker
                items={[
                  ...rows().map((r) => ({
                    label: truncate(r.tool, 50),
                    hint: [KIND[r.kind], coverage(r)].filter(Boolean).join(" · "),
                    mark: r.kind === "deny" ? "✘" : r.kind === "ask" ? "?" : "✓",
                    value: keyOf(r),
                    group: "Quy tắc",
                  })),
                  ...denials.map((d, i) => ({
                    label: truncate(`${d.tool} ${d.summary}`, 50),
                    hint: `${d.label ? `[${d.label}] ` : ""}${d.reason}`,
                    mark: "▸",
                    value: `blocked:${i}`,
                    group: "Auto mode chặn gần đây",
                  })),
                ]}
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
