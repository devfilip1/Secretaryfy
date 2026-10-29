"""Compatibility alias for the modular retrieval pipeline."""
import sys

from assistant.retrieval import pipeline as _implementation

sys.modules[__name__] = _implementation
