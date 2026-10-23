import { build as currentBuild } from "../core/build-info"
import type { Config } from "../core/config"
import { NPM_PACKAGE, checkForUpdate, detectInstall, removeOldBinaries, updateCheckEnabled, type Fetch, type Install } from "../core/update"
import { notify } from "./notify"

/**
 * On TUI start (binary installs only): clear what a Windows update left behind, then look up the
 * latest release at most once a day and say so in a toast. Runs in the background; silent on
 * any failure.
 */
export async function announceUpdate(config: Config, deps: { install?: Install; version?: string; fetch?: Fetch } = {}) {
  const install = deps.install ?? detectInstall()
  const version = deps.version ?? currentBuild?.version
  if (install.kind === "source" || !version) return
  if (install.kind === "binary") removeOldBinaries(install.dir)
  if (!updateCheckEnabled(config)) return
  const latest = await checkForUpdate(version, install, { fetch: deps.fetch })
  if (!latest) return
  notify({
    key: "update",
    toast: true,
    level: "info",
    title: `Có OpenTrading ${latest}`,
    text: `Đang dùng ${version}. Cập nhật: ${install.kind === "npm" ? `npm i -g ${NPM_PACKAGE}@latest` : "ot update"} (tắt thông báo trong /config)`,
    timeoutMs: 15_000,
  })
}
