"""Credential resolution contract; secret values must never be persisted as events."""

from typing import Protocol

from pydantic import SecretStr


class CredentialStore(Protocol):
    async def get(self, credential_id: str) -> SecretStr | None: ...
