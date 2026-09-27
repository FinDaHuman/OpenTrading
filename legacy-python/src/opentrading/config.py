"""Local configuration with no implicit remote defaults."""

from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="OPENTRADING_", env_file=".env", extra="ignore", case_sensitive=False
    )

    environment: Literal["local"] = "local"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    session_database: Path = Path("~/.opentrading/sessions.sqlite3")
    donganh_capital_base_url: AnyHttpUrl | None = None
    donganh_capital_token: SecretStr | None = None
    trading_agents_base_url: AnyHttpUrl | None = None
    trading_agents_token: SecretStr | None = None
    request_timeout_seconds: float = Field(default=15, gt=0, le=120)

    @field_validator(
        "donganh_capital_base_url",
        "donganh_capital_token",
        "trading_agents_base_url",
        "trading_agents_token",
        mode="before",
    )
    @classmethod
    def empty_string_is_unset(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


def summarize_settings_error(error: ValidationError) -> str:
    """Return field names and error kinds without echoing rejected input values."""
    issues: list[str] = []
    for item in error.errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in item["loc"])
        issues.append(f"{location or 'settings'}: {item['msg']}")
    return "; ".join(issues)
