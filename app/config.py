"""Central application configuration.

Loads settings from environment variables (and a local .env file in
development). See .env.example for the full list of variables.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- App ----
    app_name: str = "TeleMed+"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # ---- Database (MySQL) ----
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "telemed"
    mysql_password: str = "telemed_dev_pw"
    mysql_database: str = "telemed"
    # Optional explicit override; if empty it is derived from the parts above.
    database_url: str | None = None
    # Echo every SQL statement to the log. Noisy — opt in only when debugging SQL.
    db_echo: bool = False

    # ---- Security ----
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # ---- Painel admin (usuário criado pelo seed) ----
    admin_email: str = "admin@telemed.example"
    admin_password: str = "admin123"

    # ---- WhatsApp (Meta Cloud API) ----
    whatsapp_api_base_url: str = "https://graph.facebook.com/v21.0"
    whatsapp_phone_number_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_verify_token: str = "telemed-webhook-verify"

    # ---- LLM ----
    llm_backend: Literal["ollama", "huggingface"] = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.1:8b"
    hf_model: str = "meta-llama/Llama-3.1-8B-Instruct"

    # ---- Audio transcription ----
    whisper_model: str = "base"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_uri(self) -> str:
        """Full SQLAlchemy connection string for MySQL via PyMySQL."""
        if self.database_url:
            return self.database_url
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
            "?charset=utf8mb4"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor. Use this everywhere instead of instantiating Settings()."""
    return Settings()


settings = get_settings()
