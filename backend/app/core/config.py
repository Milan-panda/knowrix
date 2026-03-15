from pydantic_settings import BaseSettings
from functools import lru_cache
from urllib.parse import quote_plus


class Settings(BaseSettings):
    ENVIRONMENT: str = "dev"

    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"
    CORS_ORIGINS: str = "http://localhost:3000"

    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "contextiq"
    POSTGRES_USER: str = "contextiq"
    POSTGRES_PASSWORD: str = "changeme"

    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333

    REDIS_URL: str = "redis://redis:6379/0"

    MINIO_ENDPOINT: str = "http://minio:9000"
    MINIO_ROOT_USER: str = "minioadmin"
    MINIO_ROOT_PASSWORD: str = "changeme"
    MINIO_BUCKET: str = "contextiq"

    ANTHROPIC_API_KEY: str = ""
    NEXTAUTH_SECRET: str = ""
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_TOKEN: str = ""  # Fallback when no workspace connector
    NOTION_API_KEY: str = ""  # Fallback when no workspace connector
    NOTION_CLIENT_ID: str = ""  # OAuth public integration
    NOTION_CLIENT_SECRET: str = ""
    NOTION_REDIRECT_URI: str = ""  # Optional; default derived from BACKEND_URL
    ENCRYPTION_KEY: str = ""  # Base64 Fernet key for connector tokens (32 url-safe bytes)

    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    LLM_MODEL: str = "stepfun/step-3.5-flash:free"

    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    EMBEDDING_DIM: int = 384
    RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.POSTGRES_USER)}:{quote_plus(self.POSTGRES_PASSWORD)}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def notion_redirect_uri(self) -> str:
        if self.NOTION_REDIRECT_URI:
            return self.NOTION_REDIRECT_URI
        return f"{self.BACKEND_URL.rstrip('/')}/api/v1/workspaces/connectors/notion/callback"

    @property
    def github_connector_redirect_uri(self) -> str:
        return f"{self.BACKEND_URL.rstrip('/')}/api/v1/workspaces/connectors/github/callback"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
