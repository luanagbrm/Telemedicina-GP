"""Médico — dados fictícios no protótipo (sem integração hospitalar real)."""

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Medico(Base):
    __tablename__ = "medicos"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    nome: Mapped[str] = mapped_column(String(150), nullable=False)
    especialidade_id: Mapped[int] = mapped_column(
        ForeignKey("especialidades.id", ondelete="RESTRICT"), index=True, nullable=False
    )

    especialidade: Mapped["Especialidade"] = relationship(back_populates="medicos")  # noqa: F821
    agenda: Mapped[list["Agenda"]] = relationship(  # noqa: F821
        back_populates="medico", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Medico id={self.id} nome={self.nome!r}>"
