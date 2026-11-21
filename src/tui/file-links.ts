import { statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { MAX_LINK_URL_BYTES, type CliRenderer } from "@opentui/core"
import { createSignal, type Accessor } from "solid-js"

/**
 * Clickable file paths in the transcript (#345): OSC 8 hyperlinks, through OpenTUI's own link support.
 *
 * Nothing changes unless the terminal said it understands OSC 8 (`renderer.capabilities.hyperlinks`,
 * detected natively, multiplexers included): the fallback is the plain text shown before. Only existing
 * regular files under the workspace roots (the folder and the /add-dir ones) are linked, never one a click
 * could run (a script or program opens with its handler), never a UNC path (a stat there can stall a
 * frame), never a link longer than the renderer keeps. OPENTRADING_HYPERLINKS=0 turns it off.
 */

/** Opened, not shown, by the OS on a click: never linked. */
const RUNNABLE = new Set(
  "bat cmd com exe msi msp msc scr pif cpl lnk url reg hta ps1 psm1 psd1 vbs vbe js jse wsf wsh jar appref-ms application gadget inf scf sh command app".split(" "),
)

/** Where relative paths are looked up: the workspace roots. Set by the app. */
let roots: () => readonly string[] = () => []
export function setLinkRoots(get: () => readonly string[]) {
  roots = get
  known.clear()
}

/** Lookups by roots and token. A miss is kept briefly only: the file may be written a moment later. */
const known = new Map<string, { href?: string; at: number }>()
const KNOWN_MAX = 2000
const MISS_MS = 2000

/** The file a path token names, inside a root, as a file:// URL; undefined when it is not one to link. */
export function fileHref(token: string): string | undefined {
  const list = roots()
  const key = `${list.join("\u0000")}\u0000${token}`
  const hit = known.get(key)
  if (hit && (hit.href || Date.now() - hit.at < MISS_MS)) return hit.href
  const href = resolve(token, list)
  if (known.size >= KNOWN_MAX) known.clear()
  known.set(key, { href, at: Date.now() })
  return href
}

const isUnc = (p: string) => /^[\\/]{2}/.test(p)
const inside = (root: string, file: string) => {
  const rel = path.relative(root, file)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function resolve(token: string, list: readonly string[]): string | undefined {
  if (!token || isUnc(token) || /^[a-z][a-z0-9+.-]+:\/\//i.test(token)) return undefined
  const ext = path.extname(token).slice(1).toLowerCase()
  if (!ext || RUNNABLE.has(ext)) return undefined
  const candidates = path.isAbsolute(token) ? [path.resolve(token)] : list.map((root) => path.resolve(root, token))
  for (const file of candidates) {
    if (isUnc(file) || !list.some((root) => inside(path.resolve(root), file))) continue
    try {
      if (!statSync(file).isFile()) continue
    } catch {
      continue
    }
    // Brackets and spaces would end a markdown destination; quotes are safe either way.
    const href = pathToFileURL(file).href.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))
    if (Buffer.byteLength(href) > MAX_LINK_URL_BYTES) return undefined
    return href
  }
  return undefined
}

/**
 * A path-looking run: optional drive, ./, ../ or / start, segments of letters (Vietnamese too), digits,
 * `._-+@`, joined by / or \, ending in an extension. `:12` or `:12:3` after it is kept out of the token.
 */
const PATH = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\p{L}\p{N}_.+@-]+[\\/])*[\p{L}\p{N}_+@-][\p{L}\p{N}_.+@-]*\.[\p{L}\p{N}]{1,10}/gu

export type Segment = { text: string; href?: string }

/** `text` cut into plain runs and linked file paths; one plain segment when nothing links. */
export function linkSegments(text: string): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of text.matchAll(PATH)) {
    const start = m.index!
    // Part of a longer word or a URL (…/x.html, a@b.com): left alone.
    const before = text[start - 1]
    if (before && /[\p{L}\p{N}_.:/\\@-]/u.test(before)) continue
    const href = fileHref(m[0])
    if (!href) continue
    if (start > at) out.push({ text: text.slice(at, start) })
    out.push({ text: m[0], href })
    at = start + m[0].length
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) })
  return out
}

/**
 * Markdown with file paths made into links: an inline code span whose whole content is a file
 * (`` `src/x.ts` `` → `` [`src/x.ts`](file://…) ``) and a bare path in prose. Fenced and indented code,
 * existing links, autolinks, URLs and HTML are left as they are, so with links on the screen shows the
 * same characters.
 */
export function linkMarkdown(markdown: string): string {
  if (!markdown) return markdown
  const lines = markdown.split("\n")
  let fence: string | undefined
  let prevBlank = true
  let inList = false
  return lines
    .map((line) => {
      const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length && !line.slice(opener[0].length).trim()) fence = undefined
        return line
      }
      if (opener) {
        fence = opener[1]
        return line
      }
      const blank = !line.trim()
      if (!blank && /^ {0,3}([-*+]|\d{1,9}[.)])\s/.test(line)) inList = true
      else if (blank) {
        /* a list goes on across a blank line while what follows is indented */
      } else if (!/^\s/.test(line)) inList = false
      // Indented code: four spaces (or a tab) after a blank line, outside a list.
      const indentedCode = /^( {4}|\t)/.test(line) && prevBlank && !inList
      prevBlank = blank || (indentedCode && prevBlank)
      return indentedCode ? line : linkInline(line)
    })
    .join("\n")
}

/** Code spans, links, autolinks, URLs, HTML tags and backslash escapes: matched to be skipped or linked. */
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|!?\[[^\]]*\]\([^)]*\)|!?\[[^\]]*\]\[[^\]]*\]|<[^>\s]+>|[a-z][a-z0-9+.-]+:\/\/\S+|\\[!-/:-@[-`{-~]/gi

function linkInline(line: string): string {
  let out = ""
  let at = 0
  for (const m of line.matchAll(INLINE)) {
    const start = m.index!
    out += linkProse(line.slice(at, start))
    const [whole, ticks, body] = m
    if (ticks && body !== undefined) {
      // A code span is linked only when its whole content (trimmed of one space each side) is a file.
      const content = body.startsWith(" ") && body.endsWith(" ") && body.trim() ? body.slice(1, -1) : body
      const href = !content.trim() || content !== content.trim() ? undefined : fileHref(content)
      out += href ? `[${whole}](${href})` : whole
    } else out += whole
    at = start + whole.length
  }
  return out + linkProse(line.slice(at))
}

/** Bare paths in prose. Markdown specials in a path (`_`, `*`) would be read as emphasis: those stay. */
function linkProse(text: string): string {
  if (!text) return text
  return linkSegments(text)
    .map((s) => (s.href && !/[*_[\]<>]/.test(s.text) ? `[${s.text}](${s.href})` : s.text))
    .join("")
}

const perRenderer = new WeakMap<CliRenderer, Accessor<boolean>>()

/**
 * True while the terminal takes OSC 8 links. `capabilities` is null until the terminal answers, so this
 * follows the renderer's "capabilities" event; one listener per renderer, however many rows ask.
 */
export function useLinks(renderer: CliRenderer): Accessor<boolean> {
  const known = perRenderer.get(renderer)
  if (known) return known
  const on = (caps: { hyperlinks?: boolean } | null | undefined) => caps?.hyperlinks === true && process.env.OPENTRADING_HYPERLINKS !== "0"
  const [links, setLinks] = createSignal(on(renderer.capabilities))
  renderer.on("capabilities", (caps: { hyperlinks?: boolean }) => setLinks(on(caps)))
  perRenderer.set(renderer, links)
  return links
}
