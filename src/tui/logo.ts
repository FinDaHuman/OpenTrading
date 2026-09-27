/**
 * OpenTrading wordmark: rounded quadrant-block letters, 3 rows tall.
 * "Open" renders in the text colour, "Trading" in the brand green.
 */
const GLYPHS: Record<string, [string, string, string]> = {
  O: ["▟▀▀▙", "█  █", "▜▄▄▛"],
  P: ["█▀▀▙", "█▄▄▛", "█   "],
  E: ["█▀▀▀", "█▀▀ ", "█▄▄▄"],
  N: ["█▀▀▙", "█  █", "█  █"],
  T: ["▀█▀", " █ ", " █ "],
  R: ["█▀▀▙", "█▄▄▛", "█ ▝▙"],
  A: ["▟▀▀▙", "█▄▄█", "█  █"],
  D: ["█▀▀▙", "█  █", "█▄▄▛"],
  I: ["▀", "█", "█"],
  G: ["▟▀▀▀", "█ ▀█", "▜▄▄█"],
}

function word(text: string): string[] {
  const rows = ["", "", ""]
  for (const ch of text) {
    const g = GLYPHS[ch]!
    for (let r = 0; r < 3; r++) rows[r] += g[r] + " "
  }
  return rows.map((r) => r.trimEnd())
}

export const logo = { left: word("OPEN"), right: word("TRADING") }
