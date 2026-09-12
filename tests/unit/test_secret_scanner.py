import subprocess
from pathlib import Path

import scripts.check_secrets as secret_scanner


def test_default_secret_scan_uses_only_git_index(monkeypatch, tmp_path: Path) -> None:
    tracked = tmp_path / "tracked.txt"
    tracked.write_text("safe", encoding="utf-8")
    (tmp_path / ".env").write_text("SYNTHETIC_LOCAL_SECRET=value", encoding="utf-8")

    def fake_git_ls_files(
        command: list[str], *, cwd: Path, check: bool, capture_output: bool
    ) -> subprocess.CompletedProcess[bytes]:
        assert command == ["git", "ls-files", "--cached", "-z"]
        assert cwd == tmp_path
        assert check and capture_output
        return subprocess.CompletedProcess(command, 0, stdout=b"tracked.txt\0")

    monkeypatch.setattr(secret_scanner, "ROOT", tmp_path)
    monkeypatch.setattr(secret_scanner.subprocess, "run", fake_git_ls_files)

    assert secret_scanner.repository_files(include_ignored=False) == [tracked]
