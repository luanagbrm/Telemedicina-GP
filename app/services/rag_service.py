"""RAG — recuperação de informações do hospital ("checar info do hospital").

Objetivo (Carta de Projeto, métricas): responder SOMENTE com base em documentos
reais da base de conhecimento, para atingir 0% de alucinação em informações
críticas. Se nada relevante for recuperado, o chamador deve encaminhar o
paciente para atendimento humano (risco #1).

Este é um esqueleto funcional com recuperação por sobreposição de palavras.
Para produção, troque `retrieve()` por embeddings (ex: sentence-transformers)
+ um vector store (ex: Chroma/FAISS) — a interface permanece a mesma.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_KB_PATH = Path(__file__).resolve().parent.parent / "data" / "hospital_kb.md"
_STOPWORDS = {
    "a", "o", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "um", "uma",
    "para", "por", "com", "no", "na", "que", "qual", "quais", "quanto", "onde",
    "como", "the", "of", "is",
}


def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-zà-ú0-9]+", text.lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 2}


class RAGService:
    def __init__(self, kb_path: Path = _KB_PATH) -> None:
        self.kb_path = kb_path
        self._chunks: list[str] = []
        self._load()

    def _load(self) -> None:
        if not self.kb_path.exists():
            logger.warning("KB file not found at %s", self.kb_path)
            return
        raw = self.kb_path.read_text(encoding="utf-8")
        # Split into chunks by markdown section (## heading).
        self._chunks = [c.strip() for c in re.split(r"\n(?=## )", raw) if c.strip()]

    def retrieve(self, query: str, top_k: int = 2, min_overlap: int = 1) -> list[str]:
        """Return the most relevant KB chunks for the query (may be empty)."""
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []
        scored = [
            (len(q_tokens & _tokenize(chunk)), chunk)
            for chunk in self._chunks
        ]
        scored = [(score, chunk) for score, chunk in scored if score >= min_overlap]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [chunk for _score, chunk in scored[:top_k]]

    def build_context(self, query: str) -> str | None:
        """Concatenated context for grounding, or None if nothing relevant."""
        chunks = self.retrieve(query)
        return "\n\n".join(chunks) if chunks else None


rag_service = RAGService()
