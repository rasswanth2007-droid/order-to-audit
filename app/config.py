from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-secret-do-not-use-in-production-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    env: str = "development"
    database_url: str = "sqlite:///./data/app.db"
    secret_key: str = DEV_SECRET
    access_token_minutes: int = 600
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    docs_enabled: bool = True
    rate_limit_per_minute: int = 300
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    seed_demo_password: str = "Demo@12345"

    @property
    def is_prod(self) -> bool:
        return self.env.lower() == "production"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip() and o.strip() != "*"]

    def validate_for_runtime(self) -> None:
        if self.is_prod and (self.secret_key == DEV_SECRET or len(self.secret_key) < 32):
            raise RuntimeError("SECRET_KEY must be set to a random value of >= 32 chars in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
