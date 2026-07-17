"""Nexla ADK Standardization Service — HTTP service on port 5001."""

from .resolver import ResolutionError, resolve_dot_path, extract_value
from .server import app

__version__ = "0.0.1"

__all__ = ["app", "ResolutionError", "resolve_dot_path", "extract_value"]
