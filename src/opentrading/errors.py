"""Stable error taxonomy shared across application boundaries."""

from dataclasses import dataclass
from enum import StrEnum


class ErrorCode(StrEnum):
    INVALID_CONFIGURATION = "invalid_configuration"
    INVALID_INPUT = "invalid_input"
    AUTHENTICATION_FAILED = "authentication_failed"
    PERMISSION_DENIED = "permission_denied"
    RATE_LIMITED = "rate_limited"
    UPSTREAM_TIMEOUT = "upstream_timeout"
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    MALFORMED_UPSTREAM_DATA = "malformed_upstream_data"
    CAPABILITY_UNAVAILABLE = "capability_unavailable"
    POLICY_DENIED = "policy_denied"
    CANCELLED = "cancelled"
    STORAGE_CONFLICT = "storage_conflict"
    INTERNAL = "internal"


@dataclass(slots=True)
class HarnessError(Exception):
    """A user-safe error with a stable machine-readable code."""

    code: ErrorCode
    message: str
    retryable: bool = False

    def __str__(self) -> str:
        return self.message
