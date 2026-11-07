import { foldName } from "./topics"

/**
 * Ranks lessons for memory_read's keyword search: the words of the query (diacritics and case ignored)
 * found in a lesson's title, summary, tags and the names it applies to. A word in the title counts a
 * little more, so "định giá ngân hàng" puts the lesson titled so ahead of one that only mentions banks.
 */

export interface SearchableLesson {
  id: number
  title: string
  summary: string
  tags: readonly string[]
  appliesToDisplay: readonly string[]
}

export const MAX_SEARCH_RESULTS = 5

const words = (text: string) => new Set(foldName(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean))

export function rankLessons<T extends SearchableLesson>(query: string, lessons: readonly T[]): T[] {
  const asked = [...words(query)]
  if (asked.length === 0) return []
  return lessons
    .map((lesson) => {
      const title = words(lesson.title)
      const all = new Set([...title, ...words(lesson.summary), ...lesson.tags.flatMap((t) => [...words(t)]),
        ...lesson.appliesToDisplay.flatMap((n) => [...words(n)])])
      const score = asked.reduce((s, w) => s + (all.has(w) ? 1 : 0) + (title.has(w) ? 0.5 : 0), 0)
      return { lesson, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.lesson.id - b.lesson.id)
    .slice(0, MAX_SEARCH_RESULTS)
    .map((r) => r.lesson)
}
