"""Detect high-confidence secret material without printing matched values."""

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = frozenset({".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv", "dist"})
EXCLUDED_NAMES = frozenset({".coverage"})
PROHIBITED_NAMES = frozenset({".env", "session.json", "credentials.json"})
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    "OpenAI-style key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
}


def repository_files(*, include_ignored: bool) -> list[Path]:
    if not include_ignored:
        result = subprocess.run(
            ["git", "ls-files", "--cached", "-z"],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
        return [
            ROOT / raw.decode("utf-8")
            for raw in result.stdout.split(b"\0")
            if raw and (ROOT / raw.decode("utf-8")).is_file()
        ]

    files: list[Path] = []
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if (
            path.name in EXCLUDED_NAMES
            or not path.is_file()
            or any(part in EXCLUDED_PARTS for part in relative.parts)
        ):
            continue
        files.append(path)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--include-ignored",
        action="store_true",
        help="also inspect ignored local files; expected credential files will be reported",
    )
    arguments = parser.parse_args()
    failures: list[str] = []
    for path in repository_files(include_ignored=arguments.include_ignored):
        relative = path.relative_to(ROOT)
        if path.name in PROHIBITED_NAMES or path.suffix.lower() in {".key", ".pem", ".p12", ".pfx"}:
            failures.append(f"{relative}: prohibited secret-bearing filename")
            continue
        try:
            if path.stat().st_size > 2_000_000:
                continue
            content = path.read_text(encoding="utf-8")
        except (FileNotFoundError, UnicodeDecodeError):
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                failures.append(f"{relative}: possible {label}")
    if failures:
        print("Potential secrets detected (values suppressed):")
        print("\n".join(sorted(failures)))
        return 1
    print("No high-confidence secret patterns detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
