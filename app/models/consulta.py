"""Consulta — agendamento de uma consulta (modelo ER).

O médico e o horário vêm do slot de Agenda referenciado (id_agenda), então a
Consulta não duplica medico_id/data — usa `consulta.agenda.medico` e
`consulta.agenda.data/horario`.
"""

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import StatusConsulta


class Consulta(Base):
    __tablename__ = "consultas"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paciente_id: Mapped[int] = mapped_column(
        ForeignKey("pacientes.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    agenda_id: Mapped[int] = mapped_column(
        ForeignKey("agenda.id", ondelete="RESTRICT"), unique=True, index=True, nullable=False
    )
    status_consulta: Mapped[StatusConsulta] = mapped_column(
        Enum(StatusConsulta), default=StatusConsulta.AGENDADA, index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    paciente: Mapped["Paciente"] = relationship(back_populates="consultas")  # noqa: F821
    agenda: Mapped["Agenda"] = relationship(back_populates="consulta")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Consulta id={self.id} paciente_id={self.paciente_id} status={self.status_consulta}>"
