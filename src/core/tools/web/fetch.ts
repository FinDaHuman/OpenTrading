import { LRUCache } from "lru-cache"
import { z } from "zod"
import { vnStamp } from "../net-dates"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { decodeText, htmlToMarkdown, isHtml, isPdf, isTextual, pdfToText } from "./convert"
import { isPreapproved } from "./domains"
import { checkUrl, fetchPublic, type Resolver } from "./net"
import { extractWithModel, webTarget, type Extracted } from "./side-model"

/**
 * web_fetch at the level of Claude Code's WebFetch: https only, private addresses refused
 * (on resolved IPs), same-site redirects followed and cross-host ones reported, HTML turned
 * into markdown (main content, links and tables kept), PDF text extracted, a 15-minute cache,
 * an optional `prompt` answered by a side model over the page, and paging with `start_char`.
 * Hosts outside the Vietnamese presets ask the user first (per domain).
 */

export type WebFetchInput = { url: string; prompt?: string; start_char?: number }

const PAGE = 50_000
/** Page part kept beside a cut side answer, however long the answer. */
const PAGE_MIN = 10_000
const PROMPT_INPUT = 100_000

/** The whole call's limit (wrap.ts races it): download and the side model share it. */
export const FETCH_TOOL_TIMEOUT_MS = 125_000
/** How a result opens when the side model's provider blocked its output (stable, like `REDIRECT:`, for tests and traces). */
export const FILTERED_PREFIX = "BLOCKED:"
/** The page download's own limit. */
const DOWNLOAD_TIMEOUT_MS = 60_000
/** The side model's own limit, inside what the download left of the call's. */
const EXTRACT_MAX_MS = 90_000
/** Kept back so the page and a note still come back before the call's limit fires. */
const EXTRACT_MARGIN_MS = 5_000
/** Less than this left: the side model is skipped, the page comes back with a note. */
const EXTRACT_MIN_MS = 10_000

interface Page {
  url: string
  status: number
  statusText: string
  contentType: string
  bytes: number
  fetchedAt: string
  title?: string
  markdown: string
  /** Plain text of the page (markdown without its syntax) or the raw HTML. */
  note?: string
}

const cache = new LRUCache<string, Page>({ maxSize: 50 * 1024 * 1024, sizeCalculation: (p) => p.markdown.length + 1, ttl: 15 * 60_000 })

export interface FetchDeps {
  fetch?: typeof fetch
  resolve?: Resolver
  extract?: (content: string, prompt: string, url: string, signal: AbortSignal) => Promise<string | Extracted>
  /** Tests: the clock the side model's budget is measured with. */
  now?: () => number
}

async function load(url: URL, signal: AbortSignal, deps: FetchDeps): Promise<Page | { redirect: string; status: number }> {
  const cached = cache.get(url.href)
  if (cached) return cached
  const got = await fetchPublic(url, signal, { fetch: deps.fetch, resolve: deps.resolve })
  if (got.kind === "redirect") return { redirect: got.to.href, status: got.status }
  if (got.status >= 400) throw new Error(`HTTP ${got.status} ${got.statusText} fetching ${got.url.href}.${got.status === 401 || got.status === 403 ? " The page needs a login or blocks bots." : ""}`)
  const base = { url: got.url.href, status: got.status, statusText: got.statusText, contentType: got.contentType.split(";")[0]!.trim(), bytes: got.bytes.byteLength, fetchedAt: vnStamp() }
  let page: Page
  if (isPdf(got.contentType, got.bytes)) {
    const { text, pages } = await pdfToText(got.bytes)
    const scanned = text.length < 50 * Math.max(1, pages)
    page = {
      ...base,
      markdown: text,
      note: scanned ? `PDF of ${pages} pages with almost no text layer (a scan): its content cannot be read; look for an HTML version or the data through MCP tools.` : `PDF of ${pages} pages.`,
    }
  } else if (isTextual(got.contentType)) {
    const text = decodeText(got.bytes, got.contentType)
    if (isHtml(got.contentType, text)) {
      const { title, markdown, extracted } = htmlToMarkdown(text, got.url.href)
      const thin = markdown.length < 300 && text.length > 20_000
      page = {
        ...base,
        title,
        markdown,
        note: thin ? "The page is almost empty after extraction: it may be rendered by JavaScript; get market figures with the MCP data tools." : extracted ? undefined : "The main article could not be isolated; this is the whole page (menus/footers removed).",
      }
    } else page = { ...base, markdown: text }
  } else {
    throw new Error(`${got.contentType || "Binary"} content (${Math.round(got.bytes.byteLength / 1024)}KB) cannot be read as text.`)
  }
  cache.set(url.href, page)
  return page
}

/**
 * `signal` is the caller's (the user's Esc). The download gets 60s (DOWNLOAD_TIMEOUT_MS); the
 * side model gets its own limit from what is left of the call's 125s. On 30/10 one 60s limit
 * covered both, and gemini-3.8-flash reading a 22k-token page ended in a bare "The operation
 * timed out." (opencode and Claude Code time only the HTTP request; their summarizer has none).
 */
export async function runFetch(input: WebFetchInput, signal: AbortSignal, deps: FetchDeps = {}): Promise<string> {
  const now = deps.now ?? Date.now
  const started = now()
  const url = checkUrl(input.url)
  const cachedBefore = cache.has(url.href)
  const page = await load(url, AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]), deps)
  if ("redirect" in page) {
    return [
      "REDIRECT: the URL redirects to another host.",
      `Original URL: ${url.href}`,
      `Redirect URL: ${page.redirect}`,
      `Status: ${page.status}`,
      "",
      "To continue, call web_fetch again with:",
      `- url: "${page.redirect}"`,
      ...(input.prompt ? [`- prompt: "${input.prompt}"`] : []),
    ].join("\n")
  }
  const header = `URL: ${page.url} | HTTP ${page.status} | ${page.contentType || "?"} | ${Math.max(1, Math.round(page.bytes / 1024))}KB | fetched ${page.fetchedAt}${cachedBefore ? " | (cache)" : ""}${page.title ? `\nTitle: ${page.title}` : ""}${page.note ? `\nNote: ${page.note}` : ""}`
  const body = page.markdown

  if (input.prompt) {
    const content = body.length > PROMPT_INPUT ? `${body.slice(0, PROMPT_INPUT)}\n[content cut: too long]` : body
    const extract =
      deps.extract ??
      (async (c: string, p: string, u: string, s: AbortSignal) => {
        const target = await webTarget()
        if (!target) throw new Error("No model to read the page with a prompt (type /model).")
        return extractWithModel(c, p, u, target, s)
      })
    const budget = Math.min(EXTRACT_MAX_MS, FETCH_TOOL_TIMEOUT_MS - (now() - started) - EXTRACT_MARGIN_MS)
    if (budget < EXTRACT_MIN_MS) return withPage(header, body, "not enough time left after downloading the page")
    let got: Extracted
    try {
      const out = await extract(content, input.prompt, page.url, AbortSignal.any([signal, AbortSignal.timeout(budget)]))
      got = typeof out === "string" ? { text: out } : out
    } catch (error) {
      // The user's Esc and the side model's own errors (quota…) stay errors; its limit does not.
      if (signal.aborted || (error as { name?: string })?.name !== "TimeoutError") throw error
      return withPage(header, body, `over ${Math.round(budget / 1000)}s`)
    }
    // A provider block is a terminal result, not an incomplete extraction to replace with the page.
    // The line states what happened and nothing else: no advice the model could read as an order.
    if (got.finishReason === "content-filter") {
      // A code word of the provider (RECITATION, SAFETY, content_filter…): anything else is not copied into the result.
      const reason = got.rawFinishReason && /^[A-Za-z0-9_-]{1,40}$/.test(got.rawFinishReason) ? got.rawFinishReason : undefined
      const raw = reason ? `, provider reason: ${reason}` : ""
      const line = `${FILTERED_PREFIX} the provider blocked the output of the page-reading model (finishReason=content-filter${raw}).`
      // RECITATION is a block over quoting the page, not over what the page says: the page is what
      // web_fetch without a prompt returns anyway, so it comes back (as data, after the stated
      // block). Financial news trips it often; a bare block left the model with nothing to read.
      // The side model was never an injection barrier (a timeout or an empty answer returns the raw
      // page too, and the model may fetch without a prompt): the barrier is "tool results are data".
      if (reason === "RECITATION") return `${header}\n\n${line} The page content follows.${pageChunk(body, 0)}`
      return `${header}\n\n${line} There is no reading result for this request.`
    }
    const text = got.text.trim()
    if (!text) return withPage(header, body, `no answer${got.finishReason ? `, finishReason=${got.finishReason}` : ""}`)
    if (got.finishReason === "length") return withPage(header, body, "the answer was cut (finishReason=length)", text)
    return `${header}\n\n${text}`
  }
  return `${header}${pageChunk(body, input.start_char)}`
}

/**
 * The side model did not read the page through: the page itself, so the model needs no second
 * call (and no second request) to see it. A cut answer is kept above it, and the page part is
 * shorter by as much: the whole stays under the tool's 60,000 chars (wrap.ts would cut it and the
 * start_char hint would be wrong).
 */
function withPage(header: string, body: string, why: string, partial?: string): string {
  const note = `Note: the page-reading model did not finish (${why}); the page content follows, continue with start_char.`
  const size = Math.max(PAGE_MIN, PAGE - (partial?.length ?? 0))
  return `${header}\n${note}${partial ? `\n\nThe page-reading model's partial answer:\n${partial}` : ""}${pageChunk(body, 0, size)}`
}

/** `body` from `start_char`, one page at a time, with how to read on. */
function pageChunk(body: string, startChar: number | undefined, size = PAGE): string {
  const start = Math.max(0, startChar ?? 0)
  if (start >= body.length && body.length > 0) return `\n\n(start_char ${start} is past the length of ${body.length} characters.)`
  const chunk = body.slice(start, start + size)
  const rest = body.length - (start + chunk.length)
  const more = rest > 0 ? `\n\n(${rest} characters left; call web_fetch again with start_char=${start + chunk.length}, or use prompt to ask for the part you need)` : ""
  return `${start > 0 ? `\n(from character ${start})` : ""}\n\n${chunk || "(the page has no text content)"}${more}`
}

const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return undefined
  }
}

export function webFetchTool(deps: FetchDeps = {}): ToolDef<WebFetchInput> {
  return {
    name: "web_fetch",
    description:
      "Reads a public URL (HTML as markdown, text from PDFs). Use when you need the content of a specific page or report. Not for searching (use web_search); cannot read pages that need a login or run only in JavaScript. " +
      "Long page: pass prompt to get only the part you need, or continue with start_char.",
    input: z.object({
      url: z.string().min(8),
      prompt: z.string().min(3).max(1000).optional().describe("The question to answer from the page"),
      start_char: z.number().int().min(0).optional(),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    // A page can carry injected instructions; reading an arbitrary host could leak data in
    // its URL. Vietnamese finance/news/government hosts are exempt; others ask once per domain.
    askFor: (input) => {
      const host = hostOf((input as WebFetchInput).url)
      return host && isPreapproved(host) ? undefined : `domain:${host ?? "?"}`
    },
    timeoutMs: FETCH_TOOL_TIMEOUT_MS,
    maxOutputChars: 60_000,
    summarize: (input) => `web_fetch ${input.url.slice(0, 80)}${input.prompt ? ` · "${input.prompt.slice(0, 40)}"` : ""}`,
    execute: (input, ctx) => runFetch(input, ctx.signal, deps),
  }
}

/** Tests only. */
export const clearFetchCache = () => cache.clear()
