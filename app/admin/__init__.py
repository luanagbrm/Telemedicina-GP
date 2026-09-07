"""Painel administrativo (SQLAdmin) — visualização do que está no banco.

Monta um admin web no próprio app FastAPI em /admin, com telas de listagem e
detalhe geradas automaticamente a partir dos models SQLAlchemy.
"""

from fastapi import FastAPI
from sqladmin import Admin

from app.admin.auth import AdminAuth
from app.admin.views import ALL_VIEWS
from app.config import settings
from app.database import engine


def setup_admin(app: FastAPI) -> Admin:
    admin = Admin(
        app,
        engine,
        title="TeleMed+ · Painel",
        authentication_backend=AdminAuth(secret_key=settings.jwt_secret_key),
    )
    for view in ALL_VIEWS:
        admin.add_view(view)
    return admin
