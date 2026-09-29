import { RGBA, SyntaxStyle } from "@opentui/core"

/** Palette from HarnessPlan.html — the Vietnamese price-board colours. */
export const color = {
  bg: "#070C12",
  bg2: "#0C131C",
  panel: "#101923",
  panel2: "#0A1017",
  rule: "#1D2937",
  ruleSoft: "#16202B",
  tx: "#D8E1EB",
  tx2: "#8C9BAD",
  tx3: "#5C6C7E",
  /** trần — ceiling, purple */
  tran: "#C87BF0",
  /** tăng — up, green (brand accent) */
  tang: "#35D07F",
  /** tham chiếu — reference, yellow */
  tham: "#EFC442",
  /** giảm — down, red (errors) */
  giam: "#F26464",
  /** sàn — floor, cyan */
  san: "#3FD0DE",
} as const

export const rgba = (hex: string) => RGBA.fromHex(hex)

let markdown: SyntaxStyle | undefined

/**
 * Styles for the markdown renderer's `markup.*` scopes (same scope names opencode themes).
 * Created lazily: SyntaxStyle is backed by the native renderer library.
 */
export function markdownStyle(): SyntaxStyle {
  markdown ??= SyntaxStyle.fromStyles({
    default: { fg: color.tx },
    "markup.heading": { fg: color.tang, bold: true },
    "markup.heading.1": { fg: color.tang, bold: true, underline: true },
    "markup.bold": { fg: color.tx, bold: true },
    "markup.strong": { fg: color.tx, bold: true },
    "markup.italic": { fg: color.tx2, italic: true },
    "markup.list": { fg: color.tham },
    "markup.quote": { fg: color.tx2, italic: true },
    "markup.raw": { fg: color.san },
    "markup.raw.block": { fg: color.san },
    "markup.raw.inline": { fg: color.san },
    "markup.link": { fg: color.san, underline: true },
    "markup.link.label": { fg: color.san, underline: true },
    "markup.link.url": { fg: color.tx3, underline: true },
    conceal: { fg: color.tx3 },
  })
  return markdown
}

/** Linear mix of two hex colours, `t` in 0..1. */
export function mix(a: string, b: string, t: number): RGBA {
  const x = RGBA.fromHex(a)
  const y = RGBA.fromHex(b)
  return RGBA.fromValues(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t, 1)
}
