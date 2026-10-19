/**
 * The auto-mode classifier's rules, in four lists (Claude Code auto-mode-config):
 * - `hard_deny`: block unconditionally — no user message, no allow rule clears them;
 * - `soft_deny`: block unless an `allow` exception matches or the user's own message names
 *   this exact action and its target;
 * - `allow`: exceptions to `soft_deny`;
 * - `environment`: what counts as inside the user's trust boundary.
 * Written in English (the classifier reads it; English rules are what models follow best),
 * each as "Label: text"; the label is what the UI and the denial message show.
 * The user extends or replaces a list in ~/.opentrading/config.json → autoMode.<list>, with
 * "$defaults" splicing these in (a list without it replaces them). Never read from the
 * project folder: a downloaded repo must not grant itself permissions.
 */

export const DEFAULT_HARD_DENY = [
  "Secret Read: Reading the content of a credential or key file by any tool or command — OpenTrading's auth.json / mcp-auth.json / mcp.json, .env files, SSH keys, cloud credentials, browser profiles, password stores, *.pem / *.key. Reading it sends it to the model provider. Listing a folder that contains such a file is fine; printing the file is not. Also printing environment variables wholesale (printenv, env, set, Get-ChildItem env:, $env: dumps), which holds API keys.",
  "Secret Exfiltration: Sending, uploading, committing, posting or pasting any credential, API key, token, cookie or private key to any destination, or writing one into a file other than where the user asked.",
  "Self-Permission Change: Changing OpenTrading's own permissions, rules, auto-mode settings or configuration (anything under the OpenTrading data folder, e.g. ~/.opentrading/config.json), or launching another agent or tool with its approvals or sandbox disabled (--dangerously-skip-permissions, --yes-always, --no-sandbox, --auto-approve).",
]

export const DEFAULT_SOFT_DENY = [
  "Real Trading: Placing, modifying or cancelling a real order, or moving money, through any broker or bank API, CLI, SDK or web page (DNSE, SSI, VPS, TCBS, VNDirect, MBS, HSC, or any other). Must name: the order (symbol, side, quantity, price) or the transfer. Analysis, quotes and paper-trading simulations that touch no real account are fine.",
  "Code From External: Downloading and running code in one step (curl | bash, iwr | iex, Invoke-Expression on downloaded content), running a script fetched from the internet, or installing a package the user did not ask for, from an unknown source, or globally (npm -g, pip outside a virtual environment the task set up).",
  "Irreversible Local Destruction: Deleting, truncating or overwriting files or folders that existed before this session, beyond what the user named (rm/Remove-Item on existing paths, Set-Content / > onto an existing file, mass deletes by wildcard or age). Must name: the files or folder.",
  "Git Destructive: Force pushing, deleting remote branches or tags, rewriting pushed history, git reset --hard, git clean -fd, git checkout -- . or git stash drop on work that is not the agent's own from this session. Must name: the operation and its target.",
  "Data Exfiltration: Sending local file contents, the user's portfolio, watchlists, notes or other private data to any external host, service, chat, email, paste site, form or repository that the user did not name for that data — including inside a URL or query string.",
  "Messaging As User: Sending email, chat messages (Telegram, Zalo, Slack…), social posts, comments or issues on the user's behalf. Must name: the recipient and the message.",
  "Persistence: Making something start by itself or survive the session: scheduled tasks (schtasks, Register-ScheduledTask, crontab), services, startup/autostart folders or Run registry keys, shell or PowerShell profile files ($PROFILE, .bashrc, .zshrc), git hooks, login items.",
  "Security Weaken: Turning off or bypassing a safety control: -ExecutionPolicy Bypass or Unrestricted, disabling Windows Defender or a firewall, --insecure / -k / verify=False on requests that carry data, changing file permissions or ACLs broadly, granting access to others.",
  "Credential Probing: Searching for, extracting or using credentials or session data from places that are not the normal login flow for the task (browser profiles, keychains, other apps' config, token caches), or trying another credential after one was refused.",
  "Network Exposure: Opening a server, tunnel, port-forward or reverse shell that makes this machine reachable from outside (ngrok, ssh -R, python -m http.server bound to 0.0.0.0, cloudflared).",
  "Outside Workspace Writes: Creating or changing files outside the workspace folders listed in the environment (moving, copying, renaming or writing into other folders), unless the user named that destination.",
  "System Change: Changing system settings, environment variables (setx, [Environment]::SetEnvironmentVariable), the registry, installed programs (winget/choco/apt install or uninstall), drivers, or killing processes the agent did not start.",
]

export const DEFAULT_ALLOW = [
  "Read-Only Commands: Commands that only read or list and print nothing secret: dir / ls / Get-ChildItem, Get-Content or cat of ordinary files, git status / log / diff / show, python --version, pip list, conda list, where / which, Get-Date.",
  "Session Scripts: Running a script the agent wrote in this session inside the workspace (its content is in the transcript), when it only reads input data, computes, and writes its output inside the workspace, and does nothing in the soft_deny list.",
  "Declared Dependencies: Installing packages listed in the workspace's requirements.txt, pyproject.toml or package.json, into a virtual environment or the project folder.",
  "Requested Data Packages: Installing a well-known data or charting package (pandas, numpy, matplotlib, plotly, openpyxl, python-docx, yfinance, vnstock) with pip/uv in a virtual environment or with --user, when the user asked for analysis or a file that needs it.",
  "Public Data Reads: Read-only HTTP GET requests (web_fetch, curl/iwr without a body) to public market-data, news, exchange, regulator or company websites, carrying no local data in the URL beyond the ticker or query the task needs.",
  "Workspace Files: Creating, editing, moving or deleting files the agent created in this session inside the workspace, and creating new files or folders inside the workspace.",
  "Open Own Output: Opening a file the agent just created in the workspace with the default application (start / Invoke-Item / xdg-open on that file).",
  "OpenTrading Data Tools: Calling OpenTrading's own market-data MCP server tools, including ones that save a watchlist or alert there, when the user's request needs them.",
]

export const DEFAULT_ENVIRONMENT = [
  "Context: The agent is OpenTrading, a terminal assistant for Vietnamese stock research. The user is an individual investor, usually on Windows (PowerShell) or a personal computer; messages are often in Vietnamese. The machine holds the user's personal files and API keys.",
  "Trust boundary: Only the workspace folders listed below and the configured OpenTrading MCP data server are trusted. Every other host, service, repository, account and folder is external.",
  "Brokers: Any broker or bank account (DNSE, SSI, VPS, TCBS, VNDirect, MBS, HSC…) is a sensitive target holding real money; reading public market data is not.",
]

export type AutoRuleList = "hard_deny" | "soft_deny" | "allow" | "environment"

export interface AutoModeConfig {
  model?: { provider?: string; model?: string }
  environment?: string[]
  allow?: string[]
  soft_deny?: string[]
  hard_deny?: string[]
}

const DEFAULTS: Record<AutoRuleList, string[]> = {
  hard_deny: DEFAULT_HARD_DENY,
  soft_deny: DEFAULT_SOFT_DENY,
  allow: DEFAULT_ALLOW,
  environment: DEFAULT_ENVIRONMENT,
}

/** A list as the classifier uses it: the user's entries with "$defaults" spliced in; absent = defaults. */
export function effectiveList(list: AutoRuleList, config: AutoModeConfig | undefined): string[] {
  const own = config?.[list]
  if (!own) return [...DEFAULTS[list]]
  return own.flatMap((entry) => (entry === "$defaults" ? DEFAULTS[list] : [entry])).filter((e) => e.trim() !== "")
}

/** "Real Trading" from "Real Trading: Placing…". */
export function labelOf(rule: string) {
  const at = rule.indexOf(":")
  return at > 0 && at < 60 ? rule.slice(0, at).trim() : rule.slice(0, 40)
}

/** Vietnamese names for the default labels (UI and the model's denial message). */
export const LABEL_VI: Record<string, string> = {
  "Secret Read": "Đọc khoá/mật khẩu",
  "Secret Exfiltration": "Lộ khoá/mật khẩu",
  "Self-Permission Change": "Tự sửa quyền",
  "Real Trading": "Giao dịch thật",
  "Code From External": "Chạy code từ ngoài",
  "Irreversible Local Destruction": "Xoá/ghi đè không hoàn tác",
  "Git Destructive": "Git phá huỷ",
  "Data Exfiltration": "Gửi dữ liệu ra ngoài",
  "Messaging As User": "Nhắn tin thay người dùng",
  Persistence: "Tự chạy về sau",
  "Security Weaken": "Hạ bảo mật",
  "Credential Probing": "Dò thông tin đăng nhập",
  "Network Exposure": "Mở máy ra internet",
  "Outside Workspace Writes": "Ghi ngoài workspace",
  "System Change": "Đổi cài đặt hệ thống",
}

export const labelVi = (label: string) => LABEL_VI[label] ?? label
