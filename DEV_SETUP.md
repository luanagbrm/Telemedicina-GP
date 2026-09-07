# TeleMed+ — Dev Setup

Ambiente de desenvolvimento (skeleton runnable) do **TeleMed+**, o chatbot de
agendamento no WhatsApp. Este repositório cobre **apenas o setup de
desenvolvimento**: ambiente Python, configuração, conexão com o banco (Aiven
MySQL), migrations, testes e Docker.

> **Escopo:** os models de domínio, os serviços (WhatsApp, LLM/RAG, transcrição),
> o painel admin e a lógica de agendamento fazem parte da **tarefa de backend**
> (separada). As pastas `app/models`, `app/services`, `app/admin` e
> `app/core` ficam aqui como esqueleto para o backend preencher.

Stack: **Python 3.11+ · FastAPI · MySQL (Aiven) · SQLAlchemy**

---

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|------------|--------|------------|
| Python | 3.11+ | `python3 --version` |
| Docker + Docker Compose | recente | Opcional — só para o MySQL local offline |

---

## 2. Setup rápido

```bash
# 1. Ambiente virtual + dependências
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Variáveis de ambiente
cp .env.example .env
# preencha as credenciais DB_* da Aiven no .env

# 3. Rode a API
uvicorn app.main:app --reload
```

Acesse:
- API: <http://localhost:8000>
- Swagger/OpenAPI: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health> e <http://localhost:8000/health/db>

`/health/db` executa um `SELECT 1` — é a prova de que a conexão com o banco está
funcionando.

---

## 3. Estrutura do projeto

```text
.
├── app/
│   ├── main.py                # entrypoint FastAPI (root + /health)
│   ├── config.py              # settings via env (.env): app + banco
│   ├── database.py            # engine + sessão SQLAlchemy + SSL
│   ├── api/routes/health.py   # /health e /health/db
│   ├── models/                # (esqueleto — backend)
│   ├── services/              # (esqueleto — backend)
│   ├── admin/                 # (esqueleto — backend)
│   └── core/                  # (esqueleto — backend)
├── scripts/init_db.sql        # cria banco de teste + grants (MySQL local)
├── tests/test_health.py       # smoke tests
├── docker-compose.yml         # MySQL local opcional
├── requirements.txt
├── Makefile
└── pyproject.toml             # config ruff/pytest
```

Ou, com o `Makefile`: `make venv && source .venv/bin/activate && make install env run`.

---

## 4. Banco de dados (MySQL / Aiven)

O banco **padrão é o MySQL gerenciado na Aiven**. A conexão usa SQLAlchemy com o
driver `mysql-connector-python` (`mysql+mysqlconnector://...`); a URL é montada em
`app/config.py` a partir das variáveis `DB_*` do `.env`:

| Variável | Descrição |
|----------|-----------|
| `DB_HOST` | host da Aiven (ex: `xxx.aivencloud.com`) |
| `DB_PORT` | porta da Aiven |
| `DB_USER` / `DB_PASSWORD` | credenciais |
| `DB_NAME` | nome do banco (ex: `defaultdb`) |
| `DB_SSL` | `true` para Aiven (TLS obrigatório); `false` só no Docker local |
| `DB_SSL_CA` | (opcional) caminho do `ca.pem` da Aiven p/ verificar o certificado |
| `DB_ECHO` | `true` para logar todo SQL (barulhento; padrão `false`) |

O TLS é aplicado via `connect_args` em `app/database.py`.

> **MySQL local (opcional, offline):** `docker compose up -d` sobe um MySQL 8
> local. Para usá-lo, no `.env`: `DB_HOST=127.0.0.1`, `DB_PORT=3306`,
> `DB_USER=telemed`, `DB_PASSWORD=telemed_dev_pw`, `DB_NAME=telemed`,
> **`DB_SSL=false`**.

### Schema (fonte da verdade = Aiven)

**Não usamos ferramenta de migration (ex: Alembic).** O schema já existe e é
gerenciado diretamente no Aiven, então o banco é a fonte da verdade — o app
apenas se conecta e (na tarefa de backend) mapeia os models para as tabelas
existentes. Mantenha um `schema.sql` de referência no repo se quiser versionar a
estrutura.

Se um dia o projeto precisar de schema versionado pelo código (múltiplos
ambientes, recriação repetível), aí sim vale adicionar Alembic.

---

## 5. Testes e qualidade

```bash
pytest                 # smoke tests (sobem o app, sem precisar de banco)
ruff check app tests
```

---

## 6. Solução de problemas

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `Can't connect to MySQL` (Aiven) | credenciais/porta erradas ou IP não liberado | confira `DB_*` no `.env` e o "Allowed IP addresses" na Aiven |
| Erro de SSL/TLS ao conectar | `DB_SSL=false` apontando p/ Aiven | Aiven exige TLS: `DB_SSL=true` |
| `Can't connect to MySQL` (local) | container ainda subindo | `docker compose logs mysql`; aguarde o healthcheck; use `DB_SSL=false` |
