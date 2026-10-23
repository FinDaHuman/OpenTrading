import { build } from "../core/build-info"
import { NPM_PACKAGE, applyUpdate, compareVersions, detectInstall, latestVersion, type Fetch, type Install } from "../core/update"

export const UPDATE_HELP = `opentrading update [phiên bản] [--check]

  opentrading update            cập nhật lên bản mới nhất
  opentrading update 0.3.0      cài đúng bản đó (cả bản cũ hơn)
  opentrading update --check    chỉ xem có bản mới không

  Cài bằng npm: in lệnh npm để chạy. Chạy từ mã nguồn: git pull && bun install.
  Tắt thông báo bản mới trong TUI: /config, hoặc OPENTRADING_DISABLE_UPDATE_CHECK=1.
`

export interface UpdateDeps {
  install?: Install
  current?: string
  fetch?: Fetch
  out?: (text: string) => void
  err?: (text: string) => void
  apply?: typeof applyUpdate
}

/** `opentrading update …`; returns the exit code. */
export async function runUpdateCli(args: string[], deps: UpdateDeps = {}): Promise<number> {
  const out = deps.out ?? ((t) => process.stdout.write(t))
  const err = deps.err ?? ((t) => process.stderr.write(t))
  let check = false
  let wanted: string | undefined
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      out(UPDATE_HELP)
      return 0
    }
    if (arg === "--check") check = true
    else if (/^v?\d+\.\d+\.\d+([-+][\w.]+)?$/.test(arg) && !wanted) wanted = arg.replace(/^v/, "")
    else {
      err(`Không hiểu "${arg}". Xem: opentrading update --help\n`)
      return 1
    }
  }

  const install = deps.install ?? detectInstall()
  if (install.kind === "source") {
    out("Bạn đang chạy OpenTrading từ mã nguồn: cập nhật bằng `git pull && bun install` trong thư mục repo.\n")
    return 0
  }
  const current = deps.current ?? build?.version ?? "0.0.0"

  try {
    const latest = wanted ?? (await latestVersion(install, deps.fetch))
    if (!wanted && compareVersions(latest, current) <= 0) {
      out(`Đang dùng bản mới nhất (${current}).\n`)
      return 0
    }
    if (install.kind === "npm") {
      // npm replaces the folder this binary runs from, which Windows refuses while it runs.
      out(`Có OpenTrading ${latest} (đang dùng ${current}). Cài bằng npm nên cập nhật bằng:\n\n  npm i -g ${NPM_PACKAGE}@${wanted ?? "latest"}\n`)
      return 0
    }
    if (check) {
      out(`Có OpenTrading ${latest} (đang dùng ${current}). Chạy: opentrading update\n`)
      return 0
    }
    out(`Đang tải OpenTrading ${latest} cho ${install.target}…\n`)
    const line = await (deps.apply ?? applyUpdate)({ dir: install.dir, target: install.target, version: latest, fetch: deps.fetch })
    out(`Đã cập nhật: ${line}. Mở lại OpenTrading để dùng bản mới.\n`)
    return 0
  } catch (error) {
    err(`Không cập nhật được: ${error instanceof Error ? error.message : String(error)}\nBản đang dùng (${current}) vẫn giữ nguyên.\n`)
    return 1
  }
}
