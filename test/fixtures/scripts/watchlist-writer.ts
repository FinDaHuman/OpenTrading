// Child process for watchlist-local.test.ts: adds 20 symbols one call at a time.
import { watchlistOps } from "../../../src/core/tools/watchlist/local"

const [home, prefix] = process.argv.slice(2) as [string, string]
for (let i = 0; i < 20; i++) await watchlistOps.add(home, "qa", [`${prefix}${String.fromCharCode(65 + i)}`])
console.log("done")
