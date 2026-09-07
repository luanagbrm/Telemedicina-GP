"""Audio transcription — turns WhatsApp voice notes into text (enviar por áudio).

Uses faster-whisper (an optional ML dependency). The model is loaded lazily on
first use so the base app can boot without the heavy dependency installed.
"""

from __future__ import annotations

import logging
import tempfile

from app.config import settings

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(self) -> None:
        self._model = None

    def _ensure_model(self) -> None:
        if self._model is None:
            # Imported lazily: only needed when actually transcribing audio.
            from faster_whisper import WhisperModel  # noqa: PLC0415

            logger.info("Loading whisper model '%s'...", settings.whisper_model)
            self._model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")

    def transcribe(self, audio_bytes: bytes, suffix: str = ".ogg") -> str:
        """Transcribe raw audio bytes (WhatsApp sends OGG/Opus) to text."""
        self._ensure_model()
        assert self._model is not None
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            segments, _info = self._model.transcribe(tmp.name, language="pt")
            return " ".join(segment.text for segment in segments).strip()


transcription_service = TranscriptionService()
