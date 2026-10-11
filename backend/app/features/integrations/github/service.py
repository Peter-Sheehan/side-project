"""Linking a user's GitHub account for repo access. No HTTP or FastAPI here:
callers pass in a DB session, Redis and a GitHubClient."""

import json
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.crypto import decrypt, encrypt
from app.features.integrations.github.client import (
    GitHubAuthError,
    GitHubClient,
    GitHubError,
    GitHubRepo,
    TokenSet,
    make_pkce,
)
from app.features.integrations.models import ProviderConnection

PROVIDER = "github"
STATE_TTL_SECONDS = 600
REFRESH_MARGIN = timedelta(minutes=5)  # refresh tokens this close to expiry


class LinkError(Exception):
    """Linking failed. `reason` is a short code shown to the user."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _state_key(state: str) -> str:
    return f"oauth_state:{state}"


def start_link(r: redis.Redis, github: GitHubClient, user_id: str) -> tuple[str, str]:
    """Begin the OAuth flow. Returns (authorize_url, state); the caller must
    also bind `state` to the browser so the callback can be checked."""
    state = secrets.token_urlsafe(32)
    verifier, challenge = make_pkce()
    r.set(
        _state_key(state),
        json.dumps({"verifier": verifier, "user_id": user_id}),
        ex=STATE_TTL_SECONDS,
    )
    return github.authorize_url(state, challenge), state


def complete_link(
    db: Session,
    r: redis.Redis,
    github: GitHubClient,
    *,
    code: str,
    state: str,
    browser_state: str | None,
) -> ProviderConnection:
    """Finish the OAuth flow and store the user's tokens. Raises LinkError."""
    # The state must match the one bound to this browser, so a callback URL
    # planted by an attacker is rejected.
    if not browser_state or not secrets.compare_digest(browser_state, state):
        raise LinkError("invalid_state")
    raw = r.getdel(_state_key(state))  # single use
    if raw is None:
        raise LinkError("expired_state")
    flow = json.loads(raw)
    user_id = flow["user_id"]

    try:
        tokens = github.exchange_code(code, flow["verifier"])
        profile = github.fetch_profile(tokens.access_token)
    except GitHubError as e:
        raise LinkError("github_error") from e

    taken = db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.provider == PROVIDER,
            ProviderConnection.provider_user_id == profile.id,
        )
    )
    if taken is not None and taken.user_id != user_id:
        raise LinkError("already_linked")

    # Reuse the user's existing row, so linking a different GitHub account replaces it.
    conn = taken or _get_connection(db, user_id)
    if conn is None:
        conn = ProviderConnection(user_id=user_id, provider=PROVIDER)
        db.add(conn)
    conn.provider_user_id = profile.id
    _store_tokens(conn, tokens, profile.login)
    try:
        db.commit()
    except IntegrityError as e:
        # Lost a race with another user linking the same account.
        db.rollback()
        raise LinkError("already_linked") from e
    return conn


class LinkRevoked(Exception):
    """GitHub stopped accepting the user's tokens, so the link was removed.
    The user has to link GitHub again."""


def check_link(
    db: Session, github: GitHubClient, user_id: str
) -> ProviderConnection | None:
    """The user's GitHub connection after confirming GitHub still accepts it,
    or None if they haven't linked one. Raises LinkRevoked.

    If GitHub can't be reached, the stored connection is returned unverified:
    an outage shouldn't look like the user unlinked."""
    conn = _get_connection(db, user_id)
    if conn is None:
        return None
    try:
        profile = _call(db, github, conn, github.fetch_profile)
    except GitHubError:
        return conn
    if profile.login != conn.provider_login:  # renamed on GitHub
        conn.provider_login = profile.login
        db.commit()
    return conn


def list_repos(
    db: Session, github: GitHubClient, user_id: str
) -> list[GitHubRepo] | None:
    """Repos the user's linked account can reach, or None if not linked.
    Raises LinkRevoked, or GitHubError if GitHub fails."""
    conn = _get_connection(db, user_id)
    if conn is None:
        return None
    return _call(db, github, conn, github.list_repos)


def _call[T](
    db: Session,
    github: GitHubClient,
    conn: ProviderConnection,
    fn: Callable[[str], T],
) -> T:
    """Run fn with a valid access token. If GitHub rejects the grant, delete the
    connection (its tokens are dead) and raise LinkRevoked."""
    try:
        return fn(_access_token(db, github, conn))
    except GitHubAuthError as e:
        db.rollback()
        db.delete(conn)
        db.commit()
        raise LinkRevoked from e


def _access_token(db: Session, github: GitHubClient, conn: ProviderConnection) -> str:
    """The stored access token, refreshed first if it has expired or is about to."""
    expires_soon = conn.token_expires_at is not None and (
        conn.token_expires_at <= datetime.now(UTC) + REFRESH_MARGIN
    )
    if not expires_soon:
        return decrypt(conn.access_token_enc)
    if not conn.refresh_token_enc:
        raise GitHubAuthError("token expired and can't be refreshed")
    tokens = github.refresh(decrypt(conn.refresh_token_enc))
    _store_tokens(conn, tokens, conn.provider_login)
    db.commit()
    return tokens.access_token


def unlink(db: Session, user_id: str) -> bool:
    """Remove the user's GitHub connection. Returns False if there was none."""
    conn = _get_connection(db, user_id)
    if conn is None:
        return False
    db.delete(conn)
    db.commit()
    return True


def _get_connection(db: Session, user_id: str) -> ProviderConnection | None:
    return db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.user_id == user_id,
            ProviderConnection.provider == PROVIDER,
        )
    )


def _store_tokens(
    conn: ProviderConnection, tokens: TokenSet, login: str | None
) -> None:
    conn.provider_login = login
    conn.access_token_enc = encrypt(tokens.access_token)
    conn.refresh_token_enc = (
        encrypt(tokens.refresh_token) if tokens.refresh_token else None
    )
    conn.token_expires_at = tokens.expires_at
