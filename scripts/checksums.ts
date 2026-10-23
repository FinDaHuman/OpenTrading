import { createHash } from "node:crypto"
import { readdir } from "node:fs/promises"
import path from "node:path"

/**
 * Write <dir>/SHA256SUMS for every opentrading-* archive in <dir>, in `sha256sum` format
 * ("<hex>  <name>"), which install.sh, install.ps1 and `opentrading update` check.
 * Cách chạy: bun scripts/checksums.ts dist/release
 */
const dir = path.resolve(process.argv[2] ?? "dist/release")
const names = (await readdir(dir)).filter((n) => n.startsWith("opentrading-")).sort()
if (names.length === 0) throw new Error(`no opentrading-* archives in ${dir}`)
const lines: string[] = []
for (const name of names) {
  const hash = createHash("sha256")
  for await (const chunk of Bun.file(path.join(dir, name)).stream()) hash.update(chunk)
  lines.push(`${hash.digest("hex")}  ${name}`)
}
await Bun.write(path.join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`)
console.log(lines.join("\n"))
