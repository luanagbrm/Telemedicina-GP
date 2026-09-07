"""Central application configuration.

Loads settings from environment variables (and a local .env file in
development). See .env.example for the full list of variables.
"""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import computed_field
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

    # ---- Database (MySQL / Aiven) ----
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "telemed"
    db_password: str = "telemed_dev_pw"
    db_name: str = "telemed"
    # Aiven (and other managed MySQL) require TLS. Set false only for a local dev DB.
    db_ssl: bool = True
    # Optional path to the CA cert (Aiven "ca.pem") for full certificate verification.
    db_ssl_ca: str | None = None
    # Optional explicit override; if set, it wins over the parts above.
    database_url: str | None = None
    # Echo every SQL statement to the log. Noisy — opt in only when debugging SQL.
    db_echo: bool = False

    # NOTE: backend-specific settings (JWT/auth, WhatsApp, LLM, transcription)
    # belong to the backend task and are intentionally not part of this dev setup.

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_uri(self) -> str:
        """Full SQLAlchemy connection string (MySQL via mysql-connector-python).

        SSL/charset are applied through connect_args in app/database.py, not here.
        """
        if self.database_url:
            return self.database_url
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password)
        return (
            f"mysql+mysqlconnector://{user}:{password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
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
