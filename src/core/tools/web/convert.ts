import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"
// @ts-expect-error turndown-plugin-gfm ships no types
import { gfm } from "turndown-plugin-gfm"

/** Charset from the Content-Type header, else a <meta charset>, else UTF-8. Some VN sites still use windows-1258. */
export function decodeText(bytes: Uint8Array, contentType: string): string {
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048))
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase()
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

export const isPdf = (contentType: string, bytes: Uint8Array) =>
  /application\/pdf/i.test(contentType) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)

export const isHtml = (contentType: string, text: string) => /html|xml/i.test(contentType) || /^\s*<(!doctype html|html)/i.test(text)

/** Text-like types read as they are; anything else is binary. */
export const isTextual = (contentType: string) => !contentType || /^(text\/|application\/(json|xml|javascript|x-ndjson|ld\+json|rss|atom))/i.test(contentType)

let turndown: TurndownService | undefined
function markdowner() {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" })
    turndown.use(gfm)
    turndown.remove(["script", "style", "noscript", "iframe", "form", "button"])
    turndown.remove((node) => node.nodeName.toLowerCase() === "svg")
    // Images cost tokens and the model cannot see them here.
    turndown.addRule("no-images", { filter: "img", replacement: () => "" })
  }
  return turndown
}

/**
 * Main content as markdown: Readability picks the article (cafef/vietstock pages are mostly
 * menus and ads), turndown keeps links, tables and headings. Pages Readability cannot read
 * (data tables, listings) fall back to the whole body minus nav/header/footer.
 */
export function htmlToMarkdown(html: string, baseUrl: string): { title?: string; markdown: string; extracted: boolean } {
  const { document } = parseHTML(html)
  try {
    const base = document.createElement("base")
    base.setAttribute("href", baseUrl)
    document.head?.prepend(base)
  } catch {
    // no <head>: relative links stay relative
  }
  const title = document.querySelector("title")?.textContent?.trim() || undefined
  let article: { title?: string | null; content?: string | null; textContent?: string | null } | null = null
  try {
    article = new Readability(document.cloneNode(true) as unknown as Document, { charThreshold: 300 }).parse()
  } catch {
    article = null
  }
  if (article?.content && (article.textContent?.trim().length ?? 0) > 300) {
    return { title: article.title?.trim() || title, markdown: tidy(markdowner().turndown(article.content)), extracted: true }
  }
  for (const el of document.querySelectorAll("nav, header, footer, aside, script, style, noscript, svg, form")) el.remove()
  // Menus, sidebars and ad slots that are plain divs on many VN news sites.
  for (const el of document.querySelectorAll("[class], [id]")) {
    const tag = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`.toLowerCase()
    if (/(^|[\s_-])(menu|nav|navbar|breadcrumb|sidebar|footer|header|banner|ads?|advert|social|share|popup|modal|cookie)([\s_-]|$)/.test(tag)) el.remove()
  }
  return { title, markdown: tidy(markdowner().turndown(document.body?.innerHTML ?? html)), extracted: false }
}

const tidy = (md: string) =>
  md
    .replace(/\[\s*\]\([^)]*\)/g, "") // links left empty once images are gone
    .replace(/^\s*[-*]\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

/** Text of a PDF (disclosures, broker reports). Scanned PDFs have no text layer: says so. */
export async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf")
  const doc = await getDocumentProxy(bytes)
  const { text, totalPages } = await extractText(doc, { mergePages: true })
  return { text: String(text).replace(/[ \t]+\n/g, "\n").trim(), pages: totalPages }
}
