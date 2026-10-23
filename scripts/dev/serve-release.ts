import path from "node:path"

/**
 * Serve a folder of release files (archives + SHA256SUMS) the way GitHub's
 * releases/latest/download/<name> does, to test the installers and `opentrading update` without
 * publishing. Point them at it with OPENTRADING_RELEASE_BASE=http://127.0.0.1:<port>.
 * Cách chạy: bun scripts/dev/serve-release.ts dist/release [port]
 */
const dir = path.resolve(process.argv[2] ?? "dist/release")
const port = Number(process.argv[3] ?? 8765)
Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const file = Bun.file(path.join(dir, path.basename(new URL(req.url).pathname)))
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 })
  },
})
console.log(`serving ${dir} on http://127.0.0.1:${port}`)
