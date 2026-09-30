/**
 * Deterministic content screening for memory writes: secrets, then market data / forecasts / holdings.
 * Memory must never hold prices, figures or forecasts; those always come from tools with evidence.
 * These rules only catch digit-based forms. Numbers written as words or data without digits can slip through,
 * so this is a best-effort guard, never a complete classifier.
 */

export type RejectReason =
  | "secret_pem"
  | "secret_bearer"
  | "secret_openai"
  | "secret_groq"
  | "secret_nvidia"
  | "secret_google"
  | "secret_xai"
  | "secret_hf"
  | "secret_github"
  | "secret_aws"
  | "money_amount"
  | "valuation_value"
  | "forecast"
  | "holding"
export type AmbiguousReason = "number_present" | "valuation_threshold"

/** Named apart from the memory status `rejected`, which means a user declined a proposal. */
export type ContentVerdict =
  | { verdict: "accepted" }
  | { verdict: "ambiguous"; reasons: AmbiguousReason[] }
  | { verdict: "rejected"; reasons: RejectReason[] }

// JavaScript `\b` only knows ASCII letters, so it breaks on Vietnamese; use Unicode lookarounds instead.
const B = String.raw`(?<![\p{L}\p{N}])`
const E = String.raw`(?![\p{L}\p{N}])`
const NUM = String.raw`\p{N}+(?:[.,]\p{N}+)*`

/*
 * Secrets only need a leading boundary. A trailing one would let a key slip through when a letter follows it
 * directly, and the minimum lengths already keep ordinary words from matching.
 */
const LEAD = String.raw`(?<![A-Za-z0-9_\-])`
export const SECRET_PATTERNS: readonly { reason: RejectReason; pattern: RegExp }[] = [
  { reason: "secret_pem", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { reason: "secret_bearer", pattern: /Authorization:\s*Bearer\s+\S{8,}/i },
  { reason: "secret_openai", pattern: new RegExp(String.raw`${LEAD}sk-[A-Za-z0-9_\-]{16,}`) },
  { reason: "secret_groq", pattern: new RegExp(String.raw`${LEAD}gsk_[A-Za-z0-9]{16,}`) },
  { reason: "secret_nvidia", pattern: new RegExp(String.raw`${LEAD}nvapi-[A-Za-z0-9_\-]{16,}`) },
  { reason: "secret_google", pattern: new RegExp(String.raw`${LEAD}AIza[0-9A-Za-z_\-]{30,}`) },
  { reason: "secret_xai", pattern: new RegExp(String.raw`${LEAD}xai-[A-Za-z0-9]{16,}`) },
  { reason: "secret_hf", pattern: new RegExp(String.raw`${LEAD}hf_[A-Za-z0-9]{16,}`) },
  {
    reason: "secret_github",
    pattern: new RegExp(String.raw`${LEAD}(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`),
  },
  { reason: "secret_aws", pattern: new RegExp(String.raw`${LEAD}AKIA[0-9A-Z]{16}`) },
]

const rx = (source: string) => new RegExp(source, "iu")
const rxAll = (source: string) => new RegExp(source, "giu")

// `k` and `tr` count only when glued to the number, so "3 kịch bản" and "3 tr" do not match but "10k" does.
const MONEY = rx(
  [
    String.raw`${B}${NUM}\s?(?:đồng|đ|vnđ|vnd|nghìn|ngàn|triệu|tỷ|tỉ|usd)${E}`,
    String.raw`${B}${NUM}(?:k|tr)${E}`,
    String.raw`\$\s?${NUM}`,
    String.raw`${B}${NUM}\s?\$`,
  ].join("|"),
)

// Longest names first so "giá mục tiêu" wins over "giá"; "giá trị"/"giá cả" are ordinary words, not prices.
const METRIC = rxAll(
  String.raw`${B}(?:ev/ebitda|p/e|p/b|eps|roe|roa|peg|giá mục tiêu|giá vốn|vùng giá|cắt lỗ|chốt lời|target|giá(?!\s+(?:trị|cả)))${E}`,
)
const COMPARATOR = rx(String.raw`(?:${B}(?:trên|dưới|không quá|không vượt|tối đa|tối thiểu|quá)${E}|[<>≤≥])`)
const HAS_NUMBER = /\p{N}/u

const FORECAST_STRONG = rx(String.raw`${B}(?:dự báo|dự phóng|sẽ\s+(?:tăng|giảm|lên|xuống|đạt|về))${E}`)
const FORECAST_EXPECT = rx(String.raw`${B}kỳ vọng${E}`)
const TIME_MARKER = rx(
  String.raw`${B}(?:(?:tuần|tháng|quý|năm)\s+(?:tới|sau|này)|cuối năm|đầu năm|quý\s*\p{N}|năm\s*\p{N}{4})${E}`,
)

const HOLDING = rxAll(
  String.raw`${B}(?:đang\s+giữ|nắm\s+giữ|nắm|sở\s+hữu|mua|bán)${E}((?:\s+\p{L}+){0,2})\s+${NUM}\s*(?:cp|cổ\s+phiếu|cổ|lô|hợp\s+đồng|hđ)${E}`,
)

// A full stop inside "25.000" is not a sentence end.
const sentences = (text: string) => text.split(/[!?\n]|\.(?!\p{N})/u)

/** Metric followed by a number within three tokens. A comparator before the number marks a user threshold. */
function valuation(text: string): "value" | "threshold" | null {
  let found: "value" | "threshold" | null = null
  for (const m of text.matchAll(METRIC)) {
    const window = text.slice(m.index + m[0].length).split(/\s+/).filter(Boolean).slice(0, 3)
    const at = window.findIndex((t) => HAS_NUMBER.test(t))
    if (at < 0) continue
    if (COMPARATOR.test(window.slice(0, at + 1).join(" "))) found ??= "threshold"
    else return "value"
  }
  return found
}

function forecast(text: string): boolean {
  return sentences(text).some((s) => {
    // "kỳ vọng" also means a plain expectation ("kỳ vọng 3 kịch bản"), so a bare count is not enough for it.
    if (FORECAST_STRONG.test(s)) return HAS_NUMBER.test(s) || s.includes("%") || TIME_MARKER.test(s)
    if (FORECAST_EXPECT.test(s)) return s.includes("%") || MONEY.test(s) || TIME_MARKER.test(s)
    return false
  })
}

/** Holdings are rejected; "không mua quá 2 lô" is a limit the user sets, so a comparator in between is not. */
function holding(text: string): boolean {
  for (const m of text.matchAll(HOLDING)) if (!COMPARATOR.test(m[1] ?? "")) return true
  return false
}

/** Classify an already normalized body. Reasons are rule ids only; they never echo the matched text. */
export function classifyContent(body: string): ContentVerdict {
  const rejected: RejectReason[] = SECRET_PATTERNS.filter((s) => s.pattern.test(body)).map((s) => s.reason)
  if (MONEY.test(body)) rejected.push("money_amount")
  const metric = valuation(body)
  if (metric === "value") rejected.push("valuation_value")
  if (forecast(body)) rejected.push("forecast")
  if (holding(body)) rejected.push("holding")
  if (rejected.length > 0) return { verdict: "rejected", reasons: rejected }

  const ambiguous: AmbiguousReason[] = []
  if (metric === "threshold") ambiguous.push("valuation_threshold")
  if (HAS_NUMBER.test(body) || body.includes("%")) ambiguous.push("number_present")
  if (ambiguous.length > 0) return { verdict: "ambiguous", reasons: ambiguous }
  return { verdict: "accepted" }
}
