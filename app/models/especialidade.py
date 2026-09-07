"""Especialidade médica (ex: Cardiologia, Dermatologia)."""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Especialidade(Base):
    __tablename__ = "especialidades"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    nome_especialidade: Mapped[str] = mapped_column(
        String(100), unique=True, index=True, nullable=False
    )

    medicos: Mapped[list["Medico"]] = relationship(back_populates="especialidade")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Especialidade id={self.id} nome={self.nome_especialidade!r}>"
