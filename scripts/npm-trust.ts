import { NPM_PACKAGE, REPO } from "../src/core/update"
import { TARGETS, targetName } from "./targets"

/**
 * Make release.yml the npm trusted publisher (OIDC, no token) of every package the release ships.
 * A publisher that has not published within 2 days of being set up expires, so run this right
 * before a release (docs/release.md).
 *
 * Cách chạy (npm >= 11.15, after `npm login` with the account's 2FA):
 *   bun scripts/npm-trust.ts         print the commands
 *   bun scripts/npm-trust.ts --yes   run them
 */
const names = [NPM_PACKAGE, ...TARGETS.map((t) => `opentrading-${targetName(t)}`)]
const failed: string[] = []
for (const name of names) {
  const args = ["trust", "github", name, "--file", "release.yml", "--repo", REPO, "--allow-publish", "--yes"]
  console.log(`npm ${args.join(" ")}`)
  if (!process.argv.includes("--yes")) continue
  // Inherited: the first command asks for 2FA in the browser (pick "skip for 5 minutes" there).
  const run = Bun.spawnSync([process.platform === "win32" ? "npm.cmd" : "npm", ...args], { stdio: ["inherit", "inherit", "inherit"] })
  if (!run.success) failed.push(name)
  await Bun.sleep(2000) // npm's advice for setting up many packages
}
if (failed.length) {
  console.error(`\nFailed: ${failed.join(", ")}\nOne that already has a publisher: npm trust list <package>, then npm trust revoke <package> --id=<id>.`)
  process.exit(1)
}
