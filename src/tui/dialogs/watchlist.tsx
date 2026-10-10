import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { Runtime } from "../../core/runtime"
import { fetchQuotes, type QuoteRow } from "../../core/tools/watchlist/quotes"
import { readWatchlists, type WatchlistStore } from "../../core/tools/watchlist/local"
import { closeDialog } from "../state"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { pad, truncate } from "../ui/text"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const [focus, setFocus] = createSignal<string>()

/** Open /watchlist straight on one list (`/watchlist <tên>`). */
export const focusWatchlist = (name?: string) => setFocus(name?.trim().toUpperCase() || undefined)

const num = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 })
const compact = (v: number) =>
  v >= 1e9 ? `${num.format(v / 1e9)} tỷ` : v >= 1e6 ? `${num.format(v / 1e6)}M` : v >= 1e3 ? `${num.format(v / 1e3)}K` : num.format(v)

export function quoteLine(r: QuoteRow) {
  const price = r.price === undefined ? "—" : num.format(r.price)
  const change = r.changePct === undefined ? "" : `${r.changePct > 0 ? "+" : ""}${num.format(r.changePct)}%`
  const volume = r.volume === undefined ? "" : `KL ${compact(r.volume)}`
  return `${pad(r.symbol, 8)} ${pad(price, 11)} ${pad(change, 9)} ${volume}`
}

const changeColor = (r: QuoteRow) => (r.changePct === undefined || r.changePct === 0 ? color.tham : r.changePct > 0 ? color.tang : color.giam)

/**
 * /watchlist: the personal lists in `<home>/watchlists.json`. Enter opens one with live
 * quotes from the MCP server (vn_equity_quote_batch), r refreshes. Edits go through
 * `/watchlist new|add|rm|rename|del …` — the user's own actions, so no approval prompt.
 */
export function WatchlistDialog(props: { runtime: Runtime }) {
  const [lists, { refetch: reloadLists }] = createResource(async (): Promise<{ store: WatchlistStore; error?: string }> => {
    try {
      return { store: await readWatchlists(props.runtime.home) }
    } catch (error) {
      return { store: {}, error: (error as Error).message }
    }
  })
  const opened = () => {
    const name = focus()
    return name ? lists()?.store[name] : undefined
  }
  let abort = new AbortController()
  onCleanup(() => {
    abort.abort()
    setFocus(undefined)
  })
  const [quotes, { refetch }] = createResource(
    () => opened()?.symbols.join(","),
    async () => {
      abort.abort()
      abort = new AbortController()
      return fetchQuotes(props.runtime.registry, opened()?.symbols ?? [], abort.signal)
    },
  )

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return focus() ? setFocus(undefined) : closeDialog()
    if (evt.name === "r" && focus() && !quotes.loading) {
      evt.preventDefault()
      void reloadLists()
      void refetch()
    }
  })

  const names = () => Object.keys(lists()?.store ?? {})
  return (
    <Show
      when={opened()}
      fallback={
        <DialogFrame
          title={`Watchlist cá nhân · ${names().length}`}
          hint="enter xem giá · /watchlist new|add|rm|rename|del … để sửa · esc đóng"
        >
          <Show when={lists()?.error}>
            <text fg={color.giam} wrapMode="word">
              {lists()!.error}
            </text>
          </Show>
          <Show
            when={names().length > 0}
            fallback={
              <Show when={!lists()?.error}>
                <text fg={color.tx3} wrapMode="word">
                  Chưa có watchlist. Tạo bằng: /watchlist new dai-han rồi /watchlist add dai-han VCB FPT HPG
                </text>
              </Show>
            }
          >
            <Picker
              items={names().map((n) => {
                const w = lists()!.store[n]!
                return { label: n, hint: `${w.symbols.length} mã · ${truncate(w.symbols.join(", ") || "(trống)", 60)}`, mark: "◆", value: n }
              })}
              onPick={(name) => setFocus(name)}
              rows={10}
            />
          </Show>
        </DialogFrame>
      }
    >
      {(w) => (
        <DialogFrame title={`Watchlist ${w().name} · ${w().symbols.length} mã`} hint="r làm mới · esc quay lại">
          <Show when={w().symbols.length > 0} fallback={<text fg={color.tx3}>{`Trống. Thêm mã: /watchlist add ${w().name} VCB FPT`}</text>}>
            <Show when={!quotes.loading} fallback={<text fg={color.tx3}>Đang lấy giá…</text>}>
              <Show when={quotes()?.error}>
                <text fg={color.giam} wrapMode="word">
                  {quotes()!.error}
                </text>
              </Show>
              <For each={quotes()?.rows ?? []}>
                {(r) => (
                  <text fg={changeColor(r)} wrapMode="none">
                    {quoteLine(r)}
                  </text>
                )}
              </For>
              <Show when={(quotes()?.missing.length ?? 0) > 0}>
                <text fg={color.tx3} wrapMode="word">{`Không có giá: ${quotes()!.missing.join(", ")}`}</text>
              </Show>
              <Show when={quotes()?.rows.length}>
                <text fg={color.tx3} marginTop={1} wrapMode="none">
                  {`nguồn: ${quotes()?.source ?? "vn_equity_quote_batch"}${quotes()?.asOf ? ` · ${quotes()!.asOf}` : ""}`}
                </text>
              </Show>
            </Show>
          </Show>
        </DialogFrame>
      )}
    </Show>
  )
}
