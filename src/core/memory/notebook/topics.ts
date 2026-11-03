import { fold } from "../../skills/catalog"
import { splitNotices } from "../../subagents/notification"

/**
 * Which subjects a turn is about, from what the user typed only. A sub-agent's result listing twenty
 * tickers rides in front of the user's words; counting it would inject twenty theses nobody asked for.
 */

export interface MatchEntry {
  subjectId: number
  aliases: readonly string[]
  uppercaseOnly: boolean
}

/** The user's own words, without sub-agent and ultradesk notifications; `noticeOnly` when nothing else is left. */
export function typedText(query: string): { text: string; noticeOnly: boolean } {
  const { notices, rest } = splitNotices(query)
  return { text: rest, noticeOnly: notices.length > 0 && rest === "" }
}

const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/u

/**
 * Folded text (no diacritics, lower case, one space per run of spaces) with, for each folded character,
 * the index in the NFC text it came from. Folding changes lengths, so a match position is only ever
 * mapped back through this table, never reused as an index into the original.
 */
function folded(nfc: string): { text: string; origin: number[] } {
  let text = ""
  const origin: number[] = []
  let at = 0
  for (const ch of nfc) {
    if (SPACE.test(ch)) {
      if (!text.endsWith(" ")) {
        text += " "
        origin.push(at)
      }
    } else {
      const f = fold(ch)
      text += f
      for (let k = 0; k < f.length; k++) origin.push(at)
    }
    at += ch.length
  }
  return { text, origin }
}

/** A name or a query as matching sees it: NFC, no diacritics, lower case, single spaces, trimmed. */
export const foldName = (text: string) => folded(text.normalize("NFC")).text.trim()

/** Start of the first whole-word occurrence of `key` in `text`, or -1. */
function firstWord(text: string, key: string): number {
  if (!key) return -1
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const before = text[i - 1]
    const after = text[i + key.length]
    if ((before === undefined || !WORD.test(before)) && (after === undefined || !WORD.test(after))) return i
  }
  return -1
}

/**
 * Subjects named in `text`, in order of first appearance, each once. Aliases match as whole words,
 * ignoring case and diacritics; an uppercase-only subject ("TIN") matches only its capitals, so the
 * word "tin" (news) does not inject a thesis.
 */
export function detectSubjects(text: string, table: readonly MatchEntry[]): number[] {
  const nfc = text.normalize("NFC")
  const loose = folded(nfc)
  const hits: { subjectId: number; at: number; length: number }[] = []
  for (const entry of table) {
    let best: { at: number; length: number } | undefined
    for (const alias of entry.aliases) {
      const name = alias.normalize("NFC").trim()
      let at: number
      if (entry.uppercaseOnly) {
        at = firstWord(nfc, name.toLocaleUpperCase("vi"))
      } else {
        const i = firstWord(loose.text, foldName(name))
        at = i < 0 ? -1 : loose.origin[i]!
      }
      if (at >= 0 && (!best || at < best.at || (at === best.at && name.length > best.length))) {
        best = { at, length: name.length }
      }
    }
    if (best) hits.push({ subjectId: entry.subjectId, ...best })
  }
  return hits.sort((a, b) => a.at - b.at || b.length - a.length || a.subjectId - b.subjectId).map((h) => h.subjectId)
}
