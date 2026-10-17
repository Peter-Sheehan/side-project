from functools import lru_cache
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All backend configuration. Values come from environment variables
    (case-insensitive), falling back to backend/.env when run outside Docker."""

    # hide_input_in_errors keeps secrets out of startup tracebacks.
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    database_url: str
    redis_url: str

    # Fernet key for encrypting provider tokens at rest.
    token_encryption_key: SecretStr

    # GitHub App used for repository access (not for sign-in).
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")
    github_redirect_uri: str = "http://localhost:3000/api/integrations/github/callback"
    # The App's URL name (github.com/apps/<slug>), for the "install the App" link.
    github_app_slug: str = ""

    auth_service_url: str = "http://auth:3001"  # Better Auth owns sign-in
    auth_session_cache_seconds: int = 60  # How long a checked session is cached

    frontend_url: str = "http://localhost:3000"
    cookie_secure: bool = False

    @field_validator("token_encryption_key")
    @classmethod
    def _valid_fernet_key(cls, v: SecretStr) -> SecretStr:
        try:
            Fernet(v.get_secret_value())
        except ValueError as e:
            raise ValueError(
                "must be a Fernet key; run scripts/setup.sh to generate one"
            ) from e
        return v

    @field_validator("frontend_url", "auth_service_url")
    @classmethod
    def _bare_origin(cls, v: str) -> str:
        # PUBLIC_URL in compose. Redirects and the GitHub callback append paths to
        # it, so it must be just scheme://host[:port].
        url = urlsplit(v.strip())
        if url.scheme not in ("http", "https") or not url.netloc:
            raise ValueError("must start with http:// or https://")
        if url.path.rstrip("/") or url.query or url.fragment:
            raise ValueError("must have no path, e.g. http://203.0.113.10:3000")
        return f"{url.scheme}://{url.netloc}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
