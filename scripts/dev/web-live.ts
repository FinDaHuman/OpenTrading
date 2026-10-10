// Live check of web_search / web_fetch without any LLM key: bun scripts/dev/web-live.ts
import { runFetch } from "../../src/core/tools/web/fetch"
import { runSearch } from "../../src/core/tools/web/search"

const signal = AbortSignal.timeout(60_000)
const show = (label: string, text: string) => console.log(`\n===== ${label}\n${text.slice(0, 1200)}`)

try {
  show("search vn_finance", await runSearch({ query: "VCB lợi nhuận quý 3 2026", preset: "vn_finance", num_results: 5 }, signal, { native: async () => undefined }))
} catch (e) {
  show("search error", String(e))
}
for (const url of ["https://vnexpress.net/kinh-doanh/chung-khoan", "http://www.sbv.gov.vn/", "https://example.com/"]) {
  try {
    show(url, await runFetch({ url }, signal))
  } catch (e) {
    show(`${url} error`, String(e))
  }
}
