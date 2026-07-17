"""
Dot-path resolver for extracting values from nested dict/list payloads.

Supports:
- Simple paths: "current.temperature_2m"
- Array access: "data[0].intensity.actual"
- Literal values: pass-through strings without "." or "[" (e.g. "gCO2/kWh")
"""
import re
from typing import Any


class ResolutionError(Exception):
    """Raised when a dot-path cannot be resolved in the payload."""

    def __init__(self, path: str, detail: str):
        self.path = path
        self.detail = detail
        super().__init__(f"{path}: {detail}")


def _is_literal(mapping_value: str) -> bool:
    """A mapping value is a literal if it contains no dot and no bracket."""
    return "." not in mapping_value and "[" not in mapping_value


def resolve_dot_path(payload: dict[str, Any], path: str) -> Any:
    """
    Resolve a dot-path against a payload dict.

    Segments are split by ".". Each segment may contain "[N]" array indexing.
    Returns the resolved value or raises ResolutionError.
    """
    if _is_literal(path):
        return path

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
    Returns the value directly, or raises ResolutionError.

    Literal strings (those without "." or "[") are returned as-is.
    """
    return resolve_dot_path(payload, path)
