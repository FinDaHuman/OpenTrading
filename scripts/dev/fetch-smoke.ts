// Dev check that the fetch pipeline libraries run under Bun: bun scripts/dev/fetch-smoke.ts
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"
// @ts-expect-error no types
import { gfm } from "turndown-plugin-gfm"
import { extractText, getDocumentProxy } from "unpdf"

const html = `<html><head><title>Tin VCB</title></head><body><nav>menu menu</nav><article><h1>Kết quả kinh doanh VCB</h1>
<p>Lợi nhuận quý 3 tăng <a href="https://example.vn/x">xem thêm</a>.</p>
<table><tr><th>Quý</th><th>LNST</th></tr><tr><td>Q3</td><td>10.000</td></tr></table>
<p>${"Nội dung đủ dài cho Readability. ".repeat(20)}</p></article><footer>chân trang</footer></body></html>`
const { document } = parseHTML(html)
const article = new Readability(document as unknown as Document).parse()
const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" })
td.use(gfm)
console.log("title:", article?.title)
console.log(td.turndown(article?.content ?? ""))

// A one-page PDF with the text "Hello PDF" (smallest valid file).
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 40 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`
const doc = await getDocumentProxy(new TextEncoder().encode(pdf))
const { text } = await extractText(doc, { mergePages: true })
console.log("pdf:", text)
