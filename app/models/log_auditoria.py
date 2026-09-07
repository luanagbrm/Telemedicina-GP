"""LogAuditoria model (Design.md §6.1, RNF-05).

Append-only audit trail for access to clinical data (LGPD art. 37). The
application must never UPDATE or DELETE rows in this table.
"""

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import AcaoAuditoria


class LogAuditoria(Base):
    __tablename__ = "logs_auditoria"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    usuario_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"), index=True, nullable=True
    )
    acao: Mapped[AcaoAuditoria] = mapped_column(Enum(AcaoAuditoria), nullable=False)
    recurso: Mapped[str] = mapped_column(String(100), nullable=False)
    recurso_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)  # IPv6-safe
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )

    def __repr__(self) -> str:
        return f"<LogAuditoria id={self.id} acao={self.acao} recurso={self.recurso!r}>"
