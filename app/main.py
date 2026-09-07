"""FastAPI application entrypoint.

Run in dev with:
    uvicorn app.main:app --reload
"""

import logging

from fastapi import FastAPI

from app import __version__
from app.admin import setup_admin
from app.api.routes import health, whatsapp
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
# Silence chatty third-party loggers; keep only what's useful in dev.
for _noisy in ("asyncio", "httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Chatbot WhatsApp para agendamento de consultas e exames com IA open source.",
    debug=settings.debug,
)

app.include_router(health.router)
app.include_router(whatsapp.router, prefix="/api")

# Painel administrativo (SQLAdmin) em /admin
setup_admin(app)


@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    return {
        "app": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "environment": settings.environment,
    }
