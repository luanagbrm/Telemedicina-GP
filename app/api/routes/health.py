"""Health / readiness endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.config import settings
from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness probe — does not touch external deps."""
    return {"status": "ok", "app": settings.app_name, "version": __version__}


@router.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict[str, str]:
    """Readiness probe — verifies the MySQL connection."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
