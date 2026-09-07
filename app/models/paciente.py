"""Paciente — identificado pelo WhatsApp e cadastrado ao longo da conversa.

Campos alinhados ao modelo ER (nome_completo, email, cpf único, data_nascimento,
telefone, carteirinha -> Convenio). Exceto o telefone (chave natural do WhatsApp),
os dados são NULLABLE para permitir a captura progressiva no fluxo "Cadastrar
paciente" — o bot só tem o telefone no primeiro contato.

LGPD (risco #3): guardar apenas o necessário e evitar repetir a coleta de dados.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Paciente(Base):
    __tablename__ = "pacientes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Telefone/WhatsApp em E.164 (ex: 5511999999999) — chave natural do paciente.
    telefone: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    nome_completo: Mapped[str | None] = mapped_column(String(150), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cpf: Mapped[str | None] = mapped_column(String(14), unique=True, index=True, nullable=True)
    data_nascimento: Mapped[date | None] = mapped_column(Date, nullable=True)
    carteirinha: Mapped[str | None] = mapped_column(
        ForeignKey("convenios.carteirinha", ondelete="SET NULL"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    convenio: Mapped["Convenio | None"] = relationship(back_populates="pacientes")  # noqa: F821
    consultas: Mapped[list["Consulta"]] = relationship(back_populates="paciente")  # noqa: F821
    exames: Mapped[list["AgendamentoExame"]] = relationship(back_populates="paciente")  # noqa: F821
    conversas: Mapped[list["Conversa"]] = relationship(back_populates="paciente")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Paciente id={self.id} telefone={self.telefone!r}>"
