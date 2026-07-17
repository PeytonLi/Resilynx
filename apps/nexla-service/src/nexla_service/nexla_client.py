"""
Nexla cloud integration — validates connectivity and provider schemas.
The Nexla SDK orchestrates cloud data pipelines (sources → nexsets → transforms →
destinations), not one-off payload transforms. Our local resolver implements the
same $ prefix path resolution that Nexla transform operations would define.

This module verifies Nexla SDK connectivity on startup and validates that
provider field mappings are compatible with Nexla transform operations.
"""
import os
from pathlib import Path

from nexla_sdk import NexlaClient


def _load_env() -> None:
    """Load .env from repo root if it exists."""
    env_path = Path(__file__).resolve().parent.parent.parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = value.strip().strip('"').strip("'")


class NexlaRegistry:
    """Validates Nexla connectivity and provider schema compatibility."""

    def __init__(self):
        _load_env()
        self.token = os.environ.get("NEXLA_TOKEN", "")
        self.client: NexlaClient | None = None
        self.connected = False
        if self.token:
            try:
                api_url = os.environ.get("NEXLA_API_URL", "")
                kwargs = {"access_token": self.token}
                if api_url:
                    kwargs["base_url"] = api_url
                self.client = NexlaClient(**kwargs)
                # Verify connectivity by listing nexsets (lightweight call)
                self.client.nexsets.list(limit=1)
                self.connected = True
                print(f"[nexla] Connected to Nexla cloud ({api_url or 'default'})")
            except Exception as e:
                print(f"[nexla] Connection failed: {e}")
                self.client = None

    def is_available(self) -> bool:
        return self.connected

    def validate_field_mapping(self, field_mapping: dict[str, str]) -> list[str]:
        """Validate that field mappings are compatible with Nexla transform operations.

        Returns a list of warnings (empty = valid).
        """
        warnings: list[str] = []
        for field, mapping in field_mapping.items():
            if mapping.startswith("$"):
                # $ prefix paths map to Nexla 'rename' operations
                path = mapping[1:]
                if not path or ".." in path:
                    warnings.append(
                        f"Invalid path '{mapping}' for field '{field}': "
                        "Nexla rename operations require valid dot-paths"
                    )
            elif field == "metric" and mapping:
                # Literal metric names are fine
                pass
            elif field in ("value", "unit", "timestamp"):
                # These should be $ paths (we warn if literal)
                warnings.append(
                    f"Field '{field}' is a literal '{mapping}'. "
                    "Consider using a $ prefix path for dynamic extraction."
                )
        return warnings


# Singleton
nexla_registry = NexlaRegistry()
