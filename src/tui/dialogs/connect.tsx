import { useKeyboard, usePaste } from "@opentui/solid"
import { createMemo, createSignal, Match, Switch } from "solid-js"
import { connectedProviders, maskKey, setKey } from "../../core/auth"
import { saveConfig } from "../../core/config"
import { isSupported, sortedProviders, type ProviderId } from "../../core/providers"
import { closeDialog, providerName, pushLine, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

export function ConnectDialog() {
  const [provider, setProvider] = createSignal<ProviderId>()
  const [key, setKeyText] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const providers = createMemo(() => sortedProviders(state.catalog).filter(isSupported))

  async function save() {
    const id = provider()
    const value = key().trim()
    if (!id || !value || saving()) return
    setSaving(true)
    await setKey(id, value)
    setState("connected", await connectedProviders())
    // First provider becomes the default; later ones just add their models to /model.
    if (!state.provider) {
      await saveConfig({ provider: id })
      setState("provider", id)
    }
    pushLine({ kind: "info", text: `Đã lưu key ${providerName(id)} (${maskKey(value)}) vào ~/.opentrading/auth.json` })
    setState({ modelFilter: providerName(id), dialog: "model" })
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") {
      if (provider()) {
        setProvider(undefined)
        setKeyText("")
      } else closeDialog()
      return
    }
    if (!provider()) return
    if (evt.name === "return") void save()
    else if (evt.name === "backspace") setKeyText((k) => k.slice(0, -1))
    else if (evt.ctrl && evt.name === "u") setKeyText("")
    else if (!evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence > " ") setKeyText((k) => k + evt.sequence)
  })

  usePaste((evt) => {
    if (!provider()) return
    setKeyText((k) => k + new TextDecoder().decode(evt.bytes).replace(/\s+/g, ""))
  })

  return (
    <Switch>
      <Match when={!provider()}>
        <DialogFrame title={`Kết nối provider · ${providers().length}`} width={72}>
          <Picker
            items={providers().map((p) => {
              const connected = state.connected.includes(p.id)
              return {
                label: p.name,
                hint: connected ? "đã kết nối" : p.env[0],
                mark: connected ? "●" : " ",
                value: p.id,
              }
            })}
            onPick={setProvider}
            rows={12}
            placeholder="gõ tên provider để lọc…"
          />
        </DialogFrame>
      </Match>
      <Match when={provider()}>
        {(id) => {
          const info = () => state.catalog[id()]
          return (
            <DialogFrame
              title={`API key · ${providerName(id())}`}
              hint="dán hoặc gõ key · enter lưu · ctrl+u xoá · esc quay lại"
            >
              <text fg={color.tx2}>
                {info()?.doc ? `Tài liệu: ${info()!.doc}` : `Biến môi trường: ${info()?.env.join(", ")}`}
              </text>
              <box
                marginTop={1}
                border
                borderStyle="rounded"
                borderColor={key() ? color.tang : color.rule}
                paddingLeft={1}
                height={3}
              >
                <text fg={key() ? color.tx : color.tx3}>
                  {key() ? `${"•".repeat(Math.min(key().length, 48))}  ${key().length} ký tự` : "…"}
                </text>
              </box>
              <text fg={color.tx3}>Key chỉ lưu trên máy này, trong ~/.opentrading/auth.json</text>
            </DialogFrame>
          )
        }}
      </Match>
    </Switch>
  )
}
