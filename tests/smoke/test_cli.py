from typer.testing import CliRunner

from opentrading.interfaces.cli.app import app

runner = CliRunner()


def test_help_lists_local_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "doctor" in result.output
    assert "research" in result.output


def test_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "opentrading 0.1.0" in result.output


def test_status_is_honest_about_unimplemented_runtime() -> None:
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0
    assert "specified" in result.output
    assert "out of scope" in result.output


def test_research_does_not_return_fake_financial_output() -> None:
    result = runner.invoke(app, ["research", "What is the market outlook?"])
    assert result.exit_code == 3
    assert "not implemented" in result.output


def test_doctor_passes_with_default_local_configuration() -> None:
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    assert "not checked" in result.output


def test_doctor_redacts_invalid_configuration_value() -> None:
    marker = "SYNTHETIC_SECRET_MARKER"
    result = runner.invoke(
        app,
        ["doctor"],
        env={"OPENTRADING_DONGANH_CAPITAL_BASE_URL": f"invalid-{marker}"},
    )
    assert result.exit_code == 2
    assert marker not in result.output
    assert "donganh_capital_base_url" in result.output
