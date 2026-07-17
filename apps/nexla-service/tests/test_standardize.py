"""
Tests for the Nexla Standardization Service.

Covers:
- Dot-path resolver with $ prefix (literal vs path)
- Golden tests: Open-Meteo, USGS Earthquake, UK Carbon Intensity, Mock Grid
- Error tests: missing metric, non-numeric value, boolean value, missing key,
  index out of range, wrong type for bracket access, mid-path non-dict
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
        assert extract_value(payload, "$current.temperature_2m") == 18.5

    def test_array_index_path(self):
        payload = {"data": [{"intensity": {"actual": 235}}]}
        assert extract_value(payload, "$data[0].intensity.actual") == 235

    def test_literal_value_no_dollar_prefix(self):
        """Strings without $ are returned as literal values."""
        payload = {"anything": 42}
        assert extract_value(payload, "gCO2/kWh") == "gCO2/kWh"

    def test_literal_value_simple_word(self):
        """Plain words without $ are treated as literals."""
        payload = {"anything": 42}
        assert extract_value(payload, "celsius") == "celsius"

    def test_top_level_field(self):
        assert extract_value({"price": 215.5}, "$price") == 215.5

    def test_missing_key_raises_error(self):
        payload = {"data": {}}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "$data.value")
        assert "value" in exc.value.detail

    def test_wrong_type_for_bracket_access(self):
        payload = {"data": "not_a_list"}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "$data[0].field")
        assert "list" in exc.value.detail.lower()

    def test_index_out_of_range(self):
        payload = {"data": []}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "$data[0].field")
        assert "out of range" in exc.value.detail

    def test_mid_path_not_dict(self):
        payload = {"a": {"b": 42}}
        with pytest.raises(ResolutionError) as exc:
            extract_value(payload, "$a.b.c")
        assert "dict" in exc.value.detail.lower()


# ── Golden tests: Open-Meteo ───────────────────────────────────────────────────


class TestOpenMeteo:
    def test_golden_standardizes_correctly(self):
        raw = {
            "latitude": 51.5,
            "current_units": {"temperature_2m": "\u00b0C"},
            "current": {"time": "2026-07-17T19:15", "temperature_2m": 26.7},
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "open-meteo",
                "rawPayload": raw,
                "fieldMapping": {
                    "metric": "temperature",
                    "value": "$current.temperature_2m",
                    "unit": "$current_units.temperature_2m",
                    "timestamp": "$current.time",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "open-meteo"
        assert record["metric"] == "temperature"
        assert record["value"] == 26.7
        assert record["unit"] == "\u00b0C"
        assert record["timestamp"] == "2026-07-17T19:15"
        assert record["raw"] == raw


# ── Golden tests: USGS Earthquake ──────────────────────────────────────────────


class TestUSGS:
    def test_golden_standardizes_correctly(self):
        raw = {
            "type": "FeatureCollection",
            "features": [
                {
                    "properties": {
                        "mag": 5.2,
                        "place": "Mexico",
                        "time": 1784312803919,
                    },
                    "geometry": {"coordinates": [-92.93, 14.37, 10]},
                }
            ],
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "usgs-earthquake",
                "rawPayload": raw,
                "fieldMapping": {
                    "metric": "earthquake_magnitude",
                    "value": "$features[0].properties.mag",
                    "unit": "magnitude",
                    "timestamp": "$features[0].properties.place",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "usgs-earthquake"
        assert record["value"] == 5.2
        assert record["unit"] == "magnitude"


# ── Golden tests: UK Carbon Intensity ──────────────────────────────────────────


class TestUKCarbon:
    def test_golden_standardizes_correctly(self):
        raw = {
            "data": [
                {
                    "from": "2026-07-17T18:30Z",
                    "to": "2026-07-17T19:00Z",
                    "intensity": {"forecast": 182, "actual": 186, "index": "high"},
                }
            ]
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "uk-carbon-intensity",
                "rawPayload": raw,
                "fieldMapping": {
                    "metric": "carbon_intensity",
                    "value": "$data[0].intensity.actual",
                    "unit": "gCO2/kWh",
                    "timestamp": "$data[0].from",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "uk-carbon-intensity"
        assert record["value"] == 186
        assert record["unit"] == "gCO2/kWh"


# ── Golden tests: Mock Grid ────────────────────────────────────────────────────


class TestMockGrid:
    def test_golden_standardizes_correctly(self):
        raw = {
            "reading": {
                "sensor": "GRID-N4",
                "frequency": 50.02,
                "voltage": 231.4,
                "unit": "Hz",
                "ts": "2026-07-17T19:00:00Z",
            }
        }
        response = client.post(
            "/standardize",
            json={
                "providerId": "mock-grid",
                "rawPayload": raw,
                "fieldMapping": {
                    "metric": "grid_frequency",
                    "value": "$reading.frequency",
                    "unit": "$reading.unit",
                    "timestamp": "$reading.ts",
                },
            },
        )
        assert response.status_code == 200
        record = response.json()
        assert record["providerId"] == "mock-grid"
        assert record["value"] == 50.02
        assert record["unit"] == "Hz"


# ── Error tests ────────────────────────────────────────────────────────────────


class TestErrorCases:
    def test_missing_metric_returns_error(self):
        raw = {"current": {"temperature_2m": 18.0, "time": "2024-01-01T00:00:00Z"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "$current.time",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Missing metric"

    def test_non_numeric_value_returns_error(self):
        raw = {"current": {"temperature_2m": "hot"}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "temperature",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$current.temperature_2m",
                    "unit": "celsius",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid value type"

    def test_boolean_value_rejected(self):
        raw = {"reading": {"value": True}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "test",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$reading.value",
                    "unit": "bool",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Invalid value type"

    def test_missing_key_returns_error(self):
        raw = {"data": {}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "test",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$data.value",
                    "unit": "count",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"

    def test_index_out_of_range_returns_error(self):
        raw = {"data": []}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "test",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$data[0].field",
                    "unit": "count",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"

    def test_wrong_type_for_bracket_access_returns_error(self):
        raw = {"data": "not_a_list"}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "test",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$data[0].field",
                    "unit": "count",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"

    def test_mid_path_non_dict_returns_error(self):
        raw = {"a": {"b": 42}}
        response = client.post(
            "/standardize",
            json={
                "providerId": "test-provider",
                "metric": "test",
                "rawPayload": raw,
                "fieldMapping": {
                    "value": "$a.b.c",
                    "unit": "count",
                    "timestamp": "2024-01-01T00:00:00Z",
                },
            },
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "Field resolution failed"
