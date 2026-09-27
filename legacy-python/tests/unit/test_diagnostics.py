from pathlib import Path

import pytest
from pydantic import ValidationError

from opentrading.application.diagnostics import run_local_diagnostics
from opentrading.config import Settings, summarize_settings_error


def test_doctor_is_local_and_reports_remote_as_unchecked(tmp_path: Path) -> None:
    settings = Settings(session_database=tmp_path / "sessions.sqlite3")
    results = run_local_diagnostics(settings)
    remote = next(result for result in results if result.name == "remote-access")
    assert remote.ok
    assert "never contacts remote" in remote.detail


def test_non_local_environment_is_visible_failure(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production", session_database=tmp_path / "sessions.sqlite3")  # type: ignore[arg-type]


def test_repository_env_example_is_valid() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    settings = Settings(_env_file=repository_root / ".env.example")  # type: ignore[call-arg]
    assert settings.donganh_capital_base_url is None
    assert settings.trading_agents_base_url is None


def test_configuration_error_summary_does_not_echo_rejected_value(tmp_path: Path) -> None:
    marker = "SYNTHETIC_SECRET_MARKER"
    env_file = tmp_path / "invalid.env"
    env_file.write_text(f"OPENTRADING_DONGANH_CAPITAL_BASE_URL=bad-{marker}\n", encoding="utf-8")
    with pytest.raises(ValidationError) as captured:
        Settings(_env_file=env_file)  # type: ignore[call-arg]
    summary = summarize_settings_error(captured.value)
    assert marker not in summary
    assert "donganh_capital_base_url" in summary
