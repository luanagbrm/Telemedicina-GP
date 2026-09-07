"""Database engine, session factory, and declarative base.

Uses SQLAlchemy 2.0 style. The FastAPI dependency `get_db` yields a session
per request and always closes it.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,   # transparently recover dropped MySQL connections
    pool_recycle=3600,    # avoid MySQL "server has gone away" on idle conns
    echo=settings.db_echo,  # off by default; opt in via DB_ECHO=true to trace SQL
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
