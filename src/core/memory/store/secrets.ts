/**
 * Shapes of secrets the store refuses to keep: only high-confidence ones (a fixed prefix plus a
 * long tail), so ordinary notes are never blocked. Numbers and prices are not checked here on
 * purpose; a pattern cannot tell a user's own target from market data.
 * Each pattern must not start in the middle of a word ("task-…", "risk-…").
 */
const START = String.raw`(?<![A-Za-z0-9_-])`

const PATTERNS: readonly RegExp[] = [
  String.raw`sk-ant-[A-Za-z0-9_-]{20,}`, // Anthropic
  String.raw`sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}`, // OpenAI, OpenRouter
  String.raw`gsk_[A-Za-z0-9]{20,}`, // Groq
  String.raw`AIza[0-9A-Za-z_-]{35}`, // Google
  String.raw`xai-[A-Za-z0-9]{20,}`, // xAI
  String.raw`nvapi-[A-Za-z0-9_-]{20,}`, // NVIDIA
  String.raw`tvly-[A-Za-z0-9_-]{20,}`, // Tavily
  String.raw`gh[pousr]_[A-Za-z0-9]{36,}`, // GitHub classic tokens
  String.raw`github_pat_[A-Za-z0-9_]{22,}`, // GitHub fine-grained tokens (the GitHub MCP server asks for one)
  String.raw`AKIA[0-9A-Z]{16}(?![0-9A-Z])`, // AWS access key id
].map((p) => new RegExp(START + p))

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

export function looksLikeSecret(text: string): boolean {
  return PRIVATE_KEY.test(text) || PATTERNS.some((p) => p.test(text))
}
