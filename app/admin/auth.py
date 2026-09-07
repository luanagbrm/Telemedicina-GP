"""Autenticação do painel — login contra a tabela `usuarios` (bcrypt).

O painel expõe dados de pacientes/agendas, então não pode ficar aberto (LGPD).
Login simples por e-mail + senha; a sessão guarda apenas o e-mail do usuário.
"""

from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from app.core.security import verify_password
from app.database import SessionLocal
from app.models.usuario import Usuario


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = str(form.get("username", "")).strip().lower()
        password = str(form.get("password", ""))

        db = SessionLocal()
        try:
            user = db.query(Usuario).filter(Usuario.email == email).first()
            if user and user.ativo and verify_password(password, user.senha_hash):
                request.session.update({"user": user.email})
                return True
            return False
        finally:
            db.close()

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return "user" in request.session
