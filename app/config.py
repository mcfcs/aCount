import os
from dotenv import load_dotenv

load_dotenv()


def _as_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


class Config:
    """Base configuration."""
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JSON_SORT_KEYS = False
    SHOES_IMAGE_UPLOAD_DIR = os.getenv("SHOES_IMAGE_UPLOAD_DIR")

    # When set, every /api/* request must send a matching `X-API-Key` header.
    # Leave unset for unauthenticated local development.
    API_KEY = os.getenv("API_KEY")

    # Comma-separated list of allowed browser origins for /api/* (CORS).
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

    # The destructive /api/settings/reset endpoint is disabled unless opted in.
    ALLOW_DB_RESET = _as_bool(os.getenv("ALLOW_DB_RESET"), default=False)


class DevelopmentConfig(Config):
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "postgresql://acount_user:acount_pass@localhost:5432/acount_db"
    )
    # Reset is allowed by default in development for convenience.
    ALLOW_DB_RESET = _as_bool(os.getenv("ALLOW_DB_RESET"), default=True)


class ProductionConfig(Config):
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "TEST_DATABASE_URL",
        "sqlite:///test_acount.db"
    )


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
