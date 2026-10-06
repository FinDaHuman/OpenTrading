import type { ServerConfig } from "./config"

/**
 * Popular MCP servers offered in /mcp under "Có sẵn". They are **off by default**: nothing
 * here is written to config or connected until the user enables an entry. Enabling writes
 * the entry's config to ~/.opentrading/mcp.json (merged) and its secret to mcp-auth.json.
 *
 * Remote URLs checked on 2026-10-02 with `opentrading mcp debug` (initialize → 401 +
 * OAuth metadata; GitHub has no dynamic client registration, hence a PAT).
 */

export interface CatalogEntry {
  /** Server name used in config and tool names (`mcp__<id>__…`). */
  id: string
  name: string
  description: string
  /** How the user signs in. */
  auth: "none" | "oauth" | "token"
  /** A token the user pastes; saved as a secret and referenced as `${env}`. */
  secret?: { env: string; label: string; url?: string }
  /** A program that must be installed (checked before enabling). */
  requires?: { command: string; hint: string }
  /** A folder the user picks (filesystem). */
  folder?: { label: string }
  build(input: { folder?: string }): ServerConfig
}

const NODE_HINT = "Cần Node.js (npx): https://nodejs.org"
const UV_HINT = "Cần uv (uvx): https://docs.astral.sh/uv/getting-started/installation/"

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "context7",
    name: "Context7",
    description: "Tài liệu và ví dụ code mới nhất của các thư viện lập trình.",
    auth: "none",
    build: () => ({ type: "http", url: "https://mcp.context7.com/mcp" }),
  },
  {
    id: "github",
    name: "GitHub",
    description: "Đọc/ghi repository, issue, pull request.",
    auth: "token",
    secret: {
      env: "GITHUB_PAT",
      label: "GitHub Personal Access Token",
      url: "https://github.com/settings/personal-access-tokens/new",
    },
    build: () => ({
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_PAT}" },
    }),
  },
  {
    id: "notion",
    name: "Notion",
    description: "Tìm, đọc và cập nhật trang, database Notion.",
    auth: "oauth",
    build: () => ({ type: "http", url: "https://mcp.notion.com/mcp" }),
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issue, project và chu kỳ trên Linear.",
    auth: "oauth",
    build: () => ({ type: "http", url: "https://mcp.linear.app/mcp" }),
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Lỗi và sự cố ứng dụng trên Sentry.",
    auth: "oauth",
    build: () => ({ type: "http", url: "https://mcp.sentry.dev/mcp" }),
  },
  {
    id: "atlassian",
    name: "Atlassian (Jira, Confluence)",
    description: "Issue Jira và trang Confluence.",
    auth: "oauth",
    build: () => ({ type: "sse", url: "https://mcp.atlassian.com/v1/sse" }),
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Điều khiển trình duyệt: mở trang, click, điền form, chụp màn hình.",
    auth: "none",
    requires: { command: "npx", hint: NODE_HINT },
    build: () => ({ command: "npx", args: ["-y", "@playwright/mcp@latest"] }),
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Đọc/ghi file trong một thư mục bạn chọn (chỉ thư mục đó).",
    auth: "none",
    requires: { command: "npx", hint: NODE_HINT },
    folder: { label: "Thư mục cho phép truy cập" },
    build: ({ folder }) => ({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", folder ?? "."] }),
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Tải một trang web và chuyển thành markdown.",
    auth: "none",
    requires: { command: "uvx", hint: UV_HINT },
    build: () => ({ command: "uvx", args: ["mcp-server-fetch"] }),
  },
  {
    id: "opentrading",
    name: "OpenTrading data (nhóm)",
    description: "Dữ liệu thị trường Việt Nam của nhóm: giá, BCTC, dòng tiền, tin tức.",
    auth: "token",
    secret: { env: "OPENTRADING_MCP_TOKEN", label: "Token nhóm (xin admin)" },
    build: () => ({
      type: "http",
      url: "https://opentrading-mcp-web.onrender.com/mcp",
      headers: { Authorization: "Bearer ${OPENTRADING_MCP_TOKEN}" },
      // Render free tier cold-starts in 20–40s.
      startupTimeoutMs: 60_000,
      toolTimeoutMs: 180_000,
    }),
  },
]

/** Catalog entries the user has not configured yet (by server name). */
export function availableCatalog(configured: string[]) {
  const taken = new Set(configured)
  return MCP_CATALOG.filter((e) => !taken.has(e.id))
}

/** Whether the entry's required program is on PATH. */
export function missingRequirement(entry: CatalogEntry): string | undefined {
  if (!entry.requires) return undefined
  return Bun.which(entry.requires.command) ? undefined : entry.requires.hint
}
