"""WhatsApp webhook — the chatbot's entry point.

GET  /api/whatsapp/webhook  -> verification handshake (Meta calls this once).
POST /api/whatsapp/webhook  -> inbound messages (text + audio).

Flow per inbound message (see the use-case diagram + Carta de Projeto):
  1. Parse the payload -> (wa_id, text|audio).
  2. If audio: download + transcribe (enviar por áudio).
  3. Interpret the text with the LLM (ator IA -> intenção).
  4. Route by intenção:
       - CHECAR_INFO_HOSPITAL -> resposta ancorada em RAG (ou handoff se não souber)
       - ENCAMINHAR_HUMANO / DESCONHECIDA -> encaminhar para atendente (risco #1)
       - AGENDAR/CANCELAR/REMARCAR/... -> fluxos de agendamento (TODO: SchedulingService)
  5. Reply on WhatsApp and persist the exchange.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.chatbot import Conversa, Mensagem
from app.models.enums import CanalMensagem, IntencaoChatbot
from app.models.paciente import Paciente
from app.services.llm_service import llm_service
from app.services.transcription_service import transcription_service
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

_HANDOFF_MSG = (
    "Vou te encaminhar para um de nossos atendentes. "
    "Você também pode ligar para a recepção: (11) 4000-0000."
)

# Intenções de agendamento ainda não implementadas (aguardam o SchedulingService).
_SCHEDULING_INTENTS = {
    IntencaoChatbot.AGENDAR_CONSULTA,
    IntencaoChatbot.CANCELAR_CONSULTA,
    IntencaoChatbot.REMARCAR_CONSULTA,
    IntencaoChatbot.AGENDAR_EXAME,
    IntencaoChatbot.CANCELAR_EXAME,
    IntencaoChatbot.LOCALIZAR_CONSULTA,
    IntencaoChatbot.CONSULTAR_DISPONIBILIDADE,
}


@router.get("/webhook")
def verify_webhook(
    mode: str = Query(alias="hub.mode", default=""),
    token: str = Query(alias="hub.verify_token", default=""),
    challenge: str = Query(alias="hub.challenge", default=""),
) -> Response:
    """Meta webhook verification handshake."""
    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        return Response(content=challenge, media_type="text/plain")
    return Response(status_code=status.HTTP_403_FORBIDDEN)


def _get_or_create_paciente(db: Session, wa_id: str) -> Paciente:
    paciente = db.query(Paciente).filter_by(telefone=wa_id).first()
    if paciente is None:
        paciente = Paciente(telefone=wa_id)
        db.add(paciente)
        db.flush()
    return paciente


async def _resolve_reply(intencao: IntencaoChatbot, texto: str, suggested: str) -> str:
    """Decide the outbound reply based on the interpreted intent."""
    if intencao == IntencaoChatbot.CHECAR_INFO_HOSPITAL:
        answer = await llm_service.answer_hospital_info(texto)
        return answer if answer else _HANDOFF_MSG
    if intencao in (IntencaoChatbot.ENCAMINHAR_HUMANO, IntencaoChatbot.DESCONHECIDA):
        return _HANDOFF_MSG
    if intencao in _SCHEDULING_INTENTS:
        # TODO: implementar SchedulingService:
        #   - consultas: ler slots DISPONIVEL em `Agenda`, gravar `Consulta`, marcar OCUPADO
        #   - exames: gravar `AgendamentoExame`
        #   - regras (nota do time): impedir 2ª consulta na mesma especialidade antes de
        #     realizar a 1ª, e impedir sobreposição de horário (consulta ~20-30 min).
        return suggested or "Certo! Vou te ajudar com seu agendamento."
    return suggested or "Recebido!"


@router.post("/webhook")
async def receive_webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    """Receive inbound WhatsApp messages and respond."""
    payload = await request.json()
    messages = whatsapp_service.parse_inbound(payload)

    for msg in messages:
        wa_id = msg["wa_id"]
        message_id = msg.get("message_id")

        # Idempotency: WhatsApp retries webhooks; skip messages we already stored.
        if message_id and db.query(Mensagem).filter_by(wa_message_id=message_id).first():
            logger.info("Duplicate webhook message %s ignored", message_id)
            continue

        # 1. Resolve the text (transcribe audio if needed).
        if msg["canal"] == CanalMensagem.AUDIO:
            audio_bytes = await whatsapp_service.download_media(msg["audio_id"])
            texto = transcription_service.transcribe(audio_bytes)
        else:
            texto = msg["text"]

        # 2. Resolve the patient + conversation.
        paciente = _get_or_create_paciente(db, wa_id)
        conversa = db.query(Conversa).filter_by(wa_id=wa_id, ativa=True).first()
        if conversa is None:
            conversa = Conversa(wa_id=wa_id, paciente_id=paciente.id)
            db.add(conversa)
            db.flush()

        # 3. Interpret with the LLM (ator IA).
        result = await llm_service.interpret(texto)
        db.add(
            Mensagem(
                conversa_id=conversa.id,
                wa_message_id=message_id,
                from_user=True,
                canal=msg["canal"],
                conteudo=texto,
                intencao=result.intencao,
            )
        )

        # 4. Route by intent and reply.
        resposta = await _resolve_reply(result.intencao, texto, result.resposta)
        await whatsapp_service.send_text(wa_id, resposta)
        db.add(
            Mensagem(
                conversa_id=conversa.id,
                from_user=False,
                canal=CanalMensagem.TEXTO,
                conteudo=resposta,
            )
        )
        db.commit()

    # Always 200 quickly so Meta does not retry.
    return {"status": "received"}
