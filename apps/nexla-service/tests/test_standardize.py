"""
Tests for the Nexla Standardization Service.

Covers:
- Golden tests: each provider's raw payload → exact expected NexsetRecord
- Malformed payloads → structured 400 errors
- Missing fields in mapping → errors, no crashes
- Literal vs path field mapping values
"""
import pytest
from fastapi.testclient import TestClient

from nexla_service.server import app
from nexla_service.resolver import ResolutionError, extract_value


client = TestClient(app)


# ── Unit tests: dot-path resolver ──────────────────────────────────────────────


class TestDotPathResolver:
    def test_simple_nested_path(self):
        payload = {"current": {"temperature_2m": 18.5}}
        assert extract_value(payload, "current.temperature_2m") == 18.5

    def test_array_index_path(self):
        payload = {"data": [{"intensity": {"actual": 235}}]}
        assert extract_value(payload, "data[0].intensity.actual") == 235

    def test_literal_value_no_dot_or_bracket(self):
        """Strings without . or [ are returned as literal values."""
        payload = {"anything": 42}
        assert extract_value(payload, "gCO2/kWh") == "gCO2/kWh"

    def test_literal_value_simple_word(self):
        """Plain words without dots/brackets are treated as literals."""
        payload = {"anything": 42}
        assert extract_value(payload, "celsius") == "celsius"

    def test_missing_key_raises_error(self):
        payload = {"data": {}}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "data.value")
        assert "value" in exc.value.detail

    def test_wrong_type_for_bracket_access(self):
        payload = {"data": "not_a_list"}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "data[0].field")
        assert "list" in exc.value.detail.lower()

    def test_index_out_of_range(self):
        payload = {"data": []}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "data[0].field")
        assert "out of range" in exc.value.detail

    def test_mid_path_not_dict(self):
        payload = {"a": {"b": 42}}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "a.b.c")
        assert "dict" in exc.value.detail.lower()

    def test_dot_path_to_top_level_field(self):
        """Top-level field access via simple dot-path must include a dot, e.g. 'payload.ts'."""
        # A single-segment key without dot/bracket IS treated as literal.
        # To access a top-level key via path, the payload must wrap it
        # and the path uses a dot: "wrapper.ts".
        payload = {"wrapper": {"ts": "2024-01-01T00:00:00Z"}}
        assert extract_value(payload, "wrapper.ts") == "2024-01-01T00:00:00Z"


# ── Golden tests: UK Carbon Intensity ─────────────────────────────────────────


class TestUkCarbonIntensity:
    def test_golden_standardizes_correctly(self):
        raw = {
            "data": [
                {
                    "from": "2024-07-17T10:00Z",
                    "to": "2024-07-17T10:30Z",
                    "intensity": {
                        "forecast": 220,
                        "actual": 235,
                        "index": "moderate",
                    },
                }
            ]
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "uk-carbon-intensity",
                "metric": "carbon_intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "data[0].intensity.actual",
                    "unit": "gCO2/kWh",
                    "timestamp": "data[0].from",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "uk-carbon-intensity"
        assert record["metric"] == "carbon_intensity"
        assert record["value"] == 235.0
        assert record["unit"] == "gCO2/kWh"
        assert record["timestamp"] == "2024-07-17T10:00Z"
        assert record["raw"] == raw

    def test_missing_data_field_returns_error(self):
        raw = {"data": []}
        response = client.post(
            "/standardize",
            json={
                "providerId": "uk-carbon-intensity",
                "metric": "carbon_intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "data[0].intensity.actual",
                    "unit": "gCO2/kWh",
                    "timestamp": "data[0].from",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"
        assert "value" in body["detail"]

    def test_wrong_value_type_returns_error(self):
        raw = {
            "data": [
                {
                    "from": "2024-07-17T10:00Z",
                    "intensity": {"actual": "not_a_number"},
                }
            ]
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "uk-carbon-intensity",
                "metric": "carbon_intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "data[0].intensity.actual",
                    "unit": "gCO2/kWh",
                    "timestamp": "data[0].from",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid value type"


# ── Golden tests: Open-Meteo ──────────────────────────────────────────────────


class TestOpenMeteo:
    def test_golden_standardizes_correctly(self):
        raw = {
            "latitude": 37.87,
            "longitude": -122.26,
            "current": {
                "time": "2024-07-17T10:00",
                "temperature_2m": 22.3,
                "relative_humidity_2m": 65,
            },
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "open-meteo",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "open-meteo"
        assert record["metric"] == "temperature"
        assert record["value"] == 22.3
        assert record["unit"] == "celsius"
        assert record["timestamp"] == "2024-07-17T10:00"
        assert record["raw"] == raw

    def test_missing_current_field_returns_error(self):
        raw = {"latitude": 37.87}
        response = client.post(
            "/standardize",
            json={
                "providerId": "open-meteo",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"
        assert "value" in body["detail"]

    def test_zero_temperature_still_valid(self):
        raw = {
            "current": {
                "time": "2024-07-17T10:00",
                "temperature_2m": 0.0,
            }
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "open-meteo",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["value"] == 0.0


# ── Golden tests: Mock Carbon Registry ────────────────────────────────────────


class TestMockCarbonRegistry:
    def test_golden_standardizes_correctly(self):
        raw = {
            "reading": {
                "value": 42.7,
                "unit": "tCO2e",
                "ts": "2024-07-17T10:00:00Z",
                "source": "mock-verifier-01",
            }
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "mock-carbon-registry",
                "metric": "carbon_offset",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "reading.value",
                    "unit": "reading.unit",
                    "timestamp": "reading.ts",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "mock-carbon-registry"
        assert record["metric"] == "carbon_offset"
        assert record["value"] == 42.7
        assert record["unit"] == "tCO2e"
        assert record["timestamp"] == "2024-07-17T10:00:00Z"
        assert record["raw"] == raw

    def test_missing_reading_field_returns_error(self):
        raw = {}
        response = client.post(
            "/standardize",
            json={
                "providerId": "mock-carbon-registry",
                "metric": "carbon_offset",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "reading.value",
                    "unit": "reading.unit",
                    "timestamp": "reading.ts",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"

    def test_negative_value_still_valid(self):
        raw = {
            "reading": {
                "value": -10.5,
                "unit": "tCO2e",
                "ts": "2024-07-17T10:00:00Z",
            }
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "mock-carbon-registry",
                "metric": "carbon_offset",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "reading.value",
                    "unit": "reading.unit",
                    "timestamp": "reading.ts",
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["value"] == -10.5


# ── Edge case tests ───────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_missing_metric_returns_error(self):
        raw = {"current": {"temperature_2m": 18.0, "time": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Missing metric"

    def test_metric_from_field_mapping_literal(self):
        raw = {"current": {"temperature_2m": 18.0, "time": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "open-meteo",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                    "metric": "temperature",
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["metric"] == "temperature"

    def test_metric_from_field_mapping_via_path(self):
        raw = {
            "meta": {"type": "carbon_intensity"},
            "data": [{"intensity": {"actual": 100}, "from": "2024-01-01T00:00:00Z"}],
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "uk-carbon-intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "metric": "meta.type",
                    "value": "data[0].intensity.actual",
                    "unit": "gCO2/kWh",
                    "timestamp": "data[0].from",
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["metric"] == "carbon_intensity"

    def test_missing_value_field_returns_error(self):
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "temperature",
                "rawPayload": {},
                "fieldMapping": {
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Missing field mapping"
        assert "value" in body["detail"]

    def test_invalid_unit_type_returns_error(self):
        raw = {"current": {"temperature_2m": 18.0, "time": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "current.temperature_2m",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid unit type"

    def test_invalid_timestamp_type_returns_error(self):
        raw = {"current": {"temperature_2m": 18.0, "time": 12345}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid timestamp type"

    def test_int_value_converted_to_float(self):
        raw = {"reading": {"value": 42, "unit": "count", "ts": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "carbon_intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "reading.value",
                    "unit": "reading.unit",
                    "timestamp": "reading.ts",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["value"] == 42.0
        assert isinstance(record["value"], float)

    def test_boolean_value_rejected(self):
        raw = {"reading": {"value": True, "unit": "bool", "ts": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "carbon_intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "reading.value",
                    "unit": "reading.unit",
                    "timestamp": "reading.ts",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid value type"
