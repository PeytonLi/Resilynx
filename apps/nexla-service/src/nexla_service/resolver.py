"""
Dot-path resolver for extracting values from nested dict/list payloads.

Supports explicit dot-paths with a "$" prefix:
- "$current.temperature_2m" resolves to nested dict values
- "$data[0].intensity.actual" handles array indexing
- Strings without "$" prefix are returned as literal values (e.g. "gCO2/kWh")
"""
import re
from typing import Any


class ResolutionError(Exception):
    """Raised when a dot-path cannot be resolved in the payload."""

    def __init__(self, path: str, detail: str):
        self.path = path
        self.detail = detail
        super().__init__(f"{path}: {detail}")


def resolve_dot_path(payload: dict[str, Any], path: str) -> Any:
    """
    Resolve a path against a payload dict.

    If ``path`` starts with ``$``, strip the prefix and resolve the remainder
    as a dot-path (segments split by ``.``, with optional ``[N]`` array indexing).
    If ``path`` does not start with ``$``, return it unchanged as a literal value.

    Raises ``ResolutionError`` when a segment cannot be resolved (missing key,
    index out of range, type mismatch, or malformed segment).
    """
    if not path.startswith("$"):
        return path

    path = path[1:]  # strip "$"
    segments = path.split(".")
    current: Any = payload

    for segment in segments:
        # Split on "[N]" patterns: "data[0]" → ("data", 0)
        bracket_match = re.match(r"^([^\[]+)(?:\[(\d+)\])?$", segment)
        if not bracket_match:
            raise ResolutionError(path, f"Malformed path segment: {segment}")

        key = bracket_match.group(1)
        index_str = bracket_match.group(2)

        # Navigate into dict by key
        if not isinstance(current, dict):
            raise ResolutionError(
                path,
                f"Expected dict at segment '{key}' but got {type(current).__name__}",
            )
        if key not in current:
            raise ResolutionError(path, f"Key '{key}' not found in payload")

        current = current[key]

        # Navigate into list by index if present
        if index_str is not None:
            index = int(index_str)
            if not isinstance(current, list):
                raise ResolutionError(
                    path,
                    f"Expected list at segment '{key}' but got {type(current).__name__}",
                )
            if index >= len(current):
                raise ResolutionError(
                    path,
                    f"Index {index} out of range for list of length {len(current)} at '{key}'",
                )
            current = current[index]

    return current


def extract_value(payload: dict[str, Any], path: str) -> Any:
    """
    Extract a value from a payload using dot-path resolution.

    Returns the resolved value if ``path`` starts with ``$``,
    otherwise returns ``path`` unchanged as a literal value.

    Raises ``ResolutionError`` on resolution failure.
    """
    return resolve_dot_path(payload, path)
