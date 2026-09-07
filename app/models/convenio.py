"""Convenio — plano de saúde. `carteirinha` é a PK (VARCHAR) do modelo ER."""

from datetime import date

from sqlalchemy import Date, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Convenio(Base):
    __tablename__ = "convenios"

    carteirinha: Mapped[str] = mapped_column(String(50), primary_key=True)
    nome_convenio: Mapped[str] = mapped_column(String(100), nullable=False)
    data_expiracao: Mapped[date | None] = mapped_column(Date, nullable=True)

    pacientes: Mapped[list["Paciente"]] = relationship(back_populates="convenio")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Convenio carteirinha={self.carteirinha!r} convenio={self.nome_convenio!r}>"
