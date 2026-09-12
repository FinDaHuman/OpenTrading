"""JSON value types used at serialized boundaries."""

from pydantic import JsonValue as PydanticJsonValue

type JsonValue = PydanticJsonValue
type JsonObject = dict[str, JsonValue]
