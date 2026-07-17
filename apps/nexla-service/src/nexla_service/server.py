"""
Nexla Standardization Service — FastAPI HTTP server on port 5001.

Accepts raw provider payloads and standardizes them into NexsetRecords
using the provider's registry field mapping. On startup, registers provider
schemas with the Nexla cloud for schema governance.
"""
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .nexla_client import nexla_registry
from .resolver import ResolutionError, extract_value

# Registration status set on startup
_registration_status: dict[str, bool] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Verify Nexla connectivity on startup."""
    global _registration_status
    path = Path(__file__).resolve().parent.parent.parent.parent.parent / "config" / "providers.json"
    if path.exists():
        with open(path) as f:
            providers = json.load(f)
        for p in providers:
            pid = p.get("id", "unknown")
            warnings = nexla_registry.validate_field_mapping(p.get("fieldMapping", {}))
            _registration_status[pid] = len(warnings) == 0
            if warnings:
                for w in warnings:
                    print(f"[nexla] Warning ({pid}): {w}")
    print(f"[nexla] Validated {len(_registration_status)} provider field mappings")
    yield


app = FastAPI(
    title="Nexla Standardization Service",
    version="0.0.1",
    lifespan=lifespan,
)


class StandardizeRequest(BaseModel):
    """Request body for POST /standardize."""

    providerId: str = Field(..., description="Provider identifier from the registry")
    rawPayload: dict[str, Any] = Field(..., description="Raw provider response payload")
    fieldMapping: dict[str, str] = Field(
        ...,
        description="Maps Nexset fields (value, unit, timestamp, metric) to dot-paths or literal values",
    )
    metric: str | None = Field(
        None,
        description="Metric name; if omitted, must be present in fieldMapping as 'metric'",
    )


class NexsetRecord(BaseModel):
    """A standardized reading produced by the Nexla service."""

    providerId: str
    metric: str
    value: float
    unit: str
    timestamp: str
    raw: dict[str, Any] | None = None


def _error(status: int, error: str, detail: str) -> JSONResponse:
    """Return a structured error response."""
    return JSONResponse(
        status_code=status,
        content={"error": error, "detail": detail},
    )


@app.post("/standardize", response_model=NexsetRecord)
def standardize(body: StandardizeRequest) -> NexsetRecord | JSONResponse:
    """
    Standardize a raw provider payload into a NexsetRecord.

    Uses the fieldMapping to extract value, unit, timestamp (and optionally metric)
    from the raw payload via dot-path resolution.
    """
    fm = body.fieldMapping

    # Resolve metric
    metric = body.metric
    if metric is None and "metric" in fm:
        metric = extract_value(body.rawPayload, fm["metric"])
    if metric is None:
        return _error(400, "Missing metric",
                      "Provide 'metric' in request body or 'metric' key in fieldMapping")
    if not isinstance(metric, str):
        return _error(400, "Invalid metric type",
                      f"Metric must be a string, got {type(metric).__name__}")

    # Resolve required fields
    for field in ("value", "unit", "timestamp"):
        if field not in fm:
            return _error(400, "Missing field mapping",
                          f"fieldMapping must include '{field}'")

    # Resolve value
    try:
        value_raw = extract_value(body.rawPayload, fm["value"])
    except ResolutionError as e:
        return _error(400, "Field resolution failed",
                      f"Cannot resolve 'value': {e.detail}")

    if not isinstance(value_raw, (int, float)) or isinstance(value_raw, bool):
        return _error(400, "Invalid value type",
                      f"Value must be numeric, got {type(value_raw).__name__} ({value_raw!r})")

    # Resolve unit
    try:
        unit_raw = extract_value(body.rawPayload, fm["unit"])
    except ResolutionError as e:
        return _error(400, "Field resolution failed",
                      f"Cannot resolve 'unit': {e.detail}")

    if not isinstance(unit_raw, str):
        return _error(400, "Invalid unit type",
                      f"Unit must be a string, got {type(unit_raw).__name__}")

    # Resolve timestamp
    try:
        timestamp_raw = extract_value(body.rawPayload, fm["timestamp"])
    except ResolutionError as e:
        return _error(400, "Field resolution failed",
                      f"Cannot resolve 'timestamp': {e.detail}")

    if not isinstance(timestamp_raw, str):
        return _error(400, "Invalid timestamp type",
                      f"Timestamp must be a string, got {type(timestamp_raw).__name__}")

    return NexsetRecord(
        providerId=body.providerId,
        metric=metric,
        value=float(value_raw),
        unit=str(unit_raw),
        timestamp=str(timestamp_raw),
        raw=body.rawPayload,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    """Health check with Nexla registration status."""
    return {
        "status": "ok",
        "nexla": {
            "available": nexla_registry.is_available(),
            "registered": _registration_status,
        },
    }
