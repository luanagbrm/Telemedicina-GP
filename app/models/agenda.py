"""Agenda — slot de horário de um médico (modelo ER: Agenda).

É a fonte da verdade da disponibilidade. A métrica da carta ("100% dos horários
apresentados correspondem ao sistema") depende de só oferecer slots com
status_horario = DISPONIVEL, marcando-os como OCUPADO ao criar a Consulta.
"""

from datetime import date, time

from sqlalchemy import Date, Enum, ForeignKey, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import StatusHorario


class Agenda(Base):
    __tablename__ = "agenda"
    __table_args__ = (
        # Um médico não pode ter dois slots na mesma data + horário.
        UniqueConstraint("medico_id", "data", "horario", name="uq_medico_data_horario"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    medico_id: Mapped[int] = mapped_column(
        ForeignKey("medicos.id", ondelete="CASCADE"), index=True, nullable=False
    )
    data: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    horario: Mapped[time] = mapped_column(Time, nullable=False)
    periodo: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "Manhã" / "Tarde"
    status_horario: Mapped[StatusHorario] = mapped_column(
        Enum(StatusHorario), default=StatusHorario.DISPONIVEL, index=True, nullable=False
    )

    medico: Mapped["Medico"] = relationship(back_populates="agenda")  # noqa: F821
    consulta: Mapped["Consulta | None"] = relationship(  # noqa: F821
        back_populates="agenda", uselist=False
    )

    def __repr__(self) -> str:
        return f"<Agenda id={self.id} medico_id={self.medico_id} data={self.data} {self.horario}>"
