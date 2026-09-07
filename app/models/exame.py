"""Exame e AgendamentoExame (modelo ER).

O time modelou exames separadamente das consultas: `Exame` é o catálogo de tipos
de exame; `AgendamentoExame` é a marcação de um exame para um paciente. Ao
contrário da Consulta (que usa a Agenda do médico), o agendamento de exame guarda
sua própria data/horário.
"""

from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import StatusExame


class Exame(Base):
    __tablename__ = "exames"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    nome_exame: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    duracao_minutos: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    agendamentos: Mapped[list["AgendamentoExame"]] = relationship(back_populates="exame")

    def __repr__(self) -> str:
        return f"<Exame id={self.id} nome={self.nome_exame!r}>"


class AgendamentoExame(Base):
    __tablename__ = "agendamentos_exame"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    exame_id: Mapped[int] = mapped_column(
        ForeignKey("exames.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    paciente_id: Mapped[int] = mapped_column(
        ForeignKey("pacientes.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    data: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    horario: Mapped[time] = mapped_column(Time, nullable=False)
    status_exame: Mapped[StatusExame] = mapped_column(
        Enum(StatusExame), default=StatusExame.AGENDADO, index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    exame: Mapped["Exame"] = relationship(back_populates="agendamentos")
    paciente: Mapped["Paciente"] = relationship(back_populates="exames")  # noqa: F821

    def __repr__(self) -> str:
        return f"<AgendamentoExame id={self.id} exame_id={self.exame_id} data={self.data}>"
