import { expect, test } from "bun:test"
import pkg from "../package.json"
import { appVersion } from "../src/core/build-info"
import { USER_AGENT } from "../src/core/providers"

test("MCP clientInfo and the User-Agent report this build's version, not a hardcoded one", async () => {
  // Running from source: the package version.
  expect(appVersion).toBe(pkg.version)
  expect(USER_AGENT.startsWith(`opentrading/${pkg.version} `)).toBe(true)
  for (const file of ["../src/core/mcp/manager.ts", "../src/cli/mcp.ts"]) {
    const source = await Bun.file(new URL(file, import.meta.url)).text()
    expect(source).not.toMatch(/version: "\d+\.\d+\.\d+"/)
    expect(source).toContain("version: appVersion")
  }
})
