"""Supported public catalog-recognition API."""

from .recognition import GameRecognition
from .service import GameRecognitionClient

__all__ = ["GameRecognition", "GameRecognitionClient"]
