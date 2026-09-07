"""Database engine, session factory, and declarative base.

Uses SQLAlchemy 2.0 style. The FastAPI dependency `get_db` yields a session
per request and always closes it.
"""

from collections.abc import Generator
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def _build_connect_args() -> dict[str, Any]:
    """DBAPI connect kwargs for mysql-connector-python (charset + TLS)."""
    args: dict[str, Any] = {"charset": "utf8mb4"}
    # TLS: managed MySQL (Aiven) requires it; local dev DB usually doesn't.
    args["ssl_disabled"] = not settings.db_ssl
    if settings.db_ssl and settings.db_ssl_ca:
        # When a CA is provided, verify the server certificate against it.
        args["ssl_ca"] = settings.db_ssl_ca
        args["ssl_verify_cert"] = True
    return args


engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,   # transparently recover dropped MySQL connections
    pool_recycle=3600,    # avoid MySQL "server has gone away" on idle conns
    echo=settings.db_echo,  # off by default; opt in via DB_ECHO=true to trace SQL
    connect_args=_build_connect_args(),
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that provides a scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
