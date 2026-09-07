"""FastAPI application entrypoint (lean dev setup).

Run in dev with:
    uvicorn app.main:app --reload

This is the runnable skeleton — routes, models, services and the admin panel
are added by the separate backend task.
"""

import logging

from fastapi import FastAPI

from app import __version__
from app.api.routes import health
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
for _noisy in ("asyncio", "httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Dev setup skeleton — TeleMed+ chatbot (backend added separately).",
    debug=settings.debug,
)

app.include_router(health.router)


@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    return {
        "app": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "environment": settings.environment,
    }
