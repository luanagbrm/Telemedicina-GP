"""Chatbot models — track WhatsApp conversations and messages.

Maps the use-case diagram: a Usuario sends a solicitação (text or audio) over
WhatsApp, the IA interprets it (intenção), and the bot responds. We persist the
exchange so flows like agendar/cancelar/remarcar can be resumed statefully.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import CanalMensagem, IntencaoChatbot


class Conversa(Base):
    __tablename__ = "conversas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # WhatsApp phone number in E.164 (wa_id). May not map to a Paciente yet.
    wa_id: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    paciente_id: Mapped[int | None] = mapped_column(
        ForeignKey("pacientes.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Free-form JSON-ish state for multi-turn flows (kept as text for portability).
    estado: Mapped[str | None] = mapped_column(Text, nullable=True)
    ativa: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    paciente: Mapped["Paciente | None"] = relationship(back_populates="conversas")  # noqa: F821
    mensagens: Mapped[list["Mensagem"]] = relationship(
        back_populates="conversa", cascade="all, delete-orphan", order_by="Mensagem.created_at"
    )

    def __repr__(self) -> str:
        return f"<Conversa id={self.id} wa_id={self.wa_id!r} ativa={self.ativa}>"


class Mensagem(Base):
    __tablename__ = "mensagens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversa_id: Mapped[int] = mapped_column(
        ForeignKey("conversas.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # WhatsApp message id (for idempotency / dedupe of webhook retries).
    wa_message_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    from_user: Mapped[bool] = mapped_column(Boolean, nullable=False)  # True=inbound, False=bot
    canal: Mapped[CanalMensagem] = mapped_column(Enum(CanalMensagem), nullable=False)
    conteudo: Mapped[str | None] = mapped_column(Text, nullable=True)  # texto ou transcrição
    intencao: Mapped[IntencaoChatbot | None] = mapped_column(Enum(IntencaoChatbot), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )

    conversa: Mapped["Conversa"] = relationship(back_populates="mensagens")

    def __repr__(self) -> str:
        return f"<Mensagem id={self.id} from_user={self.from_user} intencao={self.intencao}>"
