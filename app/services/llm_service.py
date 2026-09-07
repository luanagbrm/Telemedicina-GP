"""LLM service — interprets user requests (ator "IA" no diagrama).

Two responsibilities:
  1. interpret()          -> classifica a intenção + extrai entidades (agendar, etc.)
  2. answer_hospital_info -> responde perguntas do hospital ANCORADAS na base de
                             conhecimento (RAG), para atingir 0% de alucinação em
                             informações críticas (métrica da carta). Se não houver
                             contexto relevante, retorna None -> encaminhar humano.

Backends intercambiáveis via settings.llm_backend:
  - ollama       -> HTTP para um servidor Ollama local (padrão, sem GPU)
  - huggingface  -> pipeline transformers local (pesado; requirements-ml.txt)
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.models.enums import IntencaoChatbot
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)

_INTENT_SYSTEM_PROMPT = """Você é o assistente de uma clínica (TeleMed+) no WhatsApp.
Classifique a mensagem do usuário em UMA das intenções abaixo e extraia dados úteis.

Intenções válidas:
- AGENDAR_CONSULTA
- CANCELAR_CONSULTA
- REMARCAR_CONSULTA
- LOCALIZAR_CONSULTA
- CONSULTAR_DISPONIBILIDADE
- CHECAR_INFO_HOSPITAL
- ENCAMINHAR_HUMANO
- DESCONHECIDA

Responda SOMENTE com JSON válido no formato:
{"intencao": "<INTENCAO>", "entidades": {"data": null, "hora": null, "especialidade": null, "tipo": "CONSULTA|EXAME"}, "resposta_sugerida": "<texto curto em pt-BR>"}
"""

_RAG_SYSTEM_PROMPT = """Você responde perguntas sobre o hospital usando SOMENTE o CONTEXTO fornecido.
Se a resposta não estiver no contexto, responda EXATAMENTE: NAO_SEI.
Nunca invente endereços, horários, telefones ou valores."""


class InterpretationResult:
    def __init__(self, intencao: IntencaoChatbot, entidades: dict[str, Any], resposta: str) -> None:
        self.intencao = intencao
        self.entidades = entidades
        self.resposta = resposta

    def __repr__(self) -> str:
        return f"<InterpretationResult intencao={self.intencao} entidades={self.entidades}>"


class LLMBackend(Protocol):
    async def complete(self, system: str, user: str, json_mode: bool = False) -> str: ...


class OllamaBackend:
    """Calls an Ollama server over HTTP. See https://github.com/ollama/ollama."""

    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=5))
    async def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {"temperature": 0.1},
        }
        if json_mode:
            payload["format"] = "json"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json()["message"]["content"]


class HuggingFaceBackend:
    """Local transformers pipeline. Lazy-imported so the base install stays light."""

    def __init__(self) -> None:
        self.model_name = settings.hf_model
        self._pipe = None

    def _ensure_pipe(self) -> None:
        if self._pipe is None:
            from transformers import pipeline  # noqa: PLC0415  (optional heavy dep)

            self._pipe = pipeline("text-generation", model=self.model_name)

    async def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        self._ensure_pipe()
        assert self._pipe is not None
        prompt = f"{system}\n\nUsuário: {user}\nResposta:"
        out = self._pipe(prompt, max_new_tokens=256, do_sample=False)
        return out[0]["generated_text"]


def _make_backend() -> LLMBackend:
    if settings.llm_backend == "huggingface":
        return HuggingFaceBackend()
    return OllamaBackend()


class LLMService:
    def __init__(self) -> None:
        self.backend = _make_backend()

    async def interpret(self, user_message: str) -> InterpretationResult:
        """Classify intent + extract entities. Falls back to DESCONHECIDA on error."""
        try:
            raw = await self.backend.complete(_INTENT_SYSTEM_PROMPT, user_message, json_mode=True)
            data = json.loads(raw)
            intencao = IntencaoChatbot(data.get("intencao", "DESCONHECIDA"))
            entidades = data.get("entidades", {}) or {}
            resposta = data.get("resposta_sugerida", "")
            return InterpretationResult(intencao, entidades, resposta)
        except (httpx.HTTPError, json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning("LLM interpretation failed (%s); returning DESCONHECIDA", exc)
            return InterpretationResult(
                IntencaoChatbot.DESCONHECIDA,
                {},
                "Desculpe, não entendi. Pode reformular seu pedido?",
            )

    async def answer_hospital_info(self, question: str) -> str | None:
        """Answer grounded ONLY in the KB. Returns None if unknown (-> human handoff)."""
        context = rag_service.build_context(question)
        if not context:
            return None
        user = f"CONTEXTO:\n{context}\n\nPERGUNTA: {question}"
        try:
            answer = (await self.backend.complete(_RAG_SYSTEM_PROMPT, user)).strip()
        except httpx.HTTPError as exc:
            logger.warning("RAG answer failed (%s)", exc)
            return None
        if not answer or "NAO_SEI" in answer.upper():
            return None
        return answer


llm_service = LLMService()
