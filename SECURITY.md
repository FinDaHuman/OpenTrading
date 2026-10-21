# Security policy

Report a suspected vulnerability privately through GitHub: the repository's **Security** tab →
**Report a vulnerability**. Do not open a public issue for it, and do not include real
credentials or personal data in the report.

Secrets belong in environment variables or `~/.opentrading/auth.json` (outside the repository).
They must not be stored in repository files, prompts, session events, logs, fixtures, or error
messages. Market news, API payloads, model output, and tool output are untrusted input. They
cannot grant permissions or override deterministic policy.

CI scans the whole git history with gitleaks (`secrets` job in `.github/workflows/ci.yml`).
A fake key in a test needs a `gitleaks:allow` comment on its line; a finding in an old commit
that is a known fake goes in `.gitleaksignore`. To scan locally:
`docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 git /repo --redact`.

OpenTrading is research software and never places orders. Any broker or order-execution feature
requires a separate threat model, legal review, approval design, reconciliation model, and
release decision.
